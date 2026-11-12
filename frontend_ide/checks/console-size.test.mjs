// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import * as cliTitles from '../src/components/コンソール/CLIタイトル.js';
import * as keyboard from '../src/components/コンソール/キー入力.js';
import * as focus from '../src/components/コンソール/入力フォーカス.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as completion from '../src/components/コンソール/コマンド補完.js';
const require=createRequire(import.meta.url),vue=require('vue');
const {parse,compileScript,compileStyle}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
const {descriptor}=parse(readFileSync(new URL('../src/components/コンソール/コンソールパネル.vue',import.meta.url),'utf8'));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

// 実Vueのsetupと実FitAddonを通す。文字セルの測定・描画・WebSocketだけを代替する。
async function fixture(t,{desktop=false,linked=false,nativeTitle='',withFocus=false}={}){
 const mounted=[],unmounted=[],observers=new Set(),sockets=[],packets=[],resources={terminals:0,disposed:0};
 const container=new EventTarget();container.clientWidth=344;container.clientHeight=76;
 const timers=new Map();let timerId=0;
 const doc=Object.assign(new EventTarget(),{activeElement:null,visibilityState:'visible',hasFocus:()=>true,getSelection:()=>({isCollapsed:true})});
 const window=Object.assign(new EventTarget(),{getComputedStyle:element=>({getPropertyValue:key=>key==='height'?String(element.clientHeight):key==='width'?String(element.clientWidth):'0'}),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
 doc.defaultView=window;
 const panel=Object.assign(new EventTarget(),{ownerDocument:doc,isConnected:true,getClientRects:()=>[{}]});
 const fitModule={exports:{}};
 vm.runInNewContext(readFileSync(require.resolve('@xterm/addon-fit'),'utf8'),{window,module:fitModule,exports:fitModule.exports});
 let terminal,titleCalls=0;
 window.aidiyWindow={title:async()=>{titleCalls++;return nativeTitle;}};
 class Terminal{
  cols=80;rows=24;options={scrollback:5000};listeners={};buffer={active:{}};
  parserHandlers=new Map();
  registerParser=(id,callback)=>{const key=JSON.stringify(id);this.parserHandlers.set(key,callback);return{dispose:()=>this.parserHandlers.delete(key)};};
  parser={registerCsiHandler:this.registerParser,registerEscHandler:this.registerParser};
  write(_data,callback){callback?.();}
  _core={_renderService:{dimensions:{css:{cell:{width:8,height:17}}},clear(){}}};
  constructor(){terminal=this;resources.terminals++;}
  open(parent){this.element={parentElement:parent};} loadAddon(addon){addon.activate(this);} attachCustomKeyEventHandler(handler){this.handleKey=handler;} reset(){} clear(){} textarea={closest:()=>null};focusCount=0;hasSelection(){return false;} focus(){this.focusCount++;doc.activeElement=this.textarea;} writeln(){} dispose(){resources.disposed++;}
  resize(cols,rows){this.cols=cols;this.rows=rows;this.listeners.Resize?.({cols,rows});}
 }
 for(const event of ['Data','Key','Resize','CursorMove','Scroll','Render'])Terminal.prototype['on'+event]=function(callback){this.listeners[event]=callback;return{dispose:()=>delete this.listeners[event]};};
 class Socket{
  static OPEN=1;readyState=1;
  constructor(){sockets.push(this);} send(data){packets.push(JSON.parse(data));} close(){this.readyState=3;this.onclose?.();}
  receive(message){this.onmessage({data:JSON.stringify(message)});}
 }
 class ResizeObserver{
  constructor(callback){this.callback=callback;observers.add(this);} observe(target){this.target=target;} disconnect(){observers.delete(this);}
 }
 const modules={'../コード/パネル表示切替.vue':{},'./CLIタイトル.js':cliTitles,'./キー入力.js':keyboard,'./入力フォーカス.js':focus,'@xterm/xterm':{Terminal},'@xterm/addon-fit':fitModule.exports,'@xterm/xterm/css/xterm.css':{},'../共通表示/状態バー.vue':{},'../コンソール/開始表示.vue':{},'../コンソール/コマンド補完.js':completion};
 const script=compileScript(descriptor,{id:'ConsolePanel',genDefaultAs:'component'}),module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\nmodule.exports=component;',{format:'cjs'}).code,{
  module,URL,window,WebSocket:Socket,ResizeObserver,location:{href:'http://localhost/'},
  require(id){if(id==='vue')return{...vue,onMounted:callback=>mounted.push(callback),onBeforeUnmount:callback=>unmounted.push(callback)};if(id in modules)return modules[id];throw Error(id);},
 });
 const props=vue.reactive({base:'/',visible:true,desktop,linked}),scope=vue.effectScope(),state=scope.run(()=>module.exports.setup(props,{expose(){}}));
 state.container.value=vue.markRaw(container);if(withFocus)state.panel.value=vue.markRaw(panel);
 let cleaned=false;const dispose=()=>{if(cleaned)return;cleaned=true;for(const callback of unmounted)callback();scope.stop();};
 t.after(dispose);
 for(const callback of mounted)await callback();
 sockets[0].onopen();sockets[0].receive({type:'ready',project:'/fixture',shell:'bash',completion:false});
 return{state,props,terminal,container,sockets,packets,resources,observers,doc,window,timers,flushFocus(){const tasks=[...timers.values()];timers.clear();for(const fn of tasks)fn();},dispose,titleCalls:()=>titleCalls,resize(height,width=344){container.clientHeight=height;container.clientWidth=width;for(const observer of observers)observer.callback();}};
}

test('Console: 数行の初期サイズ・縮小・拡大・最下行が実FitAddonとresize送信へ反映する',async t=>{
 const f=await fixture(t);
 assert.deepEqual(f.packets[0],{type:'start',cols:41,rows:4});
 assert.equal(f.terminal.rows*17<=f.container.clientHeight,true);
 for(const [height,rows] of [[51,3],[17,1],[85,5],[510,30],[76,4]]){
  f.resize(height);assert.deepEqual(f.packets.at(-1),{type:'resize',cols:41,rows});
  assert.ok(f.terminal.rows*17<=height);
 }
 const count=f.packets.length;f.resize(76);assert.equal(f.packets.length,count,'同じサイズは再送しない');
 f.resize(0);f.resize(76,0);assert.equal(f.packets.length,count,'0サイズはPTYへ送らない');
 f.resize(76);f.terminal.listeners.Data('日本語\r');assert.deepEqual(f.packets.at(-1),{type:'input',data:'日本語\r'});
});

test('Console: 小さな画面の入力・表示クリア・タブ往復・再起動でも同じ端末を維持する',async t=>{
 const f=await fixture(t);assert.equal(f.state.inputStarted.value,false);
 f.terminal.listeners.Key();await vue.nextTick();assert.equal(f.state.inputStarted.value,true);
 await f.state.clearDisplay();assert.equal(f.state.inputStarted.value,false);assert.equal(f.terminal.rows,4);
 const before=f.packets.length;f.props.visible=false;await vue.nextTick();f.resize(51);assert.equal(f.packets.length,before);
 f.props.visible=true;await flush();assert.equal(f.terminal.rows,3);
 f.container.dispatchEvent(new Event('paste'));await vue.nextTick();assert.equal(f.state.inputStarted.value,true);
 f.state.connect();f.sockets.at(-1).onopen();assert.deepEqual(f.packets.at(-1),{type:'start',cols:41,rows:3});
 assert.equal(f.state.inputStarted.value,false);assert.equal(f.resources.terminals,1);assert.equal(f.observers.size,1);
});

test('Console: 内側の領域を原点に補完候補を置き、最後の表示行で切り詰める',async t=>{
 const f=await fixture(t),text='PS X> codex';
 const line={length:f.terminal.cols,isWrapped:false,translateToString:()=>text,getCell:x=>({getChars:()=>text[x]||'',isItalic:()=>false})};
 const buffer=f.terminal.buffer.active={type:'normal',baseY:10,viewportY:10,cursorX:text.length,cursorY:3,getLine:row=>row===10+buffer.cursorY?line:undefined};
 f.container.getBoundingClientRect=()=>({left:108,top:216,width:344,height:f.container.clientHeight});
 f.container.querySelector=()=>({getBoundingClientRect:()=>({left:108,top:216,width:f.terminal.cols*8,height:f.terminal.rows*17})});
 f.sockets[0].receive({type:'ready',project:'/fixture',shell:'powershell',completion:true});
 f.state.updateCompletion();
 assert.equal(f.state.ghostRows.value.length,1);
 assert.equal(f.state.ghostRows.value[0].style.left,`${(text.length+1)*8}px`);
 assert.equal(f.state.ghostRows.value[0].style.top,'51px');
 assert.equal(f.state.ghostRows.value[0].style.height,'17px');
 assert.equal(f.state.ghostRows.value[0].text.length,f.terminal.cols-text.length-1);
 f.resize(51);buffer.cursorY=2;f.state.updateCompletion();
 assert.equal(f.state.ghostRows.value.length,1);assert.equal(f.state.ghostRows.value[0].style.top,'34px');
 f.props.visible=false;f.state.updateCompletion();assert.equal(f.state.ghostRows.value.length,0);
});

test('Console CSS: 高さ240以下だけ案内を畳み、余白なしの内側へfitする',()=>{
 const css=descriptor.styles[0].content,result=compileStyle({source:css,id:'data-v-console',scoped:true});
 assert.deepEqual(result.errors,[]);
 assert.match(css,/\.console-component\{[^}]*container:console-panel \/ size/);
 assert.match(css,/@container console-panel \(max-height:240px\)\{\s*\.console-welcome\{display:none\}\s*\.console-waiting \.console-screen\{flex:1;height:auto;max-height:none;border-top:0\}/);
 assert.match(css,/\.console-viewport\{[^}]*height:100%;[^}]*min-height:0/);
 assert.match(descriptor.template.content,/<div class="console-screen"[^>]*><div ref="container" class="console-viewport">/);
 assert.match(css,/\.console-error\{flex:none;max-height:1\.65em;overflow:auto/);
 assert.match(css,/\.console-meta>span:first-child\{[^}]*white-space:nowrap/);
});


test('CLI Console: 開始時から全体表示、モード保持、クリア・再接続・起動エラー',async t=>{
 const f=await fixture(t),cli={id:'copilot',name:'GitHub Copilot CLI',mode:'YOLO',autoApprove:true};
 f.sockets[0].receive({type:'ready',project:'/fixture 日本語',shell:cli.name,cli,state:'running',completion:false});
 await vue.nextTick();assert.equal(f.state.inputStarted.value,true);assert.equal(f.state.connected.value,true);assert.equal(f.state.cli.value.mode,'YOLO');
 await f.state.clearDisplay();assert.equal(f.state.inputStarted.value,true,'CLI画面を小さな初期表示へ戻さない');
 f.state.connect();f.sockets.at(-1).onopen();f.sockets.at(-1).receive({type:'ready',project:'/fixture 日本語',shell:cli.name,cli,state:'exited',completion:false});
 assert.equal(f.state.connected.value,false);assert.equal(f.state.inputStarted.value,true);assert.equal(f.state.status.value,'終了');
 f.sockets.at(-1).receive({type:'error',message:'起動失敗fixture'});assert.equal(f.state.error.value,'起動失敗fixture');assert.equal(f.state.status.value,'エラー');
 assert.match(descriptor.template.content,/モデル指定なし/);assert.match(descriptor.template.content,/再接続/);
});


test('Console入力: 修飾EnterはWebSocketへ一度だけ送信し、Ctrl+Cはボタンだけで送る',async t=>{
 const f=await fixture(t);
 const event=(key,extra={})=>({type:'keydown',key,preventDefault(){},stopPropagation(){},...extra});
 let count=f.packets.length;
 assert.equal(f.terminal.handleKey(event('c',{ctrlKey:true})),false);
 assert.equal(f.terminal.handleKey(event('v',{ctrlKey:true})),false);
 assert.equal(f.packets.length,count);
 for(const [extra,data] of [[{shiftKey:true},'\x1b[13;2u'],[{altKey:true},'\x1b\r']]){
  f.terminal.handleKey(event('Enter',extra));
  assert.deepEqual(f.packets.at(-1),{type:'input',data});
  count=f.packets.length;f.terminal.handleKey(event('Enter',{...extra,type:'keyup'}));assert.equal(f.packets.length,count);
 }
 f.state.interrupt();assert.deepEqual(f.packets.at(-1),{type:'input',data:'\x03'});
 f.sockets[0].receive({type:'exit',exitCode:0});count=f.packets.length;
 f.state.interrupt();f.terminal.handleKey(event('Enter',{shiftKey:true}));assert.equal(f.packets.length,count);
});


test('Console実setup: ConPTY要求はクリアで保持し、再接続で解除・破棄で購読を解放する',async t=>{
 const f=await fixture(t),e={type:'keydown',key:'Enter',shiftKey:true,preventDefault(){},stopPropagation(){}};
 const enable=()=>f.terminal.parserHandlers.get(JSON.stringify({prefix:'?',final:'h'}))([9001]);
 const check=data=>{f.terminal.handleKey(e);assert.deepEqual(f.packets.at(-1),{type:'input',data});};
 assert.equal(f.terminal.parserHandlers.size,3);enable();check('\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_');
 await f.state.clearDisplay();check('\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_');
 f.state.connect();f.sockets.at(-1).onopen();f.sockets.at(-1).receive({type:'ready',project:'/fixture',shell:'bash'});
 check('\x1b[13;2u');assert.equal(f.terminal.parserHandlers.size,3);
 f.sockets.at(-1).receive({type:'keyboard-mode',win32InputMode:true});check('\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_');
 f.sockets.at(-1).receive({type:'keyboard-mode',win32InputMode:false});check('\x1b[13;2u');
 f.dispose();assert.equal(f.terminal.parserHandlers.size,0);
});

test('Console再接続: 実xtermの未解析出力を排出してから最新のPTYだけを開始する',async t=>{
 const f=await fixture(t),{Terminal}=require('@xterm/xterm'),parserTerminal=new Terminal();
 t.after(()=>parserTerminal.dispose());
 // 描画用fixtureを保ちつつ、出力キューとparserは実xtermを使う。
 parserTerminal.parser.registerCsiHandler({prefix:'?',final:'h'},params=>f.terminal.parserHandlers.get(JSON.stringify({prefix:'?',final:'h'}))?.(params)||false);
 f.terminal.write=(data,callback)=>parserTerminal.write(data,callback);
 f.terminal.reset=()=>parserTerminal.reset();
 const old=f.sockets[0],before=f.packets.length;
 old.receive({type:'data',data:'\x1b[?9001h'});
 f.state.connect();f.sockets.at(-1).onopen();
 f.state.connect();f.sockets.at(-1).onopen();
 assert.equal(f.packets.length,before,'旧出力の排出前にはstartを送らない');
 old.receive({type:'data',data:'\x1b[?9001h'}); // 古い接続からの追加出力は捨てる。
 await new Promise(resolve=>parserTerminal.write('',resolve));
 assert.deepEqual(f.packets.slice(before),[{type:'start',cols:41,rows:4}],'重なった再接続は最新の一つだけ開始する');
 f.sockets.at(-1).receive({type:'ready',project:'/fixture',shell:'bash'});
 f.terminal.handleKey({type:'keydown',key:'Enter',shiftKey:true,preventDefault(){},stopPropagation(){}});
 assert.deepEqual(f.packets.at(-1),{type:'input',data:'\x1b[13;2u'});
 f.state.connect();f.sockets.at(-1).onopen();const count=f.packets.length;f.dispose();
 await new Promise(resolve=>parserTerminal.write('',resolve));assert.equal(f.packets.length,count,'破棄後の排出完了でPTYを開始しない');
});

test('Console welcome: styles target the current console kind', () => {
 const css = readFileSync(new URL('../src/components/共通表示/会話表示.css', import.meta.url), 'utf8');
 assert.match(css, /\.terminal-welcome\.console h1/);
 assert.doesNotMatch(css, /\.terminal-welcome\.term[ .{]/);
});


test('Console title: CLI display name is appended once, survives reconnect and exit, and leaves project unchanged',async t=>{
 const f=await fixture(t);
 assert.equal(f.state.title.value,'AiDiy Console');
 for(const name of ['Claude Code','Codex CLI','GitHub Copilot CLI','Antigravity CLI','Grok Build','OpenCode','AiDiy Hermes']){
  const ready={type:'ready',project:'/日本語 プロジェクト',shell:'fixture',cli:{name},state:'running'};
  f.sockets[0].receive(ready);f.sockets[0].receive(ready);
  assert.equal(f.state.title.value,`AiDiy Console / ${name}`);
  assert.equal(f.state.projectName.value,'日本語 プロジェクト');
  f.sockets[0].receive({type:'exit',code:0});assert.equal(f.state.title.value,`AiDiy Console / ${name}`);
 }
 f.sockets[0].receive({type:'ready',project:'/fixture',shell:'bash'});
 f.props.linked=true;f.state.windowTitle.value='AiDiy IDE / Console 2';
 assert.equal(f.state.title.value,'AiDiy IDE / Console 2');
});


test('desktop CLI Console does not append its native suffix twice; linked Console still reads its numbered native title',async t=>{
 const cli=await fixture(t,{desktop:true,nativeTitle:'AiDiy Console / Codex CLI'});
 cli.sockets[0].receive({type:'ready',project:'/fixture',shell:'codex',cli:{name:'Codex CLI'},state:'running'});
 await flush();
 assert.equal(cli.titleCalls(),0,'standalone Console uses terminal metadata, not the already-suffixed native title');
 assert.equal(cli.state.title.value,'AiDiy Console / Codex CLI');
 const linked=await fixture(t,{desktop:true,linked:true,nativeTitle:'AiDiy IDE / Console 2'});
 await flush();assert.equal(linked.titleCalls(),1);assert.equal(linked.state.title.value,'AiDiy IDE / Console 2');
});


test('Hermes Console title omits repeated AiDiy without changing CLI metadata or project',async t=>{
 const f=await fixture(t,{desktop:true,nativeTitle:'AiDiy Console / Hermes'});
 const cli={id:'aidiy_hermes',name:'AiDiy Hermes',mode:'YOLO'};
 for(let i=0;i<2;i++)f.sockets[0].receive({type:'ready',project:'/日本語 プロジェクト',shell:'AiDiy Hermes',cli,state:'running'});
 await flush();assert.equal(f.state.title.value,'AiDiy Console / Hermes');
 assert.equal(f.state.cli.value.name,'AiDiy Hermes');assert.equal(f.state.cli.value.id,'aidiy_hermes');
 assert.equal(f.state.projectName.value,'日本語 プロジェクト');assert.equal(f.titleCalls(),0);
});


test('Console実setup: ready・窓復帰・タブ復帰と非表示/破棄の遅延フォーカス境界',async t=>{
 const f=await fixture(t,{withFocus:true});
 f.flushFocus();assert.equal(f.terminal.focusCount,1);assert.equal(f.doc.activeElement,f.terminal.textarea);
 f.doc.activeElement=null;f.window.dispatchEvent(new Event('focus'));f.flushFocus();assert.equal(f.terminal.focusCount,2);
 f.props.visible=false;await flush();f.doc.activeElement=null;f.window.dispatchEvent(new Event('focus'));f.flushFocus();assert.equal(f.terminal.focusCount,2);
 f.props.visible=true;await flush();f.flushFocus();assert.equal(f.terminal.focusCount,3);
 f.props.visible=false;await flush();f.props.visible=true;await flush();f.props.visible=false;await flush();f.flushFocus();assert.equal(f.terminal.focusCount,3,'newer hide cancels pending tab focus');
 f.props.visible=true;await flush();f.dispose();f.flushFocus();assert.equal(f.terminal.focusCount,3,'unmount cancels pending tab focus');
 f.window.dispatchEvent(new Event('focus'));assert.equal(f.timers.size,0);
});

 test('Console collapse preserves the PTY and skips tiny resizes until expansion',async t=>{
 const f=await fixture(t),socket=f.sockets[0],rows=f.terminal.rows;
 f.state.panelCollapsed.value=true;await vue.nextTick();f.resize(1);assert.equal(f.terminal.rows,rows);assert.equal(socket.readyState,1);
 f.state.panelHidden.value=true;f.state.panelCollapsed.value=false;f.state.panelHidden.value=false;f.container.clientHeight=510;await vue.nextTick();await flush();f.resize(510);
 assert.equal(f.terminal.rows,30);assert.equal(f.sockets.length,1);assert.equal(f.resources.disposed,0);
});
