// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 完了した総合テストのMarkdownを、画像・折りたたみ欄を含むPDFにする。
// node docs/セルフテスト、操作ガイド/_tools/総合テストPDF.mjs <docs/セルフテスト、操作ガイド内のmd名> ...
// PDFは元のMarkdownと同じフォルダへ、拡張子だけを.pdfに替えて保存する。
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {resolve,join,basename,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const knowledge=join(root,'docs','セルフテスト、操作ガイド');
const runtime=process.env.AIDIY_DOCUMENT_NODE_MODULES||join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
const require=createRequire(join(root,'frontend_ide','package.json'));
const MarkdownIt=require('markdown-it');
const {chromium}=await import(pathToFileURL(join(runtime,'playwright-core','index.mjs')).href);
const sources=process.argv.slice(2);if(!sources.length)throw Error('対象のmd名を指定してください');
const temp=join(root,'tmp','pdfs');
await mkdir(temp,{recursive:true});
const md=new MarkdownIt({html:true,linkify:true});
const chrome=join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe');await access(chrome);
const browser=await chromium.launch({executablePath:chrome,headless:true});
try{
 for(const name of sources){
  const source=resolve(knowledge,name);if(!source.startsWith(knowledge+sep)||!source.endsWith('.md'))throw Error('docs/セルフテスト、操作ガイド内のMarkdownを指定してください');
  let html=md.render(await readFile(source,'utf8'));
  const page=await browser.newPage();
  await page.setContent('<!doctype html><html lang="ja"><meta charset="utf-8"><base href="'+pathToFileURL(dirname(source)+sep).href+'"><body>'+html+'</body></html>');
  // file:画像をローカルHTMLから読む。キャプションと画像を1つの図にまとめる。
  html=await page.evaluate(()=>{
   for(const image of document.images)image.src=new URL(image.getAttribute('src'),document.baseURI).href;
   for(const a of document.querySelectorAll('a'))a.href=new URL(a.getAttribute('href'),document.baseURI).href;
   for(const d of document.querySelectorAll('details'))d.open=true;
   for(const t of document.querySelectorAll('table')){
    if(t.rows.length<=10)t.classList.add('small-table');
    // ケースIDが「10 / 1」のように折り返されない幅を確保する。
    if(['ID','ケース','計画ID'].includes(t.rows[0]?.cells[0]?.textContent.trim()))for(const row of t.rows){
     row.cells[0].style.whiteSpace='nowrap';row.cells[0].style.minWidth='10mm';
    }
   }
   const title=document.querySelector('h1');if(title)title.innerHTML=title.innerHTML.replace(' — ','<br>');
   // 最終の短い記録方法が数行だけ次ページへ分かれないようにする。
   const record=[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('試験の記録方法'));
   if(record){const section=document.createElement('section');section.style.breakInside='avoid';record.before(section);let item=record;while(item){const next=item.nextElementSibling;section.append(item);item=next;}}
   for(const p of [...document.querySelectorAll('p')])if(p.children.length===1&&p.firstElementChild.tagName==='IMG'){
    const f=document.createElement('figure');const previous=p.previousElementSibling;
    // 番号付きの図では、その直前の説明も同じページに保持する。
    if(previous?.tagName==='P'&&/^図\d+/.test(previous.textContent.trim())){
     const description=previous.previousElementSibling;
     if(description?.tagName==='P'){const c=document.createElement('figcaption');c.innerHTML=description.innerHTML;f.append(c);description.remove();}
    }
    if(previous?.tagName==='P'){const c=document.createElement('figcaption');c.innerHTML=previous.innerHTML;f.append(c);previous.remove();}
    p.replaceWith(f);f.append(p.firstElementChild);
   }
   return document.body.innerHTML;
  });
  const css=`@page{size:A4;margin:17mm 16mm 19mm}*{box-sizing:border-box}body{font-family:"Yu Gothic","Meiryo",sans-serif;font-size:9.5pt;line-height:1.65;color:#172b3b;margin:0}h1{font-size:19pt;line-height:1.4;margin:0 0 7mm;border-bottom:2px solid #167b85;padding-bottom:4mm}h2{font-size:14pt;margin:8mm 0 3mm;border-left:4px solid #167b85;padding-left:3mm}h3{font-size:11pt;margin:5mm 0 2mm}h1,h2,h3,summary{break-after:avoid}p{margin:2.5mm 0;orphans:3;widows:3}li{margin:1mm 0}a{color:#176f81;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:8.6pt;line-height:1.55;margin:3mm 0}th,td{border:1px solid #b9cbd1;padding:2mm;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf4f5;text-align:left}tr{break-inside:avoid}.small-table{break-inside:avoid}thead{display:table-header-group}code{font-size:8.5pt;overflow-wrap:anywhere;white-space:normal}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:8pt;background:#edf3f5;padding:3mm}blockquote{border-left:2px solid #89b7c0;margin:3mm 0;padding:1mm 4mm;background:#f1f7f8}figure{margin:4mm 0 6mm;break-inside:avoid}figure img{display:block;max-width:100%;width:auto;max-height:165mm;object-fit:contain;margin:2mm auto;border:1px solid #bdcdd3}figcaption{font-size:9pt;line-height:1.6;margin-bottom:2mm}summary{font-weight:bold;list-style:none;margin:4mm 0 2mm}details{display:block}strong{font-weight:700}`;
  const file=join(temp,basename(source,'.md')+'.html');await writeFile(file,'<!doctype html><html lang="ja"><meta charset="utf-8"><style>'+css+'</style><body>'+html+'</body></html>','utf8');
  await page.goto(pathToFileURL(file).href);await page.evaluate(()=>document.fonts.ready);
  const images=await page.evaluate(async()=>{await Promise.all([...document.images].map(async i=>{try{await i.decode();}catch{throw Error('画像を読み込めません: '+i.src);}}));return [...document.images].map(i=>({src:i.src,ok:i.naturalWidth>0}));});
  if(images.some(i=>!i.ok))throw Error('読めない画像があります');
  const pdf=join(dirname(source),basename(source,'.md')+'.pdf');
  await page.pdf({path:pdf,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;margin:0 16mm;color:#637580;display:flex;justify-content:space-between"><span>AiDiy 総合テスト実施記録</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
  console.log(JSON.stringify({pdf,images:images.length}));await page.close();
 }
}finally{await browser.close();}
