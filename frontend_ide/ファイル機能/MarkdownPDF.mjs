// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createPreview} from '../viewer/preview.mjs';

function launchMarkdownPdfWorker(env){
 const executable=createRequire(new URL('../viewer/package.json',import.meta.url))('electron');
 return spawn(executable,[fileURLToPath(new URL('./MarkdownPDF-worker.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
}

// Web版からも既存のElectronを使う。画面・保存ダイアログは開かない。
export async function renderMarkdownPdf({root,path},{launchWorker=launchMarkdownPdfWorker}={}){
 const preview=createPreview(root),profile=await mkdtemp(join(tmpdir(),'aidiy-md-pdf-'));
 let child;
 try{
  const url=await preview.url(path);
  if(!url)throw Error('このMarkdownはPDF化できません。');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;delete env.NODE_PATH;
  child=launchWorker(env);
  const pdf=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('PDF化がタイムアウトしました。')),60000);
   const finish=(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);};
   child.on('message',message=>{
    if(message?.type==='ready')child.send({url,profile});
    else if(message?.type==='pdf'&&typeof message.data==='string'&&message.data.length<70*1024*1024)finish(null,Buffer.from(message.data,'base64'));
    else if(message?.type==='error')finish(Error('PDF化に失敗しました。Markdownと画像の読み込み状態を確認してください。'));
   });
   child.once('error',()=>finish(Error('PDF化用のElectronを起動できません。IDEのセットアップを確認してください。')));
   child.once('exit',()=>finish(Error('PDF化用のプロセスが終了しました。')));
  });
  if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('PDFの生成結果を確認できません。');
  return pdf;
 }catch(error){throw Object.assign(error,{status:503,code:'pdf_failed'});}
 finally{
  // シグナル終了ではexitCodeはnullのまま。発生済みのexitを再待機しない。
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await exited;}
  await preview.close();
  if(dirname(resolve(profile))!==resolve(tmpdir())||!basename(profile).startsWith('aidiy-md-pdf-'))throw Error('PDF用一時フォルダの場所を確認できません。');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
