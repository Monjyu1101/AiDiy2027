// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {parse,compileTemplate} from '@vue/compiler-sfc';
import {createSSRApp} from 'vue';
import {renderToString} from '@vue/server-renderer';
import {transformSync} from 'esbuild';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');
const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
const fragment=descriptor.template.content.match(/<details v-if="failedResponses\.length[^]*?<\/details>/)?.[0];
assert.ok(fragment);
const compiled=compileTemplate({source:fragment,filename:'NaviDiagnostics.vue',id:'failure-test'});
assert.deepEqual(compiled.errors,[]);
const module={exports:{}};
runInNewContext(transformSync(compiled.code,{format:'cjs'}).code,{module,exports:module.exports,require});
const failedResponses=[{attempt:1,reason:'合計が不正',text:'</textarea><script>fixture()</script>\nhttps://example.test/file'},
 {attempt:2,reason:'閉じ括弧がない',text:'再試行テキスト',truncated:true}];
const render=(data={})=>renderToString(createSSRApp({setup:()=>({failedResponses,routing:false,job:{id:'current'},...data}),render:module.exports.render}));
test('失敗理由と両回答は閉じた詳細のプレーンテキスト。HTML・URLを実行や自動リンクにしない',async()=>{
 const html=await render();
 assert.match(html,/<details class="navigation-failed-responses">/);
 assert.match(html,/初回の回答/);assert.match(html,/再試行の回答/);
 assert.match(html,/合計が不正/);assert.match(html,/閉じ括弧がない/);assert.match(html,/一部を省略/);
 assert.match(html,/<textarea readonly/);assert.match(html,/&lt;\/textarea&gt;&lt;script&gt;/);
 assert.match(html,/https:\/\/example.test\/file/);assert.doesNotMatch(html,/<script>|<a\b|<details open/);
});
test('回答データがないエラー・実行中には診断欄を出さない',async()=>{
 assert.doesNotMatch(await render({failedResponses:[]}),/失敗時の回答/);
 assert.doesNotMatch(await render({routing:true}),/失敗時の回答/);
});
