// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 明示選択したFileだけを読み、サーバーのプロジェクト境界は広げない。
export function projectFilePath(root, full) {
  if (!root || !full) return null;
  const normalize = value => value.replaceAll('\\', '/').replace(/\/$/, '');
  const base = normalize(root), path = normalize(full);
  const windows = /^[a-z]:/i.test(base);
  if (!(windows ? path.toLowerCase().startsWith(base.toLowerCase() + '/') : path.startsWith(base + '/'))) return null;
  const relative = path.slice(base.length + 1);
  return relative && relative.split('/').every(part => part && part !== '.' && part !== '..') ? relative : null;
}
export async function describeSelectedFile(file) {
  const extension = file.name.split('.').at(-1).toLowerCase(), size = file.size;
  const format = {docx:'word',dotx:'word',xlsx:'excel',xls:'excel',xlsm:'excel',ods:'excel',csv:'excel',tsv:'excel',pptx:'powerpoint',pptm:'powerpoint',pdf:'pdf'}[extension];
  if (format) return {kind:'office',format,size,tooLarge:size>50*1024*1024};
  if (['png','jpg','jpeg','gif','webp','bmp','ico'].includes(extension)) return {kind:'image',size,tooLarge:size>20*1024*1024};
  if (['mp3','wav','ogg','oga','opus','flac','aac','m4a','mp4','m4v','webm','mov'].includes(extension)) return {kind:'media',size,tooLarge:size>50*1024*1024};
  const bytes = new Uint8Array(await file.slice(0,1024*1024).arrayBuffer());
  if (bytes.subarray(0,8192).includes(0)) return {kind:'binary',size};
  let text, encoding='UTF-8';
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { encoding='Shift_JIS';text=new TextDecoder('shift_jis').decode(bytes); }
  return {kind:'text',size,text,encoding,truncated:size>bytes.length};
}
