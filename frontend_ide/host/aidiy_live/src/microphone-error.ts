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

export function microphoneError(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'マイク入力が見つかりません。Windows の「設定 → システム → サウンド → 入力」でマイクを確認してください。リモートデスクトップの場合は、接続前の「ローカル リソース → リモート オーディオの設定 → リモート オーディオ録音」で「このコンピューターで録音する」を選び、再接続してください。';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'マイクへのアクセスが許可されていません。Windows の「設定 → プライバシーとセキュリティ → マイク」で、マイクへのアクセスとデスクトップアプリのアクセスを許可してください。ブラウザ版ではサイトのマイク許可も確認してください。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'マイクを開けません。ほかのアプリによる占有や、Windows のサウンド入力設定を確認してください。';
  }
  return error instanceof Error ? error.message : String(error);
}
