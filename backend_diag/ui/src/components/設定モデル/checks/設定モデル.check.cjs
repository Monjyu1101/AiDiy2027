// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');
const assert=require('node:assert/strict');
const {render,source,component}=require('../../../../../checks/ui-components.cjs');
const ids=['CHAT','LIVE','DECISION',...Array.from({length:6},(_,i)=>`CODE${i+1}`),'TASK_plan','TASK_do','TASK_check','TEAM_plan','TEAM_do','TEAM_check'];
const snapshot={版:'v1',項目:ids.map(id=>({id,区分:id.replace(/\d+$|_.*$/,''),役割:'',プロバイダ:'synthetic',モデル:'model-a',状態:'未実行'}))};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
async function setup(api){const {設定モデル状態を作成}=await import('../設定モデル状態.mjs');let online=true;return {state:設定モデル状態を作成({api,接続可能:()=>online}),offline:()=>{online=false;}};}

test('15行と共有元・経路・応答を描画し、未設定は成功にしない',async()=>{
 const data=structuredClone(snapshot);data.項目[0].状態='未設定';
 const html=await render('components/設定モデル/設定モデルパネル.vue',{data,results:{LIVE:{状態:'OK',共有元:'CHAT',応答:'<script>bad</script>'}},selected:'LIVE',online:true});
 assert.equal((html.match(/class="trial-row(?: selected)?"/g)||[]).length,15);
 for(const id of ids)assert.ok(html.includes(id));
 assert.match(html,/未設定/);assert.match(html,/共有元/);assert.match(html,/Tools 内部 HTTP/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>bad/);
 const empty=await render('components/設定モデル/設定モデルパネル.vue',{data:{項目:[]},online:false});
 assert.match(empty,/設定項目がありません/);assert.match(empty,/id="model-trial-start"[^>]* disabled/);assert.match(empty,/Tools 接続時/);
});

test('読込はGETのみ・手動開始後は厳密な順番で15行、共有はサーバー結果だけを使用',async()=>{
 const calls=[];let active=0;
 const {state}=await setup(async(path,method)=>{calls.push([path,method]);if(method==='GET')return snapshot;if(path.endsWith('/開始'))return {...snapshot,実行ID:'r1'};if(method==='DELETE')return {};assert.equal(++active,1);await tick();active--;const id=path.split('/').pop();return {id,状態:id==='CHAT'?'NG':'OK',共有元:id==='CODE2'?'CODE1':''};});
 assert.deepEqual(calls,[]);await state.読込();assert.deepEqual(calls,[['api/モデル試行','GET']]);
 const first=state.開始();await state.開始();await first;
 assert.deepEqual(calls.filter(x=>x[1]==='POST').map(x=>x[0].split('/').pop()),['開始',...ids]);
 assert.equal(state.結果.value.CHAT.状態,'NG');assert.equal(state.結果.value.CODE2.共有元,'CODE1');assert.equal(state.実行中.value,false);
});

test('中止は実行を止め、遅い応答を捨てて再開始を汚染しない',async()=>{
 const pending=deferred(),calls=[];let count=0;
 const {state}=await setup(async(path,method)=>{calls.push([path,method]);if(method==='GET')return snapshot;if(path.endsWith('/開始'))return {...snapshot,実行ID:`r${++count}`};if(method==='DELETE')return {};if(path.includes('/r1/'))return pending.promise;return {状態:'OK'};});
 await state.読込();const run=state.開始();await tick();state.中止();assert.equal(state.結果.value.CHAT.状態,'中止');
 await state.開始();pending.resolve({状態:'NG'});await run;
 assert.equal(state.結果.value.CHAT.状態,'OK');assert.ok(calls.some(x=>x[0]==='api/モデル試行/r1'&&x[1]==='DELETE'));assert.equal(calls.filter(x=>x[0].includes('/r1/')).length,1);
});

test('切断中の開始応答と再読込前の古い設定応答を無視する',async()=>{
 const start=deferred(),old=deferred(),calls=[];let reads=0;
 const {state,offline}=await setup(async(path,method)=>{calls.push([path,method]);if(method==='GET')return ++reads===1?snapshot:old.promise;if(path.endsWith('/開始'))return start.promise;return {};});
 await state.読込();const run=state.開始();offline();state.切断();start.resolve({...snapshot,実行ID:'late'});await run;
 assert.equal(state.設定.value,null);assert.deepEqual(state.結果.value,{});assert.ok(calls.some(x=>x[0].endsWith('/late')&&x[1]==='DELETE'));
 await state.開始();assert.equal(calls.filter(x=>x[0].endsWith('/開始')).length,1);
 const second=await setup(()=>old.promise);const read=second.state.読込();second.state.終了();old.resolve(snapshot);await read;assert.equal(second.state.設定.value,null);
});

test('設定変更エラーで残りを送らず、更新で前の結果を破棄する',async()=>{
 const calls=[];const {state}=await setup(async(path,method)=>{calls.push(path);if(method==='GET')return snapshot;if(path.endsWith('/開始'))return {...snapshot,実行ID:'r'};if(method==='DELETE')return {};throw new Error('設定が変更されました。再読込してください。');});
 await state.読込();await state.開始();assert.equal(state.結果.value.CHAT.状態,'ERR');assert.ok(!calls.some(x=>x.endsWith('/LIVE')));assert.match(state.通知.value,/設定が変更/);await state.読込();assert.deepEqual(state.結果.value,{});
});

test('Appは接続でタブを制御し、全診断へ試行を含めない',()=>{
 const app=source('App.vue');assert.match(app,/:disabled="!connected \|\| !toolsOnline"/);assert.match(app,/if\(!value\)\{試行.切断\(\);手動.中止\(\)/);assert.doesNotMatch(app.match(/async function 全診断\(\)[^\r\n]*/)[0],/試行/);
});

test('Tools再確認中は接続を保持し、失敗確定時だけオフライン',async()=>{
 const {Tools接続を作成}=await import('../../ウィンドウ/Tools接続.mjs');const states=[],pending=deferred();let n=0;
 const tools=Tools接続を作成({api:()=>++n===1?Promise.resolve({online:true}):pending.promise,反映:s=>states.push(s),setTimer:()=>0,clearTimer(){}});
 tools.接続(true);await tick();const check=tools.refresh();assert.deepEqual(states.at(-1),{online:true,checking:true});pending.reject(new Error('offline'));await check;assert.deepEqual(states.at(-1),{online:false,checking:false});tools.終了();
});

const group=['CODE1','CODE2','TASK_do','TEAM_check'];
const grouped={...snapshot,項目:snapshot.項目.map(row=>({...row,共有対象:group.includes(row.id)?group:[row.id]}))};
test('個別テストは選択行だけ要求し、サーバー指定の同一設定行を同時更新する',async()=>{
 const pending=deferred(),calls=[];
 const {state}=await setup(async(path,method)=>{calls.push([path,method]);if(method==='GET')return grouped;if(method==='DELETE')return {};if(path.endsWith('/開始/TASK_do'))return {...grouped,実行ID:'single',実行順:['TASK_do']};return pending.promise;});
 await state.読込();state.選択.value='TASK_do';state.結果.value={CHAT:{状態:'OK',応答:'previous'}};
 const run=state.個別開始();await tick();
 for(const id of group)assert.equal(state.結果.value[id].状態,'実行中');
 assert.equal(state.結果.value.CHAT.応答,'previous');assert.equal(state.結果.value.CODE3,undefined);
 const html=await render('components/設定モデル/設定モデルパネル.vue',{data:grouped,results:state.結果.value,selected:'TASK_do',online:true,running:true});
 assert.match(html,/テスト中/);assert.match(html,/>再読込<\/span><\/button>/);assert.equal((html.match(/data-trial-id="[^"]+"[^>]* disabled/g)||[]).length,15);assert.doesNotMatch(html,/model-trial-single/);
 pending.resolve({id:'TASK_do',状態:'OK',応答:'おはよう',所要ms:123});await run;
 for(const id of group){assert.equal(state.結果.value[id].状態,'OK');assert.equal(state.結果.value[id].共有元,id==='TASK_do'?'':'TASK_do');}
 assert.deepEqual(calls.filter(x=>x[1]==='POST').map(x=>x[0]),['api/モデル試行/開始/TASK_do','api/モデル試行/single/TASK_do']);assert.equal(state.実行中.value,false);
});

test('共有行の中止・通信失敗でテスト中を全て解除し、選択変更にも影響されない',async()=>{
 for(const mode of ['cancel','failure']){
  const pending=deferred();const {state}=await setup(async(path,method)=>{if(method==='GET')return grouped;if(method==='DELETE')return {};if(path.includes('/開始/'))return {...grouped,実行ID:'r',実行順:['CODE1']};return pending.promise;});
  await state.読込();state.選択.value='CODE1';const run=state.個別開始();await tick();state.選択.value='LIVE';
  if(mode==='cancel'){state.中止();pending.resolve({状態:'OK'});}else pending.reject(new Error('connection failed'));
  await run;for(const id of group)assert.equal(state.結果.value[id].状態,mode==='cancel'?'中止':'ERR');
  assert.equal(state.実行中.value,false);assert.equal(state.結果.value.LIVE,undefined);
 }
});

test('全件逐次実行は共有結果をテスト中へ戻さず、サーバーのキャッシュ順序を保つ',async()=>{
 const calls=[];let state;
 ({state}=await setup(async(path,method)=>{
  if(method==='GET')return grouped;if(method==='DELETE')return {};if(path.endsWith('/開始'))return {...grouped,実行ID:'all',実行順:ids};
  const id=path.split('/').pop();calls.push(id);
  if(id==='CODE1')for(const shared of group)assert.equal(state.結果.value[shared].状態,'実行中');
  if(group.includes(id)&&id!=='CODE1')for(const shared of group)assert.equal(state.結果.value[shared].状態,'NG');
  return {id,状態:group.includes(id)?'NG':'OK',共有元:group.includes(id)&&id!=='CODE1'?'CODE1':'',所要ms:id==='CODE1'?42:0};
 }));
 await state.読込();await state.開始();assert.deepEqual(calls,ids);assert.equal(state.結果.value.CODE1.所要ms,42);
 for(const id of group)assert.equal(state.結果.value[id].状態,'NG');
});

test('個別テストで設定版が変われば旧結果を破棄し、オフライン中は送信しない',async()=>{
 let posts=0;const {state,offline}=await setup(async(path,method)=>{if(method==='GET')return grouped;if(method==='DELETE')return {};posts++;if(path.includes('/開始/'))return {...grouped,版:'v2',実行ID:'r',実行順:['CHAT']};return {状態:'OK'};});
 await state.読込();state.結果.value={CODE1:{状態:'OK'}};await state.個別開始();assert.equal(state.結果.value.CODE1,undefined);assert.equal(posts,2);
 offline();await state.個別開始();assert.equal(posts,2);
});

test('左の一覧はチャット・ライブ・判断・コード・タスク・チームの見出しで区分ごとに並べる',async()=>{
 const html=await render('components/設定モデル/設定モデルパネル.vue',{data:snapshot,results:{},selected:'CHAT',online:true});
 assert.deepEqual([...html.matchAll(/class="trial-group-title">([^<]+)<span> · (\d+)<\/span>/g)].map(m=>[m[1],Number(m[2])]),[['チャット',1],['ライブ',1],['判断',1],['コード',6],['タスク',3],['チーム',3]]);
 const groups=[...html.matchAll(/<section class="trial-group" aria-label="([^"]+)">([\s\S]*?)<\/section>/g)].map(m=>[m[1],[...m[2].matchAll(/data-trial-id="([^"]+)"/g)].map(x=>x[1])]);
 assert.deepEqual(groups,[['チャット',['CHAT']],['ライブ',['LIVE']],['判断',['DECISION']],['コード',ids.slice(3,9)],['タスク',ids.slice(9,12)],['チーム',ids.slice(12)]]);
});

test('全15行のテストボタンは接続・読込・実行状態で制御し、見出しの個別ボタンは置かない',async()=>{
 for(const flags of [{online:true},{online:false},{online:true,loading:true},{online:true,running:true}]){
  const html=await render('components/設定モデル/設定モデルパネル.vue',{data:grouped,results:{},selected:'CHAT',...flags});
  const buttons=html.match(/<button[^>]*data-trial-id="[^"]+"[^>]*>テスト<\/button>/g)||[];
  assert.equal(buttons.length,15);
  assert.ok(buttons.every(button=>button.includes(' disabled')===(!flags.online||!!flags.loading||!!flags.running)));
  assert.doesNotMatch(html,/model-trial-single|選択項目をテスト/);
  assert.match(html,/>再読込<\/span><\/button>/);assert.match(html,/動作確認/);
 }
});

test('実Vueイベントで行選択は実行せず、行テストは対象IDを一度だけ実行する',async()=>{
 const {createRenderer,h,nextTick}=require('vue');
 const make=(tag,text='')=>({tag,text,children:[],props:{},parent:null});
 const renderer=createRenderer({
  createElement:tag=>make(tag),createText:text=>make('#text',text),createComment:text=>make('#comment',text),
  setText:(node,text)=>node.text=text,setElementText:(node,text)=>{node.text=text;node.children=[];},
  parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1]||null,
  patchProp:(node,key,old,value)=>node.props[key]=value,
  insert(node,parent,anchor){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);},
  remove(node){node.parent?.children.splice(node.parent.children.indexOf(node),1);},
 });
 const pending=deferred(),calls=[],runs=[];
 const {state}=await setup(async(path,method)=>{calls.push([path,method]);if(method==='GET')return grouped;if(method==='DELETE')return {};if(path.includes('/開始/'))return {...grouped,実行ID:'row',実行順:['CODE2']};return pending.promise;});
 await state.読込();
 const root=make('root'),app=renderer.createApp({render:()=>h(component('components/設定モデル/設定モデルパネル.vue').default,{data:state.設定.value,results:state.結果.value,selected:state.選択.value,running:state.実行中.value,online:true,onSelect:id=>state.選択.value=id,onTest:id=>runs.push(state.個別開始(id))})});
 const descendants=node=>[node,...node.children.flatMap(descendants)];
 try{
  app.mount(root);
  const select=descendants(root).find(node=>node.props.class==='trial-select');select.props.onClick();await nextTick();
  assert.equal(calls.filter(([,method])=>method==='POST').length,0);
  const button=descendants(root).find(node=>node.props['data-trial-id']==='CODE2');
  for(let parent=button.parent;parent;parent=parent.parent)assert.notEqual(parent.tag,'button');
  button.props.onClick();button.props.onClick();await tick();await nextTick();
  assert.equal(state.選択.value,'CODE2');assert.deepEqual(calls.filter(([,method])=>method==='POST').map(([path])=>path),['api/モデル試行/開始/CODE2','api/モデル試行/row/CODE2']);
  assert.ok(descendants(root).filter(node=>node.props['data-trial-id']).every(node=>node.props.disabled));
  for(const id of group)assert.equal(state.結果.value[id].状態,'実行中');
  pending.resolve({id:'CODE2',状態:'OK',応答:'おはよう'});await Promise.all(runs);await nextTick();
  assert.ok(descendants(root).filter(node=>node.props['data-trial-id']).every(node=>!node.props.disabled));
  for(const id of group)assert.equal(state.結果.value[id].状態,'OK');
 }finally{app.unmount();state.終了();}
});


test('判断の選択値とJSON応答を表示し、タイムアウトNGで全体実行を止める',async()=>{
 for(const choice of ['high','medium','low']){
  const html=await render('components/設定モデル/設定モデルパネル.vue',{data:snapshot,results:{DECISION:{状態:'OK',判断結果:choice,応答:JSON.stringify({choice})}},selected:'DECISION',online:true});
  assert.match(html,/判断結果<\/dt>/);assert.ok(html.includes('<dd>'+choice+'</dd>'));assert.match(html,/high \/ medium \/ low/);assert.match(html,/おはよう/);assert.match(html,/Tools MCP/);
 }
 const calls=[];const {state}=await setup(async(path,method)=>{
  if(method==='GET')return snapshot;if(method==='DELETE')return {};if(path.endsWith('/開始'))return {...snapshot,実行ID:'timeout'};
  const id=path.split('/').pop();calls.push(id);return id==='DECISION'?{状態:'NG',実行終了:true,説明:'判断試行が制限時間を超えました。'}:{状態:'OK'};
 });
 await state.読込();await state.開始();assert.deepEqual(calls,['CHAT','LIVE','DECISION']);assert.equal(state.結果.value.DECISION.状態,'NG');assert.match(state.通知.value,/制限時間/);
});


test('未導入CLIは個別開始時にも古い結果を未実施へ戻す',async()=>{
 const data=structuredClone(snapshot);
 const {state}=await setup(async(path,method)=>{
  if(method==='GET')return data;
  if(path.includes('/開始/'))return {...data,実行ID:'skip',実行順:['TASK_do'],項目:data.項目.map(item=>['CODE1','TASK_do','TEAM_check'].includes(item.id)?{...item,状態:'未実施',説明:'CLI が未導入です。'}:item)};
  if(method==='DELETE')return {};
  assert.equal(state.結果.value.TASK_do.状態,'未実施');
  return {id:'TASK_do',状態:'未実施',説明:'CLI が未導入です。',応答:'',所要ms:0};
 });
 await state.読込();state.結果.value={CODE1:{状態:'OK',応答:'古い応答'},TASK_do:{状態:'NG'},TEAM_check:{状態:'OK'},CHAT:{状態:'OK'}};
 await state.個別開始('TASK_do');
 for(const id of ['CODE1','TASK_do','TEAM_check']){assert.equal(state.結果.value[id].状態,'未実施');assert.ok(!state.結果.value[id].応答);}
 assert.equal(state.結果.value.CHAT.状態,'OK');state.終了();
});


test('Predictionの役割と設定モデルの簡易説明は入力予測に統一する',async()=>{
 const {configRows}=await import('../../../../../モデル試行/trials.mjs');
 const row=configRows({}).find(item=>item.id==='PREDICTION');
 assert.equal(row.役割,'入力予測');
 const html=await render('components/設定モデル/設定モデルパネル.vue',{data:{項目:[row]},selected:'PREDICTION',online:false});
 assert.match(html,/PREDICTION \/ 入力予測/);assert.doesNotMatch(html,/次のユーザー入力/);
});
