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

'use strict';
// aidiy_code / aidiy_live / aidiy_discord の専用ウィンドウとブラウザ版（アプリ表示）の大きさ。
// 幅は3本とも aidiy_code 基準。高さは2種類だけ: 会話画面の aidiy_code / aidiy_live と、設定パネルの aidiy_discord。
// 各 desktop.cjs と launch-project.mjs はここの値だけを使い、個別に数値を書かない。
module.exports = Object.freeze({
  幅: 480,
  最小幅: 360,
  会話高さ: 600,
  会話最小高さ: 480,
  パネル高さ: 414,
});
