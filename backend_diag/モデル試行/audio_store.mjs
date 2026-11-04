// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Live の試行音声だけを短時間保持する。外部指定のファイル名・パスは受け取らない。
import {mkdir,mkdtemp,lstat,chmod,open,unlink,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const AUDIO_LIMIT=44+30*48000; // 最大30秒の PCM24k mono16 WAV
export const AUDIO_TTL_MS=10*60*1000;
export const AUDIO_MAX_FILES=16;
const BASE=fileURLToPath(new URL('../../_temp/',import.meta.url));
const invalid=()=>new Error('Invalid trial audio');
export function validateAudio(audio) {
  if(audio?.mime!=='audio/wav' || typeof audio.data_base64!=='string' || audio.data_base64.length>Math.ceil(AUDIO_LIMIT/3)*4 || (audio.data_base64.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data_base64)))throw invalid();
  const bytes=Buffer.from(audio.data_base64,'base64');
  // Tools が生成する固定 PCM WAV のみ。宣言サイズ・時間ではなく実バイトから検証する。
  if(bytes.length<44+48000 || bytes.length>AUDIO_LIMIT || bytes.toString('ascii',0,4)!=='RIFF' || bytes.readUInt32LE(4)!==bytes.length-8 || bytes.toString('ascii',8,12)!=='WAVE' || bytes.toString('ascii',12,16)!=='fmt ' || bytes.readUInt32LE(16)!==16 || bytes.readUInt16LE(20)!==1 || bytes.readUInt16LE(22)!==1 || bytes.readUInt32LE(24)!==24000 || bytes.readUInt32LE(28)!==48000 || bytes.readUInt16LE(32)!==2 || bytes.readUInt16LE(34)!==16 || bytes.toString('ascii',36,40)!=='data' || bytes.readUInt32LE(40)!==bytes.length-44 || (bytes.length-44)%2)throw invalid();
  return {bytes,duration:Math.floor((bytes.length-44)/48)};
}
export function createAudioStore({base=BASE,now=Date.now,ttlMs=AUDIO_TTL_MS}={}) {
  const entries=new Map();let directory,identity,queue=Promise.resolve(),closed=false,timer;
  const serial=work=>{const next=queue.then(work,work);queue=next.catch(()=>{});return next;};
  const same=(a,b)=>a?.dev===b?.dev && a?.ino===b?.ino;
  async function checkDirectory(){if(!directory)return;const info=await lstat(directory);if(!info.isDirectory() || info.isSymbolicLink() || !same(info,identity))throw invalid();}
  async function remove(id){const entry=entries.get(id);if(!entry)return;entries.delete(id);await checkDirectory();try{const info=await lstat(entry.filename);if(info.isFile() && !info.isSymbolicLink() && same(info,entry.info))await unlink(entry.filename);}catch(error){if(error.code!=='ENOENT')throw error;}}
  async function sweep(){for(const [id,entry] of entries)if(entry.expires<=now())await remove(id);}
  async function ensureDirectory(){
    if(directory){await checkDirectory();return;}
    await mkdir(base,{recursive:true,mode:0o700});const parent=await lstat(base);if(!parent.isDirectory() || parent.isSymbolicLink())throw invalid();
    directory=await mkdtemp(path.join(base,'aidiy-diag-audio-'));await chmod(directory,0o700);identity=await lstat(directory);
    timer=setInterval(()=>{void serial(sweep).catch(()=>{});},Math.min(ttlMs,30000));timer.unref?.();
  }
  async function clearEntries(owner){for(const [id,entry] of entries)if(owner===undefined || entry.owner===owner)await remove(id);}
  return {
    put(audio,owner){return serial(async()=>{
      if(closed)throw invalid();const {bytes,duration}=validateAudio(audio);await ensureDirectory();await sweep();
      while(entries.size>=AUDIO_MAX_FILES)await remove(entries.keys().next().value);
      const id=randomBytes(16).toString('hex'),filename=path.join(directory,id+'.wav');let file;
      try {file=await open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);await file.writeFile(bytes);const info=await file.stat();entries.set(id,{filename,owner,expires:now()+ttlMs,info,size:bytes.length});}
      catch(error){if(file)await unlink(filename).catch(()=>{});throw error;}finally{await file?.close();}
      return {id,MIME:'audio/wav',長さms:duration,サイズ:bytes.length};
    });},
    get(id){return serial(async()=>{
      if(closed || !/^[a-f0-9]{32}$/.test(id))return null;await sweep();const entry=entries.get(id);if(!entry)return null;await checkDirectory();let file;
      try {const before=await lstat(entry.filename);if(before.isSymbolicLink() || !before.isFile() || !same(before,entry.info))return null;file=await open(entry.filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const info=await file.stat();if(!info.isFile() || info.size!==entry.size || info.size>AUDIO_LIMIT || !same(info,entry.info))return null;const bytes=Buffer.alloc(info.size);let offset=0;while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)return null;offset+=read.bytesRead;}return bytes;}catch{return null;}finally{await file?.close();}
    });},
    clear(owner){return serial(()=>clearEntries(owner));},
    close(){closed=true;clearInterval(timer);return serial(async()=>{await clearEntries();if(directory){await checkDirectory();await rmdir(directory);directory=undefined;}});},
  };
}
