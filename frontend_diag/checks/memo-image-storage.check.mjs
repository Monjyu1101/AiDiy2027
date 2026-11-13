import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMemoStore} from '../memo/保存.mjs';
import {画像を検証,最大画像バイト数} from '../memo/画像.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=';
const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const save=note=>{const {形式,...body}=note;return body;};
async function setup(t){const root=await mkdtemp(path.join(tmpdir(),'memo-image-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createMemoStore({launchRoot:root}),source=(await store.list()).保存先[0];return {root,store,source};}
test('画像検証は固定raster MIME・magic・canonical base64・5 MiB上限を守る',()=>{
 for(const image of [png,gif,'','data:image/jpeg;base64,/9j/2Q==','data:image/webp;base64,UklGRgwAAABXRUJQVlA4TAAAAAA='])assert.equal(画像を検証(image),image);
 assert.equal(画像を検証(undefined),'');
 for(const image of [null,{},'https://example.com/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,aGVsbG8=','data:image/png;base64,iVBORw==',png+'\n',png.replace('png','jpeg'),'data:image/jpeg;base64,/9j/2R==','data:image/jpeg;base64,/9j/2Q='])assert.throws(()=>画像を検証(image),{status:400});
 const large=Buffer.alloc(最大画像バイト数);large.set([255,216,255]);assert.equal(画像を検証('data:image/jpeg;base64,'+large.toString('base64')).length>0,true);
 assert.throws(()=>画像を検証('data:image/jpeg;base64,'+Buffer.concat([large,Buffer.from([0])]).toString('base64')),{status:400});
});
test('画像のみ新規・再起動・省略保持・置換・除去と空欄保持',async t=>{
 const {root,store,source}=await setup(t);
 let note=await store.create({保存先:source.id,タイトル:'',本文:'',色:'yellow',画像:png});
 assert.equal((await createMemoStore({launchRoot:root}).list()).メモ[0].画像,png);
 assert.equal(JSON.parse(await readFile(path.join(source.パス,note.id),'utf8')).画像,png);
 const old=save(note);delete old.画像;note=await store.save({...old,本文:'text'});assert.equal(note.画像,png);
 note=await store.save({...save(note),画像:gif});assert.equal(note.画像,gif);
 await assert.rejects(store.save({...save(note),画像:'data:image/svg+xml;base64,PHN2Zy8+'}),{status:400});assert.equal((await store.list()).メモ[0].画像,gif);
 note=await store.save({...save(note),タイトル:'',本文:'',画像:''});assert.equal(note.画像,undefined);assert.equal((await store.list()).メモ.length,1);
});
test('画像込み作成再試行は同一内容のみ、trashは画像含むJSONを保全',async t=>{
 const {store,source}=await setup(t),body={保存先:source.id,タイトル:'',本文:'',色:'yellow',画像:png,clientId:'76a1bee4-8f12-44bc-a1d0-706fa0c58d96'};
 const note=await store.create(body);assert.deepEqual(await store.create(body),note);
 await assert.rejects(store.create({...body,画像:gif}),{status:409});
 await store.trash({保存先:note.保存先,id:note.id,revision:note.revision});
 const trash=path.join(source.パス,'.trash'),dir=(await readdir(trash))[0];assert.equal(JSON.parse(await readFile(path.join(trash,dir,note.id),'utf8')).画像,png);
});
test('旧textは画像をsidecarへ保存し本文を変更しない',async t=>{
 const {store,source}=await setup(t);await mkdir(source.パス,{recursive:true});const file=path.join(source.パス,'existing.txt');await writeFile(file,'旧本文');
 let note=(await store.list()).メモ[0];note=await store.save({...save(note),画像:png});assert.equal(await readFile(file,'utf8'),'旧本文');assert.equal((await store.list()).メモ[0].画像,png);
 const old=save(note);delete old.画像;note=await store.save(old);assert.equal(note.画像,png);
});
test('HTTPは画像のbase64増分を許可し、上限超過は保存呼出し前に拒否',async()=>{
 const {createMemoHandler}=await import('../memo/http.mjs');
 const {最大メモバイト数}=await import('../memo/画像.mjs');
 const {Readable}=await import('node:stream');let received;
 const handler=createMemoHandler({memoStore:{create:async body=>{received=body;return body;}}});
 async function request(body){const req=Readable.from([Buffer.from(body)]);req.method='POST';req.headers={'content-type':'application/json'};let response;await handler(req,'api/メモ/作成',(status,data)=>{response={status,data};});return response;}
 const image=Buffer.alloc(2*1024*1024);image.set([255,216,255]);const body={画像:'data:image/jpeg;base64,'+image.toString('base64')};
 assert.equal((await request(JSON.stringify(body))).status,200);assert.deepEqual(received,body);received=null;
 assert.equal((await request('x'.repeat(最大メモバイト数+4097))).status,413);assert.equal(received,null);
});
