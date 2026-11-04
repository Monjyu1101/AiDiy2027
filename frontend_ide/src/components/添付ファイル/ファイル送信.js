// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { MAX_FILE_BYTES, MAX_FILE_COUNT, validateFileUpload } from '../../../host/src/file-attachments';

export async function readDroppedFiles(fileList, { isCurrent, onFile }) {
 const files=Array.from(fileList||[]);
 if(!files.length)return 0;
 if(files.length>MAX_FILE_COUNT)throw Error(`一度に送信できるファイルは${MAX_FILE_COUNT}件までです。`);
 // 一部送ってからサイズ違反に気づかないよう、読込前に全件を確かめる。
 for(const file of files){
  if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>MAX_FILE_BYTES)throw Error('ファイルは空でない4 MiB以下のものを選んでください。');
  validateFileUpload({name:file.name,base64:'AA=='});
 }
 let count=0;
 const current=()=>{if(!isCurrent())throw Error('接続または会話が変わったため、残りのファイル送信を中止しました。');};
 for(const file of files){
  current();const buffer=await file.arrayBuffer();current();
  if(buffer.byteLength!==file.size)throw Error('ファイルサイズが読込中に変わりました。');
  const bytes=new Uint8Array(buffer);let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  const upload=validateFileUpload({name:file.name,base64:btoa(binary)});
  current();const result=await onFile(upload);if(result===false)throw Error('ファイルを送信できませんでした。');count++;
 }
 return count;
}
