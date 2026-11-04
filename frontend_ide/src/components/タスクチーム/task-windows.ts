// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { qMessage } from './utils/qAlert';
export async function openTaskDialog(payload: Record<string, unknown>) {
  try {
    const result = await window.aidiyWindow?.taskWindows('dialog', payload);
    if (result?.ok === false) throw Error(result.error || '編集ウィンドウを開けません。');
  } catch (error) { await qMessage(error instanceof Error ? error.message : '編集ウィンドウを開けません。', 'error'); }
}
