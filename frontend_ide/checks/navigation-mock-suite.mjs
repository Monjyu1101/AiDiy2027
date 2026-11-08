// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 現存7本の全工程。過去の模擬8本とは対応付けない。
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';
const root=fileURLToPath(new URL('../../',import.meta.url));
const evidence=join(root,'docs/セルフテスト、操作ガイド/evidence/Navigator現行模擬ハーネス');mkdirSync(evidence,{recursive:true});
const cases=[
 ['check-navigation','模擬作成・再評価、2窓のモデル/結果/終了の独立、失敗表示、処理中終了、単独表示'],
 ['check-navigation-progress','0/50/100%表示、依存停止復帰、目標編集と再評価、失敗再試行、履歴、実行中編集、2窓・単独表示'],
 ['check-navigation-guide','初期・履歴・モデル画面、空目標の禁止、模擬Toolsの停止復帰、Codeとのタイトル寸法一致。AI呼出しゼロ'],
 ['check-navigation-height','単独480x800、小画面384x464、リサイズ復帰、IDE内800pxと縮小、ポップアップ初期寸法。AI呼出しゼロ'],
 ['check-navigation-autopilot','次の操作の強調、右側Code、模擬2周100%終了、表示/非表示で停止、エラー停止と明示再開、デスクトップAPI模擬、再評価の保存目標復元、単独Code'],
 ['check-navigation-scene-picker','押下/右クリック/キー/タッチ、現行9候補と全選択、非送信転記、中止、狭幅、別Document、破棄'],
 ['check-navigation-scenery','3種Canvas、黒地、魚/餌/気泡/波紋/ホバー、Space/repeat/入力、別Document移動復帰と破棄']
];
const selected=process.argv.includes('--case')?cases.filter(([name])=>name===process.argv[process.argv.indexOf('--case')+1]):cases;
if(!selected.length)throw Error('対象名が不正です。');
const id=new Date().toISOString().replace(/[:.]/g,'-'),run=join(evidence,'runs',id);mkdirSync(run,{recursive:true});
const work=mkdtempSync(join(os.tmpdir(),'navi-suite-'));
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const files=folder=>existsSync(folder)?readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(['node_modules','temp','__pycache__','.aidiy_backup'].includes(e.name)?[]:files(join(folder,e.name))):[join(folder,e.name)]):[];
const snapshot=folders=>Object.fromEntries(folders.flatMap(folder=>files(join(root,folder))).map(file=>[relative(root,file).replaceAll('\\','/'),{sha256:hash(file),bytes:statSync(file).size}]));
const source=snapshot(['frontend_ide/src','frontend_ide/scripts','frontend_ide/checks','frontend_ide/ファイル機能']);
// viewerの依存物・生成物を走査せず、実装ソースだけを含める。
for(const dir of ['frontend_ide/viewer','frontend_ide/host/src'])for(const file of files(join(root,dir)).filter(p=>!/[\\/](?:node_modules|dist|temp|__pycache__)[\\/]/.test(p)&&/\.(?:mjs|cjs|js|ts)$/.test(p)))source[relative(root,file).replaceAll('\\','/')]={sha256:hash(file),bytes:statSync(file).size};
source['frontend_ide/server.mjs']={sha256:hash(join(root,'frontend_ide/server.mjs'))};
for(const p of ['frontend_ide/package.json','frontend_ide/package-lock.json','frontend_ide/node_modules/vue/package.json','frontend_ide/node_modules/@vue/compiler-sfc/package.json','frontend_ide/node_modules/esbuild/package.json','frontend_ide/node_modules/ws/package.json'])source[p]={sha256:hash(join(root,p)),version:p.includes('node_modules')?JSON.parse(readFileSync(join(root,p),'utf8')).version:undefined};
const distribution=snapshot(['frontend_ide/dist','frontend_ide/host/dist/aidiy_code']);
writeFileSync(join(run,'versions.json'),JSON.stringify({source,distribution},null,2));
const shared=[join(root,'_config/AiDiy_key.json'),join(os.homedir(),'.aidiy/aidiy_navi_model.json')];
const protectedBefore=shared.map(p=>existsSync(p)?hash(p):null);
const chrome=process.env.CHROME_PATH||[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).map(p=>join(p,'Google/Chrome/Application/chrome.exe')).find(existsSync);
if(!chrome)throw Error('CHROME_PATHが必要です。');
const report={at:new Date().toISOString(),scope:'現行模擬7本の予定全工程。過去8本の再現・原因調査・解消判定ではない。',platform:process.platform,os:os.release(),node:process.version,chrome,invocation:[process.execPath,...process.argv.slice(1)],cwd:root,runDirectory:relative(evidence,run),plan:cases.map(([name,expected])=>({name,expected})),excluded:[{name:'check-navigation-desktop',status:'NOT_RUN',reason:'通常工程は実AI。寸法限定だけの成功を通し成功に数えない。'},{name:'check-navigation-goal',status:'NOT_RUN',reason:'実AI呼出しあり'},{name:'check-navigation-project',status:'NOT_RUN',reason:'実AI呼出しあり'},{name:'check-navigation-real',status:'NOT_RUN',reason:'実AI呼出しあり'}],results:[]};
if(process.platform==='win32')report.browserVersion=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-Item -LiteralPath $env:CHROME_PATH).VersionInfo.ProductVersion'],{env:{...process.env,CHROME_PATH:chrome},encoding:'utf8',windowsHide:true}).trim();
writeFileSync(join(run,'plan.json'),JSON.stringify(report,null,2));
for(const [name,expected]of selected){
 const out=join(run,name);mkdirSync(out,{recursive:true});
 const isolated=join(work,String(cases.findIndex(([item])=>item===name)));mkdirSync(isolated);
 for(const dir of ['temporary','profile','appdata','localappdata'])mkdirSync(join(isolated,dir),{recursive:true});
 const observer=pathToFileURL(join(root,'frontend_ide/checks/navigation-mock-observer.mjs')).href;
 const args=['--import',observer,join(root,'frontend_ide/scripts',name+'.mjs')];
 const env={...process.env,CHROME_PATH:chrome,HOME:join(isolated,'profile'),USERPROFILE:join(isolated,'profile'),APPDATA:join(isolated,'appdata'),LOCALAPPDATA:join(isolated,'localappdata'),TMP:join(isolated,'temporary'),TEMP:join(isolated,'temporary'),AIDIY_NAVIGATION_MOCK_OUTPUT:join(out,'output'),AIDIY_TEST_NAVIGATION_STEP4_OUTPUT:join(out,'diagnostics'),AIDIY_NAVIGATION_MOCK_AUDIT:join(out,'audit.ndjson')};
 for(const key of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA'])if(process.env[key])env['AIDIY_MOCK_BROWSER_'+key]=process.env[key];
 delete env.NODE_OPTIONS;
 const startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',timedOut=false;
 child.stdout.on('data',d=>{stdout+=d;writeFileSync(join(out,'stdout.txt'),stdout);});child.stderr.on('data',d=>{stderr+=d;writeFileSync(join(out,'stderr.txt'),stderr);});
 const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');},180000);
 const termination=await new Promise(done=>child.once('exit',(exitCode,signal)=>done({exitCode,signal})));clearTimeout(timer);
 writeFileSync(join(out,'stdout.txt'),stdout);writeFileSync(join(out,'stderr.txt'),stderr);
 const audit=existsSync(join(out,'audit.ndjson'))?readFileSync(join(out,'audit.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 const blocked=audit.filter(e=>e.event.startsWith('blocked'));
 const result={name,expected,command:process.execPath,args,cwd:root,environment:{CHROME_PATH:chrome,HOME:env.HOME,USERPROFILE:env.USERPROFILE,APPDATA:env.APPDATA,LOCALAPPDATA:env.LOCALAPPDATA,TMP:env.TMP,TEMP:env.TEMP,AIDIY_NAVIGATION_MOCK_OUTPUT:env.AIDIY_NAVIGATION_MOCK_OUTPUT,AIDIY_TEST_NAVIGATION_STEP4_OUTPUT:env.AIDIY_TEST_NAVIGATION_STEP4_OUTPUT,AIDIY_NAVIGATION_MOCK_AUDIT:env.AIDIY_NAVIGATION_MOCK_AUDIT,NODE_OPTIONS:'removed'},startedAt,endedAt:new Date().toISOString(),...termination,timedOut,status:termination.exitCode===0&&!timedOut&&!blocked.length?'PASS':'FAIL',lastStage:stdout.split('\n').filter(s=>s.startsWith('STAGE:')).at(-1)||null,blocked,loadedAssets:audit.filter(e=>e.event==='loadedAsset'),childProcesses:audit.filter(e=>['spawn','childExit'].includes(e.event)),stdout:'stdout.txt',stderr:'stderr.txt'};
 writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));report.results.push(result);writeFileSync(join(run,'result.json'),JSON.stringify(report,null,2));console.log(name+': '+result.status+' exit='+result.exitCode+' '+(result.lastStage||''));
}
if(selected.length===cases.length){
 const args=['--test',...['navigation-layout.test.mjs','navigation-recovery.test.mjs','navigation-button-input.test.mjs','navigation-scene-menu.test.mjs','navigation-scene-picker.test.mjs','navigation-autopilot-ui.test.mjs','navigation-cancel-ui.test.mjs','navigation-size.test.cjs'].map(p=>join(root,'frontend_ide/checks',p))];
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
 writeFileSync(join(run,'supporting-checks.stdout.txt'),result.stdout||'');writeFileSync(join(run,'supporting-checks.stderr.txt'),result.stderr||'');
 report.supportingChecks={command:process.execPath,args,cwd:root,exitCode:result.status,signal:result.signal,error:result.error?.message,status:result.status===0?'PASS':'FAIL'};console.log('SUPPORTING: '+report.supportingChecks.status);
}
report.sharedConfigurationUnchanged=shared.every((p,i)=>(existsSync(p)?hash(p):null)===protectedBefore[i]);
report.sourceVersionsStable=Object.entries(source).every(([p,value])=>existsSync(join(root,p))&&hash(join(root,p))===value.sha256);
report.distributionVersionsStable=Object.entries(distribution).every(([p,value])=>existsSync(join(root,p))&&hash(join(root,p))===value.sha256);
report.allSevenExecuted=report.results.length===cases.length;report.selectionVerdict=report.results.every(r=>r.status==='PASS')&&report.supportingChecks?.status!=='FAIL'&&report.sharedConfigurationUnchanged&&report.sourceVersionsStable&&report.distributionVersionsStable?'PASS':'FAIL';report.verdict=report.allSevenExecuted&&report.selectionVerdict==='PASS'?'PASS':'INCOMPLETE_OR_FAIL';
report.externalAIRequests=0;report.coreAppsRestarted=false;report.existingUserWindowsOperated=false;
writeFileSync(join(run,'result.json'),JSON.stringify(report,null,2));writeFileSync(join(evidence,'latest-run.json'),JSON.stringify({runDirectory:report.runDirectory,verdict:report.verdict},null,2));
console.log('SUITE: '+report.verdict+' '+run);process.exitCode=report.selectionVerdict==='PASS'?0:1;
