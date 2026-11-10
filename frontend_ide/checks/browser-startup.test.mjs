// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import browser from '../デスクトップ/ブラウザ.cjs';
test('Browserの既定URLはtoolsやWebサーバーの状態によらずローカル8090',async()=>{
 let calls=0;
 assert.equal(browser.HOME,'http://127.0.0.1:8090/');
 assert.equal(await browser.browserStartupURL(()=>{calls++;throw Error('offline');}),browser.HOME);
 assert.equal(calls,0,'起動をネットワーク確認で遅延させない');
 assert.equal(browser.browserURL(''),browser.HOME);
 for(const query of ['宇宙','日本語 検索','hello world'])assert.equal(browser.browserURL(query),'https://www.google.com/ai?q='+encodeURIComponent(query));
 for(const url of ['http://localhost:8090/a','https://example.com/search?q=x'])assert.equal(browser.browserURL(url),url);
});
