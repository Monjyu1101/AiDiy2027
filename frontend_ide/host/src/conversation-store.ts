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

import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileAttachment, type ChatAttachment } from './file-attachments';

// aidiy_code の会話履歴はプロジェクトごとに `_AIDIY/aidiy_code/histories/<会話ID>.json` へ1会話1ファイルで保存する。
// VS Code 拡張・単独起動版・開発スペースの部品のどれで開いても、同じプロジェクトなら同じ履歴を使う。

export interface 履歴メッセージ { 種別: string; 本文: string; 添付?: ChatAttachment }
function 履歴添付(value: unknown): ChatAttachment | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  if (typeof item.session !== 'string' || !item.session || item.session.length > 256 || /[\x00-\x1f\x7f]/.test(item.session) || item.channel !== '1') return;
  // 保存ファイルを信用せず、受信時と同じ境界でキー・表示名・安全なPNGだけを再構築する。
  return fileAttachment({ セッションID: item.session, チャンネル: item.channel, メッセージ識別: item.kind,
    ファイル名: item.path, 元ファイル名: item.name, サムネイル画像: item.thumbnail, ファイル版: item.revision }, item.session, '1');
}
function 履歴メッセージ整形(message: 履歴メッセージ): 履歴メッセージ {
  const attachment = 履歴添付(message.添付);
  return { 種別: message.種別, 本文: message.本文, ...(attachment ? { 添付: attachment } : {}) };
}
export const 履歴メッセージ長さ = (message: 履歴メッセージ): number => {
  const attachment = 履歴添付(message.添付);
  return message.本文.length + (attachment ? JSON.stringify(attachment).length : 0);
};
/** 保存形式（拡張と単独起動版の共通形）。 */
export interface 保存履歴 {
  id: string; 更新日時: number; 初回依頼?: string; メッセージ: 履歴メッセージ[];
  provider: string; model: string; モデル選択済み?: boolean;
  実行モード?: 'online' | 'offline'; セッションID?: string; HermesセッションID?: string; PiセッションID?: string;
}

// 本文の上限は拡張・単独起動版で共用する（JavaScript の UTF-16 コード単位数）。
export const 会話本文上限 = 2_000_000;
// JSON の制御文字エスケープは1コード単位あたり最大6バイト。本文に加えてメタデータ用の余裕を持たせる。
// 旧版で保存された4MiB超の日本語履歴も、本文を削らず再び読み込めるようにする。
export const 会話ファイル上限 = 会話本文上限 * 6 + 64 * 1024;
const MAX_ENTRIES = 500;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id);
const within = (root: string, path: string) => { const back = relative(root, path); return back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back); };

/** 保存先フォルダ。各段階の実パスがプロジェクト内であることを確かめる（リンクで外へ書き出さない）。 */
export function 会話保存先(project: string, create = false): string | undefined {
  const root = realpathSync(project);
  let folder = root;
  for (const part of ['_AIDIY', 'aidiy_code', 'histories']) {
    folder = join(folder, part);
    try { if (create) mkdirSync(folder, { recursive: true }); if (!within(root, realpathSync(folder))) throw new Error('会話履歴の保存先がプロジェクト外を参照しています。'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  return folder;
}

function 形式確認(value: unknown): 保存履歴 | undefined {
  const item = value as 保存履歴;
  if (!item || !validId(item.id) || !Number.isFinite(item.更新日時) || !Array.isArray(item.メッセージ)) return undefined;
  if (!item.メッセージ.every(message => message && typeof message.種別 === 'string' && typeof message.本文 === 'string')) return undefined;
  if (typeof item.provider !== 'string' || typeof item.model !== 'string') return undefined;
  return { ...item, メッセージ: item.メッセージ.map(履歴メッセージ整形) };
}

/** 新しい順の一覧。壊れた・大きすぎるファイルは読み飛ばす。 */
export function 会話一覧(folder: string | undefined): 保存履歴[] {
  if (!folder) return [];
  const list: 保存履歴[] = [];
  let names: string[] = [];
  try { names = readdirSync(folder).filter(name => name.endsWith('.json')); } catch { return []; }
  for (const name of names) {
    try {
      const path = join(folder, name);
      if (!within(folder, realpathSync(path)) || statSync(path).size > 会話ファイル上限) continue;
      const item = 形式確認(JSON.parse(readFileSync(path, 'utf8')));
      if (item && `${item.id}.json` === name) list.push(item);
    } catch { /* 書き込み途中・壊れた記録は使わない */ }
  }
  return list.sort((a, b) => b.更新日時 - a.更新日時).slice(0, MAX_ENTRIES);
}

/** 一時ファイルへ書いてから置き換える（途中で止まっても前の記録が残る）。 */
export function 会話書込(folder: string, entry: 保存履歴): void {
  if (!validId(entry.id)) throw new Error('会話IDが不正です。');
  const json = JSON.stringify({ ...entry, メッセージ: entry.メッセージ.map(履歴メッセージ整形) });
  // 読込と同じバイト上限を置き、読めないファイルで既存履歴を置き換えない。
  if (Buffer.byteLength(json, 'utf8') > 会話ファイル上限) throw new Error('会話履歴の保存サイズが上限を超えています。');
  mkdirSync(folder, { recursive: true });
  const temp = join(folder, `${randomUUID()}.tmp`);
  writeFileSync(temp, json, { encoding: 'utf8', flag: 'wx' });
  try { renameSync(temp, join(folder, `${entry.id}.json`)); } catch (error) { rmSync(temp, { force: true }); throw error; }
}

export function 会話削除(folder: string | undefined, id: string): void {
  if (folder && validId(id)) rmSync(join(folder, `${id}.json`), { force: true });
}


/** 選択中の会話IDも同じプロジェクトに保存し、VS Codeのユーザー領域へ書かない。 */
export function 会話選択読込(folder: string | undefined): string | undefined {
  if (!folder) return;
  try { const id = JSON.parse(readFileSync(join(dirname(folder), 'current.json'), 'utf8')).id; return validId(id) ? id : undefined; }
  catch { return undefined; }
}
export function 会話選択保存(folder: string | undefined, id: string): void {
  if (!folder || !validId(id)) return;
  const file = join(dirname(folder), 'current.json'), temp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify({ id }), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); renameSync(temp, file); }
  finally { rmSync(temp, { force: true }); }
}
