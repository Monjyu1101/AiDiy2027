// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {holdMove,holdUnmoved,shortClick}=require('./window-move-probe.cjs');
app.setPath('appData',process.env.AIDIY_TEST_PROFILE);app.disableHardwareAcceleration();
const nativeShow=BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive=function(){if(!this.isAiDiyOpeningCanvas){this.setIgnoreMouseEvents(true);this.setSkipTaskbar(true);}nativeShow.call(this);};
BrowserWindow.prototype.focus=function(){};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=async(win,code)=>{try{return await win.webContents.executeJavaScript(code,true);}catch(error){throw Error('画面操作失敗: '+code,{cause:error});}};
async function until(fn,label){for(let n=0;n<200;n++){if(await fn())return;await sleep(100);}throw Error('Browser確認タイムアウト: '+label);}
const output=join(__dirname,'../../temp/browser-check');mkdirSync(output,{recursive:true});
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/\D/g,'');
const shots=[];
async function capture(win,label){await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await sleep(400);const file=join(output,`${stamp}_${label}.png`);writeFileSync(file,(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());shots.push(file);const pageFile=join(output,`${stamp}_${label}_page.png`);writeFileSync(pageFile,(await guest(win).capturePage()).toPNG());shots.push(pageFile);}
const browsers=()=>BrowserWindow.getAllWindows().filter(w=>w.getTitle().startsWith('AiDiy IDE / Browser'));
const guest=win=>win.contentView.children.find(view=>view.webContents&&view.webContents!==win.webContents).webContents;
async function clickPage(page,selector){await page.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`,true);}
let running=false;
app.on('browser-window-created',(_,owner)=>{
 owner.webContents.setBackgroundThrottling(false);if(running)return;running=true;
 owner.webContents.once('did-finish-load',async()=>{
  try{
   await until(()=>evaluate(owner,`!!document.querySelector('.ide-heading')&&!document.documentElement.classList.contains('desktop-opening')`),'IDE起動');
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser()`)).ok,false,'利用開始前は拒否');
   await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='オフライン利用').click()`);
   await until(()=>evaluate(owner,`!!window.aidiyIDE`),'利用開始');
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser()`)).ok,false,'オフラインはBrowser起動不可');
   assert.equal(await evaluate(owner,`[...document.querySelectorAll('.ai-launchers button')].find(b=>b.textContent==='＋ Browser').disabled`),true);
   await evaluate(owner,`[...document.querySelectorAll('.ide-toolbar-right button')].find(b=>b.textContent==='終了').click()`);
   await until(()=>evaluate(owner,`[...document.querySelectorAll('button')].some(b=>b.textContent==='AiDiy接続利用'&&!b.disabled)`),'利用終了');
   await evaluate(owner,`[...document.querySelectorAll('button')].find(b=>b.textContent==='AiDiy接続利用').click()`);
   await until(()=>evaluate(owner,`[...document.querySelectorAll('.ai-launchers button')].some(b=>b.textContent==='＋ Browser'&&!b.disabled)`),'tools接続');
   await evaluate(owner,`aidiyIDE.setAutoSpin(false);[...document.querySelectorAll('.ai-launchers button')].find(b=>b.textContent==='＋ Browser').click()`);
   await until(()=>browsers().length===1&&browsers()[0].isVisible(),'Googleブラウザ起動');
   const google=browsers()[0],googlePage=guest(google);
   await until(()=>googlePage.getURL().startsWith('https://www.google.')&&!googlePage.isLoading(),'Google読み込み');
   const googleTitle=googlePage.getTitle();assert.match(googleTitle,/Google/i);
   assert.equal(await googlePage.executeJavaScript(`typeof window.aidiyWindow+':'+typeof process+':'+typeof require`),'undefined:undefined:undefined');
   assert.equal(google.getParentWindow(),null);assert.equal(google.isAlwaysOnTop(),true);
   await capture(google,'google');
   const blocked=await evaluate(google,`aidiyWindow.browserAction('navigate',${JSON.stringify(process.env.AIDIY_DEVELOPMENT_URL)})`);assert.equal(blocked.ok,false);
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser('../index.html')`)).ok,false);
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser('style.css')`)).ok,false);
   await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[1].click()`);await sleep(300);
   await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'index.html'})`);
   await until(()=>evaluate(owner,`!!document.querySelector('.viewer-browser')&&!!document.querySelector('.viewer-meta')`),'HTMLのブラウザボタン');
   assert.deepEqual(await evaluate(owner,`[...document.querySelectorAll('.viewer-mode button')].map(b=>b.textContent)`),['コード','表示']);
   await evaluate(owner,`document.querySelector('.viewer-browser').click()`);
   await until(()=>browsers().length===2&&browsers().every(w=>w.isVisible()),'HTMLブラウザ起動');
   const html=browsers().find(w=>w!==google),page=guest(html);
   await until(()=>html.contentView.children.some(v=>v.getBounds().height>100),'Browser表示領域');
   await until(()=>page.getTitle()==='宇宙ブラウザ検証'&&!page.isLoading(),'HTML表示');
   assert.equal(page.getURL(),pathToFileURL(join(process.env.AIDIY_DEVELOPMENT_PROJECT,'index.html')).href,'選択したHTMLは絶対パスで表示');
   await until(()=>evaluate(html,`document.querySelector('.browser-toolbar input').value.startsWith('file:///')`),'アドレス欄にもfile URL');
   assert.equal(await page.executeJavaScript(`getComputedStyle(document.body).backgroundColor`),'rgb(10, 20, 40)');
   const moves=[];moves.push(await holdUnmoved(google,googlePage,'[name=q]','Browser Google検索欄'));
   moves.push(await holdMove(html,page,'h1','Browser HTML本文'));moves.push(await holdUnmoved(html,page,'a','Browser HTMLリンク'));
   await until(()=>page.getTitle()==='次のページ'&&!page.isLoading(),'長押し解放でもリンク本来の移動を維持');
   await evaluate(html,`aidiyWindow.browserAction('back')`);await until(()=>page.getTitle()==='宇宙ブラウザ検証'&&!page.isLoading(),'リンク長押しから戻る');
   await shortClick(page,'a');await until(()=>page.getTitle()==='次のページ','短押しのmouseupでリンクを開く');
   await evaluate(html,`aidiyWindow.browserAction('back')`);await until(()=>page.getTitle()==='宇宙ブラウザ検証'&&!page.isLoading(),'短押しから戻る');
   const original=page.getURL();await clickPage(page,'a');
   await until(()=>page.getTitle()==='次のページ','相対HTMリンク');
   await until(()=>evaluate(html,`!document.querySelector('[aria-label="戻る"]').disabled`),'戻る有効');
   await evaluate(html,`document.querySelector('[aria-label="戻る"]').click()`);
   await until(()=>page.getURL()===original&&!page.isLoading(),'戻る');
   await until(()=>evaluate(html,`!document.querySelector('[aria-label="進む"]').disabled`),'進む有効');
   await evaluate(html,`document.querySelector('[aria-label="進む"]').click()`);
   await until(()=>page.getTitle()==='次のページ'&&!page.isLoading(),'進む');
   await clickPage(page,'a');await until(()=>page.getTitle()==='宇宙ブラウザ検証','target blankも同パネルで表示');assert.equal(browsers().length,2);
   await evaluate(html,`aidiyWindow.browserAction('reload')`);await until(()=>!page.isLoading(),'再読み込み');await capture(html,'html');
   const session=(await evaluate(html,`aidiyWindow.browserAction('state')`)).session;
   assert.match(session,/^aidiy_ide [1-9]\d*$/);
   const mcp=async(method,params={})=>{
    const response=await fetch(process.env.AIDIY_TOOLS_ORIGIN+'/aidiy_chrome_devtools/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session,...params}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));assert.equal(result.error,undefined,JSON.stringify(result));return result;
   };
   assert.equal(html.getTitle(),`AiDiy IDE / Browser ${session.slice('aidiy_ide '.length)}`);
   assert.equal(await evaluate(html,`document.querySelector('.panel-brand strong').textContent`),html.getTitle());
   const tabs=(await mcp('list_tabs')).tabs;assert.equal(tabs.length,1);assert.ok(tabs.every(t=>!t.url.startsWith(process.env.AIDIY_DEVELOPMENT_URL)),'IDE本体は制御対象に公開しない');
   const tab=tabs.find(t=>t.url===original);assert.ok(tab);
   const nativeCheck=await mcp('eval_js',{tab_id:tab.id,expression:'({bridge:typeof aidiyWindow,node:typeof process})'});
   assert.ok(JSON.stringify(nativeCheck).includes('undefined'));
   await mcp('click',{tab_id:tab.id,selector:'a'});await until(()=>page.getTitle()==='次のページ','MCPから実パネルのクリック');
   await mcp('navigate',{tab_id:tab.id,url:original,show_automation_banner:false});await until(()=>page.getTitle()==='宇宙ブラウザ検証','MCPから実パネルの移動');
   await mcp('eval_js',{tab_id:tab.id,expression:"document.body.insertAdjacentHTML('beforeend','<input id=probe aria-label=検証入力>')"});
   await mcp('type_text',{tab_id:tab.id,selector:'#probe',text:'MCPから入力しました'});assert.equal(await page.executeJavaScript(`document.querySelector('#probe').value`),'MCPから入力しました');
   const mcpShot=join(output,`${stamp}_mcp.png`);await mcp('screenshot',{tab_id:tab.id,save_path:mcpShot,shutter_sounds:'none'});shots.push(mcpShot);
   const created=await mcp('new_tab',{url:original,show_automation_banner:false});assert.ok(created.id);assert.match(created.session,/^aidiy_ide [1-9]\d*$/);assert.notEqual(created.session,session);await until(()=>browsers().length===3,'MCPのnew_tabで新しいBrowserパネル');
   assert.equal((await mcp('list_tabs',{session:created.session})).tabs[0].id,created.id);
   await mcp('close_session',{session:created.session});await until(()=>browsers().length===2,'MCPのclose_sessionは作成したBrowserだけ終了');
   await evaluate(owner,`aidiyIDE.goTo({type:'file',path:'next.htm'})`);await until(()=>evaluate(owner,`document.querySelector('.viewer-path').textContent.includes('next.htm')&&!!document.querySelector('.viewer-browser')`),'HTMにもブラウザボタン');
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser('宇宙 # 100%.html')`)).ok,true);
   let special;await until(()=>{special=browsers().find(w=>w!==google&&w!==html);return special&&!guest(special).isLoading()&&guest(special).getTitle()==='特殊名HTML';},'日本語・空白・記号のファイル');
   const specialPage=guest(special);assert.equal(specialPage.getURL(),pathToFileURL(join(process.env.AIDIY_DEVELOPMENT_PROJECT,'宇宙 # 100%.html')).href);await capture(special,'absolute-file');special.close();await until(()=>specialPage.isDestroyed(),'特殊名HTMLを閉じる');
   google.close();await until(()=>googlePage.isDestroyed(),'閉じるとページを解放');
   const beforeRoute=new Set(browsers());
   assert.equal((await evaluate(owner,`aidiyWindow.openBrowser('frontend_web/public/registered.html')`)).ok,true);
   let routed;await until(()=>{routed=browsers().find(w=>!beforeRoute.has(w));return routed&&guest(routed).getTitle()==='AiDiy登録ページ'&&!guest(routed).isLoading();},'登録HTMLは対応するWebページへ');
   assert.match(guest(routed).getURL(),/^http:\/\/127\.0\.0\.1:\d+\/registered.html$/);
   assert.equal(await guest(routed).executeJavaScript(`document.querySelector('h1').textContent`),'登録ルートから表示しました');
   await capture(routed,'registered-route');routed.close();await until(()=>routed.isDestroyed(),'登録ページを閉じる');
   await evaluate(owner,`document.querySelectorAll('.ide-view-modes button')[0].click()`);
   await until(()=>evaluate(owner,`!!document.querySelector('.window-all')`),'3D');
   await evaluate(owner,`document.querySelector('.window-all').click()`);await until(()=>evaluate(owner,`!!document.querySelector('.all-restore-button')&&!document.querySelector('.all-transition')`),'VR開始');
   const displayIds=[];
   for(const display of screen.getAllDisplays()){
    const before=new Set(browsers());
    await until(()=>evaluate(owner,`[...document.querySelectorAll('.all-restore-zone[data-display-id="${display.id}"] .all-launchers button')].some(b=>b.textContent==='＋ Browser'&&!b.disabled)`),'VR Browser起動ボタン');
    await evaluate(owner,`[...document.querySelectorAll('.all-restore-zone[data-display-id="${display.id}"] .all-launchers button')].find(b=>b.textContent==='＋ Browser').click()`);
    let child;await until(()=>{child=browsers().find(w=>!before.has(w));return child?.isVisible();},'選択画面Browser');
    const b=child.getBounds(),area=display.workArea;assert.ok(b.x>=area.x-3&&b.y>=area.y-3&&b.x+b.width<=area.x+area.width+3&&b.y+b.height<=area.y+area.height+3,JSON.stringify({b,area}));
    await until(()=>guest(child).getURL().startsWith('https://www.google.')&&!guest(child).isLoading(),'VR Browser本文');
    // 外部ページ自身のURL更新を窓移動の誤操作と混同しない。実ファイルの安定した本文で長押しを検査する。
    await guest(child).loadURL(pathToFileURL(join(process.env.AIDIY_DEVELOPMENT_PROJECT,'index.html')).href);
    moves.push(await holdMove(child,guest(child),'h1','VR Browser画面'+display.id));
    displayIds.push(display.id);child.close();
   }
   await evaluate(owner,`document.querySelector('.all-restore-button').click()`);await until(()=>evaluate(owner,`!document.querySelector('.all-restore-button')`),'VR終了');
   assert.equal(html.isDestroyed(),false,'VR終了でも閲覧は維持');
   await evaluate(owner,`[...document.querySelectorAll('.ide-toolbar-right button')].find(b=>b.textContent==='終了').click()`);
   await until(()=>html.isDestroyed()&&page.isDestroyed(),'IDE利用終了でブラウザを解放');
   const result={testPassed:true,googleTitle,session,mcpControl:true,htmlAndHtm:true,registeredRoute:true,relativeAssets:true,backForward:true,popupInSamePanel:true,isolatedContent:true,displayIds,moves,closedWithSession:true,shots};writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));process.send?.(result);app.exit(0);
  }catch(error){console.error(error);for(const win of browsers()){console.error('Browser状態',JSON.stringify({history:guest(win).navigationHistory.getAllEntries().map(({url,title})=>({url,title})),state:await evaluate(win,`aidiyWindow.browserAction('state')`)}));await capture(win,'failure-'+win.id);}app.exit(1);}
 });
});
setTimeout(()=>{console.error('Browser確認期限');app.exit(1);},150000).unref();
require('../desktop.cjs');
