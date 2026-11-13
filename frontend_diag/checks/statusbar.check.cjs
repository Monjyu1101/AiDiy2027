// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test=require('node:test');const assert=require('node:assert/strict');const {render,source}=require('./ui-components.cjs');
test('サーバー表示状態が全停止なら黒、対象全稼働ならシアン、不足・不明なら赤',async()=>{
 for(const connected of [false,true])for(const serverState of ['online','offline','disconnected','unknown',undefined])for(const compact of [false,true]){
  const props={connected,serverState,compact};
  const html=await render('components/ウィンドウ/ステータスバー.vue',props);
  const classes=html.match(/class="connection-bar([^"]*)"/)[1].trim().split(/\s+/);
  const expected=connected&&['online','offline'].includes(serverState)?serverState:'disconnected';
  assert.deepEqual(classes,[expected],JSON.stringify(props));
  assert.ok(!html.includes('aria-label="終了"'));
 }
 const css=source('style.css');assert.match(css,/-webkit-app-region:drag/);assert.match(css,/-webkit-app-region:no-drag/);assert.doesNotMatch(css,/prefers-reduced-motion/);
 assert.match(css,/\.connection-bar\.online\{background:cyan;animation:cyan-bar-breathe 4\.5s linear infinite\}/);
 assert.match(css,/\.connection-bar\.disconnected\{background:#ff0000;animation:disconnected-bar-breathe 4\.5s linear infinite\}/);
 assert.match(css,/\.connection-bar\.offline\{background:#000;animation:none\}/);
 const pulse=source('components/共通表示/シアンバー.css');
 const cyan=pulse.split('@keyframes cyan-bar-breathe {')[1].split('@keyframes')[0];
 const red=pulse.split('@keyframes disconnected-bar-breathe {')[1];
 const samples=text=>[...text.matchAll(/([\d.,% ]+)\{ background-color: rgb\((\d+), (\d+), (\d+)\); \}/g)];
 const c=samples(cyan),r=samples(red);assert.equal(c.length,21);assert.equal(r.length,21);
 for(let i=0;i<c.length;i++){assert.equal(r[i][1],c[i][1]);assert.equal(+r[i][2],+c[i][3]);assert.equal(+r[i][3],0);assert.equal(+r[i][4],0);}
 assert.match(red,/50% \{ background-color: rgb\(255, 0, 0\)/);
});
test('mini restore lives in the titlebar in browser mode too',async()=>{
 const compact=await render('components/ウィンドウ/ステータスバー.vue',{compact:true,connected:true,enabled:true});
 assert.match(compact,/<header[^>]*>[\s\S]*aria-label="元のサイズに戻す"[\s\S]*<\/header>/);
 assert.ok(!compact.includes('aria-label="終了"'));
 const normal=await render('components/ウィンドウ/ステータスバー.vue',{connected:true,enabled:true});
 assert.ok(!normal.includes('aria-label="元のサイズに戻す"'));
});

// 本番 SFC の setup を実行し、DOM のない場所でも購読・状態遷移・解除を検証する。
async function desktopFixture(overrides={}){
 const path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
 const req=createRequire(path.join(__dirname,'../ui/package.json')),{parse,compileScript}=req('@vue/compiler-sfc'),{transformSync}=req('esbuild'),vue=req('vue');
 const callbacks={},events=new Map(),calls=[],listeners=new Set();let pinned=false,maximized=false;
 const api={getPinState:async()=>({pinned,locked:false}),togglePin:async()=>{calls.push('pin');pinned=!pinned;return{pinned,locked:false};},isMaximized:async()=>maximized,maximize:async()=>{maximized=!maximized;},minimize:async()=>calls.push('minimize'),close:async()=>calls.push('close'),onPinState:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},...overrides};
 const module={exports:{}},{descriptor}=parse(source('components/ウィンドウ/ステータスバー.vue'));
 const code=transformSync(compileScript(descriptor,{id:'statusbar-pin',inlineTemplate:false}).content,{format:'cjs'}).code;
 vm.runInNewContext(code,{module,exports:module.exports,window:{aidiyWindow:api,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)},require:()=>({...vue,onMounted:fn=>callbacks.mount=fn,onBeforeUnmount:fn=>callbacks.unmount=fn})});
 const state=module.exports.default.setup({},{expose(){}});callbacks.mount();
 const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};await flush();
 return{state,calls,events,listeners,flush,unmount:()=>callbacks.unmount(),emit:value=>{for(const fn of listeners)fn(value);}};
}
test('Diag の4操作の並びとピン OFF/ON/ロック、最大化、購読解除を保つ',async()=>{
 const f=await desktopFixture(),s=f.state;
 assert.equal(s.desktop.value,true);assert.equal(s.pin.value.pinned,false);assert.match(s.pinTitle.value,/ON/);
 await s.togglePin();assert.equal(s.pin.value.pinned,true);assert.match(s.pinTitle.value,/OFF/);
 await s.togglePin();assert.equal(s.pin.value.pinned,false);
 f.emit({pinned:true,locked:true});await s.togglePin();assert.equal(f.calls.filter(v=>v==='pin').length,2);assert.equal(s.pin.value.pinned,true);assert.match(s.pinTitle.value,/VR/);
 f.emit({pinned:false,locked:false});assert.equal(s.pin.value.pinned,false);await s.action('maximize');assert.equal(s.maximized.value,true);await s.action('maximize');assert.equal(s.maximized.value,false);
 const template=source('components/ウィンドウ/ステータスバー.vue');assert.match(template,/action\('minimize'\)[\s\S]*action\('maximize'\)[\s\S]*class="window-pin"[\s\S]*action\('close'\)/);assert.match(template,/:aria-pressed="pin.pinned"/);assert.match(template,/:disabled="switching"/);
 f.unmount();assert.equal(f.listeners.size,0);assert.equal(f.events.size,0);
});
test('Diag の新しいピン通知を遅い初期応答で戻さず、切替連打と終了後の反映を防ぐ',async()=>{
 let initial,toggle;const f=await desktopFixture({getPinState:()=>new Promise(resolve=>initial=resolve),togglePin:()=>new Promise(resolve=>toggle=resolve)}),s=f.state;
 f.emit({pinned:true,locked:true});initial({pinned:false,locked:false});await f.flush();assert.equal(s.pin.value.locked,true);
 f.emit({pinned:false,locked:false});const pending=s.togglePin();assert.equal(s.pinBusy.value,true);await s.togglePin();f.unmount();toggle({pinned:true,locked:false});await pending;
 assert.equal(s.pin.value.pinned,false);assert.equal(s.pinBusy.value,false);
});


test('実際の左上launcher-selectorは未接続・切替中・フォルダ未選択でnative disabledを維持する',async()=>{
 for(const props of [{connected:false},{connected:true,switching:true},{connected:true,microAvailable:false},{connected:true,microAvailable:true}]){
  for(const compact of [false,true]){
   const html=await render('components/ウィンドウ/ステータスバー.vue',{...props,compact});
   const selector=html.match(/<div class="launcher-selector">([\s\S]*?)<\/div>/)?.[1];assert.ok(selector);
   for(const [name,disabled]of [['title-mini-switch',!props.connected||!!props.switching],['title-micro-switch',!props.connected||!!props.switching||!props.microAvailable]]){
    if(compact&&name==='title-mini-switch')continue;
    const button=selector.match(new RegExp(`<button class="${name}"([^>]*)>`));assert.ok(button);assert.equal(/\bdisabled(?:=""|\s|$)/.test(button[1]),disabled,JSON.stringify({name,...props,compact}));
   }
  }
 }
});
