// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawnDesktop} from '../デスクトップ/desktop-process.mjs';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
import {toolsTarget} from '../ファイル機能/ai-search.mjs';
const project=await mkdtemp(join(tmpdir(),'aidiy-browser-standalone-')),output=resolve('.aidiy_cache/selftest/aidiy_browser');await mkdir(output,{recursive:true});
await writeFile(join(project,'index.html'),'<!doctype html><meta charset="utf-8"><title>Browser単独起動試験</title><style>body{background:#123047;color:#bffff1;font:24px sans-serif;padding:32px}input{font:inherit}</style><h1>AiDiy Browser</h1><p>単独起動とMCPの日本語入力</p><input id="probe" aria-label="確認入力">');
const app=await startDevelopment(project,{kind:'browser'}),tools=new URL(await toolsTarget(project)).origin;
const env={...process.env,AIDIY_DEVELOPMENT_KIND:'browser',AIDIY_DEVELOPMENT_URL:app.url,AIDIY_DEVELOPMENT_PROJECT:project};delete env.ELECTRON_RUN_AS_NODE;
let child;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(let i=0;i<50;i++){if((await fetch(new URL('api/connection',app.url)).then(r=>r.json())).connected)break;await delay(100);}
 child=spawnDesktop(electronExecutable(),[fileURLToPath(new URL('../desktop.cjs',import.meta.url))],{env});const exit=once(child,'exit');
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser表示待ちがタイムアウトしました。')),20000);child.on('message',value=>{if(value.windowShown){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});});
 const directory=fileURLToPath(new URL('../../backend_tools/temp/_ide_browser_sessions/',import.meta.url));let manifest;
 for(let i=0;i<100&&!manifest;i++){
  for(const name of await readdir(directory)){if(!name.endsWith('.json'))continue;try{const value=JSON.parse(await readFile(join(directory,name),'utf8'));if(value.pid===child.pid)manifest=value;}catch{}}
  if(!manifest)await delay(100);
 }
 assert.ok(manifest);assert.match(manifest.name,/^aidiy_browser [a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
 const call=async(method,params={})=>{const response=await fetch(tools+'/aidiy_chrome_devtools/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:manifest.name,...params}),signal:AbortSignal.timeout(20000)});const value=await response.json();assert.equal(response.ok,true);assert.equal(value.error,undefined,JSON.stringify(value));return value;};
 const url=pathToFileURL(join(project,'index.html')).href;
 await call('navigate',{url,show_automation_banner:false});await call('type_text',{selector:'#probe',text:'単独Browserの入力を確認'});
 const result=await call('eval_js',{expression:'document.querySelector("#probe").value'});assert.ok(JSON.stringify(result).includes('単独Browserの入力を確認'));
 await call('screenshot',{save_path:join(output,'Browser_101_単独Web画面.png'),shutter_sounds:'none'});
 const windows=await fetch(tools+'/aidiy_desktop_capture/list_windows',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json());
 const candidates=windows.windows.filter(w=>w.title==='AiDiy Browser');
 assert.equal(candidates.length,1,'同名タイトルの別Browserを撮影しないため、単独Browserがこの試験の1窓だけの状態で確認してください。');
 const window=candidates[0];
 const shot=await fetch(tools+'/aidiy_desktop_capture/screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({window_title:window.title,save_path:join(output,'Browser_101_単独起動.png'),shutter_sounds:'none'})}).then(r=>r.json());assert.equal(shot.error,undefined,JSON.stringify(shot));
 await call('close_session');const [code]=await exit;assert.equal(code,0);
 const summary={testPassed:true,session:manifest.name,japaneseInput:true,capture:true,closed:true};await writeFile(join(output,'standalone-result.json'),JSON.stringify(summary));console.log(JSON.stringify(summary));
}finally{
 if(child&&child.exitCode===null)child.kill();await app.close();assert.ok(resolve(project).startsWith(resolve(tmpdir())+sep));await rm(project,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
