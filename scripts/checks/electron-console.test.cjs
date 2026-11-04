// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Electron GUI は表示し、コンソール版の補助プロセスだけを非表示にする。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
const {spawn}=require('node:child_process');
const vm=require('node:vm');
const root=resolve(__dirname,'../..');

test('Avatar開発用ラッパーも実子プロセスにコンソールを作らず出力を受け取る',{skip:process.platform!=='win32'},async()=>{
 const file=resolve(root,'frontend_avatar/electron/dev-filter.cjs');let output='',child;
 const python=process.env.AIDIY_TEST_PYTHON||'python';
 const fakeRequire=name=>name==='node:child_process'?{spawn:(_exe,_args,options)=>{
  assert.equal(options.windowsHide,true);
  child=spawn(python,['-c','import ctypes; print(ctypes.windll.kernel32.GetConsoleWindow())'],options);return child;
 }}:require(name);
 fakeRequire.resolve=()=> 'fixture';
 let done;const ended=new Promise(r=>done=r);
 const fakeProcess={execPath:process.execPath,argv:['node',file],env:process.env,stdout:{write:s=>output+=s},stderr:{write:s=>output+=s},exit:done,kill:()=>assert.fail('unexpected signal'),pid:process.pid};
 const fixtureModule={exports:{}};fakeRequire.main=fixtureModule;
 vm.runInNewContext(readFileSync(file,'utf8'),{require:fakeRequire,process:fakeProcess,module:fixtureModule});
 assert.equal(await ended,0);assert.equal(output.trim(),'0');assert.ok(child.pid);
});

test('GUIとして起動するElectronバイナリはWindows GUI形式',{skip:process.platform!=='win32'},()=>{
 const inspected=[];
 for(const owner of ['backend_diag','frontend_ide','frontend_ide/host','frontend_ide/viewer','frontend_avatar','frontend_channels']){
  const path=resolve(root,owner,'node_modules/electron/dist/electron.exe');if(!existsSync(path))continue;
  const bytes=readFileSync(path),pe=bytes.readUInt32LE(0x3c);assert.equal(bytes.toString('ascii',pe,pe+4),'PE\0\0');
  const subsystem=bytes.readUInt16LE(pe+24+68);assert.equal(subsystem,2,owner);inspected.push(owner);
 }
 assert.ok(inspected.length>=3,JSON.stringify(inspected));
 console.log('GUIバイナリ確認: '+inspected.join(', '));
});
