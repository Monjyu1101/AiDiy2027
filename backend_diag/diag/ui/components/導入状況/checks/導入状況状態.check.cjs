// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const uiRequire = createRequire(path.join(__dirname, '../../../../../ui', 'package.json'));
const { ref, reactive, watch } = uiRequire('vue');
const 状態を作成 = async (api, connected = true) => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  const 接続済み = ref(connected), 通知 = ref('');
  return { ...導入状況状態を作成({ api, 接続済み, 通知, 間隔: 0 }), 接続済み, 通知 };
};
const 一覧 = { 項目: [{ id: 'ffmpeg' }, { id: 'claude', menuGroup: 'CLI群' }, { id: 'node', menuGroup: 'ベース' }], 結果: [] };
test('未接続・重複クリックを抑止し、全項目を確認中にしてから結果へ切り替える', async () => {
  let calls = 0, finish;
  const state = await 状態を作成((url, method) => {
    calls++; assert.equal(url, 'api/診断'); assert.equal(method, 'POST');
    return new Promise(resolve => { finish = resolve; });
  }, false);
  state.一覧を反映(一覧);
  assert.equal(await state.状況確認(), false); assert.equal(calls, 0);
  state.接続済み.value = true;
  const pending = state.状況確認(); await state.状況確認();
  assert.equal(calls, 1); assert.equal(state.確認中.value, true); assert.equal(state.通知.value, '');
  assert.deepEqual(state.結果.value.map(r => r.状態), ['確認中', '確認中', '確認中']);
  finish({ 結果: 一覧.項目.map(e => ({ id: e.id, 状態: 'OK' })) });
  assert.equal(await pending, true);
  assert.equal(state.確認中.value, false); assert.equal(state.確認済み.value, true);
  assert.deepEqual(state.結果.value.map(r => r.状態), ['OK', 'OK', 'OK']);
});
test('応答を待つ間も、確認が終わった項目から結果を表示する', async () => {
  const { 導入状況状態を作成 } = await import('../導入状況状態.mjs');
  let finish; const calls = [];
  const api = (url, method) => {
    calls.push(url);
    if (url === 'api/診断/進捗') return Promise.resolve({ 実行中: true, 結果: [{ id: 'claude', 状態: 'OK' }] });
    assert.equal(method, 'POST'); return new Promise(resolve => { finish = resolve; });
  };
  const state = 導入状況状態を作成({ api, 接続済み: ref(true), 通知: ref(''), 間隔: 0, 進捗間隔: 5 });
  state.一覧を反映(一覧);
  const pending = state.状況確認();
  for (let i = 0; i < 100 && state.結果.value.find(r => r.id === 'claude').状態 !== 'OK'; i++) await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(state.結果.value.map(r => r.状態), ['確認中', 'OK', '確認中']); assert.equal(state.確認中.value, true);
  finish({ 結果: 一覧.項目.map(e => ({ id: e.id, 状態: 'NG' })) });
  assert.equal(await pending, true);
  const polled = calls.length; await new Promise(r => setTimeout(r, 30));
  assert.equal(calls.length, polled, '完了後は進捗を問い合わせない');
  assert.deepEqual(state.結果.value.map(r => r.状態), ['NG', 'NG', 'NG']);
});
test('結果は画面の上から順（ベース→CLI群→その他拡張）に反映する', async () => {
  const seen = [];
  const state = await 状態を作成(async () => ({ 結果: 一覧.項目.map(e => ({ id: e.id, 状態: 'OK' })) }));
  state.一覧を反映(一覧);
  const stop = watch(state.結果, value => seen.push(value.filter(r => r.状態 === 'OK').map(r => r.id).join(',')), { flush: 'sync' });
  await state.状況確認(); stop();
  assert.deepEqual(seen.slice(1, 4), ['node', 'claude,node', 'ffmpeg,claude,node']);
});
test('書込は確認後だけ実行し、全テストは確認してから書き込む', async () => {
  const calls = [];
  const state = await 状態を作成(async url => { calls.push(url); return url === 'api/診断' ? { 結果: 一覧.項目.map(e => ({ id: e.id, 状態: 'OK' })) } : { 件数: 3 }; });
  state.一覧を反映(一覧);
  assert.equal(await state.書込(), false); assert.deepEqual(calls, []);
  assert.equal(await state.全テスト(), true);
  assert.deepEqual(calls, ['api/診断', 'api/書込']); assert.equal(state.書込済み.value, true);
  state.一覧を反映(一覧); assert.equal(state.確認済み.value, false); assert.equal(state.書込済み.value, false);
});
test('確認失敗では前回の結果へ戻し、書込はできない。書込失敗は通知する', async () => {
  const state = await 状態を作成(async () => { throw new Error('通信失敗'); });
  state.一覧を反映({ 項目: [{ id: 'node' }], 結果: [{ id: 'node', 状態: '未検出' }], 調査: { complete: true } });
  assert.equal(await state.全テスト(), false); assert.equal(state.通知.value, '通信失敗'); assert.equal(state.確認中.value, false);
  assert.deepEqual(state.結果.value, [{ id: 'node', 状態: '未検出' }]); assert.equal(state.確認済み.value, false);
  const writer = await 状態を作成(async url => { if (url === 'api/書込') throw new Error('書き込みに失敗しました。'); return { 結果: [{ id: 'node', 状態: 'OK' }] }; });
  writer.一覧を反映({ 項目: [{ id: 'node' }], 結果: [] });
  assert.equal(await writer.全テスト(), false); assert.equal(writer.通知.value, '書き込みに失敗しました。'); assert.equal(writer.書込済み.value, false);
  state.一覧を反映({ 項目: [], 結果: [] });
  assert.deepEqual(state.項目.value, []); assert.deepEqual(state.調査.value, {});
});
test('選択・詳細・参照重複除外・分類開閉は結果更新後も保持する', async () => {
  const { 導入状況表示を作成 } = await import('../導入状況表示.mjs');
  const props = reactive({ 項目: [{ id: 'node', name: 'Node.js', commands: ['node'], usageTier: 'base', minimumVersion: '18', evidence: [{ path: 'a', line: 1 }, { path: 'a', line: 1 }] }], 結果: [] });
  const view = 導入状況表示を作成(props);
  assert.deepEqual(view.分類, ['ベース', 'CLI群', 'その他拡張']);
  assert.equal(view.選択項目.value, undefined); assert.equal(view.状態('node'), '未確認');
  view.選択ID.value = 'node'; assert.deepEqual(view.参照箇所.value, ['a:1']);
  assert.ok(view.詳細項目.value.some(([label, value]) => label === '必要バージョン' && value.includes('18')));
  props.結果 = [{ id: 'node', 状態: 'OK', バージョン: 'v22' }];
  assert.equal(view.状態('node'), 'OK'); assert.equal(view.選択ID.value, 'node');
  view.開閉('その他拡張', { target: { open: true } }); assert.equal(view.折り畳み.value.has('その他拡張'), false);
  view.開閉('その他拡張', { target: { open: false } }); assert.equal(view.折り畳み.value.has('その他拡張'), true);
});
test('演出中は表示中の項目へ選択（右側の詳細）を順に切り替え、閉じた分類を開く', async () => {
  const order = [];
  const state = await 状態を作成(async () => ({ 結果: 一覧.項目.map(e => ({ id: e.id, 状態: 'OK' })) }));
  state.一覧を反映(一覧);
  const stop = watch(state.表示中, id => order.push(id), { flush: 'sync' });
  await state.状況確認(); stop();
  assert.deepEqual(order, ['node', 'claude', 'ffmpeg']);
  const { 導入状況表示を作成 } = await import('../導入状況表示.mjs');
  const props = reactive({ 項目: 一覧.項目, 結果: [], 表示中: null });
  const view = 導入状況表示を作成(props);
  assert.equal(view.折り畳み.value.has('その他拡張'), false);
  view.開閉('その他拡張', {target:{open:false}});
  props.表示中 = 'claude'; await Promise.resolve(); assert.equal(view.選択ID.value, 'claude');
  props.表示中 = 'ffmpeg'; await Promise.resolve(); assert.equal(view.選択ID.value, 'ffmpeg'); assert.equal(view.折り畳み.value.has('その他拡張'), false);
});

test('状況確認の完了後は一覧の1項目目（分類順の先頭）を表示し、その分類を開く', async () => {
  const { 導入状況表示を作成 } = await import('../導入状況表示.mjs');
  const props = reactive({ 項目: 一覧.項目, 結果: [], 表示中: null, 確認中: false });
  const view = 導入状況表示を作成(props);
  view.選択ID.value = 'node'; props.確認中 = false; await Promise.resolve(); assert.equal(view.選択ID.value, 'node');
  props.確認中 = true; props.表示中 = 'ffmpeg'; await Promise.resolve(); assert.equal(view.選択ID.value, 'ffmpeg');
  view.折り畳み.value = new Set(['ベース']);
  props.確認中 = false; await Promise.resolve(); assert.equal(view.選択ID.value, 'node', '一覧順ではなく画面の分類順（ベース）の先頭'); assert.equal(view.折り畳み.value.has('ベース'), false);
});

test('前回結果と日時を初期表示し、再実行したときだけ日時と書込可否を更新する',async()=>{
 const old='2026-10-17T01:02:03Z',now='2026-10-18T04:05:06Z';
 const state=await 状態を作成(async()=>({結果:[{id:'node',状態:'NG'}],前回実行日時:now}));
 state.一覧を反映({項目:[{id:'node'}],結果:[{id:'node',状態:'OK'}],前回実行日時:old});
 assert.equal(state.結果.value[0].状態,'OK');assert.equal(state.前回実行日時.value,old);assert.equal(state.確認済み.value,false);
 await state.状況確認();assert.equal(state.前回実行日時.value,now);assert.equal(state.結果.value[0].状態,'NG');assert.equal(state.確認済み.value,true);
});

test('個別確認は対象だけ確認中にし、連打・一括・書込を抑止して新しい結果だけ反映する',async()=>{
 const calls=[];let finish;
 const state=await 状態を作成((url,method)=>{calls.push([url,method]);return new Promise(resolve=>{finish=resolve;});},false);
 const previous=一覧.項目.map(entry=>({id:entry.id,状態:'OK',バージョン:'old',前回結果:true}));
 state.一覧を反映({...一覧,結果:previous});
 assert.equal(await state.個別確認('node'),false);state.接続済み.value=true;
 assert.equal(await state.個別確認('unknown'),false);assert.equal(calls.length,0);
 const pending=state.個別確認('claude');
 assert.equal(state.個別確認中.value,'claude');assert.equal(state.確認中.value,false);
 assert.deepEqual(state.結果.value.map(row=>row.状態),['OK','確認中','OK']);
 assert.deepEqual(state.結果.value.filter(row=>row.id!=='claude'),previous.filter(row=>row.id!=='claude'));
 for(const run of [()=>state.個別確認('claude'),state.状況確認,state.書込,state.全テスト])assert.equal(await run(),false);
 assert.deepEqual(calls,[['api/診断/claude','POST']]);
 finish({結果:{id:'claude',状態:'未検出',確認日時:'2026-10-19T00:00:00Z'},前回実行日時:'2026-10-19T00:00:00Z',確認済み:false});
 assert.equal(await pending,true);assert.equal(state.個別確認中.value,'');assert.equal(state.確認済み.value,false);
 assert.deepEqual(state.結果.value.map(row=>row.状態),['OK','未検出','OK']);assert.equal(state.表示中.value,null);
 assert.equal(state.前回実行日時.value,'2026-10-19T00:00:00Z');assert.equal(state.書込済み.value,false);
});

test('個別確認は一括確認・書込中に実行せず、完了後の再確認で保存済み表示を解除する',async()=>{
 const calls=[];let finish;
 const state=await 状態を作成(async url=>{
  calls.push(url);
  if(url==='api/診断')return {結果:一覧.項目.map(entry=>({id:entry.id,状態:'OK'}))};
  if(url==='api/書込')return new Promise(resolve=>{finish=resolve;});
  return {結果:{id:'node',状態:'NG'},確認済み:true};
 });
 state.一覧を反映(一覧);state.確認中.value=true;assert.equal(await state.個別確認('node'),false);state.確認中.value=false;
 await state.状況確認();const writing=state.書込();assert.equal(await state.個別確認('node'),false);finish({});await writing;
 assert.equal(state.書込済み.value,true);assert.equal(await state.個別確認('node'),true);
 assert.equal(state.確認済み.value,true);assert.equal(state.書込済み.value,false);assert.equal(state.結果.value.find(row=>row.id==='node').状態,'NG');
 assert.deepEqual(calls,['api/診断','api/書込','api/診断/node']);
});

test('個別確認失敗は前回の結果・日時を保ち、通知してロックを解除し再試行できる',async()=>{
 let fail=true;
 const state=await 状態を作成(async()=>{if(fail)throw Error('通信失敗');return {結果:{id:'node',状態:'ERR',説明:'タイムアウト'},確認済み:true};});
 const old='2026-10-17T01:02:03Z',previous=[{id:'node',状態:'OK',バージョン:'old'}];
 state.一覧を反映({項目:[{id:'node'}],結果:previous,前回実行日時:old});
 assert.equal(await state.個別確認('node'),false);assert.equal(state.通知.value,'通信失敗');assert.equal(state.個別確認中.value,'');
 assert.deepEqual(state.結果.value,previous);assert.equal(state.前回実行日時.value,old);assert.equal(state.確認済み.value,false);
 fail=false;assert.equal(await state.個別確認('node'),true);assert.equal(state.通知.value,'');assert.equal(state.結果.value[0].状態,'ERR');
});

test('個別確認の完了は選択・折り畳みを変更せず、待機中の新しい選択を維持する',async()=>{
 const {導入状況表示を作成}=await import('../導入状況表示.mjs');
 let finish;
 const state=await 状態を作成(()=>new Promise(resolve=>{finish=resolve;}));state.一覧を反映(一覧);
 const props=reactive({項目:一覧.項目,結果:state.結果,確認中:state.確認中,個別確認中:state.個別確認中,表示中:state.表示中});
 const view=導入状況表示を作成(props);view.開閉('その他拡張',{target:{open:false}});view.選択ID.value='ffmpeg';
 const pending=state.個別確認('ffmpeg');await Promise.resolve();view.選択ID.value='claude';
 finish({結果:{id:'ffmpeg',状態:'OK'},確認済み:false});await pending;await Promise.resolve();
 assert.equal(view.選択ID.value,'claude');assert.equal(view.折り畳み.value.has('その他拡張'),true);
 assert.equal(state.確認中.value,false);assert.equal(state.表示中.value,null);
});
