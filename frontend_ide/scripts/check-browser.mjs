// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDevelopment} from '../server.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
import {toolsTarget} from '../ファイル機能/ai-search.mjs';
const project=mkdtempSync(join(tmpdir(),'aidiy-browser-project-')),profile=mkdtempSync(join(tmpdir(),'aidiy-browser-profile-'));
writeFileSync(join(project,'index.html'),'<!doctype html><html lang="ja"><meta charset="UTF-8"><title>宇宙ブラウザ検証</title><link rel="stylesheet" href="style.css"><h1>宇宙からWebへ</h1><p>HTMLのブラウザ表示</p><a href="next.htm">次のページ</a></html>');
writeFileSync(join(project,'next.htm'),'<!doctype html><html lang="ja"><meta charset="UTF-8"><title>次のページ</title><link rel="stylesheet" href="style.css"><h1>相対リンクで移動しました</h1><a href="index.html" target="_blank">新しいリンク</a></html>');
writeFileSync(join(project,'style.css'),'body{background:#0a1428;color:#dbeeff;font:20px sans-serif;padding:40px}h1{color:#61ddff}a{color:#9edfff}');
writeFileSync(join(project,'宇宙 # 100%.html'),'<!doctype html><meta charset="UTF-8"><title>特殊名HTML</title><link rel="stylesheet" href="style.css"><h1>絶対パスからの表示</h1>');
// 登録されたHTMLだけがWebルートへ進むことを、実Electronの起動IPCで確認する。
const routedServer=createServer((req,res)=>{
 if(req.url==='/@vite/client'){res.end('// vite fixture');return;}
 if(decodeURI(req.url)==='/登録画面/表示'){res.writeHead(302,{Location:'/registered.html'});res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>AiDiy登録ページ</title><style>body{background:#102138;color:#bcefff;padding:40px;font:22px sans-serif}</style><h1>登録ルートから表示しました</h1>');
});
await new Promise(resolve=>routedServer.listen(0,'127.0.0.1',resolve));
for(const path of ['src/router','public'])mkdirSync(join(project,'frontend_web',path),{recursive:true});
writeFileSync(join(project,'frontend_web/vite.config.ts'),`const PORT_WEB = ${routedServer.address().port}`);
writeFileSync(join(project,'frontend_web/src/router/index.ts'),`const routes=[createStaticAliasRoute('/登録画面/表示','registered.html','登録画面')];`);
writeFileSync(join(project,'frontend_web/public/registered.html'),'<title>file表示ではないこと</title>');
const server=await startDevelopment(project);
try{
 const tools=await toolsTarget(project);
 const ping=await fetch(new URL('ping',tools),{signal:AbortSignal.timeout(3000)});if(!ping.ok)throw Error('toolsを起動してから実行してください。');
 const env={...process.env,AIDIY_TOOLS_ORIGIN:new URL(tools).origin,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'ide',AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/browser-desktop-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 let result;child.on('message',value=>{if(value.testPassed)result=value;});
 const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Browser確認失敗: ${code}`);console.log(JSON.stringify(result,null,2));
}finally{
 await server.close();
 await new Promise(resolve=>routedServer.close(resolve));
 for(const folder of [project,profile]){if(!resolve(folder).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
