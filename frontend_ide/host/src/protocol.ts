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

import { CLI実行, 再開セッション不在, type 実行要求 } from './runner';
import { STREAM_CANCEL, STREAM_END, STREAM_START } from './stream-control';

export { STREAM_CANCEL, STREAM_END, STREAM_START, streamControlOf, visibleStreamContent } from './stream-control';

// AIコード.vue / AIコード.py / AIコード_cli.py と同じメッセージ項目・識別子。
// 転送路は VS Code の Webview IPC。AiDiy サーバーの起動は不要。
export interface コードパケット {
  セッションID: string;
  チャンネル: string;
  メッセージ識別: 'input_text' | 'input_request' | 'cancel_run' | 'output_stream' | 'output_text';
  メッセージ内容: string;
  ファイル名?: null;
  サムネイル画像?: null;
  出力元?: 'stdout' | 'stderr';
}

export function コード要求実行(要求: コードパケット, 設定: Omit<実行要求, '本文' | 'ストリーム'>, 受信: (packet: コードパケット) => void, 再開ID?: string) {
  if (!['input_text', 'input_request'].includes(要求.メッセージ識別)) throw new Error('コード要求の識別子が不正です。');
  const 送信 = (メッセージ識別: コードパケット['メッセージ識別'], メッセージ内容: string, 出力元?: 'stdout' | 'stderr') => 受信({
    セッションID: 要求.セッションID, チャンネル: 要求.チャンネル,
    メッセージ識別, メッセージ内容, ファイル名: null, サムネイル画像: null, ...(出力元 ? { 出力元 } : {})
  });
  送信('output_stream', STREAM_START);
  const 実行 = (引数: string[]) => CLI実行({ ...設定, 引数, 本文: 要求.メッセージ内容, ストリーム: (line, source) => 送信('output_stream', line, source) });
  let job = 実行(設定.引数);
  const 完了 = (async () => {
    let result = await job.完了;
    if (再開セッション不在(result, 再開ID)) {
      送信('output_stream', '保存済みの Hermes セッションが見つからないため、新しいセッションで再試行します。', 'stderr');
      const 引数 = [...設定.引数];
      const 位置 = 引数.findIndex((value, index) => value === '--resume' && 引数[index + 1] === 再開ID);
      if (位置 >= 0) 引数.splice(位置, 2);
      job = 実行(引数);
      result = { ...await job.完了, セッション復旧: true };
    }
    送信('output_stream', result.停止理由 || result.終了コード !== 0 ? STREAM_CANCEL : STREAM_END);
    if (result.回答) 送信('output_text', result.回答);
    return result;
  })().catch(error => { 送信('output_stream', STREAM_CANCEL); throw error; });
  return { 完了, 停止: (理由?: string) => job.停止(理由) };
}
