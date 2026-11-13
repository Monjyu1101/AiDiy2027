// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../diag/diag_main.mjs';
import {アプリアイコン} from '../diag/ui/components/アプリ起動/アプリアイコン.mjs';
for(const id of ['discord','slack'])test(`${id}: Diag は module 内の PNG コピーだけで完結する`,async()=>{
 const png=await readFile(new URL(`../diag/ui/components/アプリ起動/アイコン/AiDiy_${id}.png`,import.meta.url));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);assert.deepEqual(await readFile(new URL(`../static/AiDiy_${id}.png`,import.meta.url)),png);
 for(const folder of ['diag/ui/components/アプリ起動/アイコン','static'])await assert.rejects(readFile(new URL(`../${folder}/AiDiy_${id}.svg`,import.meta.url)),{code:'ENOENT'});
 assert.equal(アプリアイコン[id],`AiDiy_${id}.png`);
});
test('固定 PNG だけを Diag から配布し、SVG・任意 path は公開しない（待受なし）',async()=>{
 const handler=createHandler({token:'fixture',prefix:'/fixture/',installManagerFactory:()=>({close(){}})});
 const request=async name=>{const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};await handler({url:'/fixture/'+name,method:'GET',headers:{}},res);return res;};
 try{for(const id of ['discord','slack']){const response=await request(`AiDiy_${id}.png`);assert.equal(response.status,200);assert.equal(response.headers['Content-Type'],'image/png');assert.deepEqual(response.body,await readFile(new URL(`../static/AiDiy_${id}.png`,import.meta.url)));assert.equal((await request(`AiDiy_${id}.svg`)).status,404);}assert.equal((await request('AiDiy_other.png')).status,404);assert.equal((await request('%2e%2e/frontend_channels/slack/panel/AiDiy_slack.svg')).status,404);}finally{await handler.close();}
});
