// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
const test=require('node:test'),assert=require('node:assert/strict');
const {dependency,render,source}=require('./ui-components.cjs');
const {Tools状態を作成:create}=dependency('components/Tools/Tools状態.mjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const baseline=()=>({tools:[{id:'aidiy_chrome_devtools',label:'Chrome',enabled:true,available:true,status:'利用可能',defaultsKey:null},{id:'aidiy_text_to_speech',label:'Speech',enabled:true,available:true,status:'利用可能',defaultsKey:'text_to_speech'},{id:'aidiy_windows',label:'Windows',enabled:false,available:false,status:'サービス外',defaultsKey:null}],defaults:{text_to_speech:{auto_provider:'edge',auto_voice:'female'}},schema:{text_to_speech:{auto_provider:['edge','openai'],auto_voice:['female','male']}}});
function setup(options={}){let data=baseline();const calls=[];const api=async(path,method,signal,format,body)=>{calls.push({path,method,signal,format,body:clone(body)});if(options.api)return options.api(path,method,signal,format,body);if(path==='api/AI設定/ログイン')return{status:'OK',data:{access_token:'test-token'}};if(body.data.enabled)for(const row of data.tools)if(Object.hasOwn(body.data.enabled,row.id))row.enabled=body.data.enabled[row.id];if(body.data.defaults)data.defaults={...data.defaults,...clone(body.data.defaults)};return{status:'OK',data:{...clone(data),saved:body.data.write===true}};};return{state:create({api,...options}),calls};}
const login=state=>state.ログイン('user','secret');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};

test('Tools一括: 順次実行・条件固定・失敗後継続・対象外・二重押し防止',async()=>{
 const pending=deferred(),order=[];
 const {state}=setup({代表テスト:{
  aidiy_chrome_devtools:{label:'Chrome',defaults:{headless:false},run:async({input})=>{order.push(['chrome',clone(input)]);await pending.promise;throw Error('fixture failure');}},
  aidiy_text_to_speech:{label:'説明',defaults:{sample:'before'},run:async({input})=>{order.push(['speech',clone(input)]);return {status:'OK',message:'説明応答'};}},
  aidiy_windows:{label:'実行不可',run:()=>assert.fail('OFFは呼ばない')},
 }});
 assert.equal(await state.一括テスト(),false);await login(state);
 const task=state.一括テスト();assert.equal(state.処理中.value,'test-all');assert.equal(order.length,1);
 assert.equal(await state.一括テスト(),false);assert.equal(await state.テスト('aidiy_text_to_speech'),false);
 state.テスト条件.value.aidiy_text_to_speech={sample:'after'};
 pending.resolve();assert.equal(await task,true);
 assert.deepEqual(order,[['chrome',{headless:false}],['speech',{sample:'before'}]]);
 assert.equal(state.結果.value.aidiy_chrome_devtools.status,'ERR');assert.equal(state.結果.value.aidiy_windows.status,'対象外');
 assert.match(state.通知.value,/成功 1件、失敗 1件、対象外 1件/);state.終了();
});

for(const action of ['テスト中止','ログアウト','切断','終了'])test(`Tools一括: ${action}で残りを実行せず遅い応答を破棄`,async()=>{
 const pending=deferred();let next=0,signal;
 const {state}=setup({代表テスト:{
  aidiy_chrome_devtools:{label:'起動',run:args=>{signal=args.signal;return pending.promise;}},
  aidiy_text_to_speech:{label:'次',run:()=>{next++;return {status:'OK',message:'次'};}},
 }});
 await login(state);const task=state.一括テスト();state[action]();assert.equal(signal.aborted,true);
 pending.resolve({status:'OK',message:'遅い成功'});assert.equal(await task,false);assert.equal(next,0);
 if(action==='テスト中止'){assert.equal(state.結果.value.aidiy_chrome_devtools.status,'中止');assert.equal(state.結果.value.aidiy_text_to_speech.status,'中止');}
 else assert.equal(Object.keys(state.結果.value).length,0);
 state.終了();
});

test('Tools一括: 認証期限切れで次項目を呼ばずログインへ戻す',async()=>{
 let calls=0;const {Tools代表テスト}=dependency('components/Tools/Tools代表テスト.mjs');
 const {state}=setup({代表テスト:Tools代表テスト,api:async path=>{
  if(path.endsWith('ログイン'))return {status:'OK',data:{access_token:'fixture'}};
  if(path.endsWith('representative')){calls++;return {authExpired:true};}
  return {status:'OK',data:baseline()};
 }});
 await login(state);assert.equal(await state.一括テスト(),false);assert.equal(calls,1);assert.equal(state.認証済み.value,false);assert.match(state.通知.value,/有効期限/);state.終了();
});
test('Tools: 未認証では一覧・保存・test APIを呼ばず、ログイン後だけ読取、tokenはメモリ',async()=>{const{state,calls}=setup();assert.equal(await state.再読込(),false);assert.equal(await state.有効保存(),false);assert.equal(calls.length,0);assert.equal(await login(state),true);assert.equal(calls[0].path,'api/AI設定/ログイン');assert.equal(calls[1].path,'api/Tools/enabled');assert.deepEqual(calls[1].body,{token:'test-token',data:{}});assert.equal(state.項目.value.length,3);assert.doesNotMatch(source('components/Tools/Tools状態.mjs'),/localStorage|sessionStorage/);state.終了();});
test('Tools: OFFは登録を残しruntime適用、保存操作だけwrite:true、再読込は書込しない',async()=>{const{state,calls}=setup();await login(state);await state.切替('aidiy_chrome_devtools');assert.equal(state.項目.value.length,3);assert.equal(state.項目.value[0].enabled,false);assert.deepEqual(calls.at(-1).body.data,{enabled:{aidiy_chrome_devtools:false},write:false});await state.再読込();assert.deepEqual(calls.at(-1).body.data,{});assert.equal(Object.keys(state.有効変更.value).length,1,'読取では未保存の適用を忘れない');await state.有効保存();assert.equal(calls.at(-1).body.data.write,true);assert.equal(Object.keys(state.有効変更.value).length,0);assert.match(state.通知.value,/保存しました/);state.終了();});
test('Tools: available=falseは切替・test無効、OFFはtest無効',async()=>{let runs=0;const{state,calls}=setup({代表テスト:{aidiy_windows:{run:()=>runs++},aidiy_chrome_devtools:{run:()=>runs++}}});await login(state);const before=calls.length;assert.equal(await state.切替('aidiy_windows'),false);assert.equal(await state.テスト('aidiy_windows'),false);assert.equal(calls.length,before);await state.切替('aidiy_chrome_devtools');assert.equal(await state.テスト('aidiy_chrome_devtools'),false);assert.equal(runs,0);state.終了();});
test('Tools: 既定値の編集だけでは通信せず、適用falseと保存trueを区別',async()=>{const{state,calls}=setup();await login(state);state.選択ID.value='aidiy_text_to_speech';const before=calls.length;state.編集値.value.text_to_speech.auto_voice='male';assert.equal(calls.length,before);await state.規定値設定(false);assert.deepEqual(calls.at(-1).body.data,{defaults:{text_to_speech:{auto_provider:'edge',auto_voice:'male'}},write:false});assert.equal(state.未保存規定値.value.text_to_speech,true);await state.規定値設定(true);assert.equal(calls.at(-1).body.data.write,true);assert.equal(state.未保存規定値.value.text_to_speech,false);state.終了();});
test('Tools: 保存失敗は成功にせず未保存状態を維持',async()=>{let fail=false;const{state}=setup({api:async(path,_m,_s,_f,body)=>path.endsWith('ログイン')?{status:'OK',data:{access_token:'token'}}:fail?{status:'NG',message:'保存できません'}:{status:'OK',data:{...baseline(),saved:false}}});await login(state);await state.切替('aidiy_chrome_devtools');fail=true;assert.equal(await state.有効保存(),false);assert.match(state.通知.value,/保存できません/);assert.equal(Object.keys(state.有効変更.value).length,1);state.終了();});
test('Tools: 保存応答saved=trueがなければ保存完了と表示しない',async()=>{const{state}=setup({api:async path=>path.endsWith('ログイン')?{status:'OK',data:{access_token:'token'}}:{status:'OK',data:{...baseline(),saved:false}}});await login(state);await state.切替('aidiy_chrome_devtools');assert.equal(await state.有効保存(),false);assert.match(state.通知.value,/保存を確認できません/);state.終了();});
test('Tools: 認証期限切れで一覧・編集値・tokenを破棄し再ログインを要求',async()=>{let expired=false;const{state,calls}=setup({api:async path=>path.endsWith('ログイン')?{status:'OK',data:{access_token:'token'}}:expired?{authExpired:true}:{status:'OK',data:baseline()}});await login(state);expired=true;await state.再読込();assert.equal(state.認証済み.value,false);assert.equal(state.項目.value.length,0);assert.match(state.通知.value,/再ログイン/);const before=calls.length;await state.再読込();assert.equal(calls.length,before);state.終了();});
test('Tools: 遅いloginの応答はlogout後の画面を復活させない',async()=>{const d=deferred();const{state}=setup({api:()=>d.promise});const task=login(state);state.ログアウト();d.resolve({status:'OK',data:{access_token:'old-token'}});assert.equal(await task,false);assert.equal(state.認証済み.value,false);assert.equal(state.項目.value.length,0);state.終了();});
test('Tools: 処理中の二重押しと別保存を抑止、logoutで遅い結果を破棄',async()=>{const d=deferred();let runs=0;const{state}=setup({代表テスト:{aidiy_chrome_devtools:{label:'ブラウザ起動',run:async()=>{runs++;return d.promise;}}}});await login(state);const p=state.テスト('aidiy_chrome_devtools');assert.equal(state.処理中.value,'test');assert.equal(await state.テスト('aidiy_chrome_devtools'),false);assert.equal(await state.切替('aidiy_chrome_devtools'),false);state.ログアウト();d.resolve({status:'OK',message:'起動済み'});await p;assert.equal(runs,1);assert.equal(Object.keys(state.結果.value).length,0);state.終了();});
test('Tools: 代表testの待機中止で古い応答は結果を上書きしない',async()=>{const d=deferred();let signal;const{state}=setup({代表テスト:{aidiy_chrome_devtools:{label:'起動',run:args=>{signal=args.signal;return d.promise;}}}});await login(state);const p=state.テスト('aidiy_chrome_devtools');state.テスト中止();assert.equal(signal.aborted,true);assert.equal(state.認証済み.value,true);d.resolve({status:'OK',message:'遅い成功'});await p;assert.equal(state.結果.value.aidiy_chrome_devtools.status,'中止');state.終了();});
test('Tools: 初期DOMはloginだけ、Core/Tools停止中は操作画面を出さない',async()=>{const html=await render('components/Tools/Toolsパネル.vue',{connected:true,coreOnline:true,toolsOnline:true,visible:true,api:async()=>{throw Error('初期表示からAPIを呼ばない');}});assert.match(html,/Coreへログイン/);assert.doesNotMatch(html,/class="tools-columns"/);assert.doesNotMatch(html,/class="tools-detail"/);const offline=await render('components/Tools/Toolsパネル.vue',{connected:true,coreOnline:false,toolsOnline:false});assert.match(offline,/Core と Tools を起動/);assert.doesNotMatch(offline,/<form/);});
test('Tools: システム起動の直前へ追加し、全テスト対象には混ぜない',()=>{const app=source('App.vue');assert.match(app,/class="tab-tools"[\s\S]*?>Tools<\/button><button class="tab-launch"/);assert.match(app,/tab!=='apps'&&tab!=='settings'&&tab!=='tools'/);assert.match(app,/:core-online="起動.Core利用可能.value" :tools-online="toolsOnline"/);assert.doesNotMatch(app.match(/async function 全診断\(\)[\s\S]*?async function changeTab/)[0],/Tools|tools/);});
test('Tools: Chrome代表は固定ブラウザ起動/終了だけ、URL・コマンド・有料APIを渡さない',async()=>{const{Tools代表テスト}=dependency('components/Tools/Tools代表テスト.mjs');const calls=[];const call=async(...args)=>calls.push(clone(args));const def=Tools代表テスト.aidiy_chrome_devtools;assert.match(def.description,/headless条件.*終了.*再テスト/);assert.equal(Object.keys(Tools代表テスト).length,20);assert.equal((await def.run({call,input:{headless:true,url:'https://ignored.invalid',command:'ignored'}})).status,'OK');await def.close({call});assert.deepEqual(calls,[['Tools/representative',{operation:'open',headless:true}],['Tools/representative',{operation:'close',headless:false}]]);});
test('Tools: 代表testの認証期限切れも一覧と実行結果を消して再ログインへ戻す',async()=>{const{Tools代表テスト}=dependency('components/Tools/Tools代表テスト.mjs');const{state}=setup({代表テスト:Tools代表テスト,api:async path=>path.endsWith('ログイン')?{status:'OK',data:{access_token:'token'}}:path.endsWith('representative')?{authExpired:true}:{status:'OK',data:baseline()}});await login(state);assert.equal(await state.テスト('aidiy_chrome_devtools'),false);assert.equal(state.認証済み.value,false);assert.equal(Object.keys(state.結果.value).length,0);assert.match(state.通知.value,/有効期限/);state.終了();});

test('Backup: 初期true・選択したfalseの再利用・中止後の古い応答破棄を維持',async()=>{
 const {Tools代表テスト}=dependency('components/Tools/Tools代表テスト.mjs');const sent=[];let delayed=null;
 const {state}=setup({代表テスト:Tools代表テスト,api:async(path,method,signal,format,body)=>{
  if(path.endsWith('ログイン'))return{status:'OK',data:{access_token:'fixture-token'}};
  if(path.endsWith('representative')){sent.push(body.data.batch);if(delayed)return delayed.promise;return{status:'OK',data:{summary:body.data.batch?'受付（完了未確認）':'完了'}};}
  return{status:'OK',data:{tools:[{id:'aidiy_backup',enabled:true,available:true}],defaults:{},schema:{}}};
 }});
 await login(state);assert.equal(await state.テスト('aidiy_backup'),true);assert.equal(sent[0],true);
 state.テスト条件.value.aidiy_backup={batch:false};state.選択ID.value='other';state.選択ID.value='aidiy_backup';await state.テスト('aidiy_backup');await state.一括テスト();assert.deepEqual(sent,[true,false,false]);
 delayed=deferred();const run=state.テスト('aidiy_backup');await new Promise(r=>setImmediate(r));state.テスト中止();assert.equal(state.結果.value.aidiy_backup.status,'中止');assert.match(state.結果.value.aidiy_backup.message,/待機を中止/);delayed.resolve({status:'OK',data:{summary:'late'}});assert.equal(await run,false);assert.notEqual(state.結果.value.aidiy_backup.message,'late');
 delayed=null;assert.equal(await state.テスト('aidiy_backup'),true);assert.equal(sent.at(-1),false);state.終了();
});
