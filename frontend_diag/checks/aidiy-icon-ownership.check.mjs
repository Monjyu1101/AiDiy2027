// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {アプリアイコン} from '../diag/ui/components/アプリ起動/アプリアイコン.mjs';
import {createHandler} from '../diag/diag_main.mjs';
const root=new URL('../',import.meta.url),bytes=name=>readFile(new URL(name,root));
const icons=[...['cpu','navi','console','code','live','ide','task','team','browser','avatar','diag','discord','slack'].map(id=>({id,source:`アイコン/AiDiy_${id}.png`,file:`AiDiy_${id}.png`})),...['aidiy_hermes','aidiy_pi'].map(id=>({id,source:`CLIアイコン/${id}.png`,file:`CLI_${id}.png`}))];

test('AiDiy 15 種は Diag 内の PNG コピーだけで配布を検証できる',async()=>{
 assert.equal(icons.length,15);assert.equal(new Set(icons.map(icon=>icon.id)).size,15);
 for(const icon of icons){
  const png=await bytes('diag/ui/components/アプリ起動/'+icon.source);
  assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.readUInt32BE(16)>0);assert.ok(png.readUInt32BE(20)>0);
  assert.deepEqual(await bytes('static/'+icon.file),png,icon.id+' static copy');
  await assert.rejects(bytes('static/'+icon.file.replace(/\.png$/,'.svg')),{code:'ENOENT'});
  await assert.rejects(bytes('diag/ui/components/アプリ起動/'+icon.source.replace(/\.png$/,'.svg')),{code:'ENOENT'});
  if(!['diag','aidiy_hermes','aidiy_pi'].includes(icon.id))assert.equal(アプリアイコン[icon.id],icon.file);
 }
 for(const name of ['task','team','browser'])await assert.rejects(bytes(`diag/ui/components/アプリ起動/アプリアイコン/${name}.svg`),{code:'ENOENT'});
 assert.equal(アプリアイコン.chrome,'Chrome.svg');
 for(const name of ['ui/build.mjs','ui/verify.mjs','diag/ui/style.css'])assert.doesNotMatch((await bytes(name)).toString('utf8').replaceAll('../../frontend_ide/src/components','shared-title-components'),/frontend_(?:ide|channels|avatar)|command_hermes|aidiy-icon-sources|_icons\/AiDiy/,'外部 module の asset を参照しない');
});
test('AiDiy は固定 PNG 配布のみ、第三者 SVG と認証境界は維持（実待受なし）',async()=>{
 const handler=createHandler({token:'fixture',prefix:'/fixture/',installManagerFactory:()=>({close(){}})});
 const request=async name=>{const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};await handler({url:'/fixture/'+name,method:'GET',headers:{}},res);return res;};
 try{
  for(const icon of icons){const response=await request(icon.file);assert.equal(response.status,200,icon.id);assert.equal(response.headers['Content-Type'],'image/png');assert.deepEqual(response.body,await bytes('diag/ui/components/アプリ起動/'+icon.source));assert.equal((await request(icon.file.replace(/\.png$/,'.svg'))).status,404);}
  for(const file of ['Chrome.svg','CLI_codex.svg'])assert.equal((await request(file)).status,200);
  for(const file of ['AiDiy_unknown.png','%2e%2e/frontend_ide/aidiy_code/AiDiy_code.svg'])assert.equal((await request(file)).status,404);
  assert.equal((await request('api/status')).status,401);
 }finally{await handler.close();}
});
test('通常・ミニ・マイクロは Hermes / Pi のみ PNG、外部 CLI は SVG を維持',async()=>{
 const normal=(await bytes('diag/ui/components/アプリ起動/アプリ起動パネル.vue')).toString('utf8'),micro=(await bytes('diag/ui/components/アプリ起動/マイクロランチャー.vue')).toString('utf8'),mini=(await bytes('diag/ui/components/アプリ起動/ミニアプリ起動.vue')).toString('utf8');
 assert.ok(normal.includes("['aidiy_hermes','aidiy_pi'].includes(item.id)?'.png':'.svg'"));assert.ok(micro.includes("['aidiy_hermes','aidiy_pi'].includes(item.id)?`CLI_${item.id}.png`"));assert.ok(mini.includes("'CLI_'+item.id+'.png'"));assert.ok(!mini.includes('.svg'));
});
