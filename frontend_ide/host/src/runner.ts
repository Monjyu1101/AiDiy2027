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

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { stripVTControlCharacters } from 'node:util';

export interface 起動設定 { 実行ファイル: string; 引数: string[] }
export interface 実行結果 { 回答: string; ログ: string; セッションID?: string; 終了コード: number | null; 停止理由?: string; セッション復旧?: boolean }
export interface 実行要求 {
  起動: 起動設定; 作業フォルダ: string; 本文: string; 引数: string[]; 制限時間: number;
  進捗?: (行: string) => void;
  ストリーム?: (行: string, 出力元: 'stdout' | 'stderr') => void;
}

function ファイルあり(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

// .cmd をシェルへ渡さず、_setup.py が生成する PY / CLI の絶対パスを解決する。
export function 起動解決(cliPath: string, pythonPath = '', 作業フォルダ?: string): 起動設定 {
  const 候補: string[] = [];
  if (isAbsolute(cliPath)) 候補.push(cliPath);
  else {
    if (cliPath.includes('/') || cliPath.includes('\\')) throw new Error('CLI は絶対パスで指定してください。');
    const 拡張子 = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
    for (const dir of [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin')]) {
      if (!isAbsolute(dir)) continue;
      for (const ext of 拡張子) 候補.push(join(dir, cliPath + ext));
    }
    if (cliPath === 'aidiy_hermes' && 作業フォルダ) {
      候補.push(join(作業フォルダ, 'command_hermes', 'cli_main.py'));
    }
  }
  const file = 候補.find(ファイルあり);
  if (!file) throw new Error('aidiy_hermes が見つかりません。CLI をセットアップするか、設定の Cli Path に絶対パスを指定してください。');
  if (/\.(cmd|bat)$/i.test(file)) {
    const script = readFileSync(file, 'utf8');
    const python = script.match(/^\s*set\s+"PY=([^"\r\n]+)"\s*$/im)?.[1];
    const cli = script.match(/^\s*set\s+"CLI=([^"\r\n]+)"\s*$/im)?.[1];
    if (!python || !cli || !isAbsolute(python) || !isAbsolute(cli) || !ファイルあり(python) || !ファイルあり(cli)) {
      throw new Error('この .cmd は AiDiy の起動形式ではありません。Cli Path に cli_main.py、Python Path に仮想環境の Python を指定してください。');
    }
    return { 実行ファイル: python, 引数: [cli] };
  }
  if (/\.py$/i.test(file)) {
    const python = pythonPath || join(dirname(file), '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
    if (!isAbsolute(python) || !ファイルあり(python)) throw new Error('Python が見つかりません。Python Path に仮想環境の Python の絶対パスを指定してください。');
    return { 実行ファイル: python, 引数: [file] };
  }
  return { 実行ファイル: file, 引数: [] };
}

export function 会話引数(provider: string, model: string, maxTurns: number, セッションID?: string): string[] {
  const args = ['-Q', '--oneshot-stdin', '--max-turns', String(maxTurns)];
  if (provider.trim()) args.push('--provider', provider.trim());
  const modelId = model.trim();
  if (modelId && !['auto', 'same'].includes(modelId.toLowerCase())) args.push('--model', modelId);
  if (セッションID) args.push('--resume', セッションID);
  return args;
}

export function 再開セッション不在(結果: 実行結果, セッションID?: string): boolean {
  if (!セッションID || 結果.終了コード === 0 || 結果.停止理由) return false;
  return 結果.ログ.split(/\r?\n/).some(line => line.trim() === `Session not found: ${セッションID}`);
}

export function CLI実行(要求: 実行要求): { 完了: Promise<実行結果>; 停止: (理由?: string) => void } {
  const child = spawn(要求.起動.実行ファイル, [...要求.起動.引数, ...要求.引数], {
    cwd: 要求.作業フォルダ, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', NO_COLOR: '1', TERM: 'dumb', TERMINAL_CWD: 要求.作業フォルダ }
  });
  let 回答 = '', ログ = '', 保留行 = '', 標準出力保留 = '', セッションID: string | undefined;
  let 停止理由: string | undefined, 終了済み = false;
  let 強制停止: NodeJS.Timeout | undefined;
  const 停止 = (理由 = '停止しました。実行済みのファイル変更は残ります。') => {
    if (終了済み || 停止理由) return;
    停止理由 = 理由;
    if (!child.pid) return;
    if (process.platform === 'win32') {
      const kill = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      kill.on('error', () => child.kill());
      kill.on('exit', code => { if (code && !終了済み) child.kill(); });
    } else {
      const kill = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* 既に終了 */ } };
      kill('SIGTERM');
      強制停止 = setTimeout(() => kill('SIGKILL'), 1500);
    }
  };
  // stdout/stderr の受信ごとに更新する。改行のない途中チャンクも通信中とみなす。
  let タイマー: NodeJS.Timeout;
  const 受信待機開始 = () => {
    clearTimeout(タイマー);
    タイマー = setTimeout(() => 停止('最後の受信から制限時間を超えたため停止しました。設定で制限時間を変更できます。'), 要求.制限時間);
  };
  受信待機開始();
  const 行処理 = (line: string) => {
    const clean = stripVTControlCharacters(line).trim();
    if (!clean) return;
    要求.ストリーム?.(clean, 'stderr');
    const match = clean.match(/^session_id:\s*([A-Za-z0-9_.:-]+)$/);
    if (match) セッションID = match[1];
    else 要求.進捗?.(clean);
  };
  const 完了 = new Promise<実行結果>((成功, 失敗) => {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      受信待機開始();
      回答 += chunk;
      標準出力保留 += chunk;
      const lines = 標準出力保留.split(/\r\n|\n/);
      標準出力保留 = (lines.pop() ?? '').slice(-2_000_000);
      for (const line of lines) 要求.ストリーム?.(stripVTControlCharacters(line).trimEnd(), 'stdout');
      if (回答.length > 2_000_000) { 回答 = 回答.slice(0, 2_000_000); 停止('回答が表示上限を超えたため停止しました。'); }
    });
    child.stderr.on('data', (chunk: string) => {
      受信待機開始();
      ログ = (ログ + stripVTControlCharacters(chunk)).slice(-64_000);
      保留行 += chunk;
      const lines = 保留行.split(/\r\n|\r|\n/);
      保留行 = (lines.pop() ?? '').slice(-64_000);
      for (const line of lines) 行処理(line);
    });
    child.once('error', error => {
      終了済み = true; clearTimeout(タイマー); clearTimeout(強制停止);
      失敗(new Error(`CLI を起動できません: ${error.message}`));
    });
    child.once('close', code => {
      終了済み = true; clearTimeout(タイマー); clearTimeout(強制停止);
      行処理(保留行);
      if (標準出力保留) 要求.ストリーム?.(stripVTControlCharacters(標準出力保留).trimEnd(), 'stdout');
      成功({ 回答: stripVTControlCharacters(回答).trim(), ログ, セッションID, 終了コード: code, 停止理由 });
    });
    // 起動失敗や stdin を読まず終了する CLI の EPIPE を未処理例外にしない。
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') 停止(`入力を送信できません: ${error.message}`); });
    child.stdin.end(要求.本文, 'utf8');
  });
  return { 完了, 停止 };
}
