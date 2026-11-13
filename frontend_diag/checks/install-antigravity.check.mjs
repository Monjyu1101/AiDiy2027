// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 全コマンドを mock する。実際の導入・削除・認証・ネットワーク通信は行わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,readdir,symlink,link} from 'node:fs/promises';
import {readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {inspectAntigravity,executeAntigravity,ANTIGRAVITY_INSTALLER_URL,ANTIGRAVITY_INSTALLER_SHA256} from '../diag/導入管理/antigravity.mjs';
// Windows はシンボリックリンク権限（開発者モード等）が無いと作成できないため、リンク前提の確認だけ省略する。
const symlinkSkip=await (async()=>{const temp=await mkdtemp(path.join(os.tmpdir(),'aidiy-diag-link-'));try{await writeFile(path.join(temp,'a'),'');await symlink(path.join(temp,'a'),path.join(temp,'b'));return false;}catch(error){if(error.code==='EPERM')return 'シンボリックリンクを作成できない環境';throw error;}finally{await rm(temp,{recursive:true,force:true});}})();

// レビュー済み公式 cmd の凍結 fixture。mock curl がファイルへ書くだけで、実行しない。
const INSTALLER=gunzipSync(Buffer.from('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','base64'));
const OLD=Buffer.from('MZ synthetic old official binary'),NEW=Buffer.from('MZ synthetic new official binary');
const sha=data=>createHash('sha512').update(data).digest('hex');
const result={code:0,error:false,cancelled:false,timedOut:false,overflow:false};
const entry={id:'agy',commands:['agy','agy.exe']};
const identity={status:'Valid',subject:'CN=Google LLC, O=Google LLC, C=US',company:'Google LLC',product:'Antigravity CLI',original:'agy.exe'};
const receipt=bytes=>JSON.stringify({schema:1,id:'agy',installer:ANTIGRAVITY_INSTALLER_URL,installerSha256:ANTIGRAVITY_INSTALLER_SHA256,sha512:sha(bytes)});

async function fixture(t,{binary,owned=false,signed=false,processCount=0,localName='Local'}={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'aidiy-agy-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const local=path.join(root,localName),systemRoot=path.join(root,'Windows'),prefix=path.join(local,'agy','bin'),target=path.join(prefix,'agy.exe'),record=path.join(prefix,'.aidiy-antigravity-install.json');
  await mkdir(prefix,{recursive:true});
  const system=path.join(systemRoot,'System32');
  for(const command of ['cmd.exe','curl.exe','WindowsPowerShell/v1.0/powershell.exe']){const file=path.join(system,command);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'Synthetic OS command. Never executed.');}
  if(binary)await writeFile(target,binary);if(owned)await writeFile(record,receipt(binary));
  const home=path.join(root,'User'),settings=path.join(home,'.gemini','antigravity-cli','settings.json');await mkdir(path.dirname(settings),{recursive:true});await writeFile(settings,'synthetic settings / auth must stay');
  const sentinel=path.join(prefix,'unrelated.txt');await writeFile(sentinel,'keep unrelated');
  const env={LOCALAPPDATA:local,SystemRoot:systemRoot,HOME:home,USERPROFILE:home,PATH:'/not-trusted',OPENAI_API_KEY:'never-send-to-child',NODE_OPTIONS:'--require unsafe',PROCESSOR_ARCHITECTURE:'untrusted'};
  const calls=[],state={processCount,identity:signed?identity:null,downloadError:null,installerError:null,payload:NEW,installer:INSTALLER};
  const run=async command=>{
    calls.push(command);assert.equal(command.platform,'win32');assert.equal(command.env.OPENAI_API_KEY,undefined);assert.equal(command.env.NODE_OPTIONS,undefined);assert.equal(command.env.PATH,system);
    if(command.executable===path.join(system,'WindowsPowerShell','v1.0','powershell.exe')){
      assert.deepEqual(command.args.slice(0,3),['-NoProfile','-NonInteractive','-Command']);
      assert.doesNotMatch(command.args.join(' '),/ExecutionPolicy|Bypass|Set-Item|Remove-Item|Unblock-File/i);
      command.onData(JSON.stringify({processCount:state.processCount,identity:state.identity}));return {...result};
    }
    if(command.executable===path.join(system,'curl.exe')){
      if(state.downloadError)return {...result,...state.downloadError};
      const destination=command.args[command.args.indexOf('--output')+1],url=command.args.at(-1);
      assert.deepEqual(command.args.slice(0,9),['--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-redirs']);
      if(url===ANTIGRAVITY_INSTALLER_URL)await writeFile(destination,state.installer);
      else{
        assert.match(url,/^https:\/\/antigravity-cli-auto-updater-974169037036\.us-central1\.run\.app\/manifests\/windows_(amd64|arm64)\.json$/);
        const arch=url.endsWith('arm64.json')?'arm64':'x64';
        await writeFile(destination,JSON.stringify(state.manifest||{version:'fixture',url:`https://storage.googleapis.com/antigravity-public/antigravity-cli/fixture/windows-${arch}/cli_windows_${arch}.exe`,sha512:sha(state.payload)}));
      }
      if(state.afterDownload)await state.afterDownload(command);
      return {...result};
    }
    assert.equal(command.executable,path.join(system,'cmd.exe'),'未知の実行ファイルを起動しない');
    assert.deepEqual(command.args.slice(0,4),['/d','/v:off','/s','/c']);assert.equal(command.windowsVerbatimArguments,true);
    assert.match(command.args[4],/--skip-path --skip-aliases/);assert.doesNotMatch(command.args[4],/ExecutionPolicy|Bypass|Zone.Identifier/);
    assert.ok(command.args[4].includes(`--dir "${prefix}"`));assert.equal(command.env.TEMP,command.cwd);
    assert.equal(command.env.PROCESSOR_ARCHITECTURE,process.arch==='arm64'?'ARM64':'AMD64');
    if(state.beforeInstall)await state.beforeInstall(command);
    if(state.writePayload!==false){await mkdir(prefix,{recursive:true});await writeFile(target,state.partial||state.payload);}
    if(state.afterInstall)await state.afterInstall(command);
    return {...result,...state.installerError};
  };
  const options={env,platform:'win32',run,resolve:async()=>null};
  const inspect=()=>inspectAntigravity(entry,options);
  const execute=async(action,extra={})=>executeAntigravity(entry,action,(await inspect()).context,{...options,...extra});
  return {root,local,systemRoot,prefix,target,record,env,state,calls,options,inspect,execute,settings,sentinel};
}

async function absent(file){await assert.rejects(()=>lstat(file),{code:'ENOENT'});}
async function preserved(f){assert.equal(await readFile(f.settings,'utf8'),'synthetic settings / auth must stay');assert.equal(await readFile(f.sentinel,'utf8'),'keep unrelated');}

test('凍結公式インストーラー fixture はレビュー済み SHA256 と一致する',()=>{
  assert.equal(createHash('sha256').update(INSTALLER).digest('hex'),ANTIGRAVITY_INSTALLER_SHA256);
  assert.match(INSTALLER.toString(),/if exist "!BINARY_PATH!"/);assert.match(INSTALLER.toString(),/exit \/b 0/);
});

test('Windows 以外・未知 ID・危険な導入先はコマンドを実行しない',async()=>{
  for(const options of [{platform:'linux'},{platform:'darwin'},{platform:'win32',env:{LOCALAPPDATA:'relative',SystemRoot:'/fixture'}},{platform:'win32',env:{LOCALAPPDATA:'/fixture/unsafe&path',SystemRoot:'/fixture'}}]){
    const cap=await inspectAntigravity(entry,{run:()=>assert.fail('実行しない'),...options});assert.deepEqual(cap.item.操作,[]);assert.ok(cap.item.理由);
  }
  assert.deepEqual((await inspectAntigravity({id:'__proto__'},{run:()=>assert.fail('実行しない')})).item.操作,[]);
});

test('未導入は固定標準配置・OS コマンド・プロセスだけ読み取り確認する',async t=>{
  const f=await fixture(t),cap=await f.inspect();assert.deepEqual(cap.item.操作,['導入']);assert.equal(cap.context.prefix,f.prefix);
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].executable.endsWith('powershell.exe'));assert.equal(f.calls[0].env.AIDIY_AGY_BINARY,f.target);
  assert.match(cap.item.確認説明,/PATH/);assert.match(cap.item.説明,/設定・認証/);
});

test('一致する自前導入記録、または有効 Google 署名と製品情報だけを所有扱いする',async t=>{
  for(const setup of [{binary:OLD,owned:true},{binary:OLD,signed:true}]){
    const f=await fixture(t,setup);assert.deepEqual((await f.inspect()).item.操作,['再導入','削除']);
  }
  const f=await fixture(t,{binary:OLD});assert.deepEqual((await f.inspect()).item.操作,[]);
  for(const patch of [{status:'NotSigned'},{subject:'CN=Other Corporation'},{company:'Other'},{product:'Unrelated product'},{original:'other.exe'}]){
    f.state.identity={...identity,...patch};assert.deepEqual((await f.inspect()).item.操作,[]);
  }
});

test('破損・別所有者・hash 不一致・欠損バイナリの導入記録は拒否する',async t=>{
  const f=await fixture(t,{binary:OLD,owned:true});
  for(const content of ['{broken',receipt(NEW),JSON.stringify({schema:1,id:'not-agy'}),'x'.repeat(5000)]){await writeFile(f.record,content);assert.deepEqual((await f.inspect()).item.操作,[]);}
  await writeFile(f.record,receipt(OLD));await rm(f.target);assert.deepEqual((await f.inspect()).item.操作,[]);
});

test('外部配置・リンク・hardlink・staging 残存・前回復旧残存を拒否する',{skip:symlinkSkip},async t=>{
  const foreign=await fixture(t);assert.deepEqual((await inspectAntigravity(entry,{...foreign.options,resolve:async()=>'/other/agy.exe'})).item.操作,[]);
  for(const kind of ['binary-link','directory-link','hardlink','staging','backup']){
    const f=await fixture(t,{binary:OLD,owned:true});
    if(kind==='binary-link'){await rm(f.target);await symlink(f.sentinel,f.target);}
    if(kind==='directory-link'){const replacement=path.join(f.root,'outside');await mkdir(replacement);await rm(f.prefix,{recursive:true});await symlink(replacement,f.prefix,'dir');}
    if(kind==='hardlink'){await link(f.target,path.join(f.root,'hardlinked.exe'));}
    if(kind==='staging'){const staging=path.join(f.local,'antigravity','staging');await mkdir(staging,{recursive:true});await writeFile(path.join(staging,'agy.exe'),'unowned staging');}
    if(kind==='backup')await writeFile(`${f.target}.aidiy-backup-interrupted`,OLD);
    assert.deepEqual((await f.inspect()).item.操作,[],kind);
  }
});

test('実行中・確認不能プロセスでは導入も削除もしない',async t=>{
  const f=await fixture(t,{binary:OLD,owned:true,processCount:1});assert.match((await f.inspect()).item.理由,/実行中/);
  f.state.processCount='unknown';assert.deepEqual((await f.inspect()).item.操作,[]);
  const unknown=await inspectAntigravity(entry,{...f.options,run:async()=>({...result,code:1})});assert.deepEqual(unknown.item.操作,[]);
});

test('新規導入は固定公式 cmd と manifest で二重検証し、設定・PATH を保持する',async t=>{
  const f=await fixture(t),logs=[];await f.execute('導入',{onData:text=>logs.push(text)});
  assert.deepEqual(await readFile(f.target),NEW);assert.equal(JSON.parse(await readFile(f.record,'utf8')).sha512,sha(NEW));
  assert.deepEqual((await f.inspect()).item.操作,['再導入','削除']);await preserved(f);
  assert.equal(f.calls.filter(c=>c.executable.endsWith('cmd.exe')).length,1);
  const directory=f.calls.find(c=>c.executable.endsWith('cmd.exe')).cwd;await absent(directory);
  assert.ok(logs.join('').includes('公式バイナリと導入記録を確認'));
});

test('再導入は旧バイナリを退避してから公式 cmd を実行し、成功後だけ退避を削除する',async t=>{
  const f=await fixture(t,{binary:OLD,owned:true});f.state.beforeInstall=async()=>{await absent(f.target);assert.equal((await readdir(f.prefix)).filter(x=>x.includes('.aidiy-backup-')).length,1);};
  const cap=(await f.inspect()).item;assert.match(cap.再導入説明,/旧バイナリを退避.*更新・再導入/);assert.match(cap.再導入説明,/失敗・中止時.*復元/);assert.doesNotMatch(cap.再導入説明,/削除してから/);
  await f.execute('再導入');assert.deepEqual(await readFile(f.target),NEW);assert.equal((await readdir(f.prefix)).filter(x=>x.includes('.aidiy-backup-')).length,0);await preserved(f);
});

test('削除は所有バイナリと自前記録だけ、公式 staging や設定フォルダも残す',async t=>{
  for(const setup of [{binary:OLD,owned:true},{binary:OLD,signed:true}]){
    const f=await fixture(t,setup);const staging=path.join(f.local,'antigravity','staging');await mkdir(staging,{recursive:true});await writeFile(path.join(staging,'unrelated'),'keep');
    await f.execute('削除');await absent(f.target);await absent(f.record);await preserved(f);assert.equal(await readFile(path.join(staging,'unrelated'),'utf8'),'keep');
    assert.equal(f.calls.some(c=>c.executable.endsWith('cmd.exe')||c.executable.endsWith('curl.exe')),false);
  }
});

test('ダウンロード失敗・上流 cmd 更新・不正 manifest は退避前に停止する',async t=>{
  for(const mode of ['download','changed-script','manifest-url','manifest-hash']){
    const f=await fixture(t,{binary:OLD,owned:true});
    if(mode==='download')f.state.downloadError={code:1};if(mode==='changed-script')f.state.installer=Buffer.from('unreviewed upstream installer');
    if(mode.startsWith('manifest'))f.state.manifest={url:mode==='manifest-url'?'https://attacker.invalid/payload.exe':'https://storage.googleapis.com/antigravity-public/antigravity-cli/fixture/windows-x64/cli_windows_x64.exe',sha512:mode==='manifest-hash'?'bad':sha(NEW)};
    await assert.rejects(()=>f.execute('再導入'));assert.deepEqual(await readFile(f.target),OLD);assert.equal(f.calls.some(c=>c.executable.endsWith('cmd.exe')),false);await preserved(f);
  }
});

test('公式 cmd 失敗・no-op の exit 0 でも旧バイナリを復元して成功にしない',async t=>{
  for(const mode of ['failure','noop']){
    const f=await fixture(t,{binary:OLD,owned:true});f.state.writePayload=false;if(mode==='failure')f.state.installerError={code:1};
    await assert.rejects(()=>f.execute('再導入'));assert.deepEqual(await readFile(f.target),OLD);assert.equal(await readFile(f.record,'utf8'),receipt(OLD));await preserved(f);
    assert.equal((await readdir(f.prefix)).some(x=>x.includes('.aidiy-backup-')),false);
  }
});

test('部分ファイル・SHA512 不一致は削除せず退避し、旧バイナリを復元する',async t=>{
  const f=await fixture(t,{binary:OLD,owned:true});f.state.partial=Buffer.from('partial corrupted download');
  await assert.rejects(()=>f.execute('再導入'));assert.deepEqual(await readFile(f.target),OLD);assert.equal(await readFile(f.record,'utf8'),receipt(OLD));
  const failed=(await readdir(f.prefix)).find(x=>x.includes('.aidiy-failed-'));assert.ok(failed);assert.deepEqual(await readFile(path.join(f.prefix,failed)),f.state.partial);
  assert.deepEqual((await f.inspect()).item.操作,[]);await preserved(f);
});

test('中止は未実行なら変更なし、installer 終了確認後なら狭い復元だけ行う',async t=>{
  for(const mode of ['before','download','installer']){
    const f=await fixture(t,{binary:OLD,owned:true}),controller=new AbortController();
    if(mode==='before')controller.abort();if(mode==='download')f.state.afterDownload=()=>controller.abort();
    if(mode==='installer')f.state.afterInstall=()=>{controller.abort();f.state.installerError={cancelled:true};};
    await assert.rejects(()=>f.execute('再導入',{signal:controller.signal}));assert.deepEqual(await readFile(f.target),OLD);assert.equal(await readFile(f.record,'utf8'),receipt(OLD));await preserved(f);
    if(mode!=='installer')assert.equal(f.calls.some(c=>c.executable.endsWith('cmd.exe')),false);
  }
});

test('退避前の起動・バイナリ差替・記録差替は古い所有判定で実行しない',async t=>{
  for(const mode of ['process','binary']){
    const f=await fixture(t,{binary:OLD,owned:true});f.state.afterDownload=async command=>{if(command.args.at(-1).endsWith('.json')){if(mode==='process')f.state.processCount=1;else await writeFile(f.target,NEW);}};
    await assert.rejects(()=>f.execute('再導入'));assert.equal(f.calls.some(c=>c.executable.endsWith('cmd.exe')),false);await preserved(f);
  }
  const f=await fixture(t,{binary:OLD,owned:true}),cap=await f.inspect();await writeFile(f.target,NEW);await writeFile(f.record,receipt(NEW));
  await assert.rejects(()=>executeAntigravity(entry,'削除',cap.context,f.options));assert.deepEqual(await readFile(f.target),NEW);
});

test('任意 ID・操作を受け付けず、削除失敗時のリンクにも触れない',{skip:symlinkSkip},async t=>{
  const f=await fixture(t,{binary:OLD,owned:true}),cap=await f.inspect();
  for(const action of ['install','導入 & injected',''])await assert.rejects(()=>executeAntigravity(entry,action,cap.context,f.options),{status:400});
  await assert.rejects(()=>executeAntigravity({id:'other'},'導入',cap.context,f.options),{status:400});
  f.state.afterInstall=async()=>{await rm(f.target);await symlink(f.sentinel,f.target);f.state.installerError={code:1};};
  await assert.rejects(()=>f.execute('再導入'),/自動復元/);assert.equal((await lstat(f.target)).isSymbolicLink(),true);assert.ok((await readdir(f.prefix)).some(x=>x.includes('.aidiy-backup-')));await preserved(f);
});


test('cmd の展開文字は拒否し、引用された括弧・空白の通常パスは扱える',async t=>{
  for(const character of ['%','!','^','&',';','|','<','>','"','\r','\n']){
    const f=await fixture(t);f.env.LOCALAPPDATA=path.join(f.root,`unsafe${character}path`);
    assert.deepEqual((await f.inspect()).item.操作,[]);assert.equal(f.calls.length,0);
  }
  const f=await fixture(t,{localName:'Local (profile name)'});await f.execute('導入');assert.deepEqual(await readFile(f.target),NEW);await preserved(f);
});

test('記録公開直後・削除直後の中止でも元のバイナリと導入記録を共に復元する',async t=>{
  for(const action of ['再導入','削除']){
    const f=await fixture(t,{binary:OLD,owned:true}),controller=new AbortController();let reached=false;
    await assert.rejects(()=>f.execute(action,{signal:controller.signal,onData:text=>{if(text.includes('変更を確認しました')){reached=true;controller.abort();}}}));
    assert.equal(reached,true);assert.deepEqual(await readFile(f.target),OLD);assert.equal(await readFile(f.record,'utf8'),receipt(OLD));await preserved(f);
  }
  const f=await fixture(t),controller=new AbortController();
  await assert.rejects(()=>f.execute('導入',{signal:controller.signal,onData:text=>{if(text.includes('変更を確認しました'))controller.abort();}}));
  await absent(f.target);await absent(f.record);await preserved(f);
});

test('記録公開後の例外は旧記録も復元し、確定後の退避 cleanup 失敗は導入結果を壊さない',async t=>{
  const f=await fixture(t,{binary:OLD,owned:true});
  await assert.rejects(()=>f.execute('再導入',{onData:text=>{if(text.includes('変更を確認しました'))throw Error('synthetic failure after receipt publication');}}));
  assert.deepEqual(await readFile(f.target),OLD);assert.equal(await readFile(f.record,'utf8'),receipt(OLD));await preserved(f);
  const cleanup=await fixture(t,{binary:OLD,owned:true});
  await assert.rejects(()=>cleanup.execute('再導入',{onData:text=>{if(text.includes('変更を確認しました')){const backup=readdirSync(cleanup.prefix).find(name=>name.includes('.aidiy-backup-'));writeFileSync(path.join(cleanup.prefix,backup),'MZ changed backup');}}}),/操作は反映済み/);
  assert.deepEqual(await readFile(cleanup.target),NEW);assert.equal(await readFile(cleanup.record,'utf8'),receipt(NEW));assert.ok((await readdir(cleanup.prefix)).some(name=>name.includes('.aidiy-backup-')));await preserved(cleanup);
});


test('System32 の通常の hardlink は起動元として許すが、リンク先差替や owned file には広げない',async t=>{
  const f=await fixture(t);
  for(const command of ['cmd.exe','curl.exe','WindowsPowerShell/v1.0/powershell.exe']){
    const source=path.join(f.systemRoot,'System32',command);await link(source,path.join(f.root,path.basename(command)+'.winsxs'));
  }
  assert.deepEqual((await f.inspect()).item.操作,['導入']);await f.execute('導入');await link(f.target,path.join(f.root,'linked-owned.exe'));
  assert.deepEqual((await f.inspect()).item.操作,[]);
});
