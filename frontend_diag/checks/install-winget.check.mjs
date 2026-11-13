// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 完全なメモリ fixture。実 Windows の登録・プロセス・グローバル導入は変更しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {WINGET_PACKAGES,WINGET_INSPECTION_SCRIPT,inspectWinget,executeWinget} from '../diag/導入管理/winget.mjs';
const win=path.win32,SOURCE='Microsoft.Winget.Source_8wekyb3d8bbwe';
const success={code:0,error:false,cancelled:false,timedOut:false,overflow:false};
const env={SystemRoot:'C:\\Windows',LOCALAPPDATA:'C:\\Users\\fixture\\AppData\\Local',PROGRAMFILES:'C:\\Program Files'};
const entries=Object.keys(WINGET_PACKAGES).map(id=>({id,commands:[`${id}.exe`]}));
const norm=value=>win.normalize(value).replace(/\\+$/,'').toLowerCase();
const missing=()=>Object.assign(Error('fixture missing'),{code:'ENOENT'});
function memoryIO(){
  const nodes=new Map();
  const mkdir=directory=>{const key=norm(directory);if(nodes.has(key))return;const parent=win.dirname(directory);if(norm(parent)!==key)mkdir(parent);nodes.set(key,{directory:true});};
  const file=(filename,text='fixture executable')=>{mkdir(win.dirname(filename));nodes.set(norm(filename),{text:Buffer.from(text)});};
  const read=filename=>{const value=nodes.get(norm(filename));if(!value)throw missing();return value;};
  return {nodes,mkdir,file,io:{
    lstat:async filename=>{const value=read(filename);return {isDirectory:()=>Boolean(value.directory),isFile:()=>Boolean(value.text),isSymbolicLink:()=>Boolean(value.link),nlink:value.nlink||1,size:value.text?.length||0};},
    realpath:async filename=>{const value=read(filename);return value.link||win.normalize(filename);},
    readFile:async(filename,encoding)=>{const value=read(filename);if(!value.text)throw Error('not a file');return encoding?value.text.toString(encoding):value.text;},
    mkdir:async filename=>{if(nodes.has(norm(filename)))throw Object.assign(Error('exists'),{code:'EEXIST'});if(!nodes.has(norm(win.dirname(filename))))throw missing();nodes.set(norm(filename),{directory:true});},
    open:async(filename,flags)=>{assert.equal(flags,'wx');if(nodes.has(norm(filename)))throw Object.assign(Error('exists'),{code:'EEXIST'});file(filename,'');return {writeFile:async text=>file(filename,text),close:async()=>{}};},
    unlink:async filename=>{if(!nodes.delete(norm(filename)))throw missing();}
  }};
}
function fixture(){
  const memory=memoryIO();for(const root of Object.values(env))memory.mkdir(root);
  const metadata={schema:1,registryKnown:true,processKnown:true,registrations:[],processes:[]},resolved={},listed=new Set(),calls=[];
  const winget=win.join(env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe');
  const f={...memory,metadata,resolved,listed,calls,winget,source:{Name:'winget',Argument:'https://cdn.winget.microsoft.com/cache',Type:'Microsoft.PreIndexed.Package',Identifier:SOURCE},onChange:null};
  f.run=async command=>{
    calls.push(command);
    if(command.args[0]==='source'){command.onData(JSON.stringify(f.source));return f.sourceResult||success;}
    if(command.args[0]==='-NoLogo'){assert.equal(command.args.at(-1),WINGET_INSPECTION_SCRIPT);command.onData(f.metadataText??JSON.stringify(metadata));return f.metadataResult||success;}
    if(command.args[0]==='list'){command.onData('Name Id Version Source\n--------------------------------\n'+[...listed].map(pkg=>`Fixture ${pkg} 1.2.3 winget`).join('\n'));return f.listResult||success;}
    if(f.onChange)return f.onChange(command);
    assert.fail('fixture needs explicit mutation handler');
  };
  f.options={entries,env,platform:'win32',run:f.run,io:f.io,resolve:async entry=>entry.id==='winget'?f.winget:resolved[entry.id]||null};
  f.inspect=()=>inspectWinget(f.options);
  f.install=(group,{scope=group==='obs'?'machine':'user',registered=true}={})=>{
    const pkg=WINGET_PACKAGES[group],portable=group==='ffmpeg';
    const root=portable?win.join(scope==='user'?env.LOCALAPPDATA:env.PROGRAMFILES,...scope==='user'?['Microsoft','WinGet','Packages']:['WinGet','Packages'],`${pkg}_${SOURCE}`):group==='code'?win.join(scope==='user'?env.LOCALAPPDATA:env.PROGRAMFILES,...scope==='user'?['Programs','Microsoft VS Code']:['Microsoft VS Code']):group==='obs'?win.join(env.PROGRAMFILES,'obs-studio'):win.join(env.LOCALAPPDATA,'Programs','Ollama');
    const row={scope,view:group==='obs'?'Registry32':'Registry64',key:portable?`${pkg}_${SOURCE}`:group==='code'?scope==='user'?'{771FD6B0-FA20-440A-A002-3B3BAC16DC50}_is1':'{EA457B21-F73E-494C-ACAB-524FDE069978}_is1':group==='obs'?'OBS Studio':'Ollama',name:group==='code'?'Microsoft Visual Studio Code (User)':group==='obs'?'OBS Studio':group==='ffmpeg'?'FFmpeg':'Ollama',publisher:group==='code'?'Microsoft Corporation':group==='obs'?'OBS Project':'fixture',version:'1.2.3',installLocation:group==='obs'?'':root,uninstallString:portable?`winget uninstall --product-code ${pkg}_${SOURCE}`:`"${win.join(root,group==='code'?'unins000.exe':'uninstall.exe')}"`,quietUninstallString:'',packageIdentifier:portable?pkg:'',sourceIdentifier:portable?SOURCE:'',installerType:portable?'portable':''};
    if(group==='ffmpeg')for(const id of ['ffmpeg','ffprobe','ffplay']){resolved[id]=win.join(root,'ffmpeg-8.0-full_build','bin',`${id}.exe`);memory.file(resolved[id]);}
    if(group==='obs'){resolved.obs=win.join(root,'bin','64bit','obs64.exe');memory.file(resolved.obs);memory.file(win.join(root,'uninstall.exe'));row.quietUninstallString=row.uninstallString+' /S';}
    if(group==='code'){resolved.code=win.join(root,'bin','code.cmd');memory.file(resolved.code);memory.file(win.join(root,'Code.exe'));memory.file(win.join(root,'unins000.exe'));row.quietUninstallString=row.uninstallString+' /SILENT';}
    if(group==='ollama'){
      Object.assign(row,{key:'{44E83376-CE68-45EB-8FC1-393500EB558C}_is1',publisher:'Ollama',uninstallString:`"${win.join(root,'unins000.exe')}"`,quietUninstallString:`"${win.join(root,'unins000.exe')}" /SILENT`});
      resolved.ollama=win.join(root,'ollama.exe');
      metadata.ollamaSignatures=['ollama.exe','ollama app.exe','unins000.exe'].map(name=>{
        const filename=win.join(root,name);memory.file(filename);
        return {path:filename,status:'Valid',subject:'CN=Ollama Inc., O=Ollama Inc., C=CA',sha256:createHash('sha256').update('fixture executable').digest('hex')};
      });
    }
    if(registered){metadata.registrations.push(row);listed.add(pkg);}return {root,row};
  };
  f.uninstall=group=>{
    const ids=group==='ffmpeg'?['ffmpeg','ffprobe','ffplay']:[group],pkg=WINGET_PACKAGES[group];
    const row=metadata.registrations.find(row=>row.packageIdentifier===pkg||row.name===(group==='code'?'Microsoft Visual Studio Code (User)':'OBS Studio'));
    const root=row?.installLocation||row?.uninstallString.match(/^"(.+)\\uninstall.exe"$/)?.[1];
    metadata.registrations=metadata.registrations.filter(item=>item!==row);listed.delete(pkg);for(const id of ids)delete resolved[id];
    for(const key of memory.nodes.keys())if(root&&(key===norm(root)||key.startsWith(norm(root)+'\\')))memory.nodes.delete(key);
  };
  return f;
}
const cap=(snapshot,id)=>snapshot.items.find(item=>item.id===id);
const changes=f=>f.calls.filter(command=>['install','uninstall','upgrade'].includes(command.args[0]));
async function ownNative(f,group){
  f.onChange=async command=>{assert.equal(command.args[0],'install');f.install(group);return success;};
  const state=await f.inspect();await executeWinget({id:group},'導入',state.context,{platform:'win32',run:f.run});f.onChange=null;
}

test('固定6 ID・FFmpeg同一パッケージ・非Windows/未対応は実行しない',async()=>{
  assert.deepEqual(WINGET_PACKAGES,{ffmpeg:'Gyan.FFmpeg',ffprobe:'Gyan.FFmpeg',ffplay:'Gyan.FFmpeg',ollama:'Ollama.Ollama',obs:'OBSProject.OBSStudio',chrome:'Google.Chrome'});assert.equal(Object.isFrozen(WINGET_PACKAGES),true);
  for(const platform of ['linux','darwin']){const f=fixture(),snapshot=await inspectWinget({...f.options,platform});assert.ok(snapshot.items.every(item=>!item.操作.length));assert.equal(f.calls.length,0);}
  for(const id of ['constructor','__proto__','toString','ffmpeg;calc.exe']){const f=fixture();assert.deepEqual((await inspectWinget({...f.options,entries:[{id}]})).items,[]);assert.equal(f.calls.length,0);}
});

test('未導入は導入だけ、一覧は固定の読み取りだけで変更しない',async()=>{
  const f=fixture(),state=await f.inspect();assert.ok(state.items.every(item=>item.操作.join()==='導入'));assert.equal(changes(f).length,0);assert.equal(f.calls.length,3);assert.equal(state.context.lockKey,'C:\\Windows\\AiDiy-winget-package-management');
  assert.deepEqual(f.calls[0].args,['source','export','--name','winget','--disable-interactivity']);
  assert.deepEqual(f.calls[1].args.slice(0,-1),['-NoLogo','-NoProfile','-NonInteractive','-Command']);
  assert.doesNotMatch(WINGET_INSPECTION_SCRIPT,/ExecutionPolicy|Set-Item|Remove-Item|Start-Process|CommandLine/i);
});

test('標準 winget 以外・別 source・不明登録・壊れたJSONはすべて閉じる',async()=>{
  for(const modify of [f=>f.winget='C:\\tools\\winget.exe',f=>f.source.Argument='https://not-official.invalid',f=>f.source.Identifier='other',f=>f.source.Type='Microsoft.Rest',f=>f.metadata.registryKnown=false,f=>f.metadataText='{broken',f=>f.metadataResult={...success,error:true},f=>f.listResult={...success,code:1},f=>f.sourceResult={...success,timedOut:true}]){
    const f=fixture();modify(f);const state=await f.inspect();assert.ok(state.items.every(item=>!item.操作.length));assert.equal(changes(f).length,0);
  }
});

test('一覧なしの既知終了コードだけを未導入と扱う',async()=>{
  const f=fixture();f.listResult={...success,code:0x8a150014|0};assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,['導入']);f.listResult.cancelled=true;assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);
});

test('winget list のみでは手動導入を所有扱いしない',async()=>{
  const f=fixture();f.listed.add('Gyan.FFmpeg');assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);
  const manual=fixture();manual.install('obs');assert.deepEqual(cap(await manual.inspect(),'obs').操作,[]);
  const binary=fixture();binary.resolved.ffmpeg='C:\\manual\\ffmpeg.exe';assert.deepEqual(cap(await binary.inspect(),'ffmpeg').操作,[]);
});

test('FFmpeg一式の登録/実体照合と関連行全体の所有元・プロセス検査',async()=>{
  const f=fixture(),installed=f.install('ffmpeg');
  for(const id of ['ffmpeg','ffprobe','ffplay'])assert.deepEqual(cap(await f.inspect(),id).操作,['再導入','削除']);
  const selected=await inspectWinget({...f.options,entries:[entries.find(entry=>entry.id==='ffprobe')]});assert.deepEqual(cap(selected,'ffprobe').関連項目,['ffmpeg','ffprobe','ffplay']);assert.deepEqual(cap(selected,'ffprobe').操作,['再導入','削除']);
  f.resolved.ffplay='C:\\manual\\ffplay.exe';f.file(f.resolved.ffplay);assert.deepEqual(cap(await f.inspect(),'ffprobe').操作,[]);
  f.resolved.ffplay=win.join(installed.root,'ffmpeg-8.0-full_build','bin','ffplay.exe');f.metadata.processes=['ffmpeg.exe'];assert.deepEqual(cap(await f.inspect(),'ffprobe').操作,[]);
});

test('portable登録・source・uninstall文字列・標準配置が合わなければ操作しない',async()=>{
  for(const mutate of [row=>row.packageIdentifier='other.ffmpeg',row=>row.sourceIdentifier='other',row=>row.installerType='exe',row=>row.uninstallString+=' --purge',row=>row.installLocation='C:\\manual',row=>row.key='other']){
    const f=fixture(),{row}=f.install('ffmpeg');mutate(row);assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);
  }
  const mixed=fixture();mixed.install('ffmpeg');mixed.install('ffmpeg',{scope:'machine'});assert.deepEqual(cap(await mixed.inspect(),'ffmpeg').操作,[]);
});

test('Linksのsymlinkは実体照合、導入rootのjunction・binary link・hardlinkは拒否',async()=>{
  const f=fixture(),{root}=f.install('ffmpeg'),target=f.resolved.ffmpeg,alias=win.join(env.LOCALAPPDATA,'Microsoft','WinGet','Links','ffmpeg.exe');f.mkdir(win.dirname(alias));f.nodes.set(norm(alias),{link:target});f.resolved.ffmpeg=alias;
  assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,['再導入','削除']);
  f.nodes.get(norm(root)).link='C:\\different';assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);delete f.nodes.get(norm(root)).link;
  f.nodes.get(norm(target)).nlink=2;assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);
});

test('実行中または確認不可のプロセスでは破壊操作を隠す',async()=>{
  for(const name of ['ffmpeg.exe','ffplay.exe']){const f=fixture();f.install('ffmpeg');f.metadata.processes=[name];assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);}
  const f=fixture();f.install('ffmpeg');f.metadata.processKnown=false;assert.deepEqual(cap(await f.inspect(),'ffmpeg').操作,[]);assert.deepEqual(cap(await f.inspect(),'obs').操作,[]);
});

test('Ollamaは署名付き標準Inno導入の更新だけを許可し、削除しない',async()=>{
  const f=fixture();assert.deepEqual(cap(await f.inspect(),'ollama').操作,['導入']);f.install('ollama');const state=await f.inspect();
  assert.deepEqual(cap(state,'ollama').操作,['再導入']);assert.match(cap(state,'ollama').再導入説明,/アンインストール.*行いません/);assert.doesNotMatch(cap(state,'ollama').確認説明,/削除後/);
  await assert.rejects(()=>executeWinget({id:'ollama'},'削除',state.context,{platform:'win32',run:f.run}),{status:409});assert.equal(changes(f).length,0);
});


test('残存導入ディレクトリ・壊れたreceipt・junction parentで上書き導入しない',async()=>{
  for(const setup of [f=>f.mkdir(win.join(env.PROGRAMFILES,'obs-studio')),f=>f.file(win.join(env.LOCALAPPDATA,'AiDiy','diag-install-receipts','obs.json'),'{broken'),f=>{f.nodes.get(norm(env.PROGRAMFILES)).link='C:\\other';}]){const f=fixture();setup(f);assert.deepEqual(cap(await f.inspect(),'obs').操作,[]);}
});

test('native新規導入成功後だけlive実体hash付きreceiptを作り、停止中のみ操作可能',async()=>{
  for(const group of ['obs']){
    const f=fixture();await ownNative(f,group);const state=await f.inspect();assert.deepEqual(cap(state,group).操作,['再導入','削除']);
    const receipt=JSON.parse(await f.io.readFile(win.join(env.LOCALAPPDATA,'AiDiy','diag-install-receipts',`${group}.json`),'utf8'));
    assert.equal(receipt.package,WINGET_PACKAGES[group]);assert.equal(receipt.source,SOURCE);assert.ok(receipt.files.every(file=>/^[0-9a-f]{64}$/.test(file.sha256)));
    f.metadata.processes=['obs64.exe'];assert.deepEqual(cap(await f.inspect(),group).操作,[]);
  }
});

test('native receiptはlive登録・主binary・CLI・uninstaller変更やリンクで無効',async()=>{
  for(const mutate of [f=>f.metadata.registrations[0].version='changed',f=>f.file(f.resolved.obs,'changed'),f=>f.file(win.join(win.join(env.PROGRAMFILES,'obs-studio'),'uninstall.exe'),'changed'),f=>f.metadata.registrations[0].quietUninstallString+=' /OTHER',f=>{const receipt=win.join(env.LOCALAPPDATA,'AiDiy','diag-install-receipts','obs.json');f.nodes.get(norm(receipt)).link='C:\\other\\receipt.json';}]){
    const f=fixture();await ownNative(f,'obs');mutate(f);assert.deepEqual(cap(await f.inspect(),'obs').操作,[]);
  }
});

test('winget引数は固定ID/source/scope、no-upgradeとpreserve、承諾/強制/昇格回避なし',async()=>{
  const f=fixture();f.install('ffmpeg');f.onChange=async command=>{if(command.args[0]==='uninstall')f.uninstall('ffmpeg');else f.install('ffmpeg');return success;};
  const state=await f.inspect();await executeWinget({id:'ffmpeg'},'再導入',state.context,{platform:'win32',run:f.run});
  assert.deepEqual(changes(f).map(c=>c.args),[['uninstall','--id','Gyan.FFmpeg','--exact','--source','winget','--scope','user','--disable-interactivity','--silent','--preserve'],['install','--id','Gyan.FFmpeg','--exact','--source','winget','--scope','user','--disable-interactivity','--silent','--no-upgrade']]);
  for(const command of f.calls)assert.ok(command.args.every(arg=>!/^--(?:accept|force|purge|override|custom|ignore|allow-reboot)/.test(arg)));
});

test('native削除は正しいscopeだけで実行し、live削除確認後に自分のreceiptだけ消す',async()=>{
  for(const group of ['obs']){
    const f=fixture();await ownNative(f,group);const profile=win.join(env.LOCALAPPDATA,'profile-kept.txt');f.file(profile,'keep');f.onChange=async command=>{assert.equal(command.args[0],'uninstall');f.uninstall(group);return success;};
    await executeWinget({id:group},'削除',(await f.inspect()).context,{platform:'win32',run:f.run});
    assert.equal(changes(f).at(-1).args[7],'machine');assert.equal(await f.io.readFile(profile,'utf8'),'keep');await assert.rejects(()=>f.io.lstat(win.join(env.LOCALAPPDATA,'AiDiy','diag-install-receipts',`${group}.json`)),{code:'ENOENT'});
  }
});

test('native再導入は削除確認/receipt除去を挟み一度ずつ実行',async()=>{
  const f=fixture();await ownNative(f,'obs');f.calls.length=0;f.onChange=async command=>{if(command.args[0]==='uninstall')f.uninstall('obs');else f.install('obs');return success;};
  await executeWinget({id:'obs'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run});assert.deepEqual(changes(f).map(c=>c.args[0]),['uninstall','install']);assert.deepEqual(cap(await f.inspect(),'obs').操作,['再導入','削除']);
});

test('開始直前の所有元/プロセス変更を再確認し、古いcontextで変更しない',async()=>{
  for(const mutate of [f=>f.metadata.registrations[0].sourceIdentifier='other',f=>f.metadata.processes=['ffmpeg.exe'],f=>f.metadata.processKnown=false,f=>f.source.Argument='https://different.invalid']){
    const f=fixture();f.install('ffmpeg');const state=await f.inspect();mutate(f);await assert.rejects(()=>executeWinget({id:'ffmpeg'},'削除',state.context,{platform:'win32',run:f.run}),{status:409});assert.equal(changes(f).length,0);
  }
});

test('失敗・timeout・中止・overflow後は後続導入なし、receiptも消さない',async()=>{
  for(const bad of [{code:7},{error:true},{timedOut:true},{cancelled:true},{overflow:true}]){
    const f=fixture();await ownNative(f,'obs');f.calls.length=0;f.onChange=async()=>({...success,...bad});await assert.rejects(async()=>executeWinget({id:'obs'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run}),{status:409});assert.deepEqual(changes(f).map(c=>c.args[0]),['uninstall']);assert.deepEqual(cap(await f.inspect(),'obs').操作,['再導入','削除']);
  }
});

test('終了code0でも削除登録が残れば成功扱いせず再導入しない',async()=>{
  const f=fixture();await ownNative(f,'obs');f.calls.length=0;f.onChange=async()=>success;await assert.rejects(async()=>executeWinget({id:'obs'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run}),/削除後/);assert.equal(changes(f).length,1);assert.deepEqual(cap(await f.inspect(),'obs').操作,['再導入','削除']);
});

test('native導入完了後の証拠不明/保存失敗はreceiptを捏造しない',async()=>{
  const f=fixture();f.onChange=async()=>success;await assert.rejects(async()=>executeWinget({id:'obs'},'導入',(await f.inspect()).context,{platform:'win32',run:f.run}),/管理記録/);assert.equal(f.nodes.has(norm(win.join(env.LOCALAPPDATA,'AiDiy','diag-install-receipts','obs.json'))),false);
});

test('未登録ID・任意action・偽context・非Windows・事前中止は変更なし',async()=>{
  const f=fixture(),state=await f.inspect();for(const [id,action,context,platform] of [['constructor','導入',state.context,'win32'],['obs;calc.exe','導入',state.context,'win32'],['obs','更新',state.context,'win32'],['obs','導入',{...state.context},'win32'],['obs','導入',state.context,'linux'],['code','導入',state.context,'win32']])await assert.rejects(()=>executeWinget({id},action,context,{platform,run:f.run}),{status:409});
  const controller=new AbortController();controller.abort();await assert.rejects(()=>executeWinget({id:'obs'},'導入',state.context,{platform:'win32',run:f.run,signal:controller.signal}),/中止/);assert.equal(changes(f).length,0);
});


test('machine portable再導入は未導入表示の既定userへ変更しない',async()=>{
  const f=fixture();f.install('ffmpeg',{scope:'machine'});f.onChange=async command=>{assert.equal(command.args[7],'machine');if(command.args[0]==='uninstall')f.uninstall('ffmpeg');else f.install('ffmpeg',{scope:'machine'});return success;};
  await executeWinget({id:'ffmpeg'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run});assert.deepEqual(changes(f).map(c=>c.args[7]),['machine','machine']);
});

test('各変更前後の読み取りにもsignal/timeout/停止未確認hookを渡す',async()=>{
  const f=fixture(),controller=new AbortController(),hook=()=>{},state=await f.inspect();f.onChange=async()=>{f.install('ffmpeg');return success;};const observed=[];
  await executeWinget({id:'ffmpeg'},'導入',state.context,{platform:'win32',signal:controller.signal,timeout:12500,onUncertain:hook,run:async command=>{observed.push(command);return f.run(command);}});
  assert.ok(observed.length>3);for(const command of observed){assert.equal(command.signal,controller.signal);assert.equal(command.onUncertain,hook);assert.ok(command.timeout<=12500);}
});


test('標準native導入を後からportable化した場合は設定保持保証を適用しない',async()=>{
  for(const [group,marker] of [['obs','portable_mode'],['obs','portable_mode.txt'],['obs','config']]){
    const f=fixture();await ownNative(f,group);const root=win.join(env.PROGRAMFILES,'obs-studio');f.mkdir(win.join(root,marker));assert.deepEqual(cap(await f.inspect(),group).操作,[]);
  }
});

test('preserveで残った追加ファイル/ディレクトリは消さず再導入を止める',async()=>{
  const f=fixture(),{root}=f.install('ffmpeg'),extra=win.join(root,'user-added.txt');
  f.onChange=async command=>{assert.equal(command.args[0],'uninstall');f.uninstall('ffmpeg');f.file(extra,'keep');return success;};
  await assert.rejects(async()=>executeWinget({id:'ffmpeg'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run}),/変わりました/);
  assert.deepEqual(changes(f).map(command=>command.args[0]),['uninstall']);assert.equal(await f.io.readFile(extra,'utf8'),'keep');
});


test('Ollama更新は固定upgrade一回だけ、モデル・設定・履歴を保持し自動起動を許容',async()=>{
  for(const autoStart of [false,true]){
    const f=fixture();f.install('ollama');
    const kept=['C:\\Users\\fixture\\.ollama\\models\\blobs\\sha256-data','C:\\Users\\fixture\\.ollama\\history',win.join(env.LOCALAPPDATA,'Ollama','config.json'),'D:\\custom-models\\weights'];
    kept.forEach(file=>f.file(file,'keep'));const before=[...f.nodes.entries()].map(([key,value])=>[key,value.text?.toString()]);
    f.onChange=async command=>{assert.equal(command.args[0],'upgrade');f.metadata.registrations[0].version='1.2.4';if(autoStart)f.metadata.processes=['ollama.exe','ollama app.exe'];return success;};
    await executeWinget({id:'ollama'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run});
    assert.deepEqual(changes(f).map(c=>c.args),[['upgrade','--id','Ollama.Ollama','--exact','--source','winget','--scope','user','--disable-interactivity','--silent','--installer-type','inno']]);
    assert.deepEqual([...f.nodes.entries()].map(([key,value])=>[key,value.text?.toString()]),before);
    for(const file of kept)assert.equal(await f.io.readFile(file,'utf8'),'keep');
    for(const command of f.calls)assert.ok(command.args.every(arg=>!/^--(?:accept|force|purge|override|custom|ignore|allow-reboot|uninstall-previous|all|include-unknown)/.test(arg)));
  }
});

test('Ollama適用可能な更新なしだけを成功に正規化し、失敗・中止を隠さない',async()=>{
  for(const code of [0x8a15002b,0x8a15002b|0]){
    const f=fixture();f.install('ollama');const output=[];f.onChange=async()=>({...success,code});
    const result=await executeWinget({id:'ollama'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run,onData:text=>output.push(text)});
    assert.equal(result.code,0);assert.match(output.join(''),/更新はありません/);assert.equal(changes(f).length,1);
  }
  for(const bad of [{code:7},{error:true},{timedOut:true},{cancelled:true},{overflow:true},{code:0x8a15002b,error:true},{code:0x8a15002b,cancelled:true},{code:0x8a15002b,timedOut:true},{code:0x8a15002b,overflow:true}]){
    const f=fixture();f.install('ollama');f.onChange=async()=>({...success,...bad});
    await assert.rejects(async()=>executeWinget({id:'ollama'},'再導入',(await f.inspect()).context,{platform:'win32',run:f.run}),{status:409});assert.deepEqual(changes(f).map(c=>c.args[0]),['upgrade']);
  }
});

test('Ollamaの登録・署名・実体・別PATH・processが不明/変更なら更新しない',async()=>{
  const mutations=[
    f=>f.metadata.registrations[0].publisher='Other',f=>f.metadata.registrations[0].key='Ollama',f=>f.metadata.registrations[0].sourceIdentifier='other',f=>f.metadata.registrations[0].scope='machine',
    f=>f.metadata.registrations.push({...f.metadata.registrations[0]}),f=>f.metadata.ollamaSignatures=[],f=>f.metadata.ollamaSignatures[0].status='NotSigned',f=>f.metadata.ollamaSignatures[0].subject='O=Not Ollama Inc.',f=>f.metadata.ollamaSignatures[0].sha256='bad',
    f=>f.file(f.resolved.ollama,'replaced'),f=>{f.nodes.get(norm(f.resolved.ollama)).nlink=2;},f=>{f.resolved.ollama='C:\\foreign\\ollama.exe';f.file(f.resolved.ollama);},
    f=>f.metadata.processKnown=false,...['ollama.exe','ollama app.exe','llama-server.exe','ollama_llama_server.exe'].map(name=>f=>f.metadata.processes=[name])
  ];
  for(const mutate of mutations){
    const f=fixture();f.install('ollama');const state=await f.inspect();mutate(f);
    assert.deepEqual(cap(await f.inspect(),'ollama').操作,[]);
    await assert.rejects(()=>executeWinget({id:'ollama'},'再導入',state.context,{platform:'win32',run:f.run}),{status:409});assert.equal(changes(f).length,0);
  }
  const f=fixture();f.listed.add('Ollama.Ollama');assert.deepEqual(cap(await f.inspect(),'ollama').操作,[]);
});

test('Ollamaの直前の正規バージョン変更と更新後の証拠消失も検出する',async()=>{
  const f=fixture();f.install('ollama');const state=await f.inspect();f.metadata.registrations[0].version='1.2.4';
  await assert.rejects(()=>executeWinget({id:'ollama'},'再導入',state.context,{platform:'win32',run:f.run}),/変わりました/);assert.equal(changes(f).length,0);
  for(const code of [0,0x8a15002b]){
    const bad=fixture();bad.install('ollama');bad.onChange=async()=>{bad.metadata.ollamaSignatures=[];return {...success,code};};
    await assert.rejects(async()=>executeWinget({id:'ollama'},'再導入',(await bad.inspect()).context,{platform:'win32',run:bad.run}),/更新後/);assert.equal(changes(bad).length,1);
  }
});

test('Ollama本体内のカスタムモデル保存先は上書き更新しない',async()=>{
  const f=fixture(),{root}=f.install('ollama');
  for(const models of [root,win.join(root,'lib','ollama','models'),'relative-models'])assert.deepEqual(cap(await inspectWinget({...f.options,env:{...env,OLLAMA_MODELS:models}}),'ollama').操作,[]);
  assert.deepEqual(cap(await inspectWinget({...f.options,env:{...env,OLLAMA_MODELS:'D:\\models'}}),'ollama').操作,['再導入']);
  for(const models of ['C:\\Temp\\ollama-models',win.join(env.LOCALAPPDATA,'Ollama','updates'),win.join(env.LOCALAPPDATA,'Ollama','updates','models'),win.join(env.LOCALAPPDATA,'OLLAMA','UPDATES','models')])assert.deepEqual(cap(await inspectWinget({...f.options,env:{...env,TEMP:'C:\\Temp',OLLAMA_MODELS:models}}),'ollama').操作,[]);
  for(const overrides of [{TMP:'D:\\Temp',TEMP:'C:\\Temp',OLLAMA_MODELS:'D:\\Temp\\ollama-models'},{USERPROFILE:'C:\\Users\\fixture',OLLAMA_MODELS:'C:\\Users\\fixture\\ollama-models'},{OLLAMA_MODELS:'C:\\Windows\\ollama-models'}])assert.deepEqual(cap(await inspectWinget({...f.options,env:{...env,...overrides}}),'ollama').操作,[]);
  f.mkdir('D:\\models');f.nodes.get(norm('D:\\models')).link=root;
  assert.deepEqual(cap(await inspectWinget({...f.options,env:{...env,OLLAMA_MODELS:'D:\\models'}}),'ollama').操作,[]);
});
