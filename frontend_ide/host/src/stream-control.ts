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

export const STREAM_START = '\u0002';
export const STREAM_END = '\u0003';
export const STREAM_CANCEL = '\u0018';

export type StreamControl = 'start' | 'end' | 'cancel';

export function streamControlOf(content: string): StreamControl | undefined {
  const control = content.replace(/[\r\n]+$/, '');
  if (control === STREAM_START.trimEnd()) return 'start';
  if (control === STREAM_END.trimEnd()) return 'end';
  if (control === STREAM_CANCEL.trimEnd()) return 'cancel';
  return undefined;
}

export function visibleStreamContent(content: string): string {
  return content
    .replace(/[\u0002\u0003\u0018]/g, '')
    .replace(/[\r\n]+$/, '');
}
