// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export const AIストリーム開始 = '\u0002'
export const AIストリーム終了 = '\u0003'
export const AIストリーム中断 = '\u0018'

export type AIストリーム制御種別 = '開始' | '終了' | '中断'

export function AIストリーム制御判定(内容: string): AIストリーム制御種別 | null {
  const 制御値 = 内容.replace(/[\r\n]+$/, '')
  if (制御値 === AIストリーム開始.trimEnd()) return '開始'
  if (制御値 === AIストリーム終了.trimEnd()) return '終了'
  if (制御値 === AIストリーム中断.trimEnd()) return '中断'
  return null
}

export function AIストリーム表示内容(内容: string): string {
  return 内容
    .replace(/[\u0002\u0003\u0018]/g, '')
    .replace(/[\r\n]+$/, '')
}
