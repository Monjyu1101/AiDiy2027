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

/** Node の fetch は通信エラーを cause に包むため、実際の接続先と原因も表示する。 */
export function 接続エラー詳細(target: URL, error: unknown): string {
  // 操作による中断と応答期限を、ネットワーク障害やDOMExceptionの数値コードと混同しない。
  if (error instanceof Error && error.name === 'AbortError')
    return `AIコアへの要求を中断しました。接続先: ${target.origin}\n${error.message}`;
  if (error instanceof Error && error.name === 'TimeoutError')
    return `AIコアの応答待ちがタイムアウトしました。接続先: ${target.origin}\n${error.message}`;
  const details: string[] = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if (!(current instanceof Error)) { details.push(String(current)); break; }
    const code = (current as NodeJS.ErrnoException).code;
    details.push(`${code ? `${code}: ` : ''}${current.message}`);
    current = current.cause;
  }
  return `AIコアとの通信に失敗しました。接続先: ${target.origin}\n${details.join('\n')}`;
}
