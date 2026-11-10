// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path'),vm=require('node:vm');
const source=readFileSync(path.join(__dirname,'../electron/main.ts'),'utf8');
// Startup profile code is ordinary JavaScript; run it before any display/IPC setup.
const start=source.indexOf('const { programDataDirectory, preparePrivateDirectory }');
const end=source.indexOf("app.setPath('sessionData', avatarProfile)")+"app.setPath('sessionData', avatarProfile)".length;
test('Avatar profile stays under its installation root, without consulting home or cwd',()=>{
 assert.ok(start>=0&&end>start);
 assert.ok(end<source.indexOf('app.requestSingleInstanceLock('));
 for(const root of ['/fixture/aidiy','/fixture/日本語 project']){
  const calls=[],created=[];
  vm.runInNewContext(source.slice(start,end),{
   process:{env:{}},
   __dirname:path.join(root,'frontend_avatar','dist-electron'),path,
   require:id=>{assert.equal(id,path.join(root,'frontend_ide/host/scripts/project-storage.cjs'));return {programDataDirectory:(project,program,base,children)=>{assert.equal(project,root);assert.equal(base,root);assert.equal(program,'aidiy_avatar');return path.join(project,'_AIDIY',program,...children);},preparePrivateDirectory:folder=>created.push(folder)};},
   mkdirSync:(folder,options)=>{assert.equal(options.recursive,true);created.push(folder);},
   app:{getPath(){throw Error('home lookup forbidden');},setPath:(name,value)=>calls.push([name,value])},
  });
  const expected=path.join(root,'_AIDIY','aidiy_avatar','electron');
  assert.deepEqual(created,[expected]);
  assert.deepEqual(calls,[['userData',expected],['sessionData',expected]]);
 }
});
test('Alone profile is isolated by canonical project and program before instance lock',()=>{
 for(const project of ['/fixture/project-a','/fixture/project-b','/fixture/aidiy']){
  const root='/fixture/aidiy', calls=[];
  vm.runInNewContext(source.slice(start,end),{
   __dirname:path.join(root,'frontend_avatar','dist-electron'),path,
   process:{env:{AIDIY_AVATAR_ALONE:'1',AIDIY_AVATAR_PROJECT:project}},
   realpathSync:value=>value,statSync:()=>({isDirectory:()=>true}),configuredCoreBaseUrl:base=>{assert.equal(base,root);return 'http://127.0.0.1:18091';},
   require:()=>({programDataDirectory:(selected,program,base,children)=>{assert.equal(selected,project);assert.equal(program,'aidiy_avatar');assert.equal(base,root);return path.join(selected,'_AIDIY',program,...children);},preparePrivateDirectory:()=>{}}),
   app:{setPath:(name,value)=>calls.push([name,value])},
  });
  assert.equal(calls[0][1],path.join(project,'_AIDIY','aidiy_avatar','electron','internal'));
 }
});
