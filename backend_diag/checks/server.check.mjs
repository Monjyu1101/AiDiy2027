// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,createServer,basePath,publicUrl,parseArgs} from '../diag_main.mjs';
const response=()=>({status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
async function request(handler,url,method='GET',authorization,extra={}) {const res=response();await handler({url,method,headers:{authorization,...extra}},res);return res;}
const auth='Bearer test-key';
test('API authentication, encoded Japanese paths and static boundary',async()=>{
 const h=createHandler({token:'test-key',prefix:'/proxy/8097/',entries:[],coverage:{sourceTargetFiles:3333,complete:true}});
 assert.equal((await request(h,'/proxy/8097/api/一覧')).status,401);
 const listing=await request(h,'/proxy/8097/api/%E4%B8%80%E8%A6%A7','GET',auth);assert.equal(listing.status,200);assert.equal(JSON.parse(listing.body).調査.sourceTargetFiles,3333);
 for(const url of ['/proxy/8097/../catalog.json','/proxy/8097/catalog.json','/api/一覧','/proxy/8097/%ZZ']) assert.notEqual((await request(h,url,'GET',auth)).status,200);
 const shell=await request(h,'/proxy/8097/');assert.equal(shell.status,200);assert.match(shell.headers['Content-Security-Policy'],/frame-ancestors 'none'/);assert.ok(!shell.body.toString().includes('test-key'));
});
test('fixed diagnostic action, no command/path/body/query arguments',async()=>{
 let scans=0;const h=createHandler({token:'test-key',entries:[],scanFn:async()=>{scans++;return [];}});
 assert.equal((await request(h,'/api/診断','POST')).status,401);
 assert.equal((await request(h,'/api/診断','POST',auth,{'content-length':'4'})).status,400);
 assert.equal((await request(h,'/api/診断?command=bad','POST',auth)).status,400);
 assert.equal((await request(h,'/api/診断','POST',auth,{'transfer-encoding':'chunked'})).status,400);
 assert.equal(scans,0);assert.equal((await request(h,'/api/診断','POST',auth)).status,200);assert.equal(scans,1);
});
test('concurrent scan rejected and failed scan unlocks',async()=>{
 let release;const h=createHandler({token:'test-key',scanFn:()=>new Promise(r=>{release=r;})});
 const first=request(h,'/api/診断','POST',auth);assert.equal((await request(h,'/api/診断','POST',auth)).status,409);release([]);assert.equal((await first).status,200);
});
test('progress returns only finished items while scanning, then nothing',async()=>{
 let release;const h=createHandler({token:'test-key',entries:[{id:'a'},{id:'b'}],probeFn:async entry=>({id:entry.id,状態:'OK'}),
  scanFn:async(list,probeFn)=>{const first=await probeFn(list[0]);await new Promise(r=>{release=r;});return [first,await probeFn(list[1])];}});
 assert.equal((await request(h,'/api/診断/進捗')).status,401);
 const idle=JSON.parse((await request(h,'/api/診断/進捗','GET',auth)).body);assert.deepEqual(idle,{実行中:false,結果:[]});
 const scanning=request(h,'/api/診断','POST',auth);await new Promise(r=>setImmediate(r));
 assert.deepEqual(JSON.parse((await request(h,'/api/診断/進捗','GET',auth)).body),{実行中:true,結果:[{id:'a',状態:'OK'}]});
 assert.equal((await request(h,'/api/診断/進捗?x=1','GET',auth)).status,400);
 release();assert.equal((await scanning).status,200);
 assert.deepEqual(JSON.parse((await request(h,'/api/診断/進捗','GET',auth)).body),{実行中:false,結果:[]});
});
test('integration write saves only server-side integration results, never model results, and requires a check',async()=>{
 let saved=null,modelSaved=null;
 const rows=[{id:'openai'},{id:'huggingface_read'},{id:'discord'}];
 const h=createHandler({token:'test-key',scanFn:async()=>[],keyStatusFn:async()=>({項目:rows}),keyTestFn:async id=>({id,状態:'OK',説明:'fixture',モデル:[],確認日時:'2026-10-17T00:00:00Z'}),
  integrationWriteFn:async(_rows,results)=>{saved=results;return {件数:3,集計:{OK:Object.keys(results).length}};},modelsWriteFn:async(_rows,results)=>{modelSaved=results;return [];}});
 assert.equal((await request(h,'/api/外部連携書込','POST')).status,401);
 assert.equal((await request(h,'/api/外部連携書込','POST',auth)).status,409);
 assert.equal((await request(h,'/api/キーテスト/discord','POST',auth)).status,200);
 assert.equal((await request(h,'/api/外部連携書込','POST',auth,{'content-length':'2'})).status,400);
 assert.equal((await request(h,'/api/モデル書込','POST',auth)).status,409,'外部連携の結果だけではモデル情報を書き込まない');
 const written=await request(h,'/api/外部連携書込','POST',auth);assert.equal(written.status,200);assert.deepEqual(Object.keys(saved),['discord']);assert.match(JSON.parse(written.body).保存先,/integration_info\.json$/);
 assert.equal((await request(h,'/api/キーテスト/openai','POST',auth)).status,200);assert.equal((await request(h,'/api/モデル書込','POST',auth)).status,200);assert.deepEqual(Object.keys(modelSaved),['openai']);
 assert.equal((await request(h,'/api/キー設定','GET',auth)).status,200);assert.equal((await request(h,'/api/外部連携書込','POST',auth)).status,409,'設定の読み直しで結果を破棄');
});
test('integration report keeps registered rows, untested reasons and no secrets or extra fields',async()=>{
 const {integrationReport,INTEGRATION_IDS}=await import('../モデル情報/integration_info.mjs');
 assert.deepEqual(INTEGRATION_IDS,['huggingface_read','huggingface_write','discord','slack']);
 const report=integrationReport([{id:'huggingface_read',名前:'Hugging Face 読取',キー名:'huggingface_key_read',設定済み:true},{id:'huggingface_write',名前:'Hugging Face 書込',設定済み:false,理由:'キーが未設定です。'},{id:'discord',名前:'Discord Bot',設定済み:true}],
  {huggingface_read:{状態:'OK',説明:'認証できました',確認日時:'2026-10-17T00:00:00Z',secret:'hidden'},discord:{状態:'NG',説明:'失敗',確認日時:'bad'}},new Date('2026-10-17T01:00:00Z'));
 assert.equal(report.件数,4);assert.deepEqual(report.集計,{OK:1,NG:1,未実施:2});assert.equal(report.保存日時,'2026-10-17T01:00:00.000Z');
 assert.deepEqual(report.項目.map(item=>[item.id,item.状態,item.確認日時]),[['huggingface_read','OK','2026-10-17T00:00:00Z'],['huggingface_write','未実施',null],['discord','NG',null],['slack','未実施',null]]);
 assert.equal(report.項目[1].説明,'キーが未設定です。');assert.ok(!JSON.stringify(report).includes('hidden'));
});
test('server connection/header bounds, no listener started',()=>{
 const server=createServer({token:'test-key',entries:[]});assert.equal(server.maxConnections,16);assert.equal(server.headersTimeout,10000);assert.equal(server.requestTimeout,10000);assert.equal(server.maxRequestsPerSocket,20);server.close();
});
test('strict args and Codespaces/base-path URLs',()=>{
 assert.deepEqual(parseArgs(['--browser','--no-open','--port','8097','--base-path','/proxy/8097']),{port:8097,prefix:'/proxy/8097/',noOpen:true,browser:true,help:false});
 for(const args of [['--port','-1'],['--port','65536'],['--command','whoami'],['--base-path','//evil/']]) assert.throws(()=>parseArgs(args));
 assert.equal(basePath('/proxy/8097'),'/proxy/8097/');assert.throws(()=>basePath('/a/../'));
 assert.equal(publicUrl(8097,'/',{CODESPACES:'true',CODESPACE_NAME:'safe-name',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'}),'https://safe-name-8097.app.github.dev/');
 assert.equal(publicUrl(8097,'/',{CODESPACES:'true',CODESPACE_NAME:'bad/name',GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:'app.github.dev'}),'http://127.0.0.1:8097/');
});
test('key status and individual tests require auth and fixed no-body POST contract',async()=>{
 let reads=0,tests=0;const h=createHandler({token:'test-key',keyStatusFn:async()=>{reads++;return {項目:[]};},keyTestFn:async id=>{tests++;return {id,状態:'OK',モデル:[]};}});
 for(const route of ['/api/キー設定','/api/キーテスト/openai'])assert.equal((await request(h,route,'POST')).status,401);
 assert.equal((await request(h,'/api/キー設定','GET',auth)).status,200);assert.equal(reads,1);assert.equal(tests,0);
 assert.equal((await request(h,'/api/キーテスト/openai','GET',auth)).status,404);
 assert.equal((await request(h,'/api/キーテスト/arbitrary','POST',auth)).status,404);
 assert.equal((await request(h,'/api/キーテスト/openai?url=https://evil.test','POST',auth)).status,400);
 for(const headers of [{'content-length':'3'},{'transfer-encoding':'chunked'}])assert.equal((await request(h,'/api/キーテスト/openai','POST',auth,headers)).status,400);
 assert.equal(tests,0);assert.equal((await request(h,'/api/キーテスト/openai','POST',auth)).status,200);assert.equal(tests,1);
});
test('key test concurrency is bounded and installation action never runs key tests',async()=>{
 let release,tests=0;const h=createHandler({token:'test-key',scanFn:async()=>[],keyStatusFn:async()=>({項目:[]}),keyTestFn:async()=>{tests++;return new Promise(resolve=>{release=resolve;});}});
 assert.equal((await request(h,'/api/診断','POST',auth)).status,200);assert.equal(tests,0);
 await request(h,'/api/キー設定','GET',auth);
 const first=request(h,'/api/キーテスト/openai','POST',auth);assert.equal((await request(h,'/api/キーテスト/openai','POST',auth)).status,409);
 release({状態:'OK',モデル:[]});assert.equal((await first).status,200);assert.equal(tests,1);
});
test('public status/retry authenticated, bounded and separate from individual test results',async()=>{
 let refreshes=0;const publicCache={snapshot:()=>({状態:'取得済',件数:1,世代:2}),input:()=>({公開モデル:{example:{model_id:'example'}},公開状態:'取得済'}),refresh:async()=>{refreshes++;return {状態:'取得済'};}};
 const calls=[];const h=createHandler({token:'test-key',publicCache,keyStatusFn:async()=>({項目:[{id:'openrt_chat',設定済み:true}]}),keyTestFn:async(id,options)=>{calls.push({id,options});return {id,状態:'OK',モデル:[]};}});
 assert.equal((await request(h,'/api/公開モデル','GET')).status,401);assert.equal((await request(h,'/api/公開モデル/再取得','POST')).status,401);
 assert.equal(JSON.parse((await request(h,'/api/キー設定','GET',auth)).body).公開モデル.状態,'取得済');assert.equal(refreshes,0);
 assert.equal((await request(h,'/api/キーテスト/openai','POST',auth)).status,200);assert.equal(calls[0].options.publicCache.公開状態,'取得済');assert.equal(refreshes,0);
 assert.equal((await request(h,'/api/公開モデル/再取得','POST',auth,{'content-length':'5'})).status,400);
 assert.equal((await request(h,'/api/公開モデル/再取得?url=bad','POST',auth)).status,400);
 assert.equal((await request(h,'/api/公開モデル/再取得','POST',auth)).status,200);assert.equal(refreshes,1);
});
test('write saves only the server-side results of a completed check, never request data',async()=>{
 const entries=[{id:'node'},{id:'ffmpeg'}];let writes=[],fail=false,release;
 const h=createHandler({token:'test-key',entries,scanFn:async list=>list.map(e=>({id:e.id,状態:'OK'})),installWriteFn:async(list,results,started,finished)=>{if(fail)throw Error('disk');await new Promise(r=>{release=r;});writes.push({list,results,started,finished});return {件数:results.length,集計:{OK:results.length}};}});
 assert.equal((await request(h,'/api/書込','POST')).status,401);
 assert.equal((await request(h,'/api/書込','POST',auth)).status,409);
 assert.equal((await request(h,'/api/書込','POST',auth,{'content-length':'9'})).status,400);
 assert.equal((await request(h,'/api/診断','POST',auth)).status,200);
 const pending=request(h,'/api/書込','POST',auth);
 assert.equal((await request(h,'/api/書込','POST',auth)).status,409);
 assert.equal((await request(h,'/api/診断','POST',auth)).status,409);
 release();const saved=await pending;assert.equal(saved.status,200);
 assert.deepEqual(JSON.parse(saved.body),{保存先:'_AIDIY/aidiy_diag/install_info.json',件数:2,集計:{OK:2}});
 assert.equal(writes.length,1);assert.deepEqual(writes[0].results.map(r=>r.id),['node','ffmpeg']);assert.ok(writes[0].started<=writes[0].finished);
 fail=true;const failed=await request(h,'/api/書込','POST',auth);assert.equal(failed.status,500);assert.ok(!failed.body.toString().includes('disk'));
});


test('screen uses latest installation result to skip Ollama and replaces prior acquired models',async()=>{
 const {testKey,runModels}=await import('../モデル情報/key_status.mjs');
 let state='未検出',calls=0,saved;
 const h=createHandler({token:'test-key',entries:[{id:'ollama'}],scanFn:async()=>[{id:'ollama',状態:state}],keyStatusFn:async()=>({項目:[{id:'ollama'}]}),modelsWriteFn:async(_providers,results)=>{saved=results.ollama;return [];},keyTestFn:(id,options)=>testKey(id,{...options,run:(action,id,options)=>runModels(action,id,{...options,reader:async()=> '{}',fetch:async provider=>{assert.equal(provider,'ollama-local');calls++;return {models:[{name:'fixture:latest'}]};}})})});
 const run=async()=>JSON.parse((await request(h,'/api/キーテスト/ollama','POST',auth)).body);
 assert.equal((await run()).状態,'OK');assert.equal(calls,1); // No installation result is not missing.
 await request(h,'/api/診断','POST',auth);
 const skipped=await run();assert.equal(skipped.状態,'未実施');assert.equal(skipped.スキップ,true);assert.equal(calls,1);
 assert.equal((await request(h,'/api/モデル書込','POST',auth)).status,200);assert.deepEqual(saved.モデル,[]);assert.equal(saved.状態,'未実施');
 state='OK';await request(h,'/api/診断','POST',auth);
 assert.equal((await run()).状態,'OK');assert.equal(calls,2);
});

test('片方の設定再読込は他方の書込対象を保持し、対象側の古い認証結果だけ破棄する',async()=>{
 const saved=[];
 const h=createHandler({token:'test-key',keyStatusFn:async()=>({項目:[{id:'openai'},{id:'discord'}]}),keyTestFn:async id=>({id,状態:'OK'}),modelsWriteFn:async(_rows,results)=>{saved.push(Object.keys(results));return [];},integrationWriteFn:async(_rows,results)=>{saved.push(Object.keys(results));return {件数:1};}});
 for(const route of ['api/キー設定/モデル一覧','api/キー設定/外部連携'])assert.equal((await request(h,'/'+route)).status,401);
 await request(h,'/api/キーテスト/openai','POST',auth);await request(h,'/api/キーテスト/discord','POST',auth);
 await request(h,'/api/キー設定/外部連携','GET',auth);
 assert.equal((await request(h,'/api/モデル書込','POST',auth)).status,200);assert.equal((await request(h,'/api/外部連携書込','POST',auth)).status,409);
 await request(h,'/api/キーテスト/discord','POST',auth);await request(h,'/api/キー設定/モデル一覧','GET',auth);
 assert.equal((await request(h,'/api/モデル書込','POST',auth)).status,409);assert.equal((await request(h,'/api/外部連携書込','POST',auth)).status,200);
 assert.deepEqual(saved,[['openai'],['discord']]);assert.equal((await request(h,'/api/キー設定/未知','GET',auth)).status,404);
});
