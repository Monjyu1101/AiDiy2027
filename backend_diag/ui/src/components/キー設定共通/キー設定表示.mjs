// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// サーバーの登録順を変えず、各キーを必ず一方の画面へ分類する。
export const 外部連携ID = Object.freeze(['huggingface_read', 'huggingface_write', 'discord', 'slack']);
export const 外部連携か = item => 外部連携ID.includes(item.id);
// モデル一覧の確認に対応しない項目は、どちらの画面にも表示しない（サーバー側の登録と秘匿対象には残す）。
export const 確認不要ID = Object.freeze(['azure', 'copilot']);
export const 確認不要か = item => 確認不要ID.includes(item.id);
export const 設定表示 = item => item.ローカル ? 'ローカル' : item.設定済み === null ? '確認不可' : item.設定済み ? '設定済' : '未設定';
