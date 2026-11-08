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

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { プロジェクトルート } from '../接続/接続設定';
import { dirname, join } from 'node:path';
import { Hermesモデル検証, コード名検証, 既定コード名 } from '../コード/Hermesモデル';

// パネルの保存は1ファイル（プロジェクト/_AIDIY/aidiy_discord/aidiy_discord.json）。このファイルがあれば起動時に自動接続する。
// Slack 版の aidiy_slack.json と同じ作りで、code_name / code_model に加えて音声会話（live / live_models）も持つ。
const { programDataDirectory, projectRoot } = createRequire(import.meta.url)('../../../../frontend_ide/host/scripts/project-storage.cjs') as {
  programDataDirectory: (project: string, programName: string, aidiyRoot: string) => string;
  projectRoot: (project: string, aidiyRoot: string) => string;
};
export function パネルプロジェクト(project = process.env.AIDIY_DISCORD_PROJECT ?? ''): string {
  return projectRoot(project, プロジェクトルート);
}
export function パネル設定保存先(project = process.env.AIDIY_DISCORD_PROJECT ?? ''): string {
  return join(programDataDirectory(project, 'aidiy_discord', プロジェクトルート), 'aidiy_discord.json');
}
export type パネル設定 = { live: boolean; live_models: Record<string, string>; code_name: string; code_model: string };

function ライブモデル検証(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ライブモデル指定が不正です。');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key, item]) => !/^LIVE_[A-Z_]+$/.test(key) || typeof item !== 'string' || item.length > 300)) throw new Error('ライブモデル指定が不正です。');
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]).filter(([, item]) => item));
}
function 検証(value: unknown): パネル設定 {
  const data = value as Partial<Record<keyof パネル設定, unknown>> | null;
  if (typeof data?.live !== 'boolean') throw new Error('Live の ON/OFF を指定してください。');
  return { live: data.live, live_models: ライブモデル検証(data.live_models), code_name: コード名検証(data.code_name), code_model: Hermesモデル検証(data.code_model) };
}

export function パネル設定保存(value: unknown, file = パネル設定保存先()): パネル設定 {
  const settings = 検証(value);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
  return settings;
}

/** 保存済みの設定。未保存・破損時は undefined。旧保存先は読まず、移行しない。 */
export function パネル設定読込(_既定モデル: string, file = パネル設定保存先()): パネル設定 | undefined {
  try { return 検証(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { return undefined; }
}

/** 画面の保存（機能・Live・コードの順）を、1ファイルの該当項目だけ更新する形で受ける。 */
export function パネル設定更新(patch: Partial<パネル設定>, 既定モデル: string, file = パネル設定保存先()): パネル設定 {
  const current = パネル設定読込(既定モデル, file) ?? { live: false, live_models: {}, code_name: 既定コード名, code_model: 既定モデル };
  return パネル設定保存({ ...current, ...patch }, file);
}
