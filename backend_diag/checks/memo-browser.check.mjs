import test from 'node:test';
import assert from 'node:assert/strict';
import {openBrowserMemos} from '../memo/browser.mjs';
const token='a'.repeat(43),url='http://127.0.0.1:45678/fixture/#token='+token;
test('Web起動: 保存済みだけ個別表示し、空一覧は何も開かない',async()=>{
 const opened=[];let request;
 const run=メモ=>openBrowserMemos({url,open:u=>opened.push(u),fetchFn:async(u,o)=>{request={u,o};return {ok:true,json:async()=>({メモ})};}});
 assert.equal(await run([]),0);assert.equal(opened.length,0);
 const note={id:'一.memo.json',保存先:'project:hash',本文:'secret content'};
 assert.equal(await run([note,note,{...note,id:'二.memo.json'}]),2);
 assert.equal(request.u.pathname,'/fixture/api/%E3%83%A1%E3%83%A2');assert.equal(request.o.headers.Authorization,'Bearer '+token);assert.equal(request.o.redirect,'error');
 const one=new URL(opened[0]);assert.equal(one.pathname,'/fixture/memo.html');assert.equal(new URLSearchParams(one.hash.slice(1)).get('id'),note.id);assert.ok(!opened.join('').includes('secret'));
});
test('Web起動: 外部URL・失敗・終了中は空付箋を補完しない',async()=>{
 let count=0;const open=()=>count++;
 await assert.rejects(openBrowserMemos({url:'https://example.com/#token='+token,open}));
 await assert.rejects(openBrowserMemos({url,open,fetchFn:async()=>({ok:false})}));
 await openBrowserMemos({url,open,isClosed:()=>true,fetchFn:async()=>({ok:true,json:async()=>({メモ:[{id:'x',保存先:'launch'}]})})});assert.equal(count,0);
});
