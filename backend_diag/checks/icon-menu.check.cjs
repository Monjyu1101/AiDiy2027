// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const directory=path.resolve(__dirname,'../起動');
function fixture(){
 const ipcMain=new EventEmitter(),created=[],imagePaths=[];
 class Window extends EventEmitter{constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};created.push(this);}isDestroyed(){return !!this.dead;}close(){this.dead=true;this.emit('closed');}setAlwaysOnTop(){}loadURL(value){this.url=value;return Promise.resolve();}}
 const parent=new EventEmitter();parent.close=()=>parent.emit('close');
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(directory,'アイコンメニュー.cjs'),'utf8'),{module,exports:module.exports,__dirname:directory,process,setTimeout,clearTimeout,require:name=>name==='electron'?{BrowserWindow:Window,ipcMain,screen:{getCursorScreenPoint:()=>({x:990,y:790}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1000,height:800}})},nativeImage:{createFromPath:file=>{imagePaths.push(file);return {resize:()=>({toDataURL:()=> 'data:image/png;base64,fixture'})};}}}:require(name)});
 const menu=module.exports.アイコンメニューを作成(parent),events=[];menu.open([{key:'app:ide',label:'IDE'}],value=>events.push(value));
 return {ipcMain,parent,menu,events,imagePaths,target:created.at(-1),latest:()=>created.at(-1),bounds:module.exports.メニュー範囲};
}
test('メニューは画面内に置き、選択は表示項目と送信元に限定する',()=>{
 const f=fixture(),event={sender:f.target.webContents,senderFrame:f.target.webContents.mainFrame};
 assert.ok(f.target.options.x+f.target.options.width<=1000);assert.ok(f.target.options.y+f.target.options.height<=800);
 f.ipcMain.emit('diag:icon-menu-action',{sender:{}},'app:ide');f.ipcMain.emit('diag:icon-menu-action',event,'app:chrome');assert.equal(f.events.length,0);
 f.ipcMain.emit('diag:icon-menu-action',event,'app:ide');assert.deepEqual(f.events.map(v=>JSON.parse(JSON.stringify(v))),[{type:'launch',key:'app:ide'}]);assert.equal(f.ipcMain.listenerCount('diag:icon-menu-action'),0);
});
test('閉じるは親の既存close処理を呼び、サイズ変更は既存イベントに渡す',()=>{
 for(const action of ['mini','normal','close','dismiss']){const f=fixture();let closes=0;f.parent.on('close',()=>closes++);f.ipcMain.emit('diag:icon-menu-action',{sender:f.target.webContents,senderFrame:f.target.webContents.mainFrame},action);assert.equal(closes,action==='close'?1:0);assert.deepEqual(f.events,['mini','normal'].includes(action)?[action]:[]);}
});

test('四隅・負座標の別画面・小さい画面でもメニュー全体を作業領域内に収める',()=>{
 const {bounds}=fixture(),items=Array.from({length:32},(_,i)=>({key:'cli:test'+i}));
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1280,y:-200,width:1280,height:720},{x:100,y:100,width:300,height:280}]){
  for(const cursor of [{x:area.x,y:area.y},{x:area.x+area.width-1,y:area.y},{x:area.x,y:area.y+area.height-1},{x:area.x+area.width-1,y:area.y+area.height-1}]){
   const result=bounds(cursor,area,items);assert.ok(result.x>=area.x&&result.y>=area.y);assert.ok(result.x+result.width<=area.x+area.width);assert.ok(result.y+result.height<=area.y+area.height);
  }
 }
});


test('Slack はAiDiy列の件数へ入り、未導入項目のIPC選択も拒否する',()=>{
 const f=fixture();
 const area={x:0,y:0,width:1920,height:1040},cursor={x:0,y:0};
 assert.equal(f.bounds(cursor,area,[{key:'app:discord'},{key:'app:slack'}]).height,186);
 f.menu.close();f.menu.open([{key:'app:slack',label:'Slack',enabled:false,reason:'未導入'}],value=>f.events.push(value));
 const target=f.latest(),event={sender:target.webContents,senderFrame:target.webContents.mainFrame};
 const action=f.ipcMain.listeners('diag:icon-menu-action')[0];
 assert.equal(f.events.length,0);action(event,'app:slack');assert.equal(f.events.length,0);
 f.menu.close();
});

test('メニューpreloadはSlackをAiDiy列へ置き、disabledと安全な理由だけを表示する',()=>{
 const ipcRenderer=new EventEmitter(),listeners={},sent=[];ipcRenderer.send=(...args)=>sent.push(args);
 const element=tag=>({tag,children:[],dataset:{},setAttribute(k,v){this[k]=v;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},focus(){},getClientRects:()=>[{}]});
 const list=element('list'),document={body:{},activeElement:null,createElement:element,querySelector:selector=>selector==='.app-list'?list:{focus(){}},querySelectorAll:()=>[],addEventListener:(name,callback)=>listeners[name]=callback};
 const window={addEventListener:(_name,callback)=>callback()};
 vm.runInNewContext(fs.readFileSync(path.join(directory,'アイコンメニュー-preload.cjs'),'utf8'),{document,window,require:()=>({ipcRenderer})});
 ipcRenderer.emit('diag:icon-menu-items',{},[{key:'app:discord',label:'Discord',icon:'local'},{key:'app:slack',label:'Slack',icon:'local',enabled:false,reason:'未導入 <plain text>'}]);
 const discord=list.children[0].children[1],slack=list.children[0].children[2];assert.equal(discord.disabled,false);assert.equal(slack.disabled,true);assert.equal(slack.title,'未導入 <plain text>');assert.equal(slack.children[1].textContent,'Slack');assert.equal(list.children[1].children.length,1);
 listeners.click({target:{closest:()=>slack}});assert.equal(sent.length,0);listeners.click({target:{closest:()=>discord}});assert.deepEqual(sent[0],['diag:icon-menu-action','app:discord']);
 const firstParty=['ide','console','browser','navi','code','live','aidiy_hermes','avatar','task','team','cpu','discord','slack'].map(id=>(id==='aidiy_hermes'?'cli:':'app:')+id);
 const external=['cli:claude','cli:vscode','app:chrome'];
 ipcRenderer.emit('diag:icon-menu-items',{},[...firstParty,...external].map(key=>({key,label:key,icon:'local'})));
 assert.deepEqual(list.children[0].children.slice(1).map(n=>n.dataset.action),firstParty);
 assert.deepEqual(list.children[1].children.slice(1).map(n=>n.dataset.action),external);

});

test('native右クリックのAiDiy系は配布済ローカルPNGを使い旧SVG名を参照しない',()=>{
 const f=fixture(),ids=['cpu','browser','task','team','discord','slack'];f.menu.close();
 f.menu.open([...ids.map(id=>({key:'app:'+id,label:id})),{key:'cli:aidiy_hermes',label:'Hermes'}],()=>{});
 f.latest().webContents.emit('did-finish-load');
 const expected=[...ids.map(id=>'AiDiy_'+id+'.png'),'CLI_aidiy_hermes.png'];assert.deepEqual(f.imagePaths.map(p=>path.basename(p)),expected);
 for(const file of f.imagePaths){assert.equal(path.dirname(file),path.resolve(directory,'../static'));assert.equal(fs.existsSync(file),true);}f.menu.close();
});
