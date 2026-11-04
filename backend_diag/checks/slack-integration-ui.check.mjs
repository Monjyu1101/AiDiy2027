// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{render,component,dependency}=require('./ui-components.cjs');
const vue=createRequire(new URL('../ui/package.json',import.meta.url))('vue');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await vue.nextTick();};
const ids=['huggingface_read','huggingface_write','discord','slack'];
const rows=()=>ids.map(id=>({id,名前:id==='slack'?'Slack Bot':id,キー名:id==='slack'?'slack_bot_token':id,設定済み:true,テスト可能:true,説明:id==='slack'?'Bot トークンの認証を auth.test で確認します。':'認証確認'}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const fixture=()=>{
 const requests=[],connected=vue.ref(true),message=vue.ref('');
 const {キー設定状態を作成}=dependency('components/キー設定共通/キー設定状態.mjs');
 const state=キー設定状態を作成({connected,message,setTimer:()=>1,clearTimer(){},api:(url,method,signal)=>{const d=deferred();requests.push({url,method,signal,...d});return d.promise;}});
 return {requests,connected,message,state};
};

test('Slack は Discord の次の外部連携行で、モデル一覧へ混ざらない',async()=>{
 const {外部連携ID,外部連携か}=dependency('components/キー設定共通/キー設定表示.mjs');assert.deepEqual(Array.from(外部連携ID),ids);assert.equal(外部連携か({id:'slack'}),true);
 const data={設定状態:'読込済み',項目:[{id:'openai',名前:'OpenAI',設定済み:true,テスト可能:true},...rows()]};
 const html=await render('components/外部連携/外部連携パネル.vue',{data,connected:true,results:{}});
 assert.equal((html.match(/class="integration-row"/g)||[]).length,4);assert.ok(html.indexOf('>Discord<')>=0 && html.indexOf('>Discord<')<html.indexOf('>Slack<'));
 assert.equal((html.match(/data-state="未実施"/g)||[]).length,4);assert.doesNotMatch(html,/準備中|接続済み|data-state="OK"|>OpenAI</);
 const models=await render('components/モデル一覧/モデル一覧パネル.vue',{data,connected:true,results:{}});assert.doesNotMatch(models,/Slack Bot/);
 assert.match(html,/auth\.test/);assert.match(html,/App トークン/);assert.match(html,/Socket Mode/);
});

test('Slack 行は未設定・設定確認不可・未認証・実行中を区別して無効化する',async()=>{
 for(const [configured,possible,connected,testing] of [[false,false,true,false],[null,false,true,false],[true,true,false,false],[true,true,true,true],[true,true,true,false]]){
  const row={...rows().at(-1),設定済み:configured,テスト可能:possible,理由:possible?'':'Bot トークンを設定してください。',token:'must-not-render-secret'};
  const html=await render('components/外部連携/外部連携パネル.vue',{connected,data:{設定状態:'読込済み',項目:[row]},results:testing?{slack:{状態:'待機中'}}:{},testing:testing?'slack':'',testingIds:new Set(testing?['slack']:[])});
  const button=html.match(/<button[^>]*class="single-test-button"[^>]*>.*?<\/button>/)[0];
  assert.equal(/disabled/.test(button),!possible||!connected||testing);assert.doesNotMatch(html,/must-not-render-secret/);
  if(testing)assert.match(button,/待機中…/);else assert.match(html,/data-state="未実施"/);
  assert.match(html,new RegExp(configured===null?'確認不可':configured?'設定済':'未設定'));
 }
});

function mount(props){
 const make=(tag,text='')=>({tag,text,children:[],props:{},parent:null,querySelector(){return null;},querySelectorAll(){return [];}});
 const remove=node=>{if(node.parent){const list=node.parent.children,index=list.indexOf(node);if(index>=0)list.splice(index,1);node.parent=null;}};
 const renderer=vue.createRenderer({createElement:tag=>make(tag),createText:text=>make('#text',text),createComment:()=>make('#comment'),setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[];},patchProp:(n,k,_p,v)=>n.props[k]=v,insert:(n,p,a)=>{remove(n);n.parent=p;const i=a?p.children.indexOf(a):-1;p.children.splice(i<0?p.children.length:i,0,n);},remove,parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null});
 const root=make('root'),app=renderer.createApp({render:()=>vue.h(component('components/外部連携/外部連携パネル.vue').default,props)});app.mount(root);
 const all=node=>[node,...node.children.flatMap(all)],text=node=>node.text+node.children.map(text).join('');
 return {app,root,all:()=>all(root),text,click:node=>{assert.notEqual(node.props.disabled,true);node.props.onClick();}};
}
test('Slack 選択で右詳細を表示し、テストはSlack IDだけ送信・設定更新後も選択維持',async()=>{
 const emitted=[],props=vue.reactive({connected:true,data:{設定状態:'読込済み',項目:rows()},results:{},onTest:id=>emitted.push(id)}),ui=mount(props);
 try{
  const select=ui.all().find(n=>n.tag==='button'&&ui.text(n)==='Slack設定済');ui.click(select);await flush();
  const article=ui.all().find(n=>n.tag==='article');assert.match(ui.text(article),/Slack Bot/);assert.match(ui.text(article),/slack_bot_token/);assert.match(ui.text(article),/auth\.test/);
  const row=ui.all().find(n=>n.props.class==='integration-row selected');ui.click(row.children.flatMap(n=>[n,...n.children]).find(n=>n.tag==='button'&&n.props.class==='single-test-button'));assert.deepEqual(emitted,['slack']);
  props.data={設定状態:'読込済み',項目:rows()};props.results={slack:{状態:'NG',説明:'Bot認証を確認できません。'}};await flush();assert.match(ui.text(article),/Bot認証を確認できません/);
  props.connected=false;await flush();assert.equal(ui.all().find(n=>n.props.class==='integration-row selected').children.flatMap(n=>[n,...n.children]).find(n=>n.props.class==='single-test-button').props.disabled,true);
 }finally{ui.app.unmount();}
});

test('Slack は明示操作のみ・二重押し防止・認証破棄で遅い応答を無視し再試験できる',async()=>{
 const f=fixture(),s=f.state;assert.equal(f.requests.length,0);
 const loading=s.loadKeys();assert.equal(f.requests[0].url,'api/キー設定');f.requests[0].resolve({設定状態:'読込済み',項目:rows()});await loading;assert.equal(f.requests.length,1,'設定読込だけでは認証APIを実行しない');
 const one=s.testKey('slack');await s.testKey('slack');assert.equal(f.requests.length,2);assert.equal(f.requests[1].url,'api/キーテスト/slack');assert.equal(s.keyResults.value.slack.状態,'待機中');
 s.設定を破棄();assert.equal(f.requests[1].signal.aborted,true);f.requests[1].resolve({id:'slack',状態:'OK'});await one;assert.equal(s.keyResults.value.slack,undefined);
 f.connected.value=false;await s.testKey('slack');assert.equal(f.requests.length,2);f.connected.value=true;
 const retry=s.testKey('slack');f.requests[2].reject(Error('fixture auth expired'));await retry;assert.equal(s.keyTestingIds.value.size,0);assert.equal(s.keyResults.value.slack,undefined);assert.equal(f.message.value,'fixture auth expired');
 const success=s.testKey('slack');f.requests[3].resolve({id:'slack',状態:'OK',確認日時:'2026-10-30T00:00:00Z'});await success;assert.equal(s.integrationLastRun.value,'2026-10-30T00:00:00Z');assert.equal(s.modelLastRun.value,null);s.終了();
});

test('外部連携一括はSlackを4件目としてFIFOへ入れ、保存も外部連携だけを使う',async()=>{
 const f=fixture(),s=f.state;s.keyData.value={項目:rows()};
 const batch=s.外部連携確認({再読込:false});assert.equal(f.requests.length,2);assert.equal(s.keyResults.value.slack.状態,'待機中');
 for(let i=0;i<4;i++){assert.equal(f.requests[i].url,'api/キーテスト/'+ids[i]);f.requests[i].resolve({id:ids[i],状態:'OK'});await flush();}
 await batch;assert.equal(s.integrationBusy.value,false);assert.equal(s.keyResults.value.slack.状態,'OK');
 const write=s.外部連携書込();assert.equal(f.requests[4].url,'api/外部連携書込');f.requests[4].resolve({件数:4});await write;assert.equal(s.integrationWritten.value,true);assert.equal(s.modelWritten.value,false);s.終了();
});

test('未設定Slackは一括確認から除外され、モデル一覧の一括でも実行しない',async()=>{
 const f=fixture(),s=f.state;s.keyData.value={項目:[{...rows().at(-1),設定済み:false,テスト可能:false}]};await s.外部連携確認({再読込:false});assert.equal(f.requests.length,0);assert.equal(s.keyResults.value.slack,undefined);
 const model=s.一覧再取得();f.requests[0].resolve({項目:[{...rows().at(-1),設定済み:true,テスト可能:true}]});await model;assert.equal(f.requests.length,1);s.終了();
});

test('Slack の認証API境界と外部連携保存は既存契約を使い、モデル結果へ混ざらない',async()=>{
 const {createHandler}=await import('../diag_main.mjs');
 const {integrationReport}=await import('../モデル情報/integration_info.mjs');
 let tests=0,saved;
 const handler=createHandler({token:'fixture',keyStatusFn:async()=>({項目:rows()}),keyTestFn:async id=>{tests++;return {id,状態:'OK',説明:'Slack Bot トークンで認証できました。',確認日時:'2026-10-30T00:00:00Z',secret:'must-not-save',slack_app_token:'must-not-save-app'};},integrationWriteFn:async(items,results)=>{saved=integrationReport(items,results);return saved;}});
 const request=async(path,method='POST',headers={authorization:'Bearer fixture'})=>{
  const res={status:0,body:null,writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
  await handler({url:'/api/'+path,method,headers},res);return res;
 };
 try{
  assert.equal((await request('キーテスト/slack','POST',{})).status,401);
  assert.equal((await request('キーテスト/slack','GET')).status,404);
  assert.equal((await request('キーテスト/slack?url=https://example.invalid')).status,400);
  assert.equal((await request('キーテスト/slack','POST',{authorization:'Bearer fixture','content-length':'2'})).status,400);assert.equal(tests,0);
  assert.equal((await request('外部連携書込')).status,409);
  assert.equal((await request('キーテスト/slack')).status,200);assert.equal(tests,1);
  assert.equal((await request('モデル書込')).status,409);
  assert.equal((await request('外部連携書込')).status,200);assert.deepEqual(saved.項目.map(x=>x.id),ids);
  assert.equal(saved.項目.at(-1).状態,'OK');assert.equal(saved.項目.at(-1).確認日時,'2026-10-30T00:00:00Z');assert.equal(saved.件数,4);
  assert.doesNotMatch(JSON.stringify(saved),/must-not-save|slack_app_token|接続済み/);
  await request('キー設定','GET');assert.equal((await request('外部連携書込')).status,409,'設定再読込で保存可否を破棄する');
 }finally{await handler.close();}
});
