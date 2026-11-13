// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import http from 'node:http';
import {openBrowserMemos} from '../memo/browser.mjs';
import {createMemoHandler} from '../memo/http.mjs';
import {DIAG_TRANSPORT_BYTE_LIMIT} from '../runtime/transport_limit.mjs';
import {createToolsSettingsBridge,createToolsRepresentativeBridge,TOOLS_SETTINGS_ACTIONS,TOOLS_SETTINGS_BODY_LIMIT,BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS,TOOLS_REPRESENTATIVE_BYTE_LIMIT} from './Tools/設定接続.mjs';
import {createCoreSettingsBridge,AI_SETTINGS_ACTIONS,AI_SETTINGS_BODY_LIMIT} from './AI設定/コア設定接続.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile,realpath,stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { catalog, scan, probe, cancelProbes } from './診断/probes.mjs';
import {getToolsStatus} from './診断/tools_status.mjs';
import {createModelTrials,PREDICTION_ROW_TIMEOUT_MS} from './モデル試行/trials.mjs';
import {browserMode,desktopBinary,openDesktop,closeDesktop,readDesktopDisplay} from './起動/desktop.mjs';
import {createPublicModelCache} from './モデル情報/public_models.mjs';
import {getKeyStatus,testKey,KEY_PROVIDERS,INTEGRATION_PROBES,cancelKeyProbes} from './モデル情報/key_status.mjs';
import {verify as verifyUi} from '../ui/verify.mjs';
import {stopRevision,watchStop} from './起動/lifecycle.mjs';
import {launchDetached} from './起動/launch.mjs';
import {headlessMain,writeInstallReport,INSTALL_FILE} from './診断/headless.mjs';
import {writeIntegrationInfo,INTEGRATION_FILE} from './モデル情報/integration_info.mjs';
import {writeModelsInfo} from './モデル情報/models_info.mjs';
import {createPreviousResults} from './診断/前回結果.mjs';
import {createInstallManager} from './導入管理/導入管理.mjs';
import {createStartManager} from './起動/サービス管理.mjs';
import {createAppLauncher} from './起動/アプリ起動.mjs';
import {createCliLauncher} from './起動/CLI起動.mjs';
import {createVSCodeLauncher} from './起動/VSCode起動.mjs';
import {createPortStatusChecker} from './起動/ポート状態.mjs';
import {createWebBrowserOpener} from './起動/Webブラウザ.mjs';

// 同じkeep-alive socketの複数要求が先後逆に終わっても、最後の待機終了時だけ復元する。
const backupResponseTimeouts=new WeakMap();
function extendBackupResponseTimeout(req){
 const socket=req.socket;if(!socket||typeof socket.setTimeout!=='function')return ()=>{};
 let state=backupResponseTimeouts.get(socket);
 if(!state){state={previous:socket.timeout,users:0};backupResponseTimeouts.set(socket,state);}
 // ServerResponse.setTimeout は未割当のpipeline応答に遅延listenerを残すので使わない。
 state.users++;socket.setTimeout(BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS);
 let released=false;
 return ()=>{if(released)return;released=true;if(--state.users)return;backupResponseTimeouts.delete(socket);if(Number.isFinite(state.previous)&&!socket.destroyed&&socket.timeout===BACKUP_REPRESENTATIVE_RESPONSE_TIMEOUT_MS)socket.setTimeout?.(state.previous);};
}

// 外部例外の本文・パス・引数はログへ出さず、固定の原因分類だけを表示する。
const STARTUP_MESSAGES=Object.freeze({
  ARGUMENTS:'起動引数が不正です。aidiy_diag --help で指定方法を確認してください。',
  UI:'Vue UI のソースと配布物が一致しないか不足しています。同じ版の backend_diag を取得し直してください。UI を編集した場合は backend_diag/ui で npm ci && npm run build を実行してください。',
  ELECTRON:'Electron が未準備です。python backend_diag/_setup.py を実行するか --browser を指定してください。',
  DESKTOP:'Electron を起動できません。--browser でブラウザ起動できます。',
  CATALOG:'catalog.json または coverage.json を読み込めません。同じ版の backend_diag を取得し直してください。',
  EADDRINUSE:'指定ポートは使用中です。--port 0 で空きポートを使用してください。',
  EACCES:'ローカル待受の権限がありません。--port 0 または OS のアクセス設定を確認してください。'
});
function startupError(code){return Object.assign(new Error('Diagnostic startup failed'),{diagCode:code});}
export function startupMessage(error){return '診断を起動できません。'+((Object.hasOwn(STARTUP_MESSAGES,error?.diagCode) && STARTUP_MESSAGES[error.diagCode]) || (Object.hasOwn(STARTUP_MESSAGES,error?.code) && STARTUP_MESSAGES[error.code]) || '起動処理でエラーが発生しました。診断ファイルの配置とアクセス権を確認してください。');}

export function basePath(value) {
  if (value === '/') return '/';
  if (!/^\/[A-Za-z0-9_/-]+\/?$/.test(value) || value.includes('//')) throw new Error('base-path は /proxy/8097/ のように指定してください。');
  return value.replace(/\/+$/, '') + '/';
}
export function publicUrl(port, prefix, env = process.env) {
  const name = env.CODESPACE_NAME || '', domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || '';
  if (env.CODESPACES === 'true' && /^[a-zA-Z0-9-]+$/.test(name) && /^[a-zA-Z0-9.-]+$/.test(domain)) return `https://${name}-${port}.${domain}${prefix}`;
  return `http://127.0.0.1:${port}${prefix}`;
}
export function parseArgs(args) {
  const options = {port:0, prefix:'/', noOpen:false, browser:false, help:false};
  for (let i=0;i<args.length;i++) {
    const arg = args[i];
    if (arg === '--memo-only') {options.memoOnly = true;continue;}
    if (arg === '--new') {options.newMemo = true;continue;}
    if (arg === '--browser') {options.browser = true;continue;}
    if (arg === '--headless') {options.headless = true;continue;}
    if (arg === '--auto') {options.auto = true;continue;}
    if (arg === '--foreground' || arg === '--wait') options.foreground = true;
    else if (arg === '--no-open') options.noOpen = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') { const value = args[++i]; if (!/^\d+$/.test(value || '') || Number(value)>65535) throw new Error('port は 0〜65535 で指定してください。'); options.port=Number(value); }
    else if (arg === '--base-path') options.prefix = basePath(args[++i] || '');
    else throw new Error(`不明な引数: ${arg}`);
  }
  // ヘッドレスは画面・待受を持たないため、表示・待受系の指定とは併用しない。
  if (options.headless && args.some(arg=>arg!=='--headless' && arg!=='--help' && arg!=='-h')) throw new Error('--headless は単独で指定してください。');
  if(options.newMemo&&!options.memoOnly)throw Error('--new は aidiy_memo 専用です。');
  if(options.memoOnly&&args.some(arg=>!['--memo-only','--new','--foreground','--wait','--help','-h'].includes(arg)))throw Error('aidiy_memo はシステム付箋だけを扱います。');
  return options;
}
export function createHandler({token, prefix='/', entries=[], coverage={}, scanFn=scan, probeFn=probe, toolsStatusFn=getToolsStatus, keyStatusFn=getKeyStatus, keyTestFn=testKey, publicCache=createPublicModelCache(), installWriteFn=writeInstallReport, modelsWriteFn=writeModelsInfo, integrationWriteFn=writeIntegrationInfo, modelTrials=createModelTrials(), previousResults, startManager=createStartManager(), appLauncher,getLaunchDisplay,memoStore,launchRoot=process.cwd(),systemRoot=fileURLToPath(new URL('../../',import.meta.url)),getLaunchRoot,isNormalEnabled=()=>true,cliLauncher=createCliLauncher(),vscodeLauncher=createVSCodeLauncher(),portStatusFn=createPortStatusChecker(),webBrowserOpenFn=createWebBrowserOpener({portStatusFn}),installManagerFactory=createInstallManager,coreSettingsBridge=createCoreSettingsBridge(),toolsSettingsBridge=createToolsSettingsBridge(),toolsRepresentativeBridge=createToolsRepresentativeBridge()}) {
  appLauncher ??= createAppLauncher({portStatusFn,webBrowserOpenFn,getLaunchDisplay});
  const memoHandler=createMemoHandler({appLauncher,launchRoot,memoStore,systemRoot,getLaunchRoot,isNormalEnabled});
  let results = [], busy = false, writing = false, scanStarted = null, scanFinished = null, modelResults = {}, modelWriting = false, progress = [], integrationResults = {}, integrationWriting = false;
  const individualProbes = new Set(), keyBusy = new Set(), keyProgress = new Map();
  const hasBody = req => req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0');
  const recordInstallResult=(result,started=new Date())=>{
    const byId=new Map(results.map(item=>[item.id,item]));byId.set(result.id,result);
    results=entries.flatMap(item=>byId.has(item.id)?[byId.get(item.id)]:[]);
    scanStarted ??= started;scanFinished=new Date();
    return {前回実行日時:scanFinished.toISOString(),確認済み:results.length===entries.length};
  };
  const management=installManagerFactory({entries,probeFn,onResult:recordInstallResult});

  const assets = new Map([['',['index.html','text/html; charset=utf-8']],['app.js',['app.js','text/javascript; charset=utf-8']],['style.css',['style.css','text/css; charset=utf-8']],['AiDiy_diag.png',['AiDiy_diag.png','image/png']]]);
  for(const name of ['memo.html','memo.js','memo.css'])assets.set(name,[name,name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8']);
  assets.set('Chrome.svg',['Chrome.svg','image/svg+xml']);
  assets.set('AiDiy.png',['AiDiy.png','image/png']);
  for(const id of ['avatar','ide','cpu','navi','console','code','live','task','team','browser','discord','slack','memo'])assets.set(`AiDiy_${id}.png`,[`AiDiy_${id}.png`,'image/png']);
  for(const id of ['claude','codex','copilot','agy','grok','opencode','aidiy_hermes','vscode'])assets.set(`CLI_${id}.png`,[`CLI_${id}.png`,'image/png']);
  for(const id of ['claude','codex','copilot','agy','grok','opencode','vscode'])assets.set(`CLI_${id}.svg`,[`CLI_${id}.svg`,'image/svg+xml']);
  assets.set('LICENSE_ICONS.md',['LICENSE_ICONS.md','text/markdown; charset=utf-8']);
  for(const name of ['LICENSE-Octicons.txt','LICENSE-LobeHub.txt','LICENSE-OpenCode.txt'])assets.set(name,[name,'text/plain; charset=utf-8']);
  const handler=async (req,res) => {
    const reply = (status, body, type='application/json; charset=utf-8') => {
      if (res.destroyed) return;
      const content = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      res.writeHead(status, {'Content-Type':type,'Content-Length':content.length,'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':(route==='memo.html'?"img-src 'self' data:; ":'')+"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(content);
    };
    let route;
    try { const url = new URL(req.url,'http://localhost'); const pathname = decodeURIComponent(url.pathname); route = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null; if (url.search) return reply(400,{エラー:'クエリ引数は指定できません。'}); }
    catch { return reply(400,{エラー:'URL が不正です。'}); }
    const auth = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + token);
    const authorized = auth.length === expected.length && timingSafeEqual(auth,expected);
    try {
      if (route?.startsWith('api/') && !authorized) return reply(401,{エラー:'起動時の認証キーを入力してください。'});
      if(route?.startsWith('api/')&&!isNormalEnabled()&&route!=='api/メモ/単体'&&!route.startsWith('api/メモ/単体/'))return reply(403,{エラー:'単体起動ではシステムメモだけ利用できます。'});
      if(await memoHandler(req,route,reply))return;
      if(route?.startsWith('api/AI設定/')||route?.startsWith('api/Tools/')){
        const isTools=route.startsWith('api/Tools/');
        const action=route.slice((isTools?'api/Tools/':'api/AI設定/').length);
        const isRepresentative=isTools&&action==='representative';
        const actions=isRepresentative?{representative:true}:isTools?TOOLS_SETTINGS_ACTIONS:AI_SETTINGS_ACTIONS;
        const bodyLimit=isRepresentative?TOOLS_REPRESENTATIVE_BYTE_LIMIT:isTools?TOOLS_SETTINGS_BODY_LIMIT:AI_SETTINGS_BODY_LIMIT;
        const bridge=isRepresentative?(_action,body,options)=>toolsRepresentativeBridge(body,options):isTools?toolsSettingsBridge:coreSettingsBridge;
        if(!Object.hasOwn(actions,action))return reply(404,{エラー:'操作が見つかりません。'});
        if(req.method!=='POST')return reply(405,{エラー:'POST を使用してください。'});
        if(req.headers['sec-fetch-site']==='cross-site')return reply(403,{エラー:'同じ画面から操作してください。'});
        if(req.headers.origin){
          try{if(new URL(req.headers.origin).host!==req.headers.host)return reply(403,{エラー:'同じ画面から操作してください。'});}
          catch{return reply(403,{エラー:'送信元が不正です。'});}
        }
        if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
        if(Number(req.headers['content-length'])>bodyLimit)return reply(413,{エラー:'入力が大きすぎます。'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>bodyLimit)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
        let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
        const backupResponse=isRepresentative&&body?.data?.operation==='test'&&body?.data?.tool==='aidiy_backup';
        const restoreTimeout=backupResponse?extendBackupResponseTimeout(req):()=>{};
        const controller=new AbortController();const cancel=()=>controller.abort();res.on?.('close',cancel);
        try{return reply(200,await bridge(action,body,{signal:controller.signal}));}
        catch(error){return reply(error.status||503,{エラー:error.status?error.message:'Core への接続を確認してください。'});}
        finally{res.off?.('close',cancel);restoreTimeout();}
      }
      if(route==='api/導入管理'&&req.method==='GET')return reply(200,await management.snapshot());
      if(route?.startsWith('api/導入管理/')&&['POST','DELETE'].includes(req.method)){
        if(hasBody(req))return reply(400,{エラー:'導入操作への引数は指定できません。'});
        const parts=route.slice('api/導入管理/'.length).split('/');
        try{
          if(req.method==='DELETE'&&parts.length===1)return reply(200,await management.cancel(parts[0]));
          if(req.method!=='POST'||parts.length!==2)return reply(404,{エラー:'見つかりません。'});
          // 別項目の導入操作とは並行できる。同じ項目の重複は management.start が拒否する。
          if(busy||individualProbes.size||writing)return reply(409,{エラー:'診断・書込の実行中です。完了後に再試行してください。'});
          return reply(200,await management.start(parts[0],parts[1]));
        }catch(error){return reply(error.status||500,{エラー:error.status?error.message:'導入操作でエラーが発生しました。'});}
      }
      if(route==='api/CLI起動'&&req.method==='GET'){try{return reply(200,{対象:[...(await cliLauncher.catalog()).対象,await vscodeLauncher.catalog()]});}catch(error){return reply(error.status||500,{エラー:error.status?error.message:'CLIの一覧を確認できませんでした。'});}}
      if(['api/CLI起動/開始','api/VSCode起動/開始'].includes(route)&&req.method==='POST'){
        const editor=route==='api/VSCode起動/開始';
        if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>DIAG_TRANSPORT_BYTE_LIMIT)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!(editor?['フォルダ']:['対象','フォルダ','自動承認確認']).includes(key)))return reply(400,{エラー:'入力が不正です。'});
        try{return reply(202,(editor?await vscodeLauncher.launch(body.フォルダ):await cliLauncher.launch(body.対象,body.フォルダ,body.自動承認確認)));}
        catch(error){return reply(error.status||500,{エラー:error.status?error.message:'CLIの起動処理に失敗しました。'});}
      }
      if(route==='api/アプリ起動'&&req.method==='GET')return reply(200,await appLauncher.catalog());
      if(route?.startsWith('api/アプリ起動/')&&req.method==='POST'){
        if(!['api/アプリ起動/開始','api/アプリ起動/フォルダ'].includes(route))return reply(404,{エラー:'見つかりません。'});
        if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>DIAG_TRANSPORT_BYTE_LIMIT)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
        const keys=route.endsWith('/開始')?['対象','フォルダ']:['フォルダ'];
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))return reply(400,{エラー:'入力が不正です。'});
        try{return route.endsWith('/開始')?reply(202,await appLauncher.launch(body.対象,body.フォルダ)):reply(200,await appLauncher.folders(body.フォルダ));}
        catch(error){return reply(error.status||500,{エラー:error.status?error.message:'アプリの起動処理に失敗しました。'});}
      }
      if(route==='api/起動'&&req.method==='GET')return reply(200,await startManager.snapshot());
      if(route==='api/起動/ポート'&&req.method==='GET'){
        if(hasBody(req))return reply(400,{エラー:'入力は指定できません。'});
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return reply(200,await portStatusFn({signal:controller.signal}));}finally{res.off('close',abort);}
      }
      if(route?.startsWith('api/起動/')&&req.method==='POST'){
        if(!['api/起動/設定','api/起動/再起動','api/起動/停止','api/起動/強制停止','api/起動/ログ','api/起動/ブラウザ'].includes(route))return reply(404,{エラー:'見つかりません。'});
        if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>DIAG_TRANSPORT_BYTE_LIMIT)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
        if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{エラー:'入力が不正です。'});
        const keys=route.endsWith('/ブラウザ')||route.endsWith('/強制停止')?[]:route.endsWith('/設定')?['対象','設定']:route.endsWith('/ログ')?['対象','位置']:['対象'];
        if(Object.keys(body).some(key=>!keys.includes(key)))return reply(400,{エラー:'指定できない項目があります。'});
        try{
          if(route.endsWith('/ブラウザ')){
            const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
            try{return reply(200,await webBrowserOpenFn({signal:controller.signal}));}finally{res.off('close',abort);}
          }
          if(route.endsWith('/設定'))return reply(200,await startManager.save(body.対象,body.設定));
          if(route.endsWith('/強制停止'))return reply(202,await startManager.forceStopAll());
          if(route.endsWith('/再起動')){if(body.対象!==undefined&&typeof body.対象!=='string')return reply(400,{エラー:'起動対象が不正です。'});return reply(202,await startManager.restart(body.対象));}
          if(typeof body.対象!=='string')return reply(400,{エラー:'起動対象が不正です。'});
          if(route.endsWith('/停止'))return reply(200,await startManager.stop(body.対象));
          return reply(200,await startManager.logSnapshot(body.対象,body.位置??0));
        }catch(error){return reply(error.status||500,{エラー:error.status?error.message:'起動処理に失敗しました。コンソールを確認してください。'});}
      }
      if (req.method==='GET' && route?.startsWith('api/モデル試行/音声/')) {
        const id=route.slice('api/モデル試行/音声/'.length);
        if(!/^[a-f0-9]{32}$/.test(id))return reply(404,{エラー:'音声が見つかりません。'});
        const bytes=await modelTrials.audio(id);
        return bytes?reply(200,bytes,'audio/wav'):reply(404,{エラー:'音声の保存期限が切れたか、音声が見つかりません。'});
      }
      if(req.method==='GET' && /^api\/モデル試行\/[a-f0-9]{32}\/経過$/.test(route||'')){
        try{return reply(200,modelTrials.progress(route.split('/')[2]));}catch(error){return reply(error?.status||500,{エラー:error?.status?error.message:'経過を取得できませんでした。'});}
      }
      if(route==='api/AIモデル'&&req.method==='GET')return reply(200,await modelTrials.catalogs());
      if(route==='api/AIモデル/開始'&&req.method==='POST'){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
          const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>DIAG_TRANSPORT_BYTE_LIMIT)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
          let manual;try{manual=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
          if(!manual||typeof manual!=='object'||Array.isArray(manual))return reply(400,{エラー:'入力が不正です。'});
          if(Object.hasOwn(manual,'items')){if(Object.keys(manual).length!==1)return reply(400,{エラー:'一括試行の入力が不正です。'});return reply(200,await modelTrials.start({signal:controller.signal,manuals:manual.items}));}
          return reply(200,await modelTrials.start({signal:controller.signal,manual}));
        }catch(error){return reply(error?.status||500,{エラー:error?.status?error.message:'試行を開始できませんでした。'});}
        finally{res.removeListener('close',abort);}
      }
      if (route === 'api/モデル試行' && req.method === 'GET') return reply(200,await modelTrials.snapshot());
      if (route?.startsWith('api/モデル試行/') && ['POST','DELETE'].includes(req.method)) {
        if (hasBody(req)) return reply(400,{エラー:'モデル試行への引数は指定できません。'});
        const parts=route.split('/').slice(2);
        const controller=new AbortController();
        const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try {
          if(req.method==='DELETE' && parts.length===1 && parts[0]==='チャット成功'){modelTrials.invalidateChat?.();return reply(200,{状態:'未実施'});}
          if(req.method==='POST' && parts.length===1 && parts[0]==='開始')return reply(200,await modelTrials.start({signal:controller.signal}));
          if(req.method==='POST' && parts.length===2 && parts[0]==='開始' && /^(CHAT|LIVE|PREDICTION|DECISION|CODE[1-6]|(?:TASK|TEAM)_(?:plan|do|check))$/.test(parts[1]))return reply(200,await modelTrials.start({signal:controller.signal,rowId:parts[1]}));
          if(!/^[a-f0-9]{32}$/.test(parts[0]))return reply(404,{エラー:'試行が見つかりません。'});
          if(req.method==='DELETE' && parts.length===1)return reply(200,modelTrials.cancel(parts[0]));
          if(req.method==='POST' && parts.length===2 && /^(CHAT|LIVE|PREDICTION|DECISION|CODE[1-6]|(?:TASK|TEAM)_(?:plan|do|check))$/.test(parts[1]))return reply(200,await modelTrials.next(parts[0],parts[1],{signal:controller.signal}));
          return reply(404,{エラー:'試行が見つかりません。'});
        } catch(error) {return reply(error?.status || 500,{エラー:error?.status ? error.message : 'モデル試行に失敗しました。'});}
        finally {res.removeListener('close',abort);}
      }
      if (req.method === 'GET' && route === 'api/tools-status') {
        const controller=new AbortController();
        const abort=()=>controller.abort();res.once('close',abort);
        try {const state=await toolsStatusFn({signal:controller.signal});return reply(200,{online:state.online===true});}
        finally {res.removeListener('close',abort);}
      }
      if (req.method === 'GET' && route === 'api/一覧') {
        const previous=(await previousResults?.snapshot())?.導入状況;
        // 個別確認後も、未確認の行は保存済みの表示を維持する。保存対象には混ぜない。
        const byId=new Map([...(previous?.結果||[]),...results].map(item=>[item.id,item]));
        return reply(200,{項目:entries,結果:entries.flatMap(entry=>byId.has(entry.id)?[byId.get(entry.id)]:[]),前回実行日時:scanFinished?.toISOString()||previous?.前回実行日時||null,調査:coverage});
      }
      // 明示的に読み直す側だけ破棄し、別タブの確認結果は書込まで保持する。
      if (req.method === 'GET' && ['api/キー設定','api/キー設定/モデル一覧','api/キー設定/外部連携'].includes(route)) {
        if(keyBusy.size)return reply(409,{エラー:'個別確認中です。設定の再読込は完了後に実行してください。'});
        if(route!=='api/キー設定/外部連携'&&!modelWriting){modelResults={};modelTrials.invalidateChat?.();}
        if(route!=='api/キー設定/モデル一覧'&&!integrationWriting)integrationResults={};
        return reply(200,{...await keyStatusFn(),前回結果:await previousResults?.snapshot(),公開モデル:publicCache.snapshot()});
      }
      if (req.method === 'GET' && route === 'api/公開モデル') return reply(200,publicCache.snapshot());
      if (req.method === 'POST' && route === 'api/公開モデル/再取得') {
        if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return reply(400,{エラー:'公開モデル取得への引数は指定できません。'});
        modelTrials.invalidateChat?.();return reply(200,await publicCache.refresh());
      }
      if (req.method === 'GET' && route === 'api/キーテスト/進捗') return reply(200,{項目:[...keyProgress].map(([id,状態])=>({id,状態}))});
      if (req.method === 'POST' && route?.startsWith('api/キーテスト/')) {
        const id=route.slice('api/キーテスト/'.length);
        if (!KEY_PROVIDERS.some(provider=>provider.id===id)) return reply(404,{エラー:'未対応の項目です。'});
        if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return reply(400,{エラー:'キーテストへの引数は指定できません。'});
        if (keyBusy.has(id) || modelWriting || integrationWriting) return reply(409,{エラー:'キーテスト実行中です。完了後に再試行してください。'});
        modelTrials.invalidateChat?.();keyBusy.add(id);
        // 外部連携（Hugging Face / Discord）の認証確認はモデル情報の保存対象にしない。
        const integration=INTEGRATION_PROBES.includes(KEY_PROVIDERS.find(provider=>provider.id===id)?.probe);
        const controller=new AbortController();
        const disconnected=()=>{if(!res.writableEnded)controller.abort();};
        res.on?.('close',disconnected);keyProgress.set(id,'待機中');
        try {const result=await keyTestFn(id,{publicCache:publicCache.input(),installResults:results,signal:controller.signal,onState:state=>{if(!controller.signal.aborted)keyProgress.set(id,state);}});if(controller.signal.aborted)return;if(integration&&['OK','NG','PASS','未実施'].includes(result?.状態)&&!integrationWriting)integrationResults={...integrationResults,[id]:result};if(!integration&&(['OK','NG','PASS'].includes(result?.状態)||(id==='ollama'&&result?.スキップ===true&&result?.状態==='未実施'))&&!modelWriting)modelResults={...modelResults,[id]:result};const date=new Date().toISOString();reply(200,{...result,前回実行日時:date});} finally {res.off?.('close',disconnected);keyProgress.delete(id);keyBusy.delete(id);}
        return;
      }
      // 確認中に終わった項目だけを返す（画面の逐次表示用。引数・任意コマンドは受け付けない）。
      if (req.method === 'GET' && route === 'api/診断/進捗') return reply(200,{実行中:busy,結果:busy?progress:[]});
      // 登録済みの1項目だけを同じ固定 probe で再確認する。任意コマンド・引数は受け付けない。
      if (req.method === 'POST' && route?.startsWith('api/診断/')) {
        const entry=entries.find(item=>item.id===route.slice('api/診断/'.length));
        if (!entry) return reply(404,{エラー:'未対応の項目です。'});
        if (hasBody(req)) return reply(400,{エラー:'診断への引数は指定できません。'});
        if (busy || individualProbes.has(entry.id) || writing || management.busy()) return reply(409,{エラー:'この項目の確認・一括診断・書込・導入操作の実行中です。'});
        individualProbes.add(entry.id);
        const started=new Date();
        try {
          const result=await probeFn(entry);
          const state=recordInstallResult(result,started);management.invalidate();
          reply(200,{結果:result,...state});
        } finally { individualProbes.delete(entry.id); }
        return;
      }
      if (req.method === 'POST' && route === 'api/診断') {
        if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return reply(400,{エラー:'診断への引数は指定できません。'});
        if (busy || individualProbes.size || writing || management.busy()) return reply(409,{エラー:'診断・書込・導入操作の実行中です。完了後に再試行してください。'});
        busy=true;
        try { results=[];progress=[];scanFinished=null;scanStarted=new Date();results=await scanFn(entries,async entry=>{const result=await probeFn(entry);progress=[...progress,result];return result;});scanFinished=new Date();management.invalidate();reply(200,{結果:results,前回実行日時:scanFinished.toISOString()}); } finally { busy=false;progress=[]; }
        return;
      }
      // モデル情報: このサーバーが直前に取得したキーテスト結果だけを、プロバイダ別ファイルへ保存する。
      if (req.method === 'POST' && route === 'api/モデル書込') {
        if (hasBody(req)) return reply(400,{エラー:'書込への引数は指定できません。'});
        if (keyBusy.size || modelWriting) return reply(409,{エラー:'モデル取得または書込の実行中です。完了後に再試行してください。'});
        if (!Object.keys(modelResults).length) return reply(409,{エラー:'先に最新モデル取得を実行してください。'});
        modelTrials.invalidateChat?.();modelWriting=true;
        try { const status=await keyStatusFn();const saved=await modelsWriteFn(status.項目,modelResults); reply(200,{保存先:saved.map(file=>'_AIDIY/aidiy_diag/'+file),件数:saved.length}); }
        catch { reply(500,{エラー:'モデル情報の書き込みに失敗しました。書き込めなかったファイルは以前の内容のままです。'}); }
        finally { modelWriting=false; }
        return;
      }
      // 外部連携: このサーバーが直前に確認した認証結果だけを保存する（画面の値・キーは受け取らない）。
      if (req.method === 'POST' && route === 'api/外部連携書込') {
        if (hasBody(req)) return reply(400,{エラー:'書込への引数は指定できません。'});
        if (keyBusy.size || integrationWriting) return reply(409,{エラー:'確認または書込の実行中です。完了後に再試行してください。'});
        if (!Object.keys(integrationResults).length) return reply(409,{エラー:'先に外部連携の状況確認を実行してください。'});
        integrationWriting=true;
        try { const status=await keyStatusFn();const report=await integrationWriteFn(status.項目,integrationResults); reply(200,{保存先:'_AIDIY/aidiy_diag/'+INTEGRATION_FILE,件数:report.件数,集計:report.集計}); }
        catch { reply(500,{エラー:'書き込みに失敗しました。既存のファイルは変更していません。'}); }
        finally { integrationWriting=false; }
        return;
      }
      // 画面からは値を受け取らず、このサーバーが直前に確認した結果だけを保存する。
      if (req.method === 'POST' && route === 'api/書込') {
        if (hasBody(req)) return reply(400,{エラー:'書込への引数は指定できません。'});
        if (busy || individualProbes.size || writing || management.busy()) return reply(409,{エラー:'診断・書込・導入操作の実行中です。完了後に再試行してください。'});
        if (!scanFinished || results.length !== entries.length) return reply(409,{エラー:'先にインストール確認を実行してください。'});
        writing=true;
        try { const report=await installWriteFn(entries,results,scanStarted,scanFinished); reply(200,{保存先:'_AIDIY/aidiy_diag/'+INSTALL_FILE,件数:report.件数,集計:report.集計}); }
        catch { reply(500,{エラー:'書き込みに失敗しました。既存のファイルは変更していません。'}); }
        finally { writing=false; }
        return;
      }
      if (req.method === 'GET' && assets.has(route)) {
        const [file,type] = assets.get(route); return reply(200,await readFile(new URL('../static/'+file,import.meta.url)),type);
      }
      reply(404,{エラー:'見つかりません。'});
    } catch { reply(500,{エラー:'診断処理でエラーが発生しました。'}); }
  };
  handler.close=()=>management.close();
  return handler;
}
export function createServer(options) {
  const modelTrials=options.modelTrials || createModelTrials();
  const startManager=options.startManager || createStartManager();
  const handler=createHandler({...options,modelTrials,startManager});
  const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000,connectionsCheckingInterval:1000},handler);
  server.once('close',()=>{modelTrials.close();void startManager.close();void handler.close();});
  server.maxConnections=16; server.maxRequestsPerSocket=20; server.keepAliveTimeout=2000;
  // 診断は最大 4 並列 × 登録数分。slow connection は下の期限で切断する。
  // 予測の試行（2ターン＋予測）は1回の要求で最長 PREDICTION_ROW_TIMEOUT_MS かかる。
  server.setTimeout(Math.max(95000,PREDICTION_ROW_TIMEOUT_MS+5000,Math.ceil((options.entries?.length || 0)/4)*5000+5000),socket=>socket.destroy());
  server.on('clientError',(_err,socket)=>socket.destroy());
  return server;
}
// --auto: 画面表示と並行して「設定起動」を1回だけ実行する。直前の停止でポート解放が遅れる場合だけ待って再試行する。
export async function autoStart(startManager,{retries=20,interval=500,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const revision=startManager.startRevision();
  startManager.beginAutoStart?.(revision);
  for(let attempt=0;;attempt++){
    if(startManager.startRevision()!==revision)return false;
    try{await startManager.restart(undefined,{revision});return true;}
    catch(error){
      // 停止・手動再起動・終了の通知を古い自動起動の失敗で上書きしない。
      if(startManager.startRevision()!==revision)return false;
      if(error?.status!==409||attempt>=retries){const message='自動起動できませんでした。'+(error?.status?error.message:'コンソールを確認してください。');startManager.notify(message);startManager.failAutoStart?.(revision,message);return false;}
    }
    await wait(interval);
  }
}
function openBrowser(url) {
  // 固定 OS opener + 単一 URL 引数。Windows shell を必要とする start は使わない。
  let command,args;
  if (process.platform === 'darwin') { command='open';args=[url]; }
  else if (process.platform === 'win32') { command='rundll32.exe';args=['url.dll,FileProtocolHandler',url]; }
  else { command='xdg-open';args=[url]; }
  const child=spawn(command,args,{stdio:'ignore',shell:false,windowsHide:true});
  child.on('error',()=>console.log('自動で開けない場合は、上の URL をブラウザで開いてください。')); child.unref();
}
export async function main(args=process.argv.slice(2)) {
  const launcherChild=process.env.AIDIY_DIAG_LAUNCHER_CHILD==='1' && !!process.send;
  // 検証・読込中に起動元が消えた場合も、常駐処理へ進まない。
  const startupDisconnect=()=>process.exit(1);
  if(launcherChild){if(!process.connected)throw startupError('DESKTOP');process.once('disconnect',startupDisconnect);}
  let options;try {options=parseArgs(args);}catch {throw startupError('ARGUMENTS');}
  if (options.help) { console.log('AiDiy 診断: aidiy_diag [--auto] [--browser] [--no-open] [--foreground | --wait] [--port 8097] [--base-path /proxy/8097/]\n            aidiy_diag --headless   画面を開かず全診断を実行し _AIDIY/aidiy_diag/ へ保存\n            --auto                  画面を開き、保存済みの起動設定で「設定起動」を自動実行'); return; }
  if (options.headless) { process.exitCode = await headlessMain(); return; }
  if (!await verifyUi()) throw startupError('UI');
  const useBrowser=!options.memoOnly&&browserMode(options);
  if (!useBrowser && !options.foreground) return launchDetached(args);
  let executable;
  if (!useBrowser) {
    try {executable=await desktopBinary();}
    catch {throw startupError('ELECTRON');}
  }
  const initialStop=await stopRevision();
  const token=randomBytes(32).toString('base64url');
  let entries,coverage;
  try {entries=await catalog();coverage=JSON.parse(await readFile(new URL('./診断/coverage.json',import.meta.url),'utf8'));}
  catch {throw startupError('CATALOG');}
  const publicCache=createPublicModelCache();
  const startManager=createStartManager();
  let desktop;
  const systemRoot=fileURLToPath(new URL('../../',import.meta.url));
  let normalEnabled=!options.memoOnly,normalLaunchRoot=options.memoOnly?systemRoot:process.cwd();
  const promote=async cwd=>{
    if(normalEnabled)return true;
    if(typeof cwd!=='string'||!path.isAbsolute(cwd)||cwd.length>4096||/[\0\r\n]/.test(cwd))return false;
    try{const root=await realpath(cwd);if(!(await stat(root)).isDirectory())return false;normalLaunchRoot=root;normalEnabled=true;void publicCache.refresh();return true;}catch{return false;}
  };
  const server=createServer({token,prefix:options.prefix,entries,coverage,publicCache,startManager,systemRoot,isNormalEnabled:()=>normalEnabled,getLaunchRoot:()=>normalLaunchRoot,previousResults:createPreviousResults(),getLaunchDisplay:()=>readDesktopDisplay(desktop)});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',resolve);});
  // 公開一覧だけを起動時に取得。キー設定や他 provider の API は自動で呼ばない。
  if(normalEnabled)void publicCache.refresh();
  const url=publicUrl(server.address().port,options.prefix)+'#token='+token;
  let stopWatching=()=>{}, closed=false, ready=false, existing=false;
  const onRelease=message=>{if(message?.type==='diag-launch-release' && ready)process.off('disconnect',close);};
  const close=()=>{
    if(closed)return;closed=true;
    stopWatching();cancelProbes();cancelKeyProbes();closeDesktop(desktop);server.close();server.closeAllConnections();
    process.off('SIGINT',close);process.off('SIGTERM',close);process.off('disconnect',close);process.off('message',onRelease);
    if(launcherChild && process.connected) {
      if(!ready)process.send(existing?{type:'diag-launch-existing'}:{type:'diag-launch-error',code:'DESKTOP'},()=>{if(process.connected)process.disconnect();});
      else process.disconnect();
    }
  };
  const notifyReady=()=>{
    if(closed || ready)return;ready=true;
    if(launcherChild && process.connected)process.send({type:'diag-launch-ready'},error=>{if(error)close();});
  };
  if(launcherChild){process.off('disconnect',startupDisconnect);process.once('disconnect',close);process.on('message',onRelease);}
  process.once('SIGINT',close);process.once('SIGTERM',close);
  if (useBrowser) {
    console.log('AiDiy 診断: '+url);
    console.log('この起動中のみ有効な認証 URL です。共有せず、転送ポートは非公開にしてください。Ctrl+C で終了。');
    if (!options.noOpen && process.env.CODESPACES !== 'true') {openBrowser(url);void openBrowserMemos({url,open:openBrowser,isClosed:()=>closed}).catch(()=>console.error('保存済みメモを開けませんでした。Diag の +メモ から再試行してください。'));}
  } else {
    console.log((options.memoOnly?'AiDiy Memo':'AiDiy 診断')+': Electron ウィンドウを開きます。Ctrl+C で終了。');
    // 既に起動中なら、そのウィンドウを前面に出してこの起動は正常終了する。
    const onExisting=()=>{existing=true;if(!launcherChild)console.log((options.memoOnly?'AiDiy Memo':'AiDiy 診断')+'は既に起動しています。既存のウィンドウを前面に表示しました。');close();};
    try {desktop=openDesktop(executable,url,close,undefined,undefined,notifyReady,onExisting,{memoOnly:options.memoOnly===true,newMemo:options.newMemo===true,onPromote:promote});} catch {close();throw startupError('DESKTOP');}
  }
  stopWatching=watchStop(initialStop,close);
  server.once('close',()=>stopWatching());
  if (options.auto && !closed) void autoStart(startManager);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(startupMessage(error));process.exitCode=1;if(process.env.AIDIY_DIAG_LAUNCHER_CHILD==='1' && process.connected)process.send({type:'diag-launch-error',code:error.diagCode || error.code},()=>process.disconnect());});
