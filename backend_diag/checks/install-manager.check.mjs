// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 合成プロセスと一時フォルダだけで検証する。実際の npm・導入・削除は実行しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {NPM_PACKAGES,LOG_LIMIT,acquireInstallLock,installEnvironment,safeInstallLog,runInstallCommand as actualRunInstallCommand,findNpm,npmCapability,npmCommands,createInstallManager} from '../導入管理/導入管理.mjs';
// Windows はシンボリックリンク権限（開発者モード等）が無いと作成できないため、リンク前提の確認だけ省略する。
const symlinkSkip=await (async()=>{const temp=await mkdtemp(path.join(os.tmpdir(),'aidiy-diag-link-'));try{await writeFile(path.join(temp,'a'),'');await symlink(path.join(temp,'a'),path.join(temp,'b'));return false;}catch(error){if(error.code==='EPERM')return 'シンボリックリンクを作成できない環境';throw error;}finally{await rm(temp,{recursive:true,force:true});}})();

const entries=[...Object.keys(NPM_PACKAGES).map(id=>({id,name:id,commands:[id]})),{id:'python',name:'Python'}];
const npm={executable:'/fixture/node',cli:'/fixture/npm-cli.js',prefix:'/fixture/global prefix;not-a-shell',root:'/fixture/global/lib/node_modules'};
const success={code:0,error:false,cancelled:false,timedOut:false,overflow:false};
// 合成 PID の存在確認さえ実 OS へ送らない。個別の tree 試験だけ判定 hook を上書きする。
const runInstallCommand=options=>actualRunInstallCommand({isTreeRunning:()=>false,...options});
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(predicate,message='合成処理が完了しませんでした。'){
  const deadline=Date.now()+3000;
  while(!await predicate()){if(Date.now()>deadline)assert.fail(message);await new Promise(resolve=>setTimeout(resolve,2));}
}
async function settled(manager){await until(()=>!manager.busy());return (await manager.snapshot()).実行;}
async function temp(t){const directory=await mkdtemp(path.join(os.tmpdir(),'diag-install-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
function fixture(t,options={}){
  const calls=[],probes=[],results=[];
  const manager=createInstallManager({entries,env:{PATH:'/fixture/bin',HOME:'/fixture/home',OPENAI_API_KEY:'synthetic-secret-key',NODE_OPTIONS:'--require /do-not-run',npm_config_registry:'https://invalid.example/'},
    findNpmFn:async()=>npm,capabilityFn:async entry=>({id:entry.id,操作:['導入','再導入','削除']}),acquireLock:async()=>async()=>{},
    run:async command=>{calls.push(command);return success;},probeFn:async entry=>{probes.push(entry.id);return {id:entry.id,状態:'OK',説明:'合成確認'};},
    onResult:result=>{results.push(result);return {確認済み:true};},...options});
  t.after(()=>manager.close());return {manager,calls,probes,results};
}
function syntheticProcess(){const child=new EventEmitter();child.pid=987654321;child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}
function windowsShim(extension,target){
  if(extension==='.cmd')return `@ECHO off\r\nSET dp0=%~dp0\r\n"%dp0%\\node.exe" "%dp0%\\${target.replaceAll('/','\\')}" %*\r\n`;
  if(extension==='.ps1')return `#!/usr/bin/env pwsh\n& "$basedir/node.exe" "$basedir/${target}" $args\n`;
  return `#!/bin/sh\nexec node "$basedir/${target}" "$@"\n`;
}

test('固定4パッケージ・3操作だけを固定 argv と公式 registry で実行する',()=>{
  assert.deepEqual(NPM_PACKAGES,{claude:'@anthropic-ai/claude-code',codex:'@openai/codex',copilot:'@github/copilot',opencode:'@opencode/cli'});
  assert.equal(Object.isFrozen(NPM_PACKAGES),true);
  for(const [id,pkg] of Object.entries(NPM_PACKAGES))for(const [action,steps] of [['導入',['install']],['削除',['uninstall']],['再導入',['install']]]){
    const commands=npmCommands(npm,id,action,'/fixture/private config/npmrc');
    assert.deepEqual(commands.map(command=>command.args[1]),steps);
    for(const command of commands){
      assert.equal(command.executable,npm.executable);
      assert.equal(command.表示,`npm ${command.args[1]} --global ${pkg}`);
      assert.deepEqual(command.args,[npm.cli,command.args[1],'--global',`--prefix=${npm.prefix}`,'--registry=https://registry.npmjs.org/','--userconfig=/fixture/private config/npmrc','--globalconfig=/fixture/private config/npmrc.global','--no-audit','--no-fund','--no-update-notifier','--foreground-scripts',pkg]);
      assert.ok(command.args.every(value=>typeof value==='string'));
    }
  }
  for(const id of ['python','npm','constructor','toString','__proto__','codex;echo injected','@openai/codex'])assert.throws(()=>npmCommands(npm,id,'導入','/fixture/config'),{status:400});
  for(const action of ['install','更新','導入/extra',''])assert.throws(()=>npmCommands(npm,'codex',action,'/fixture/config'),{status:400});
});

test('導入環境は資格情報・Node 注入・任意 npm 設定を除き、探索時だけ導入先設定を許す',()=>{
  const env={PATH:'/bin',Path:'/win/bin',HOME:'/home/fixture',SystemRoot:'C:\\Windows',HTTPS_PROXY:'http://proxy.invalid',NODE_EXTRA_CA_CERTS:'/fixture/ca.pem',NPM_CONFIG_PREFIX:'/fixture/prefix',npm_config_userconfig:'/fixture/user.npmrc',NPM_CONFIG_GLOBALCONFIG:'/fixture/global.npmrc',NPM_CONFIG_REGISTRY:'https://invalid.example',NPM_CONFIG_SCRIPT_SHELL:'bad-shell',NODE_OPTIONS:'--require bad',NODE_PATH:'/bad',NPM_TOKEN:'synthetic-token',OPENAI_API_KEY:'synthetic-key',GITHUB_TOKEN:'synthetic-github',UNRELATED:'no'};
  const clean=installEnvironment(env);
  assert.deepEqual(clean,{PATH:'/bin',Path:'/win/bin',HOME:'/home/fixture',SystemRoot:'C:\\Windows',HTTPS_PROXY:'http://proxy.invalid',NODE_EXTRA_CA_CERTS:'/fixture/ca.pem',NO_COLOR:'1',CI:'1',DO_NOT_TRACK:'1'});
  const discovery=installEnvironment(env,{discovery:true});
  assert.equal(discovery.NPM_CONFIG_PREFIX,env.NPM_CONFIG_PREFIX);assert.equal(discovery.npm_config_userconfig,env.npm_config_userconfig);assert.equal(discovery.NPM_CONFIG_GLOBALCONFIG,env.NPM_CONFIG_GLOBALCONFIG);
  for(const name of ['NODE_OPTIONS','NODE_PATH','NPM_CONFIG_REGISTRY','NPM_CONFIG_SCRIPT_SHELL','NPM_TOKEN','OPENAI_API_KEY'])assert.equal(Object.hasOwn(discovery,name),false);
});

test('コンソールは ANSI・制御文字・環境の秘密・Bearer・proxy 認証を除去する',()=>{
  const value=safeInstallLog('\x1b[31m赤色\x1b[0m\r次行\x00 synthetic-secret-key https://user:password@proxy.invalid/path Bearer fixture-bearer _authToken=fixture-token password:fixture-password token=fixture-token2',{OPENAI_API_KEY:'synthetic-secret-key'});
  assert.match(value,/赤色\n次行/);assert.match(value,/https:\/\/\[非表示\]@proxy.invalid/);
  assert.doesNotMatch(value,/\x1b|\x00|synthetic-secret-key|user:password|fixture-bearer|fixture-token|fixture-password/);
});

test('プロセス実行は shell を使わず、引数・作業場所を保持して両出力を返す',async()=>{
  for(const platform of ['linux','win32']){
    const child=syntheticProcess(),data=[];let observed;
    const promise=runInstallCommand({executable:'/fixture/node',args:['a b',';not-a-command'],cwd:'/fixture/work',env:{PATH:'/fixture'},platform,spawnFn:(...args)=>{observed=args;return child;},killTree:()=>assert.fail('停止しない'),onData:value=>data.push(value)});
    child.stdout.emit('data',Buffer.from('標準出力'));child.stderr.emit('data',Buffer.from('標準エラー'));child.emit('close',0);
    assert.deepEqual(await promise,success);assert.deepEqual(data,['標準出力','標準エラー']);
    assert.deepEqual(observed,['/fixture/node',['a b',';not-a-command'],{cwd:'/fixture/work',env:{PATH:'/fixture'},shell:false,windowsHide:true,detached:platform!=='win32',stdio:['ignore','pipe','pipe']}]);
  }
});

test('日本語の UTF-8 が複数 chunk に分かれても stdout/stderr を個別に復号する',async()=>{
  const child=syntheticProcess(),data=[];
  const promise=runInstallCommand({env:{},spawnFn:()=>child,killTree:()=>assert.fail('停止しない'),onData:value=>data.push(value)});
  const output=Buffer.from('導入完了'),error=Buffer.from('確認中');
  child.stdout.emit('data',output.subarray(0,1));child.stderr.emit('data',error.subarray(0,2));
  child.stdout.emit('data',output.subarray(1,5));child.stdout.emit('data',output.subarray(5));child.stderr.emit('data',error.subarray(2));
  child.stdout.emit('end');child.stderr.emit('end');child.emit('close',0);await promise;
  assert.equal(data.join(''),'導入完了確認中');assert.doesNotMatch(data.join(''),/�/);
});

test('中止済み・生成失敗・error は実プロセスなしで安全な結果を返す',async()=>{
  const controller=new AbortController();controller.abort();
  const cancelled=await runInstallCommand({signal:controller.signal,spawnFn:()=>assert.fail('生成しない')});assert.equal(cancelled.cancelled,true);assert.equal(cancelled.code,null);
  const failed=await runInstallCommand({spawnFn:()=>{throw Error('synthetic private path');}});assert.equal(failed.error,true);assert.equal(failed.code,null);
  const child=syntheticProcess();delete child.pid;
  const promise=runInstallCommand({spawnFn:()=>child,killTree:()=>assert.fail('未生成プロセスを停止しない')});child.emit('error',Error('synthetic spawn failure'));assert.equal((await promise).error,true);
});

test('PID があるプロセスの error は終了まで待ち、停止してから失敗を返す',async()=>{
  const child=syntheticProcess(),kills=[];let resolved=false;
  const promise=runInstallCommand({env:{},spawnFn:()=>child,killTree:(_child,force)=>kills.push(force)}).then(value=>{resolved=true;return value;});
  child.emit('error',Error('synthetic live process failure'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resolved,false);assert.deepEqual(kills,[false]);child.emit('close',null);assert.equal((await promise).error,true);
});

test('中止後も close まで待ち、外部 PID に触れず所有プロセス停止 hook を使う',async()=>{
  const child=syntheticProcess(),controller=new AbortController(),kills=[];let resolved=false;
  const promise=runInstallCommand({env:{},spawnFn:()=>child,signal:controller.signal,killTree:(process,force)=>kills.push({process,force})}).then(value=>{resolved=true;return value;});
  controller.abort();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resolved,false);assert.deepEqual(kills,[{process:child,force:false}]);
  child.emit('close',null);assert.equal((await promise).cancelled,true);assert.equal(kills.length,1);
});

test('期限超過と出力上限でも終了確認まで待つ',async()=>{
  for(const kind of ['timeout','overflow']){
    const child=syntheticProcess(),killed=defer();let resolved=false;
    const promise=runInstallCommand({env:{},spawnFn:()=>child,timeout:kind==='timeout'?10:1000,outputLimit:4,killTree:()=>killed.resolve(),onData:()=>assert.fail('上限超過出力は公開しない')}).then(value=>{resolved=true;return value;});
    if(kind==='overflow')child.stdout.emit('data',Buffer.from('12345'));
    await killed.promise;assert.equal(resolved,false);child.emit('close',null);
    const result=await promise;assert.equal(result.timedOut,kind==='timeout');assert.equal(result.overflow,kind==='overflow');
  }
});

test('親 close 後も子孫が残れば停止を継続し、強制停止 timer を失わない',async()=>{
  const child=syntheticProcess(),controller=new AbortController(),kills=[];let alive=true,resolved=false;
  const promise=runInstallCommand({env:{},spawnFn:()=>child,signal:controller.signal,isTreeRunning:process=>{assert.equal(process,child);return alive;},killTree:(_child,force)=>{kills.push(force);return true;}}).then(value=>{resolved=true;return value;});
  controller.abort();child.emit('close',null);await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false);assert.deepEqual(kills,[false]);
  await until(()=>kills.includes(true));assert.equal(resolved,false,'親終了や kill の応答だけで子孫終了にしない');
  alive=false;const result=await promise;assert.equal(result.cancelled,true);assert.equal(result.code,null);
});

test('親だけ正常終了して子孫が残る場合も timeout まで監視して停止する',async()=>{
  const child=syntheticProcess(),killed=defer();let alive=true,resolved=false;
  const promise=runInstallCommand({env:{},spawnFn:()=>child,timeout:15,isTreeRunning:()=>alive,killTree:()=>{killed.resolve();return true;}}).then(value=>{resolved=true;return value;});
  child.emit('close',0);await killed.promise;assert.equal(resolved,false);alive=false;const result=await promise;assert.equal(result.timedOut,true);
});

test('Windows は非同期の tree 停止確認を待ち、false では解除せず強制停止を継続する',async()=>{
  for(const confirmation of [true,undefined,false]){
    const child=syntheticProcess(),controller=new AbortController(),gate=defer(),kills=[];let resolved=false;
    const promise=runInstallCommand({env:{},platform:'win32',isTreeRunning:undefined,spawnFn:()=>child,signal:controller.signal,killTree:(_child,force)=>{kills.push(force);return force?Promise.resolve(true):gate.promise;}}).then(value=>{resolved=true;return value;});
    controller.abort();child.emit('close',null);await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false);
    gate.resolve(confirmation);await new Promise(resolve=>setImmediate(resolve));
    if(confirmation===false){assert.equal(resolved,false);await until(()=>kills.includes(true));}
    assert.equal((await promise).cancelled,true);assert.deepEqual(kills,confirmation===false?[false,true]:[false]);
  }
});

async function npmTree(t,platform='linux'){
  const directory=await temp(t),prefix=path.join(directory,'prefix'),root=path.join(prefix,...(platform==='win32'?['node_modules']:['lib','node_modules']));
  const cli=path.join(root,'npm','bin','npm-cli.js');await mkdir(path.dirname(cli),{recursive:true});await writeFile(cli,'// 合成。実行しない。');await writeFile(path.join(root,'npm','package.json'),JSON.stringify({name:'npm'}));
  const selected=platform==='win32'?path.join(prefix,'npm.cmd'):cli;if(platform==='win32')await writeFile(selected,'@rem 合成');
  return {directory,prefix,root,cli,selected,executable:process.execPath};
}

test('npm 探索は固定 CLI 本体と標準 prefix/root のみを採用する',async t=>{
  for(const platform of ['linux','win32']){
    const tree=await npmTree(t,platform),calls=[];
    const found=await findNpm({platform,env:{PATH:'/fixture',NPM_TOKEN:'synthetic-secret',NPM_CONFIG_PREFIX:tree.prefix},resolve:async(entry,options)=>{assert.deepEqual(entry,{id:'npm',commands:['npm','npm.cmd']});assert.equal(options.platform,platform);return tree.selected;},run:async command=>{calls.push(command);command.onData(`${command.args[1]==='prefix'?tree.prefix:tree.root}\n`);return success;}});
    assert.deepEqual(found,{executable:process.execPath,cli:tree.cli,prefix:tree.prefix,root:tree.root});
    assert.deepEqual(calls.map(command=>command.args),[[tree.cli,'prefix','--global','--loglevel=error'],[tree.cli,'root','--global','--loglevel=error']]);
    for(const command of calls){assert.equal(command.executable,process.execPath);assert.equal(command.cwd,os.tmpdir());assert.equal(command.timeout,10000);assert.equal(command.outputLimit,65536);assert.equal(command.env.NPM_TOKEN,undefined);assert.equal(command.env.NPM_CONFIG_PREFIX,tree.prefix);}
  }
});

test('npm 不在・別 CLI・異なる所有者・不正導入先・探索失敗では操作しない',async t=>{
  // POSIX 配置の fixture は、実行OSにかかわらず同じ探索条件で検証する。
  const findFixtureNpm=options=>findNpm({...options,platform:'linux'});
  const tree=await npmTree(t);
  await assert.rejects(()=>findFixtureNpm({resolve:async()=>null,run:()=>assert.fail('実行しない')}),{status:409});
  const other=path.join(tree.directory,'not-npm.js');await writeFile(other,'// 合成');
  await assert.rejects(()=>findFixtureNpm({resolve:async()=>other,run:()=>assert.fail('実行しない')}),{status:409});
  for(const answer of ['relative/path',`${tree.prefix}\n${tree.prefix}`,`${tree.prefix}\r${tree.prefix}`])await assert.rejects(()=>findFixtureNpm({resolve:async()=>tree.cli,run:async command=>{command.onData(answer);return success;}}),{status:409});
  await assert.rejects(()=>findFixtureNpm({resolve:async()=>tree.cli,run:async command=>{command.onData(command.args[1]==='prefix'?tree.prefix:path.join(tree.directory,'foreign'));return success;}}),{status:409});
  for(const patch of [{code:1},{error:true},{timedOut:true},{overflow:true}])await assert.rejects(()=>findFixtureNpm({resolve:async()=>tree.cli,run:async()=>({...success,...patch})}),{status:409});
  await writeFile(path.join(tree.root,'npm','package.json'),JSON.stringify({name:'not-npm'}));
  await assert.rejects(()=>findFixtureNpm({resolve:async()=>tree.cli,run:()=>assert.fail('実行しない')}),{status:409});
});

async function packageTree(t,{id='codex',platform='linux',manifest={name:NPM_PACKAGES[id],bin:{[id]:'bin/cli.js'}}}={}){
  const tree=await npmTree(t,platform),directory=path.join(tree.root,...NPM_PACKAGES[id].split('/')),target=path.join(directory,'bin','cli.js');
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,'// 合成。実行しない。');await writeFile(path.join(directory,'package.json'),JSON.stringify(manifest));
  return {...tree,directory,target,id,manifest};
}

test('Copilot の native bin と標準 npm shim は導入済みでも削除せず更新できる',async t=>{
  const entry=entries.find(item=>item.id==='copilot');
  for(const platform of ['linux','win32']){
    const tree=await npmTree(t,platform),directory=path.join(tree.root,'@github','copilot'),binary=path.join(directory,'bin','copilot.exe');
    await mkdir(path.dirname(binary),{recursive:true});await writeFile(binary,'MZ synthetic Copilot; never execute');
    await writeFile(path.join(directory,'package.json'),JSON.stringify({name:'@github/copilot',bin:{copilot:'./bin/copilot.exe'}}));
    const paths=[binary];
    if(platform==='win32')for(const extension of ['', '.cmd', '.ps1']){
      const shim=path.join(tree.prefix,'copilot'+extension);await writeFile(shim,windowsShim(extension,'node_modules/@github/copilot/bin/copilot.exe'));paths.push(shim);
    }
    for(const executable of paths){
      const cap=await npmCapability(entry,tree,{platform,resolve:async()=>executable});
      assert.deepEqual(cap.操作,['再導入','削除']);
      const commands=npmCommands(tree,'copilot','再導入','/fixture/npmrc',cap);
      assert.equal(commands.length,1);assert.equal(commands[0].args[1],'install');assert.equal(commands[0].args.at(-1),'@github/copilot');
      assert.doesNotMatch(commands[0].表示,/uninstall/);
    }
    const foreign=path.join(tree.prefix,'unowned-copilot.exe');await writeFile(foreign,'MZ unowned');
    assert.deepEqual((await npmCapability(entry,tree,{platform,resolve:async()=>foreign})).操作,[]);
  }
});

test('能力判定は未導入・npm 管理・別導入元・所有情報不正を区別する',async t=>{
  const tree=await npmTree(t),entry=entries.find(item=>item.id==='codex');
  assert.deepEqual((await npmCapability(entry,tree,{resolve:async()=>null})).操作,['導入']);
  assert.deepEqual((await npmCapability(entry,tree,{resolve:async()=>'/fixture/standalone-codex'})).操作,[]);
  for(const id of ['python','constructor','toString','__proto__'])assert.deepEqual((await npmCapability({id},tree,{resolve:()=>assert.fail('未登録項目は探索しない')})).操作,[]);
  const owned=await packageTree(t);assert.deepEqual((await npmCapability(entry,owned,{resolve:async()=>null})).操作,['再導入','削除']);
  assert.deepEqual((await npmCapability(entry,owned,{resolve:async()=>owned.target})).操作,['再導入','削除']);
  const foreign=path.join(owned.directory,'different.js');await writeFile(foreign,'// 別導入元');assert.deepEqual((await npmCapability(entry,owned,{resolve:async()=>foreign})).操作,[]);
  await writeFile(path.join(owned.directory,'package.json'),'{broken');assert.deepEqual((await npmCapability(entry,owned,{resolve:async()=>null})).操作,[]);
  await writeFile(path.join(owned.directory,'package.json'),JSON.stringify({name:'wrong-owner'}));assert.deepEqual((await npmCapability(entry,owned,{resolve:async()=>owned.target})).操作,[]);
});

test('POSIX symlink と Windows npm shim の所有元を照合する',{skip:symlinkSkip},async t=>{
  const tree=await packageTree(t),entry=entries.find(item=>item.id==='codex');
  const linked=path.join(tree.prefix,'codex');await symlink(tree.target,linked);assert.deepEqual((await npmCapability(entry,tree,{platform:'linux',resolve:async()=>linked})).操作,['再導入','削除']);
  const win=await packageTree(t,{platform:'win32'});
  for(const extension of ['','.cmd','.ps1']){
    const shim=path.join(win.prefix,'codex'+extension);await writeFile(shim,windowsShim(extension,'node_modules/@openai/codex/bin/cli.js'));
    assert.deepEqual((await npmCapability(entry,win,{platform:'win32',resolve:async()=>shim})).操作,['再導入','削除']);
    await writeFile(shim,windowsShim(extension,'node_modules/other/bin/cli.js'));assert.deepEqual((await npmCapability(entry,win,{platform:'win32',resolve:async()=>shim})).操作,[]);
  }
  const external=path.join(win.directory,'codex.cmd');await writeFile(external,'node_modules/@openai/codex/bin/cli.js');assert.deepEqual((await npmCapability(entry,win,{platform:'win32',resolve:async()=>external})).操作,[]);
});

test('OpenCode 2.x の同じ実体を指す opencode2 別名は所有を認め、別の実体は認めない',async t=>{
  const entry=entries.find(item=>item.id==='opencode');
  const alias=await packageTree(t,{id:'opencode',manifest:{name:NPM_PACKAGES.opencode,bin:{opencode:'bin/cli.js',opencode2:'./bin/cli.js'}}});
  await writeFile(path.join(alias.directory,'package.json'),JSON.stringify({name:NPM_PACKAGES.opencode,bin:{opencode:'bin/cli.js',opencode2:'bin/cli.js'}}));
  assert.deepEqual((await npmCapability(entry,alias,{resolve:async()=>null})).操作,['再導入','削除']);
  await writeFile(path.join(alias.directory,'bin','other.js'),'// 合成。実行しない。');
  await writeFile(path.join(alias.directory,'package.json'),JSON.stringify({name:NPM_PACKAGES.opencode,bin:{opencode:'bin/cli.js',opencode2:'bin/other.js'}}));
  assert.deepEqual((await npmCapability(entry,alias,{resolve:async()=>null})).操作,[]);
});

test('不正 bin・パッケージ外参照・別所有者では再導入も削除も許可しない',async t=>{
  const tree=await packageTree(t),entry=entries.find(item=>item.id==='codex');
  for(const bin of [null,{}, {codex:'../../../foreign.js'}, {codex:tree.target}, {'bad/name':'bin/cli.js'}, {codex:42}]){
    await writeFile(path.join(tree.directory,'package.json'),JSON.stringify({name:NPM_PACKAGES.codex,bin}));
    assert.deepEqual((await npmCapability(entry,tree,{resolve:async()=>tree.target})).操作,[]);
  }
});

test('npm link と package 内の bin symlink から外部配置を所有扱いしない',{skip:symlinkSkip},async t=>{
  const tree=await npmTree(t),entry=entries.find(item=>item.id==='codex'),external=path.join(tree.directory,'external-package');
  await mkdir(path.join(external,'bin'),{recursive:true});await writeFile(path.join(external,'package.json'),JSON.stringify({name:NPM_PACKAGES.codex,bin:{codex:'bin/cli.js'}}));await writeFile(path.join(external,'bin','cli.js'),'// 外部配置');
  const directory=path.join(tree.root,'@openai','codex');await mkdir(path.dirname(directory),{recursive:true});await symlink(external,directory,'dir');
  for(const executable of [null,path.join(external,'bin','cli.js')])assert.deepEqual((await npmCapability(entry,tree,{resolve:async()=>executable})).操作,[]);
  const binTree=await packageTree(t);await rm(binTree.target);await symlink(path.join(external,'bin','cli.js'),binTree.target);
  assert.deepEqual((await npmCapability(entry,binTree,{resolve:async()=>binTree.target})).操作,[]);
});

test('Windows shim は別接尾辞・comment のみ・混在する別対象を所有扱いしない',async t=>{
  const tree=await packageTree(t,{platform:'win32'}),entry=entries.find(item=>item.id==='codex');
  for(const extension of ['','.cmd','.ps1']){
    const shim=path.join(tree.prefix,'codex'+extension),correct=windowsShim(extension,'node_modules/@openai/codex/bin/cli.js'),foreign=windowsShim(extension,'node_modules/other/bin/cli.js');
    const comment=(extension==='.cmd'?'@rem ':'# ')+correct.split(/\r?\n/).filter(line=>line.includes('node_modules')).join('\n');
    for(const text of [windowsShim(extension,'node_modules/@openai/codex/bin/cli.js.other'),comment,correct+'\n'+foreign]){
      await writeFile(shim,text);assert.deepEqual((await npmCapability(entry,tree,{platform:'win32',resolve:async()=>shim})).操作,[]);
    }
  }
});

test('manifest がない既存 package directory は未導入と推測して上書きしない',async t=>{
  const tree=await npmTree(t),entry=entries.find(item=>item.id==='codex');
  await mkdir(path.join(tree.root,'@openai','codex'),{recursive:true});
  assert.deepEqual((await npmCapability(entry,tree,{resolve:async()=>null})).操作,[]);
});

test('一覧は操作を実行せず、能力をキャッシュし、明示 invalidation 後だけ更新する',async t=>{
  let inspected=0;const {manager,calls,probes}=fixture(t,{findNpmFn:async()=>{inspected++;return npm;}});
  const first=await manager.snapshot();assert.equal(first.実行,null);assert.deepEqual(first.項目.at(-1).操作,[]);
  await manager.snapshot();assert.equal(inspected,1);assert.equal(calls.length,0);assert.equal(probes.length,0);
  manager.invalidate();await manager.snapshot();assert.equal(inspected,2);
});

test('開始前の能力読込が invalidation 後に終了しても古い情報を再利用しない',async t=>{
  const gate=defer();let calls=0;t.after(()=>gate.resolve());
  const {manager}=fixture(t,{findNpmFn:async()=>{calls++;if(calls===1)await gate.promise;return npm;}});
  const pending=manager.snapshot();await until(()=>calls===1);manager.invalidate();gate.resolve();await pending;
  assert.equal(calls,2);await manager.snapshot();assert.equal(calls,2);
});

test('導入は空の一時 npmrc と隔離環境で実行し、確認結果を返して一時領域を回収する',async t=>{
  let command,config;const {manager,probes,results}=fixture(t,{run:async value=>{
    command=value;config=value.args.find(arg=>arg.startsWith('--userconfig=')).slice('--userconfig='.length);
    assert.equal(path.dirname(config),value.cwd);assert.equal(await readFile(config,'utf8'),'');assert.equal(await readFile(config+'.global','utf8'),'');
    if(process.platform!=='win32'){assert.equal((await stat(config)).mode&0o777,0o600);assert.equal((await stat(config+'.global')).mode&0o777,0o600);}
    assert.equal(value.env.OPENAI_API_KEY,undefined);assert.equal(value.env.NODE_OPTIONS,undefined);assert.equal(value.env.npm_config_registry,undefined);assert.equal(value.env.HOME,'/fixture/home');
    value.onData('合成コマンド出力\n');return success;
  }});
  const started=await manager.start('codex','導入');assert.equal(started.実行.対象,'codex');assert.equal(manager.busy(),true);
  const job=await settled(manager);assert.equal(job.状態,'完了');assert.equal(job.終了コード,0);assert.equal(job.確認済み,true);assert.equal(job.結果.id,'codex');assert.ok(job.終了日時);assert.match(job.ログ,/合成コマンド出力/);
  assert.deepEqual(probes,['codex']);assert.equal(results.length,1);assert.equal(command.args.at(-1),'@openai/codex');
  await assert.rejects(()=>stat(command.cwd),{code:'ENOENT'});
});

test('npm 再導入は install 1回だけで更新し、最後に1回だけ確認する',async t=>{
  for(const [id,pkg] of Object.entries(NPM_PACKAGES)){
    const sequence=[];const {manager,results}=fixture(t,{run:async command=>{sequence.push(command.args[1]);assert.equal(command.args.at(-1),pkg);return success;},probeFn:async entry=>{sequence.push('probe');return {id:entry.id,状態:'OK'};}});
    await manager.start(id,'再導入');const job=await settled(manager);assert.equal(job.状態,'完了');assert.deepEqual(sequence,['install','probe']);assert.equal(results.length,1);
    assert.ok(job.ログ.includes(`$ npm install --global ${pkg}`));assert.doesNotMatch(job.ログ,/uninstall/);
  }
});

test('npm 再導入の失敗・期限超過・出力上限・例外でも削除や再試行をせず、対象を再確認する',async t=>{
  for(const failure of [{code:7},{error:true,code:null},{timedOut:true},{overflow:true},'throw']){
    const sequence=[];const {manager}=fixture(t,{run:async command=>{sequence.push(command.args[1]);if(failure==='throw')throw Error('synthetic-private-secret');return {...success,...failure};},probeFn:async entry=>{sequence.push('probe');return {id:entry.id,状態:'未検出'};}});
    await manager.start('codex','再導入');const job=await settled(manager);assert.equal(job.状態,'失敗');assert.deepEqual(sequence,['install','probe']);assert.doesNotMatch(job.ログ,/synthetic-private-secret|uninstall/);
  }
});

test('表示後の所有元変更を開始直前に再確認し、実行せず対象だけ確認する',async t=>{
  let allowed=true;const {manager,calls,probes}=fixture(t,{capabilityFn:async entry=>({id:entry.id,操作:allowed?['導入']:[]})});
  assert.deepEqual((await manager.snapshot()).項目[0].操作,['導入']);allowed=false;
  await manager.start('claude','導入');const job=await settled(manager);assert.equal(job.状態,'失敗');assert.match(job.説明,/所有元が変わりました/);assert.equal(calls.length,0);assert.deepEqual(probes,['claude']);
});

test('同じ項目の連打は排他され、中止後も停止と再確認完了まで解除しない',async t=>{
  const gate=defer(),checked=defer(),sequence=[];let running,checking=false;t.after(()=>{gate.resolve();checked.resolve();});
  const {manager}=fixture(t,{run:async command=>{running=command;sequence.push(command.args[1]);await gate.promise;return {...success,code:null,cancelled:command.signal.aborted};},probeFn:async entry=>{checking=true;sequence.push('probe');await checked.promise;return {id:entry.id,状態:'未検出'};}});
  const start=await manager.start('codex','再導入');await until(()=>running);
  await assert.rejects(()=>manager.start('codex','導入'),{status:409});
  await assert.rejects(()=>manager.cancel('unknown'),{status:404});assert.equal(running.signal.aborted,false);
  await manager.cancel(start.実行.実行ID);assert.equal(running.signal.aborted,true);assert.equal(manager.busy(),true);
  running.onUncertain();assert.equal((await manager.snapshot()).実行.状態,'停止未確認');await assert.rejects(()=>manager.start('codex','導入'),{status:409});
  gate.resolve();await until(()=>checking);assert.equal((await manager.snapshot()).実行.状態,'確認中');assert.equal(manager.busy(),true);
  checked.resolve();const job=await settled(manager);assert.equal(job.状態,'中止');assert.match(job.ログ,/中止を要求/);assert.deepEqual(sequence,['install','probe']);assert.doesNotMatch(job.ログ,/uninstall/);
});

test('事前確認中の中止は npm 操作を開始せず、その後の確認は行う',async t=>{
  const gate=defer();let discovers=0;t.after(()=>gate.resolve());
  const {manager,calls,probes}=fixture(t,{findNpmFn:async()=>{discovers++;if(discovers===1)await gate.promise;return npm;}});
  const start=await manager.start('codex','導入');await until(()=>discovers===1);await manager.cancel(start.実行.実行ID);assert.equal(manager.busy(),true);
  gate.resolve();assert.equal((await settled(manager)).状態,'中止');assert.equal(calls.length,0);assert.deepEqual(probes,['codex']);
});

test('実行コード0でも導入未確認・削除後の別導入元残存・確認例外は成功にしない',async t=>{
  for(const [action,result] of [['導入',{状態:'未検出'}],['削除',{状態:'OK',パス:'/fixture/another/codex'}],['導入',null]]){
    const {manager}=fixture(t,{probeFn:async entry=>{if(!result)throw Error('synthetic-private-probe');return {id:entry.id,...result};}});
    await manager.start('codex',action);const job=await settled(manager);assert.equal(job.状態,'失敗');assert.doesNotMatch(job.ログ,/synthetic-private-probe/);
  }
  const {manager}=fixture(t,{probeFn:async entry=>({id:entry.id,状態:'未検出',パス:null})});await manager.start('codex','削除');assert.equal((await settled(manager)).状態,'完了');
});

test('公開ログは上限内・秘密除去済みで、内部 raw を返さない',async t=>{
  const {manager}=fixture(t,{run:async command=>{command.onData('x'.repeat(LOG_LIMIT*3));command.onData('\nsynthetic-secret-key\x1b[31m token=synthetic-other-secret\n');return success;}});
  await manager.start('codex','導入');const job=await settled(manager);assert.ok(job.ログ.length<=LOG_LIMIT);assert.equal(Object.hasOwn(job,'raw'),false);assert.match(job.ログ,/非表示/);assert.doesNotMatch(JSON.stringify(job),/synthetic-secret-key|synthetic-other-secret|\\u001b/);
});

test('終了は所有操作を中止して確認完了を待ち、以後の操作を拒否する',async t=>{
  const gate=defer();let active,closed=false;t.after(()=>gate.resolve());
  const {manager,probes}=fixture(t,{run:async command=>{active=command;await gate.promise;return {...success,cancelled:command.signal.aborted};}});
  await manager.start('codex','導入');await until(()=>active);const close=manager.close().then(()=>{closed=true;});
  assert.equal(active.signal.aborted,true);assert.equal(closed,false);assert.equal(manager.busy(),true);gate.resolve();await close;
  assert.deepEqual(probes,['codex']);assert.equal((await manager.snapshot()).実行.状態,'中止');await assert.rejects(()=>manager.start('codex','導入'),{status:409});
});

test('manager 自体も固定4 ID と固定操作以外を拒否する',async t=>{
  const {manager,calls,probes}=fixture(t,{entries:[...entries,{id:'constructor'},{id:'toString'}]});
  for(const id of ['node','constructor','toString','__proto__','codex/extra'])await assert.rejects(()=>manager.start(id,'導入'),{status:404});
  await assert.rejects(()=>manager.start('codex','任意コマンド'),{status:404});assert.equal(calls.length,0);assert.equal(probes.length,0);
});

test('prefix ロックは同じ実体・Windows 大小文字違いを拒否し、別導入先と解除後を許可する',{skip:symlinkSkip},async t=>{
  const directory=await temp(t),prefix=path.join(directory,'prefix');await mkdir(prefix);
  const alias=path.join(directory,'alias');await symlink(prefix,alias,'dir');
  const release=await acquireInstallLock(prefix,{directory});t.after(release);
  const files=(await readdir(directory)).filter(name=>name.endsWith('.lock'));assert.equal(files.length,1);
  assert.equal(await readFile(path.join(directory,files[0]),'utf8'),String(process.pid));
  if(process.platform!=='win32')assert.equal((await stat(path.join(directory,files[0]))).mode&0o777,0o600);
  for(const target of [prefix,path.join(prefix,'.'),alias])await assert.rejects(()=>acquireInstallLock(target,{directory}),{status:409});
  const releaseOther=await acquireInstallLock(path.join(directory,'other'),{directory});await releaseOther();
  await release();await release();assert.equal((await readdir(directory)).some(name=>name.endsWith('.lock')),false);
  const again=await acquireInstallLock(prefix,{directory});await again();
  const releaseWin=await acquireInstallLock(path.join(directory,'WindowsPrefix'),{directory,platform:'win32'});t.after(releaseWin);
  await assert.rejects(()=>acquireInstallLock(path.join(directory,'WINDOWSPREFIX'),{directory,platform:'win32'}),{status:409});await releaseWin();
});

test('残存ロックは推測で削除せず、作成不可の場合も閉じたまま失敗する',async t=>{
  const directory=await temp(t),prefix=path.join(directory,'prefix');
  const release=await acquireInstallLock(prefix,{directory});t.after(release);
  const filename=(await readdir(directory)).find(name=>name.endsWith('.lock'));
  await writeFile(path.join(directory,filename),'999999999');
  await assert.rejects(()=>acquireInstallLock(prefix,{directory}),{status:409});assert.equal(await readFile(path.join(directory,filename),'utf8'),'999999999');
  await assert.rejects(()=>acquireInstallLock(prefix,{directory:path.join(directory,'missing')}),{status:409});
  await release();
});

test('prefix ロックを所有プロセス停止・確認・能力更新まで保持する',async t=>{
  const commandGate=defer(),probeGate=defer();let active,checking=false,released=0,acquired=0,capabilities=0;t.after(()=>{commandGate.resolve();probeGate.resolve();});
  const {manager}=fixture(t,{acquireLock:async(prefix,options)=>{acquired++;assert.equal(prefix,npm.prefix);assert.equal(options.platform,process.platform);return async()=>{released++;};},
    capabilityFn:async entry=>{capabilities++;return {id:entry.id,操作:['導入']};},
    run:async command=>{active=command;await commandGate.promise;return {...success,cancelled:command.signal.aborted};},
    probeFn:async entry=>{checking=true;await probeGate.promise;return {id:entry.id,状態:'未検出'};}});
  const start=await manager.start('codex','導入');await until(()=>active);assert.equal(acquired,1);assert.equal(released,0);
  await manager.cancel(start.実行.実行ID);active.onUncertain();assert.equal(released,0);assert.equal(manager.busy(),true);
  commandGate.resolve();await until(()=>checking);assert.equal(released,0);const before=capabilities;
  probeGate.resolve();assert.equal((await settled(manager)).状態,'中止');assert.equal(released,1);assert.ok(capabilities>before,'解除前に導入能力も更新する');
});

test('prefix ロックの競合は npm を動かさず、取得直後も所有元変更を再確認する',async t=>{
  const rejected=fixture(t,{acquireLock:async()=>{throw Object.assign(Error('合成の別操作が実行中です。'),{status:409});}});
  await rejected.manager.start('codex','導入');assert.equal((await settled(rejected.manager)).状態,'失敗');assert.equal(rejected.calls.length,0);assert.deepEqual(rejected.probes,['codex']);
  let acquired=false,released=0;
  const changed=fixture(t,{acquireLock:async()=>{acquired=true;return async()=>{released++;};},capabilityFn:async entry=>({id:entry.id,操作:acquired?[]:['導入']})});
  await changed.manager.start('codex','導入');const job=await settled(changed.manager);assert.equal(job.状態,'失敗');assert.match(job.説明,/所有元が変わりました/);assert.equal(changed.calls.length,0);assert.deepEqual(changed.probes,['codex']);assert.equal(released,1);
});

test('prefix ロック解除失敗は成功と表示せず安全な失敗を返す',async t=>{
  const {manager}=fixture(t,{acquireLock:async()=>async()=>{throw Error('synthetic-private-lock-path');}});
  await manager.start('codex','導入');const job=await settled(manager);assert.equal(job.状態,'失敗');assert.match(job.説明,/排他ロックを解除できません/);assert.doesNotMatch(job.ログ,/synthetic-private-lock-path/);
});

test('管理処理は親 close 後も子孫停止まで prefix ロックを保持する',async t=>{
  const child=syntheticProcess();let active,alive=true,released=0,checks=0;
  t.after(()=>{alive=false;child.emit('close',null);});
  const {manager}=fixture(t,{acquireLock:async()=>async()=>{released++;},run:command=>{active=command;return runInstallCommand({...command,spawnFn:()=>child,isTreeRunning:()=>alive,killTree:()=>true});},probeFn:async entry=>{checks++;return {id:entry.id,状態:'未検出'};}});
  const start=await manager.start('codex','導入');await until(()=>active);await manager.cancel(start.実行.実行ID);child.emit('close',null);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(released,0);assert.equal(checks,0);assert.equal(manager.busy(),true);await assert.rejects(()=>manager.start('codex','導入'),{status:409});
  alive=false;assert.equal((await settled(manager)).状態,'中止');assert.equal(released,1);assert.equal(checks,1);
});


test('固定 CMD だけは既に組み立てた引用符を Windows へ保持し、shell は無効のまま実行する',async()=>{
  const child=syntheticProcess();let captured;
  const args=['/d','/v:off','/s','/c','""C:\\fixture (space)\\install.cmd" --skip-path --skip-aliases"'];
  const pending=runInstallCommand({platform:'win32',executable:'C:\\Windows\\System32\\cmd.exe',args,windowsVerbatimArguments:true,spawnFn:(_executable,actualArgs,options)=>{captured={actualArgs,options};return child;}});
  child.emit('close',0);assert.equal((await pending).code,0);assert.deepEqual(captured.actualArgs,args);assert.equal(captured.options.windowsVerbatimArguments,true);assert.equal(captured.options.shell,false);
});

test('別項目は同じ npm 導入先でも並行して実行し、排他ロックはパッケージ単位で取る',async t=>{
  const gate=defer(),running=[],scopes=[];t.after(()=>gate.resolve());
  const {manager,probes}=fixture(t,{acquireLock:async(prefix,options)=>{assert.equal(prefix,npm.prefix);scopes.push(options.scope);return async()=>{};},run:async command=>{running.push(command.args.at(-1));await gate.promise;return success;}});
  await manager.start('codex','導入');await manager.start('claude','導入');
  await until(()=>running.length===2);
  assert.deepEqual([...running].sort(),['@anthropic-ai/claude-code','@openai/codex']);assert.deepEqual([...scopes].sort(),['@anthropic-ai/claude-code','@openai/codex']);
  assert.equal((await manager.snapshot()).実行一覧.filter(job=>job.実行中).length,2);
  await assert.rejects(()=>manager.start('codex','削除'),{status:409});
  gate.resolve();await settled(manager);
  const jobs=(await manager.snapshot()).実行一覧;
  assert.deepEqual(jobs.map(job=>[job.対象,job.状態]),[['codex','完了'],['claude','完了']]);assert.deepEqual([...probes].sort(),['claude','codex']);
});

test('同じ導入先でも、ロックの範囲が違えば並行取得でき、同じ範囲は拒否する',async t=>{
  const directory=await temp(t),prefix=path.join(directory,'prefix');await mkdir(prefix);
  const first=await acquireInstallLock(prefix,{directory,scope:'@openai/codex'});
  const second=await acquireInstallLock(prefix,{directory,scope:'@anthropic-ai/claude-code'});
  await assert.rejects(()=>acquireInstallLock(prefix,{directory,scope:'@openai/codex'}),{status:409});
  await first();await second();
  await (await acquireInstallLock(prefix,{directory,scope:'@openai/codex'}))();
});

test('残留子孫の定期確認は1秒周期、親close直後は即時に確認する',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const child=syntheticProcess();let alive=true,checks=0,resolved=false;
  const promise=runInstallCommand({env:{},spawnFn:()=>child,isTreeRunning:()=>{checks++;return alive;}}).then(value=>{resolved=true;return value;});
  child.emit('close',0);assert.equal(checks,1);assert.equal(resolved,false);
  t.mock.timers.tick(999);assert.equal(checks,1);alive=false;
  t.mock.timers.tick(1);assert.equal(checks,2);assert.equal((await promise).code,0);assert.equal(resolved,true);
});
