// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import axios from 'axios';
import apiClient from '../../../api/client';

export interface 日誌見出し {
  日誌日付: string;
  利用者ID: string;
  利用者名: string;
}
export interface 日誌添付 {
  ファイル名: string;
  base64内容: string;
}
export interface 日誌明細 {
  行番号: number;
  作業内容: string;
  添付: 日誌添付[];
}
export interface 日誌記録 {
  作業ID: number;
  プロジェクト: string;
  作業タイトル: string;
  新規更新ファイル数: number | null;
  明細: 日誌明細[];
}
export interface 日誌 extends 日誌見出し { 記録: 日誌記録[]; 更新版: string }
export interface 日誌一覧 {
  items: (日誌見出し & {
    記録件数: number;
    作業一覧: Pick<日誌記録, '作業ID' | 'プロジェクト' | '作業タイトル' | '新規更新ファイル数'>[];
  })[];
  total: number;
  limit: number | null;
}
export interface 日誌保存 { 日誌日付: string; 更新版?: string; 記録: (Omit<日誌記録, "作業ID"> & { 作業ID: number | null })[] }
export interface 日誌一覧候補 {
  利用者: { 利用者ID: string; 利用者名: string }[];
  プロジェクト: string[];
}
type 操作名 = '一覧検索' | '一覧候補' | '取得' | '登録' | '変更' | '削除';

export async function 日誌操作<T>(操作: 操作名, body: object = {}): Promise<T> {
  const { data } = await apiClient.post<{status: string; message: string; data: T}>('/apps/T日誌/' + 操作, body);
  if (data.status !== 'OK') throw new Error(data.message || `日誌の${操作}に失敗しました。`);
  return data.data;
}

export function エラー表示(error: unknown, message: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 413) return '添付ファイルまたは日誌全体の容量が上限を超えています。';
    if (status === 422) return '入力内容を確認してください。日誌日付・記録・明細の形式または上限に問題があります。';
    if (status === 403) return '日誌を利用する権限がありません。';
    if (status === 401) return 'ログインし直してください。';
    const data = error.response?.data;
    if (typeof data?.message === 'string') return data.message;
    return error.response ? message : `${message} 接続を確認してください。`;
  }
  return error instanceof Error ? error.message : message;
}

export function ローカル日付(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
