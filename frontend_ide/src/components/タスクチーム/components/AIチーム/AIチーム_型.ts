// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export type エージェント状態 = '作業中' | '相談中' | '雑談中' | '瞑想中' | '移動中' | '休憩中' | '召喚中';

export type エージェント = {
  id: string;
  名前: string;
  役割: string;
  人格情報: string;
  色: number;
  色CSS: string;
  状態: エージェント状態;
  作業内容: string;
  ひとこと: string;
  状態更新時刻: number;
};

export type チーム要員 = {
  要員ID: string;
  要員名: string;
  役割: string;
  人格情報: string;
  有効: boolean;
};

export type チーム経験 = {
  経験ID: string;
  依頼ID: string;
  タスクID: string;
  要員ID: string;
  プロジェクト: string;
  /** 何を: 実行したタスクのタイトル */
  タスクタイトル: string;
  要求内容: string;
  /** タスクの実行結果（応答内容） */
  実行応答内容: string;
  /** タスクの完了日時 */
  完了日時: string;
  タイトル: string;
  経験値: number;
  分類: string;
  まとめ内容: string;
  学び: string;
  状態: '生成中' | '完了' | 'エラー';
  開始日時: string;
  終了日時: string;
  エラー内容: string;
  更新日時: string;
};

export type チーム作業 = {
  作業ID: string;
  プロジェクト: string;
  ループ: number;
  依頼ID: string;
  チーム作業: string;
  要員ID: string;
  /** S=相談 / P=計画 / D=実行 / C=評価 / A=改善 */
  PDCA区分: string;
  /** 対応するAチーム依頼の状態を写した表示用の値 */
  状況: string;
  開始日時: string;
  終了日時: string;
  応答内容: string;
  まとめ内容: string;
  更新日時: string;
};

export type チーム会話 = {
  プロジェクト: string;
  要員ID: string;
  要求内容: string;
  発言内容: string;
  登録日時: string;
  更新日時: string;
};

export type チーム目標 = {
  CODE_BASE_PATH: string;
  チーム目標: string;
  /** 自動作業設定を回すかどうか（既定はオフ） */
  自動作業設定?: boolean | number;
  チーム作業: string;
  /** 目標に向けた作業ループを回すかどうか（既定はオフ） */
  作業ループ?: boolean | number;
  /** 1〜98は上限回数、99は無制限 */
  作業ループ回数?: number;
  /** 作業ループの相談フェーズへ動員する要員数（1〜admin以外の有効要員数、既定2） */
  動員要員数?: number;
  /** 作業ループのパターン（SPDCA=S→P→D→C→Aの5段 / PlanDo=P→Dの2段、既定SPDCA） */
  パターン?: 'SPDCA' | 'PlanDo';
  /** 作業ループの各段を実行するAI（Aチーム依頼側） */
  TEAM_AI_NAME?: string;
  /** モデルは plan（相談・計画=S・P）/ do（実施=D）/ check（評価・改善=C・A）の3種 */
  TEAM_AI_MODEL_plan?: string;
  TEAM_AI_MODEL_do?: string;
  TEAM_AI_MODEL_check?: string;
  /** 作業ループから投入するAタスク側のAI */
  TASK_AI_NAME?: string;
  TASK_AI_MODEL_plan?: string;
  TASK_AI_MODEL_do?: string;
  TASK_AI_MODEL_check?: string;
  更新日時: string;
  更新利用者ID?: string;
  更新利用者名?: string;
};

export type チーム状況 = {
  要員ID: string;
  要員名: string;
  最終更新日時: string;
  経験最終更新日時: string;
  待機数: number;
  実行数: number;
  まとめ中数: number;
  完了数: number;
  エラー数: number;
  更新日時: string;
};

export type チーム依頼 = {
  依頼ID: string;
  要員ID: string;
  プロジェクト: string;
  タイトル: string;
  要求内容: string;
  TEAM_AI_NAME: string;
  /** モデルは plan / do / check の3種。TEAM は作業ループの段、TASK は Aタスクの内部フェーズ */
  TEAM_AI_MODEL_plan: string;
  TEAM_AI_MODEL_do: string;
  TEAM_AI_MODEL_check: string;
  TASK_AI_NAME: string;
  TASK_AI_MODEL_plan: string;
  TASK_AI_MODEL_do: string;
  TASK_AI_MODEL_check: string;
  タスクID: string;
  実行有効: boolean | number;
  状態: '準備開始' | '準備中' | '準備完了' | '待機' | '実行中' | 'エラー' | '完了' | '済' | '中止';
  PID: string;
  開始日時: string;
  終了日時: string;
  実行回数: number;
  応答タイトル: string;
  応答内容: string;
  まとめ内容: string;
  更新日時: string;
  表示優先順位: number;
};

export type 稼働要員 = {
  エージェントID: string;
  エージェント名: string;
  役割: string;
  人格情報: string;
  状態: エージェント状態;
  作業内容: string;
  ひとこと: string;
};

export type 状態表示 = Record<エージェント状態, { 色: string; 記号: string }>;

export const 状態情報: 状態表示 = {
  作業中: { 色: '#65e8b7', 記号: '●' },
  相談中: { 色: '#8bb8ff', 記号: '◆' },
  雑談中: { 色: '#8bb8ff', 記号: '◆' },
  瞑想中: { 色: '#ffd580', 記号: '◉' },
  移動中: { 色: '#b8a7ff', 記号: '→' },
  休憩中: { 色: '#7be3b0', 記号: '○' },
  召喚中: { 色: '#f58cff', 記号: '✦' },
};

export const 要員色一覧: [
  { 色: number; 色CSS: string },
  ...{ 色: number; 色CSS: string }[],
] = [
  { 色: 0x5bd9ff, 色CSS: '#5bd9ff' },
  { 色: 0x8d7dff, 色CSS: '#9d91ff' },
  { 色: 0x5ce3a1, 色CSS: '#5ce3a1' },
  { 色: 0xff7eb6, 色CSS: '#ff8fc2' },
  { 色: 0xffc35b, 色CSS: '#ffd078' },
  { 色: 0x66a4ff, 色CSS: '#78afff' },
  { 色: 0xd07dff, 色CSS: '#d893ff' },
  { 色: 0x65e5d6, 色CSS: '#74e9dc' },
];
