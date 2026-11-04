// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 既存コマンドの互換入口。画面・起動処理はVue版に集約。
import { launch } from '../launch.mjs';
launch('ide').catch(error=>{console.error(error.message);process.exitCode=1;});
