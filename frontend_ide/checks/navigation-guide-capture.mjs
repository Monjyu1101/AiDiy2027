// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 操作ガイド専用の表示撮影。既存step-8結果を現行Vueで表示し、API/AI/保存は使わない。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),ide=join(root,'frontend_ide');
const temp=join(root,'tmp/pdfs/navi-step10/capture');await mkdir(temp,{recursive:true});
const base=join(root,'docs/セルフテスト、操作ガイド'),images=join(base,'images/セルフテスト,aidiy_navi,操作編');
const evidence='evidence/Navigator停止操作/step8-visible-20261107/evaluation-1.json';
const result=JSON.parse(JSON.parse(await readFile(join(base,evidence),'utf8')).content);
// AI出力は原文のまま使用。保存時刻等の未採取値は追加しない。
const panel=join(ide,'src/components/開発スペース/Navigationパネル.vue');
const {build}=await import(pathToFileURL(join(ide,'node_modules/vite/dist/node/index.js')));
const vue=(await import(pathToFileURL(join(ide,'node_modules/@vitejs/plugin-vue/dist/index.mjs')))).default;
const entry=join(temp,'main.js');
await writeFile(entry,`import {createApp,nextTick} from 'vue';
import Panel from ${JSON.stringify(panel.replaceAll('\\','/'))};
import ${JSON.stringify(join(ide,'src/style.css').replaceAll('\\','/'))};
import ${JSON.stringify(join(ide,'src/components/共通表示/会話表示.css').replaceAll('\\','/'))};
let displayState='input';
window.fetch=async(url,options={})=>{if(options.method&&options.method!=='GET')throw Error('説明図のため操作禁止');return new Response(JSON.stringify(String(url).includes('/api/connection')?{connected:false,active:true,mode:'online',startedAt:1}:{result:displayState==='input'?null:${JSON.stringify(result)},job:displayState==='running'?{id:'display-only',status:'running',action:'navigate'}:null,availability:{available:true,reason:''},selection:{provider:'codex_cli',model:'gpt-6.1-sol'}}),{headers:{'content-type':'application/json'}});};
const app=createApp(Panel,{standalone:true,instance:'guide',startedAt:1,project:{name:'公開README（表示例）',path:'/guide'}});
app.mount('#app');window.guide=async(state)=>{displayState=state;const a=window.guideApi;a.error.value='';
a.visible.value=true;a.goal.value=${JSON.stringify(result.goal)};a.availability.value={available:true,reason:''};
a.selection.value={provider:'codex_cli',model:'gpt-6.1-sol'};a.toolsState.value={connected:false,mode:'online'};
a.result.value=state==='input'?null:${JSON.stringify(result)};
a.job.value=state==='running'?{id:'display-only',status:'running',action:'navigate'}:null;
a.cruiseKind.value='clock';if(state==='cancelled')a.autopilotMessage.show('処理を中止しました。');
await nextTick();for(const d of document.querySelectorAll('details'))d.open=state==='expanded';
};`,'utf8');
process.env.CI='1';
await build({root:temp,configFile:false,logLevel:'error',plugins:[{name:'guide-display-only',enforce:'pre',transform(code,id){if(id.split('?')[0].replaceAll('\\','/')===panel.replaceAll('\\','/')&&!id.includes('?'))return code.replace('</script>','window.guideApi={visible,goal,availability,selection,toolsState,result,job,cruiseKind,autopilotMessage,error};\n</script>');}},vue()],resolve:{alias:{vue:join(ide,'node_modules/vue/dist/vue.runtime.esm-bundler.js')}},define:{'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:true,__VUE_PROD_DEVTOOLS__:false,__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:false},build:{outDir:join(temp,'dist'),emptyOutDir:true,minify:false,cssCodeSplit:false,lib:{entry,name:'Guide',formats:['iife'],fileName:()=> 'guide.js',cssFileName:'guide'}}});
const runtime=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=await import(pathToFileURL(join(runtime,'playwright-core/index.mjs')));
const browser=await chromium.launch({executablePath:join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),headless:true});
const shots=[];try{const page=await browser.newPage({viewport:{width:480,height:960},deviceScaleFactor:1});
const html=join(temp,'display.html');await writeFile(html,'<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="dist/guide.css"><style>html,body,#app{width:480px;height:960px;margin:0;overflow:hidden}.navigation-panel{position:static!important;width:100%!important;height:100%!important}</style><div id="app"></div><script src="dist/guide.js"></script></html>');
await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith('file:')&&url.includes('/development/')){const name=url.split('/').pop();try{return await route.fulfill({body:await readFile(join(ide,'public',name)),contentType:'image/png'});}catch{}}if(!url.startsWith('file:'))return route.abort();return route.continue();});
for(const [state,name] of [['input','Navigator_301_目標入力.png'],['running','Navigator_302_ナビ実行中.png'],['result','Navigator_303_ナビ結果.png'],['expanded','Navigator_304_理由と総合評価.png'],['cancelled','Navigator_801_処理の中止.png']]){
 await page.goto(pathToFileURL(html).href);await page.evaluate(state=>window.guide(state),state);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1000);
 const file=join(images,name);await page.screenshot({path:file});shots.push({state,path:'images/セルフテスト,aidiy_navi,操作編/'+name,sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
}
}finally{await browser.close();}
await writeFile(join(base,'evidence/Navigator資料整合/図版.json'),JSON.stringify({at:new Date().toISOString(),kind:'現行Vueによる説明用表示。機能試験・実AI送信・実機操作の新規証拠ではない。',resultSource:evidence,unchangedAiResult:true,source:{path:'frontend_ide/src/components/開発スペース/Navigationパネル.vue',sha256:createHash('sha256').update(await readFile(panel)).digest('hex')},network:'file以外を遮断。API/CLI/共有サービス/利用者窓への操作なし。',limits:'調査中・中止通知は撮影用状態。再評価の前後比較はしていない。接続表示は実サービス状態を示さない。',shots},null,2)+'\n');
console.log(JSON.stringify({images:shots.length,externalRequests:0}));
