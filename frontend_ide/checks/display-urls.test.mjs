// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDisplayUrls,normalizeDisplayUrlReason} from '../viewer/表示URL.mjs';

test('表示URL: HTTP(S)・日本語・hashルートを許可し正規化・重複除去する',()=>{
 const value=normalizeDisplayUrls([{url:'HTTP://LOCALHOST:80',label:' ホーム '},{url:'http://localhost/'},{url:'https://example.test:443/a/../b'},{url:'http://[::1]:8090/#/一覧?page=2',label:'一覧'}]);
 assert.deepEqual(normalizeDisplayUrls([{url:'https://example.test/%e4%b8%80'},{url:'https://example.test/%E4%B8%80'}]),[{url:'https://example.test/%E4%B8%80',label:''}]);
 assert.deepEqual(value,[{url:'http://localhost/',label:'ホーム'},{url:'https://example.test/b',label:''},{url:'http://[::1]:8090/#/%E4%B8%80%E8%A6%A7?page=2',label:'一覧'}]);
});

test('表示URL: 不正形式・認証情報・秘密クエリ・未解決ルートは保存しない',()=>{
 const bad=[undefined,null,17,{},'//example.test','/relative','javascript:alert(1)','data:text/html,test','file:///tmp/a','https:example.test','http://user:pass@example.test','http://user@example.test','http://example.test/\na','http://example.test/%0a','http://example.test/%250a','http://example.test/\\evil','http://example.test/:id','http://example.test/#/items/:id','http://example.test/{id}','http://example.test/%7Bid%7D','http://example.test/[id]','http://example.test/<id>','http://example.test/*','https://example.test/?token=fake','https://example.test/#access_token=fake','https://example.test/#/route?api_key=fake','https://example.test/?%74oken=fake','https://example.test/?signature=fake','https://example.test/?sessionId=fake','https://example.test/?code=fake','https://example.test/token/fake','https://example.test/%ZZ','https://example.test/'+ 'x'.repeat(4096)];
 for(const url of bad)assert.deepEqual(normalizeDisplayUrls([{url}]),[],String(url));
 for(const value of [undefined,null,{},'http://example.test'])assert.deepEqual(normalizeDisplayUrls(value),[]);
 assert.deepEqual(normalizeDisplayUrls([null,17,{}, {url:'https://example.test/',label:12}]),[{url:'https://example.test/',label:''}]);
});

test('表示URL: 件数・ラベル・理由の上限と不正型を扱う',()=>{
 const entries=Array.from({length:25},(_,i)=>({url:`https://example.test/${i}`,label:'名'.repeat(201)}));
 const value=normalizeDisplayUrls(entries);assert.equal(value.length,20);assert.equal(value[0].label.length,200);
 assert.equal(normalizeDisplayUrls([{url:'https://example.test',label:' a\nb\u0000 '}])[0].label,'a b');
 assert.equal(normalizeDisplayUrlReason('理'.repeat(2001)).length,2000);
 assert.equal(normalizeDisplayUrlReason(' 根拠\n確認\u0000 '),'根拠\n確認');
 assert.equal(normalizeDisplayUrlReason({}), '');assert.equal(normalizeDisplayUrlReason(undefined),'');
});

test('表示URL: エンコードした文字%を残し、二重エンコードした制御文字は拒否する',()=>{
 assert.deepEqual(normalizeDisplayUrls([{url:'https://example.com/100%25.html'}]),[{url:'https://example.com/100%25.html',label:''}]);
 for(const url of ['https://example.com/%250a%25','https://example.com/%0a%','https://example.com/%ff%0a'])assert.deepEqual(normalizeDisplayUrls([{url}]),[]);
});
