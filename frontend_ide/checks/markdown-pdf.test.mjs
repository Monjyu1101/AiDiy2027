// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createExplorerFiles} from '../ファイル機能/explorer-files.mjs';
import {renderMarkdownPdf} from '../ファイル機能/MarkdownPDF.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'aidiy-pdf-test-'));t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});});await mkdir(join(root,'資料'));await writeFile(join(root,'資料','日本語.MD'),'# 日本語\n\n本文');return root;}
const pdf=Buffer.from('%PDF-1.4\nfixture');
test('PDF化は同じフォルダ・同名で作成し、元Markdownを保持して既存PDFを上書きする',async t=>{
 const root=await fixture(t);let count=0,changed=0;
 const service=createExplorerFiles(root,{pdfRenderer:async input=>{count++;assert.equal(input.path,'資料/日本語.MD');return pdf;},onChange:()=>changed++});
 const result=await service.apply({action:'pdf',path:'資料/日本語.MD'});
 assert.equal(result.path,'資料/日本語.pdf');assert.equal(result.type,'file');assert.equal(changed,1);
 assert.deepEqual(await readFile(join(root,result.path)),pdf);assert.equal(await readFile(join(root,'資料/日本語.MD'),'utf8'),'# 日本語\n\n本文');
 await writeFile(join(root,result.path),'old PDF');
 await service.apply({action:'pdf',path:'資料/日本語.MD'});assert.equal(count,2);assert.equal(changed,2);assert.deepEqual(await readFile(join(root,result.path)),pdf);
});
test('PDF化は対象外・外部パス・生成失敗・途中変更・利用終了時に出力しない',async t=>{
 const root=await fixture(t);await writeFile(join(root,'a.txt'),'text');let active=true;
 const service=createExplorerFiles(root,{state:()=>({active}),pdfRenderer:async()=>{throw Object.assign(Error('failed'),{status:503});}});
 for(const path of ['a.txt','資料','../outside.md'])await assert.rejects(service.apply({action:'pdf',path}));
 await assert.rejects(service.apply({action:'pdf',path:'資料/日本語.MD'}),{status:503});
 const edited=createExplorerFiles(root,{pdfRenderer:async()=>{await writeFile(join(root,'資料/日本語.MD'),'updated content');return pdf;}});
 await assert.rejects(edited.apply({action:'pdf',path:'資料/日本語.MD'}),{status:409});
 active=false;await assert.rejects(service.apply({action:'pdf',path:'資料/日本語.MD'}),{status:503});
 assert.deepEqual(await readdir(join(root,'資料')),['日本語.MD']);
});
test('PDF化中に作られた同名PDFも上書きする',async t=>{
 const root=await fixture(t),service=createExplorerFiles(root,{pdfRenderer:async()=>{await writeFile(join(root,'資料/日本語.pdf'),'keep');return pdf;}});
 await service.apply({action:'pdf',path:'資料/日本語.MD'});assert.deepEqual(await readFile(join(root,'資料/日本語.pdf')),pdf);
});
test('実Electronでプレビューの見出し・日本語・表・相対画像をPDF化', {skip:process.env.AIDIY_TEST_PDF_RENDER!=='1'},async t=>{
 const root=await fixture(t);await writeFile(join(root,'資料','図.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#38bdf8"/></svg>');
 await writeFile(join(root,'資料','日本語.MD'),'# PDF化の確認\n\n日本語の本文です。\n\n|項目|結果|\n|---|---|\n|日本語|成功|\n\n![相対画像](図.svg)\n\n```js\nconsole.log("hello");\n```');
 const service=createExplorerFiles(root);const result=await service.apply({action:'pdf',path:'資料/日本語.MD'});const bytes=await readFile(join(root,result.path));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);
});

test('生成失敗は既存PDFを保持し、同名フォルダは置換しない',async t=>{
 const root=await fixture(t),target=join(root,'資料/日本語.pdf');await writeFile(target,'original');
 const service=createExplorerFiles(root,{pdfRenderer:async()=>{throw Error('failed');}});
 await assert.rejects(service.apply({action:'pdf',path:'資料/日本語.MD'}));assert.equal(await readFile(target,'utf8'),'original');
 await rm(target);await mkdir(target);
 await assert.rejects(createExplorerFiles(root,{pdfRenderer:async()=>pdf}).apply({action:'pdf',path:'資料/日本語.MD'}),{code:'not_file'});
 assert.deepEqual((await readdir(join(root,'資料'))).sort(),['日本語.MD','日本語.pdf'].sort());
});

// Electron本体だけを隔離Node子プロセスに置き換え、IPC・終了通知・プレビュー・清掃は本番処理を通す。
for(const mode of ['signal','exit','error','pdf'])test(`PDF worker ${mode}: 終了を待ち直さず清掃し、次のExplorer操作を実行する`,async t=>{
 const root=await fixture(t),target=join(root,'資料/日本語.pdf');await writeFile(target,'original PDF');
 let child,observed,request,next;
 const launchWorker=env=>{
  child=spawn(process.execPath,['-e',`
   process.once('message',async({url,profile})=>{
    const response=await fetch(url);if(!response.ok)process.exit(9);
    process.send({type:'observed',url,profile});
    const mode=${JSON.stringify(mode)};
    if(mode==='signal')process.send({type:'terminate'});
    else if(mode==='exit')process.exit(7);
    else process.send(mode==='error'?{type:'error'}:{type:'pdf',data:${JSON.stringify(pdf.toString('base64'))}});
   });
   process.send({type:'ready'});
  `],{env,stdio:['ignore','ignore','ignore','ipc']});
  child.on('message',message=>{if(message?.type==='observed')observed=message;else if(message?.type==='terminate')child.kill('SIGTERM');});
  return child;
 };
 const service=createExplorerFiles(root,{pdfRenderer:input=>renderMarkdownPdf(input,{launchWorker})});
 t.after(async()=>{
  service.close();
  if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  // 旧実装でassertionが失敗しても、待ち直したexitを解放しテスト用サーバーを残さない。
  if(child?.exitCode!==null||child?.signalCode!==null)child?.emit('exit',child.exitCode,child.signalCode);
  await Promise.allSettled([request,next]);
 });
 request=service.apply({action:'pdf',path:'資料/日本語.MD'});
 const settled=request.then(value=>({value}),error=>({error}));
 next=service.apply({action:'create-file',directory:'資料',name:'次の操作.txt'});
 let timer;
 const [result]=await Promise.race([
  Promise.all([settled,next]),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PDF終了後にExplorerの待ち行列が進みません。')),5000);}),
 ]).finally(()=>clearTimeout(timer));
 if(mode==='pdf'){assert.equal(result.value.path,'資料/日本語.pdf');assert.deepEqual(await readFile(target),pdf);}
 else{assert.equal(result.error.code,'pdf_failed');assert.equal(result.error.status,503);assert.equal(await readFile(target,'utf8'),'original PDF');}
 if(mode==='signal')assert.equal(child.signalCode,'SIGTERM');
 assert.ok(child.exitCode!==null||child.signalCode!==null,'worker process exited');
 assert.ok(observed,'worker received the preview URL and temporary profile');
 await assert.rejects(stat(observed.profile),{code:'ENOENT'});
 await assert.rejects(fetch(observed.url,{signal:AbortSignal.timeout(1000)}));
 assert.equal(await readFile(join(root,'資料','次の操作.txt'),'utf8'),'');
 assert.deepEqual((await readdir(join(root,'資料'))).sort(),['日本語.MD','日本語.pdf','次の操作.txt'].sort());
});
