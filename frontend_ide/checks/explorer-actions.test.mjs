// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerActions, compactExplorerName, explorerNameError, parentPath, containsPath, renamedPath } from '../src/components/ファイル閲覧/エクスプローラー操作.js';
const file={path:'docs/sample.txt',name:'sample.txt',type:'file'},folder={path:'docs',name:'docs',type:'dir'};
function fixture(checked=()=>[]){
  const requests=[],changes=[],copied=[];let response,resolve,pending=false,root='/project';
  const document={defaultView:{navigator:{clipboard:{writeText:async text=>copied.push(text)}}},querySelector:()=>null};
  const actions=createExplorerActions({root:()=>root,checked,document:()=>document,changed:async result=>changes.push(result),request:async(url,options)=>{
    requests.push({url,options,payload:JSON.parse(options.body)});if(pending)await new Promise(done=>{resolve=done;});
    return response||new Response(JSON.stringify({action:JSON.parse(options.body).action,path:'docs/new.txt',previousPath:file.path,type:'file',name:'new.txt'}));
  }});
  return{actions,state:actions.state,requests,changes,copied,root:value=>{root=value;},response:value=>{response=value;},pending:value=>{pending=value;},resolve:()=>resolve()};
}
test('Explorer名前: Windows予約名・区切り・制御文字を拒否し、日本語名を維持',()=>{
  for(const name of ['', ' ','.','..','../bad','a/b','a\\b','a:b','foo.','foo ','a\0b','CON','nul.txt','LPT1.md','x'.repeat(256)])assert.ok(explorerNameError(name),name);
  for(const name of ['日本語 資料.txt','.gitignore','CONTEXT.md','report (2).txt'])assert.equal(explorerNameError(name),'');
  assert.equal(parentPath('hello.txt'),'');assert.equal(parentPath(file.path),'docs');assert.equal(containsPath('doc','docs/file'),false);assert.equal(containsPath('docs','docs/a'),true);
  assert.equal(renamedPath('docs/a','docs','new'),'new/a');assert.equal(renamedPath('docstring','docs','new'),'docstring');
});
test('Explorerコピー: IDE内clipboard、ルート背景貼付け・複製・パスコピー',async()=>{
  const f=fixture();await f.actions.action('paste',folder);assert.equal(f.requests.length,0);
  await f.actions.action('copy',file);assert.equal(f.requests.length,0);
  await f.actions.action('paste');assert.deepEqual(f.requests[0].payload,{action:'copy',path:file.path,directory:''});assert.equal(f.requests[0].options.headers['X-AiDiy-Explorer'],'1');
  await f.actions.action('duplicate',file);assert.equal(f.requests[1].payload.directory,'docs');
  await f.actions.action('copy-path',file);await f.actions.action('copy-relative',file);await f.actions.action('copy-path');await f.actions.action('copy-relative');assert.deepEqual(f.copied,['/project/docs/sample.txt','docs/sample.txt','/project','.']);
  f.root('/other');await f.actions.action('paste');assert.equal(f.requests.length,2);f.actions.dispose();
});

test('Explorerチェック一括: パス・内部コピー・複製・削除確認を同じ対象へ適用する',async()=>{
 const rows=[file,{path:'docs/other.txt',name:'other.txt',type:'file'}],f=fixture(()=>rows);
 try{
  await f.actions.action('copy-relative',file);assert.equal(f.copied[0],'docs/sample.txt\ndocs/other.txt');
  await f.actions.action('copy',file);assert.equal(f.state.clipboard.items.length,2);
  await f.actions.action('paste',folder);assert.deepEqual(f.requests[0].payload,{action:'copy',paths:rows.map(row=>row.path),directory:'docs'});
  await f.actions.action('duplicate',file);assert.deepEqual(f.requests[1].payload,{action:'copy',paths:rows.map(row=>row.path),duplicate:true});
  await f.actions.action('trash',file);assert.deepEqual([...f.state.dialog.paths],rows.map(row=>row.path));assert.equal(f.requests.length,2);
  f.actions.cancel();assert.equal(f.state.dialog,null);
  await f.actions.action('trash',file);
  const results=rows.map(row=>({...row,action:'trash',previousPath:row.path}));
  f.response(new Response(JSON.stringify({action:'trash',results,total:2})));
  await f.actions.perform({action:'trash',paths:rows.map(row=>row.path),confirmed:true});
  assert.equal(f.state.dialog,null);assert.equal(f.state.clipboard,null);assert.equal(f.changes.at(-1).results.length,2);assert.match(f.state.notice,/2件/);
 }finally{f.actions.dispose();}
});

test('Explorer一括: 部分成功は完了分だけ反映し、確認画面を閉じ自動再実行しない',async()=>{
 const rows=[file,{path:'docs/other.txt',name:'other.txt',type:'file'}],f=fixture(()=>rows);
 try{
  await f.actions.action('trash',file);
  f.response(new Response(JSON.stringify({message:'1/2件完了。other.txtで停止',completed:[{...file,action:'trash'}],failedPath:'other.txt',total:2}),{status:503}));
  await f.actions.perform({action:'trash',paths:rows.map(row=>row.path),confirmed:true});
  assert.equal(f.requests.length,1);assert.equal(f.state.dialog,null);assert.equal(f.changes.length,1);assert.equal(f.changes[0].results.length,1);assert.match(f.state.error,/1\/2件完了/);
 }finally{f.actions.dispose();}
});

test('Explorer一括連携: ファイル参照を1回の下書き依頼にまとめ、本文を送らない',async()=>{
 const drafts=[],rows=[file,{path:'docs/second.txt',name:'second.txt',type:'file'}];
 const actions=createExplorerActions({root:()=>'/project',document:()=>null,checked:()=>rows,openDraft:value=>drafts.push(value)});
 try{
  await actions.action('handoff',file);assert.equal(drafts.length,1);assert.equal(drafts[0].selection,false);
  assert.equal(drafts[0].text,'参照ファイル: docs/sample.txt\n\n参照ファイル: docs/second.txt');
 }finally{actions.dispose();}
});
test('Explorer: 自分自身・子孫へ貼り付けない、rootのrename/trash/copy禁止',async()=>{
  const f=fixture();await f.actions.action('copy',folder);await f.actions.action('paste',folder);await f.actions.action('paste',{path:'docs/deep',type:'dir'});assert.equal(f.requests.length,0);assert.match(f.state.error,/配下/);
  for(const action of ['rename','trash','copy'])await f.actions.action(action);assert.equal(f.state.dialog,null);assert.equal(f.state.rename,null);assert.equal(f.requests.length,0);f.actions.dispose();
});
test('Explorer削除: ダイアログだけでは変更しない、キャンセル・確認・失敗',async()=>{
  const f=fixture();await f.actions.action('trash',folder);assert.equal(f.state.dialog.path,'docs');assert.equal(f.requests.length,0);f.actions.cancel();assert.equal(f.state.dialog,null);
  await f.actions.action('trash',file);f.response(new Response(JSON.stringify({error:'ゴミ箱を利用できません'}),{status:503}));await f.actions.perform({action:'trash',path:file.path,confirmed:true});assert.equal(f.changes.length,0);assert.equal(f.state.dialog.path,file.path);assert.match(f.state.error,/ゴミ箱/);
  f.response(new Response(JSON.stringify({action:'trash',path:file.path,name:file.name,type:'file'})));await f.actions.perform({action:'trash',path:file.path,confirmed:true});assert.equal(f.state.dialog,null);assert.equal(f.changes.length,1);assert.match(f.state.notice,/復元/);f.actions.dispose();
});
test('Explorer名前: 検証後1回だけ送信、同名/キャンセル/エラーは保持',async()=>{
  const f=fixture();await f.actions.beginRename(file);f.state.rename.value='../invalid';await f.actions.submitName();assert.equal(f.requests.length,0);f.state.rename.value=file.name;await f.actions.submitName();assert.equal(f.requests.length,0);assert.equal(f.state.rename,null);
  await f.actions.beginRename(file);f.state.rename.value='new.txt';f.response(new Response(JSON.stringify({message:'同名が存在します'}),{status:409}));await f.actions.submitName();assert.equal(f.state.rename.value,'new.txt');assert.match(f.state.error,/同名/);f.actions.cancel();assert.equal(f.state.rename,null);
  await f.actions.action('create-folder',file);assert.equal(f.state.dialog.directory,'docs');assert.equal(f.requests.length,1);f.state.dialog.value='new folder';f.response(null);await f.actions.submitName();assert.equal(f.requests[1].payload.action,'create-folder');f.actions.dispose();
});
test('Explorer処理: 連打は重複送信しない、セッション変更後の応答は無視',async()=>{
  const f=fixture();f.pending(true);const first=f.actions.action('duplicate',file);await f.actions.action('duplicate',file);assert.equal(f.requests.length,1);f.actions.cancel();assert.equal(f.state.busy,true);f.actions.reset();f.resolve();await first;assert.equal(f.changes.length,0);assert.equal(f.state.notice,'');assert.equal(f.state.busy,false);f.actions.dispose();
});
test('Explorerキーボード: 入力欄は通常clipboard、Shift+Deleteを削除しない',async()=>{
  const f=fixture(),event=(key,extra={})=>({key,target:{closest:()=>null},preventDefault(){this.prevented=true;},stopPropagation(){},...extra});
  assert.equal(f.actions.keyboard(event('Delete',{shiftKey:true}),file),false);assert.equal(f.actions.keyboard(event('c',{ctrlKey:true,target:{closest:()=>({})}}),file),false);
  const copy=event('c',{ctrlKey:true});assert.equal(f.actions.keyboard(copy,file),true);assert.ok(copy.prevented);assert.equal(f.state.clipboard.path,file.path);assert.equal(f.actions.keyboard(event('F10',{shiftKey:true}),file),'menu');
  f.actions.keyboard(event('Delete'),file);assert.equal(f.state.dialog.action,'trash');assert.equal(f.requests.length,0);f.actions.dispose();
});
test('Explorer非同期UI: rename準備・clipboard・refreshの遅い応答をreset後に表示しない',async()=>{
  let finishClipboard,finishRefresh;
  const actions=createExplorerActions({root:()=>'/project',document:()=>({querySelector:()=>null,defaultView:{navigator:{clipboard:{writeText:()=>new Promise((_resolve,reject)=>{finishClipboard=reject;})}}}}),refresh:()=>new Promise(done=>{finishRefresh=done;})});
  const rename=actions.beginRename(file);actions.reset();await rename;assert.equal(actions.state.rename,null);
  const copying=actions.action('copy-path',file);actions.reset();finishClipboard(Error('rejected'));await copying;assert.equal(actions.state.dialog,null);assert.equal(actions.state.notice,'');
  const refreshing=actions.action('refresh');actions.reset();finishRefresh();await refreshing;assert.equal(actions.state.notice,'');assert.equal(actions.state.busy,false);actions.dispose();
});
test('Explorerコピー元状態: 名前変更後のclipboardは追従、削除後は解除',async()=>{
  const f=fixture();await f.actions.action('copy',file);
  await f.actions.perform({action:'rename',path:file.path,name:'new.txt'});assert.equal(f.state.clipboard.path,'docs/new.txt');
  f.response(new Response(JSON.stringify({action:'trash',path:'docs',name:'docs',type:'directory'})));await f.actions.perform({action:'trash',path:'docs',confirmed:true});assert.equal(f.state.clipboard,null);f.actions.dispose();
});
test('Explorer: 途中コピー失敗は再試行せず一覧更新して残存先を案内',async()=>{
  let refreshes=0,requests=0;
  const actions=createExplorerActions({root:()=>'/project',document:()=>null,refresh:async()=>refreshes++,request:async()=>{requests++;return new Response(JSON.stringify({message:'途中のコピーが残っています: copy.txt',partialPath:'copy.txt'}),{status:408});}});
  await actions.action('duplicate',file);assert.equal(requests,1);assert.equal(refreshes,1);assert.match(actions.state.error,/copy.txt/);actions.dispose();
});

test('Explorer PDF化: .mdのみを要求し、成功後に作成先を一覧へ反映する',async()=>{
 const f=fixture();await f.actions.action('pdf',file);assert.equal(f.requests.length,0);
 f.response(new Response(JSON.stringify({action:'pdf',path:'docs/日本語.pdf',name:'日本語.pdf',type:'file'})));
 await f.actions.action('pdf',{type:'file',path:'docs/日本語.MD',name:'日本語.MD'});
 assert.deepEqual(f.requests[0].payload,{action:'pdf',path:'docs/日本語.MD'});assert.equal(f.changes.length,1);assert.match(f.state.notice,/日本語.pdf.*作成/);f.actions.dispose();
});

test('Explorerフォルダを開く: 本体/別窓で同じ限定APIへ選択パスを渡し、rootも扱う',async()=>{
 const calls=[];let document={name:'embedded'};
 const actions=createExplorerActions({root:()=>'/project',document:()=>document,openFolder:async path=>{calls.push(path);return{ok:true};},request:()=>assert.fail('OS表示をHTTPへ送らない')});
 try{
  for(const name of ['embedded','detached']){
   document={name};
   for(const row of [file,folder,{type:'dir',path:'',name:'project'}]){await actions.action('open-folder',row);assert.equal(actions.state.error,'');assert.match(actions.state.notice,/開きました/);}
  }
  assert.deepEqual(calls,[file.path,folder.path,'',file.path,folder.path,'']);
 }finally{actions.dispose();}
});
test('Explorerフォルダを開く: Webは無効、失敗・連打・reset後の遅い結果を処理する',async()=>{
 const web=createExplorerActions({root:()=>'/project',document:()=>null});
 await web.action('open-folder',folder);assert.equal(web.canOpenFolder,false);assert.match(web.state.error,/デスクトップ版/);web.dispose();
 let resolve,calls=0;
 const actions=createExplorerActions({root:()=>'/project',document:()=>null,openFolder:()=>{calls++;return new Promise(done=>{resolve=done;});}});
 try{
  const first=actions.action('open-folder',file);await actions.action('open-folder',folder);assert.equal(calls,1);
  actions.reset();resolve({ok:false,error:'late'});await first;assert.equal(actions.state.error,'');assert.equal(actions.state.notice,'');assert.equal(actions.state.busy,false);
  const second=actions.action('open-folder',folder);resolve({ok:false,error:'フォルダを表示できません'});await second;assert.match(actions.state.error,/表示できません/);
 }finally{actions.dispose();}
});
test('Explorer右クリック: 実Vueテンプレートでアプリで開くの直後にフォルダを開くを表示',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync}=await import('node:fs'),{default:vm}=await import('node:vm');
 const require=createRequire(import.meta.url),vue=require('vue'),{parse,compileScript,compileTemplate}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
 const {descriptor}=parse(readFileSync(new URL('../src/components/ファイル閲覧/エクスプローラー操作表示.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'explorer-menu',genDefaultAs:'component'});
 const template=compileTemplate({source:descriptor.template.content,filename:'ExplorerActions.vue',id:'explorer-menu',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
 const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,require:id=>id==='vue'?vue:{containsPath,compactExplorerName}});
 const component=module.exports;
 const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?node.type===vue.Comment?'':text(node.children):typeof node==='string'?node:'';
 const targetNode=node=>Array.isArray(node)?node.flatMap(targetNode):node&&typeof node==='object'?[(node.props?.class==='menu-target'?node:null),...targetNode(node.children)].filter(Boolean):[];
 const buttons=node=>Array.isArray(node)?node.flatMap(buttons):node&&typeof node==='object'?[(node.props?.role==='menuitem'?node:null),...buttons(node.children)].filter(Boolean):[];
 for(const desktop of [false,true])for(const row of [file,folder,{type:'dir',path:'',name:'project'},{type:'file',path:'docs/test.md'},{type:'file',name:'非常に長い日本語の業務報告書ファイル.xlsx',path:'docs/非常に長い日本語の業務報告書ファイル.xlsx'}]){
  const calls=[],actions=createExplorerActions({root:()=>'/project',document:()=>null,openFile:desktop?async()=>({ok:true}):null,openFolder:desktop?async path=>{calls.push(path);return{ok:true};}:null});
  actions.state.menu={target:row,directory:parentPath(row.path),x:0,y:0};
  const props={actions},state=component.setup(props,{expose(){}}),items=buttons(component.render({},[],props,vue.proxyRefs(state),{},{}));
  const heading=targetNode(component.render({},[],props,vue.proxyRefs(state),{},{}))[0];
  assert.equal(text(heading.children),compactExplorerName(row.name||'ルートフォルダ'));
  assert.equal(heading.props.title,row.path,'全文パスはツールチップに保持する');
  assert.equal(actions.state.menu.target.path,row.path,'操作対象は短縮しない');
  const index=items.findIndex(button=>button.props['data-action']==='open-app'),next=items[index+1];
  assert.equal(next.props['data-action'],'open-folder');assert.equal(next.props.disabled,!desktop);assert.equal(text(next.children[0]),'フォルダを開く');
  if(desktop){await next.props.onClick();assert.deepEqual(calls,[row.path]);}
  actions.dispose();
 }
 assert.match(descriptor.styles[0].content,/width:min\(220px,calc\(100% - 12px\)\)/);
 const explorer=readFileSync(new URL('../src/components/ファイル閲覧/ファイル一覧.vue',import.meta.url),'utf8');
 assert.match(explorer,/openFolder:typeof window\.aidiyWindow\?\.openFolder==='function'\?path=>window\.aidiyWindow\.openFolder\(path\):null/);
});

test('Explorer右クリック: 下端メニューの位置反映後にスクロールせずフォーカスする',async()=>{
  const {watchEffect}=await import('vue');
  const listeners=new Map(),focusCalls=[];
  let renderedY,actions;
  const view={addEventListener(){},removeEventListener(){}};
  const document={defaultView:view,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const menu={offsetWidth:250,offsetHeight:300,querySelector:()=>({focus:options=>focusCalls.push({options,y:renderedY})})};
  const panel={ownerDocument:document,getBoundingClientRect:()=>({left:20,top:20,width:360,height:400}),querySelector:()=>actions.state.menu?menu:null};
  actions=createExplorerActions({root:()=>'/project',document:()=>document});
  // VueのDOM反映と同じpost flushで、表示上のtopを記録する。
  const stop=watchEffect(()=>{renderedY=actions.state.menu?.y;},{flush:'post'});
  try{
    await actions.showMenu({clientX:80,clientY:390,preventDefault(){},stopPropagation(){}},file,panel);
    assert.equal(actions.state.menu.y,94);
    assert.deepEqual(focusCalls,[{options:{preventScroll:true},y:94}]);
    assert.equal(actions.state.menu.target.path,file.path);
    actions.closeMenu();
    assert.equal(listeners.size,0);
    const pending=actions.showMenu({clientX:80,clientY:390,preventDefault(){},stopPropagation(){}},file,panel);
    actions.closeMenu();await pending;
    assert.equal(focusCalls.length,1,'閉じたメニューへフォーカスしない');
    const first=actions.showMenu({clientX:80,clientY:390,preventDefault(){},stopPropagation(){}},file,panel);
    const second=actions.showMenu({clientX:80,clientY:100,preventDefault(){},stopPropagation(){}},folder,panel);
    await Promise.all([first,second]);
    assert.equal(actions.state.menu.target.path,folder.path);
    assert.deepEqual(focusCalls.slice(1),[{options:{preventScroll:true},y:80}],'連続右クリックは最後のメニューだけにフォーカスする');
    actions.closeMenu();
    const cancelAfterPosition=watchEffect(()=>{
      if(actions.state.menu?.y===94)actions.closeMenu();
    },{flush:'post'});
    try{
      await actions.showMenu({clientX:80,clientY:390,preventDefault(){},stopPropagation(){}},file,panel);
      assert.equal(focusCalls.length,2,'位置反映の途中で閉じてもフォーカスしない');
    }finally{cancelAfterPosition();}
  }finally{stop();actions.dispose();}
});

test('Explorer右クリック: 12px右を優先し、右端では左へ回り、狭いパネルでは枠内へ収める',async()=>{
  const {watchEffect}=await import('vue');
  for(const [label,panelWidth,menuWidth,x,expected] of [
    ['右側',600,250,120,132],
    ['右端にちょうど収まる',500,250,232,244],
    ['1px足りないので左へ（左端で制限）',500,250,233,6],
    ['右端から左へ',600,250,500,238],
    ['左端',600,250,0,12],
    ['狭いパネル',220,208,110,6],
    ['実測幅が小さいメニュー',300,180,100,112],
  ]){
    let actions,renderedX;
    const focused=[];
    const document={defaultView:{addEventListener(){},removeEventListener(){}},addEventListener(){},removeEventListener(){}};
    const menu={offsetWidth:menuWidth,offsetHeight:150,querySelector:()=>({focus:options=>focused.push({x:renderedX,options})})};
    // 別窓などの原点に依存せず、viewport座標をパネル内座標へ変換する。
    const left=label==='左端'?0:80;
    const panel={ownerDocument:document,getBoundingClientRect:()=>({left,top:20,width:panelWidth,height:400}),querySelector:()=>menu};
    actions=createExplorerActions({root:()=>'/project',document:()=>document});
    const stop=watchEffect(()=>{renderedX=actions.state.menu?.x;},{flush:'post'});
    try{
      await actions.showMenu({clientX:left+x,clientY:120,preventDefault(){},stopPropagation(){}},file,panel);
      assert.equal(actions.state.menu.x,expected,label);
      assert.deepEqual(focused,[{x:expected,options:{preventScroll:true}}],label);
      assert.ok(expected>=6&&expected+menuWidth<=panelWidth-6,label);
    }finally{stop();actions.dispose();}
  }
});

test('Explorerメニュー名: 短名と16文字境界はそのまま、長名は先頭8・末尾7文字を残す',()=>{
  for(const name of ['','a.txt','設定.json','1234567890123456'])assert.equal(compactExplorerName(name),name);
  assert.equal(compactExplorerName('12345678901234567'),'12345678…1234567');
  assert.equal(compactExplorerName('非常に長い日本語の業務報告書ファイル.xlsx'),'非常に長い日本語…イル.xlsx');
  assert.equal(compactExplorerName('long-project-release-archive.tar.gz'),'long-pro….tar.gz');
  const combined='か\u3099',emoji='👨‍👩‍👧‍👦';
  assert.equal(compactExplorerName(combined.repeat(17)),combined.repeat(8)+'…'+combined.repeat(7));
  assert.equal(compactExplorerName(emoji.repeat(17)),emoji.repeat(8)+'…'+emoji.repeat(7));
});
