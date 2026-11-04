// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {registeredHTMLRoute} from '../viewer/登録HTMLルート.mjs';
import browser from '../デスクトップ/ブラウザ.cjs';

test('登録HTMLのみルート表示、一般HTMLは絶対パス、停止中は理由を表示',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aidiy-html-route-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 async function put(path,text){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);}
 await put('frontend_web/src/router/index.ts',`
 // createStaticAliasRoute('/除外', '未登録.html', '除外'),
 const routes=[createStaticAliasRoute('/動画/宇宙 # 100%', '動画/index.html', '動画'),
 {path:'/ゲーム/表示',component:()=>import('../components/ゲーム.vue')}];
 `);
 await put('frontend_web/src/components/ゲーム.vue','<script setup>const frameSrc = `${baseUrl}ゲーム/index.html`;</script><template><iframe :src="frameSrc"></iframe></template>');
 for(const path of ['動画/index.html','ゲーム/index.html','未登録.html'])await put('frontend_web/public/'+path,'<h1>テスト</h1>');
 await put('docs/index.html','<h1>通常HTML</h1>');
 assert.equal(await registeredHTMLRoute(root,'frontend_web/public/動画/index.html'),'/動画/宇宙 # 100%');
 assert.equal(await registeredHTMLRoute(root,'frontend_web/public/ゲーム/index.html'),'/ゲーム/表示');
 for(const path of ['docs/index.html','frontend_web/public/未登録.html'])assert.equal(await browser.browserFileTarget(root,path),pathToFileURL(join(root,path)).href);
 const server=createServer((req,res)=>{res.writeHead(req.url==='/@vite/client'?200:404);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port;
 await put('frontend_web/vite.config.ts',`const PORT_WEB = ${port}`);
 assert.equal(await browser.browserFileTarget(root,'frontend_web/public/動画/index.html'),`http://127.0.0.1:${port}/`+['動画','宇宙 # 100%'].map(encodeURIComponent).join('/'));
 await new Promise(resolve=>server.close(resolve));
 await assert.rejects(browser.browserFileTarget(root,'frontend_web/public/ゲーム/index.html'),/frontend_web.*起動/);
 await assert.rejects(browser.browserFileTarget(root,'../outside.html'));
 await assert.rejects(browser.browserFileTarget(root,'frontend_web/public/存在しない.html'));
});

test('実際のAiDiy登録：別名HTMLとiframe画面、未登録の除外',async()=>{
 const root=new URL('../../',import.meta.url);
 const {fileURLToPath}=await import('node:url');
 assert.equal(await registeredHTMLRoute(fileURLToPath(root),'frontend_web/public/Xアバター訓練中/index.html'),'/Xその他/Xアバター訓練中/表示');
 assert.equal(await registeredHTMLRoute(fileURLToPath(root),'frontend_web/public/Xテトリス/index.html'),'/Xその他/Xテトリス/ゲーム');
 assert.equal(await registeredHTMLRoute(fileURLToPath(root),'docs/index.html'),null);
});

test('音声・動画: Browser で開け、AiDiy 保守中の public は正式なリンク、それ以外は file:// で開く',async t=>{
 for(const path of ['a.html','曲.mp3','声.opus','動画.MP4','clip.webm','x.mov'])assert.equal(await browser.browserOpenable(path),true,path);
 for(const path of ['a.txt','a.mkv','a.avi','a.png'])assert.equal(await browser.browserOpenable(path),false,path);
 const root=await mkdtemp(join(tmpdir(),'aidiy-media-route-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 async function put(path,text){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);}
 for(const path of ['frontend_web/public/動画/宇宙 # 1.mp4','docs/曲.mp3'])await put(path,'media');
 const fileURL=path=>pathToFileURL(join(root,path)).href;
 const server=createServer((req,res)=>{res.writeHead(req.url==='/@vite/client'?200:404);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 // frontend_web の Vite 設定がないフォルダは AiDiy とみなさず file:// で開く。
 assert.equal(await browser.browserFileTarget(root,'frontend_web/public/動画/宇宙 # 1.mp4'),fileURL('frontend_web/public/動画/宇宙 # 1.mp4'));
 await put('frontend_web/vite.config.ts',`const PORT_WEB = ${port}`);
 assert.equal(await browser.browserFileTarget(root,'frontend_web/public/動画/宇宙 # 1.mp4'),`http://127.0.0.1:${port}/`+['動画','宇宙 # 1.mp4'].map(encodeURIComponent).join('/'));
 assert.equal(await browser.browserFileTarget(root,'docs/曲.mp3'),fileURL('docs/曲.mp3'));
 // frontend_web が止まっていても、HTML と違い file:// で再生できる。
 await new Promise(resolve=>server.close(resolve));
 assert.equal(await browser.browserFileTarget(root,'frontend_web/public/動画/宇宙 # 1.mp4'),fileURL('frontend_web/public/動画/宇宙 # 1.mp4'));
 await assert.rejects(browser.browserFileTarget(root,'frontend_web/public/存在しない.mp4'));
});
