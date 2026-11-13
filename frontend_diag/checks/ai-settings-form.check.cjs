// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const req = createRequire(path.join(__dirname, '../ui/package.json'));
const vue = req('vue');
const {parse, compileScript, compileTemplate} = req('@vue/compiler-sfc');
const {transformSync} = req('esbuild');
const source = fs.readFileSync(path.join(__dirname, '../diag/ui/dialog/AI設定再起動.vue'), 'utf8');
function form(request, confirm = () => true) {
  const {descriptor} = parse(source);
  const code = transformSync(compileScript(descriptor, {id:'test'}).content, {format:'cjs'}).code;
  const module = {exports:{}};
  vm.runInNewContext(code, {module, exports:module.exports, window:{confirm}, require: () => ({...vue, onBeforeUnmount:()=>{}})});
  const props = vue.reactive({isOpen:true, sessionId:'mock-session', request});
  const events = [];
  const scope = vue.effectScope();
  const state = scope.run(() => module.exports.default.setup(props, {expose(){}, emit:(...e)=>events.push(e)}));
  return {state, props, events, stop:()=>scope.stop()};
}
const tick = async () => { for(let i=0;i<5;i++) await vue.nextTick(); };
const ok = () => ({data:{status:'OK',data:{available_models:{}, モデル設定:{CODE_BASE_PATH:'mock-original'}}}});
test('embedded form compiles and exposes exactly three footer actions', () => {
  const {descriptor,errors}=parse(source);
  assert.equal(errors.length,0);
  assert.equal(compileTemplate({source:descriptor.template.content,id:'test'}).errors.length,0);
  const footer=descriptor.template.content.split('class="config-panel-actions"')[1];
  assert.equal((footer.match(/<button/g)||[]).length,3);
  assert.match(footer,/>書込み<\/button>/);
  assert.doesNotMatch(source,/リセット:\s*true|submitSettings|function handleSave\(/);
});
test('load failure blocks writes, retry succeeds and write preserves saved edits on repeated saves', async () => {
  const calls=[]; let fail=true;
  const f=form(async (p,b)=>{calls.push([p,b]); if(fail) throw Error('private-secret'); return ok();});
  await tick();
  assert.equal(f.state.canSave.value,false);
  assert.doesNotMatch(f.state.errorMessage.value,/private-secret/);
  await f.state.handleSaveOnly(); assert.equal(calls.length,1);
  fail=false; await f.state.loadConfig(); await tick();
  f.state.selections.codeBasePath='mock-new';
  await f.state.handleSaveOnly(); await f.state.handleSaveOnly();
  for(const [,body] of calls.slice(2)) {
    assert.equal(body.モデル設定.CODE_BASE_PATH,'mock-new');
    assert.equal(body.save,true);
    assert.ok(Object.values(body.再起動要求).every(x=>x===false));
  }
  f.stop();
});
test('duplicate writes blocked and session change invalidates pending completion', async () => {
  let resolve; let writes=0;
  const f=form(async (p)=>p.endsWith('取得')?ok(): (writes++, await new Promise(r=>{resolve=r;})));
  await tick();
  const pending=f.state.handleSaveOnly(); await f.state.handleSaveOnly();
  assert.equal(writes,1);
  assert.equal(f.state.writing.value,true);
  f.state.handleCancel();
  assert.ok(!f.events.some(e=>e[0]==='close'));
  f.props.isOpen=false; resolve(ok()); await pending;
  assert.equal(f.state.notice.value,''); assert.equal(f.state.hasLoadedConfig.value,false);
  f.stop();
});
test('restart requires confirmation and does not persist or reset configured defaults', async () => {
  const calls=[]; let confirmed=false;
  const f=form(async (p,b)=>{calls.push([p,b]); return ok();},()=>confirmed);
  await tick(); await f.state.handleResetReboot(); assert.equal(calls.length,1);
  confirmed=true; await f.state.handleResetReboot();
  const b=calls[1][1];
  assert.equal(b.save,false); assert.equal(b.リセット,undefined);
  assert.equal(Object.keys(b.モデル設定).length,0);
  assert.equal(Object.values(b.再起動要求).length,6);
  assert.ok(Object.values(b.再起動要求).every(x=>x===true));
  assert.ok(f.events.some(e=>e[0]==='saved')); 
  f.stop();
});
test('cancel invalidates delayed load and never writes', async () => {
  let resolve;
  const f=form(()=>new Promise(r=>{resolve=r;}));
  f.state.handleCancel(); resolve(ok()); await tick();
  assert.equal(f.state.hasLoadedConfig.value,false);
  assert.equal(f.events[0][0],'close'); f.stop();
});

test('openrt_free uses an independent setting and keeps paid OpenRouter selections on repeated switches and saves', async () => {
  const settings = {CHAT_AI_NAME:'openrt_chat',CHAT_OPENRT_MODEL:'vendor/paid',CHAT_OPENRT_FREE_MODEL:'auto'};
  const calls=[];
  const f=form(async (p,b)=>{
    calls.push([p,b]);
    if(b?.save) Object.assign(settings,b.モデル設定);
    return {data:{status:'OK',data:{モデル設定:{...settings},available_models:{chat_models:{openrt_chat:{'vendor/paid':'Paid'},openrt_free:{'vendor/new:free':'Free','vendor/other:free':'Other'}}}}}};
  });
  try {
    await tick();
    assert.ok(f.state.chatAiOptions.value.includes('openrt_free'));
    f.state.selections.chatAi='openrt_free';await tick();
    assert.equal(f.state.selections.chatModel,'vendor/new:free');
    f.state.selections.chatModel='vendor/other:free';
    await f.state.handleSaveOnly();
    assert.equal(calls.at(-1)[1].モデル設定.CHAT_OPENRT_FREE_MODEL,'vendor/other:free');
    assert.equal(settings.CHAT_OPENRT_MODEL,'vendor/paid');
    await f.state.loadConfig();await tick();
    assert.equal(f.state.selections.chatAi,'openrt_free');
    assert.equal(f.state.selections.chatModel,'vendor/other:free');
    f.state.selections.chatAi='openrt_chat';await tick();
    assert.equal(f.state.selections.chatModel,'vendor/paid');
    f.state.selections.chatAi='openrt_free';await tick();
    assert.equal(f.state.selections.chatModel,'vendor/other:free');
  } finally {f.stop();}
});
test('missing or empty free catalog follows normal provider selection', async () => {
  for(const free of [{},{openrt_free:{}}]){
    const f=form(async()=>({data:{status:'OK',data:{モデル設定:{CHAT_AI_NAME:'openrt_free',CHAT_OPENRT_FREE_MODEL:'auto',CHAT_OPENRT_MODEL:'vendor/paid'},available_models:{chat_models:{openrt_chat:{'vendor/paid':'Paid'},...free}}}}}));
    try {
      await tick();
      assert.equal(f.state.selections.chatAi,free.openrt_free?'openrt_free':'openrt_chat');
      assert.equal(f.state.selections.chatModel,free.openrt_free?'':'vendor/paid');
      assert.equal(f.state.buildNextSettings().CHAT_OPENRT_FREE_MODEL,'auto');
    } finally {f.stop();}
  }
});
