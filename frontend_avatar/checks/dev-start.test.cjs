// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {test}=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events');
const {background,startDevelopment}=require('../electron/dev-start.cjs');

test('Avatarの準備完了後だけElectron監視を直接起動し、終了時は所有する子だけ回収する',async()=>{
 const calls=[],stops=[],children=[];let ready;
 const waiting=new Promise(resolve=>ready=resolve);
 const running=startDevelopment({launch:(command,args,options)=>{const child=Object.assign(new EventEmitter(),{pid:children.length+1,exitCode:null});children.push(child);calls.push({command,args,options});return child;},wait:()=>waiting,stop:async child=>stops.push(child.pid)});
 assert.equal(calls.length,2);assert.match(calls[0].args[0],/[\\/]vite[\\/]bin[\\/]vite.js$/);assert.ok(calls.every(c=>c.command===process.execPath));
 ready();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3);assert.equal(calls[2].options.env.VITE_DEV_SERVER_URL,'http://127.0.0.1:8092');
 assert.match(calls[2].args[0],/dev-filter.cjs$/);children[2].emit('exit',0);assert.equal(await running,0);assert.deepEqual(stops,[1,2,3]);
});
test('準備中の起動失敗ではElectronを起動せず、子の回収完了まで待つ',async()=>{
 const children=[];let finishStop,settled=false;
 const gate=new Promise(resolve=>finishStop=resolve);
 const running=startDevelopment({launch:()=>{const child=new EventEmitter();children.push(child);return child;},wait:()=>new Promise(()=>{}),stop:()=>gate});
 const rejected=assert.rejects(running,/準備失敗/).then(()=>settled=true);
 children[0].emit('error',Error('準備失敗'));await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 finishStop();await rejected;assert.equal(children.length,2);
});
test('直接起動した実補助プロセスもコンソールなしでログを返す',{skip:process.platform!=='win32'},async()=>{
 const child=background(process.env.AIDIY_TEST_PYTHON||'python',['-c','import ctypes;print(ctypes.windll.kernel32.GetConsoleWindow())'],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);
 const [code]=await once(child,'exit');assert.equal(code,0);assert.equal(output.trim(),'0');
});
test('アプリ自身の終了だけを検出し、ファイル変更の再起動では開発サーバーを止めない',()=>{
 const {isAppClosed}=require('../electron/dev-filter.cjs');
 for(const line of ['[electronmon] app exited due to signal (null), waiting for change to restart it','[electronmon] app exited with code 1, waiting for change to restart it'])assert.equal(isAppClosed(line),true,line);
 for(const line of ['[electronmon] restarting app due to file change','[electronmon] ignoring exit with code 1','[electronmon] waiting for a change to restart it'])assert.equal(isAppClosed(line),false,line);
});
