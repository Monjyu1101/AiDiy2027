/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { createApp } from 'vue';
import 接続パネル from './components/接続/接続パネル.vue';
let アプリ;
function 画面開始() {
  アプリ = createApp(接続パネル);
  アプリ.mount('#app');
}
画面開始();
window.addEventListener('pagehide', () => { アプリ?.unmount(); アプリ = undefined; });
// ブラウザの戻る/進むで bfcache から復元された場合も、購読と状態を新しく取得する。
window.addEventListener('pageshow', event => { if (event.persisted && !アプリ) 画面開始(); });
