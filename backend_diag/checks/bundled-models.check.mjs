// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';import {deflateRawSync} from 'node:zlib';import os from 'node:os';import path from 'node:path';
import {extractEntry,loadBundledModels,crc32,BUNDLED_ENTRY,EXTRACT_DIRECTORY} from '../モデル情報/bundled_models.mjs';
// 最小 ZIP（1 エントリ）を組み立てる。
function zip(name,data,{method=8,flags=0,crc=crc32(data)}={}){
 const body=method===8?deflateRawSync(data):data,file=Buffer.from(name);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE(0,42);
 const start=30+file.length+body.length,end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+file.length,12);end.writeUInt32LE(start,16);
 return Buffer.concat([local,file,body,central,file,end]);
}
test('extracts the named entry (deflate or stored) and rejects damaged, encrypted or missing entries',()=>{
 const data=Buffer.from('{"data":[]}');
 assert.deepEqual(extractEntry(zip('a.txt',data),'a.txt'),data);
 assert.deepEqual(extractEntry(zip('a.txt',data,{method:0}),'a.txt'),data);
 assert.throws(()=>extractEntry(zip('a.txt',data,{crc:1}),'a.txt'));
 assert.throws(()=>extractEntry(zip('a.txt',data,{flags:1}),'a.txt'));
 assert.throws(()=>extractEntry(zip('a.txt',data),'b.txt'));
 assert.throws(()=>extractEntry(Buffer.from('not a zip'),'a.txt'));
});
test('bundled OpenRouter list extracts to the temp folder and parses',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-bundled-'));
 try{const body=await loadBundledModels({directory});assert.ok(body.data.length>100);assert.ok(body.data.every(row=>typeof row.id==='string'));assert.ok((await readFile(path.join(directory,BUNDLED_ENTRY))).length>0);}
 finally{await rm(directory,{recursive:true,force:true});}
 assert.equal(path.dirname(EXTRACT_DIRECTORY),os.tmpdir());
});
test('a broken bundle is reported as failure, not as models',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'diag-bundled-'));
 try{const file=path.join(directory,'broken.zip');await writeFile(file,zip(BUNDLED_ENTRY,Buffer.from('{"items":[]}')));await assert.rejects(loadBundledModels({zipPath:file,directory}));}
 finally{await rm(directory,{recursive:true,force:true});}
});
