// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {アプリアイコン,起動項目を整列} from '../diag/ui/components/アプリ起動/アプリアイコン.mjs';
import {createServer} from '../diag_main.mjs';
const read=name=>readFile(new URL('../'+name,import.meta.url));
test('MEMO専用画像は全ランチャー共通でCPUの直前、配布画像は正本と一致',async()=>{
 assert.equal(アプリアイコン.memo,'AiDiy_memo.png');
 assert.deepEqual(起動項目を整列([{id:'cpu'},{id:'memo'},{id:'team'}]).map(x=>x.id),['team','memo','cpu']);
 const source=await read('icons/AiDiy_memo.png');assert.equal(source.readUInt32BE(16),512);assert.equal(source.readUInt32BE(20),512);
 for(const name of ['static/AiDiy_memo.png','diag/ui/components/アプリ起動/アイコン/AiDiy_memo.png'])assert.deepEqual(await read(name),source);
 assert.notDeepEqual(source,await read('icons/AiDiy_diag.png'));
 assert.match((await read('diag/ui/components/アプリ起動/アプリ状態.mjs')).toString(),/id:'memo',名前:'MEMO'/);
 assert.match((await read('memo/ui/src/memo.html')).toString(),/href="AiDiy_memo.png"/);
});
test('通常と単体モードの両方でMEMO画像を配信',async t=>{
 for(const enabled of [true,false]){
 const server=createServer({token:'test',isNormalEnabled:()=>enabled});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();server.closeAllConnections();});
 const result=await fetch(`http://127.0.0.1:${server.address().port}/AiDiy_memo.png`);
 assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'image/png');
 assert.deepEqual(Buffer.from(await result.arrayBuffer()),await read('icons/AiDiy_memo.png'));
 }
});
