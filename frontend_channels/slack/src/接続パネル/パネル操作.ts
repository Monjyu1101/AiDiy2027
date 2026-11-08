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

import { basename } from 'node:path';
import { SlackBot, エラー案内 } from '../接続/Bot接続';
import { 設定読込, 設定エラー, type Slack設定 } from '../接続/接続設定';
import { SlackAPIエラー } from '../接続/ネットワーク接続';
import { 起動解決 } from '../共通連携/IDE連携';
import { モデル情報取得, type モデル初期情報 } from '../モデル情報/モデル情報';
import { Hermesモデル候補, Hermesモデル検証, 既定コード名, 対応コード名 } from '../コード/Hermesモデル';
import { パネル設定保存先, パネル設定読込, パネル設定保存 } from './パネル設定';

export type パネル発言 = { who: string; text: string; role: 'user' | 'ai' };
export type パネル状態 = { phase: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopping' | 'error'; message: string; details?: string };
type 接続段階 = '設定読込' | 'Hermes確認' | 'Bot作成' | 'Slack接続';
type Bot = Pick<SlackBot, '起動' | '終了' | '表示' | '正常'>;

/** 接続失敗の詳細。token・API 応答本文は含めず、段階と Slack のエラーコードだけを示す。 */
export function 接続エラー詳細(error: unknown, stage: 接続段階, elapsed: number) {
  const kind = error instanceof SlackAPIエラー ? `Slack API ${error.method}: ${error.error}`
    : error instanceof 設定エラー ? '設定エラー' : error instanceof Error ? error.name : typeof error;
  return [`段階: ${stage}`, `種別: ${kind}`, `経過: ${(elapsed / 1000).toFixed(1)} 秒`].join('\n');
}

// UI に渡すのは表示用のモデル情報と状態だけ。トークンや接続 ID は worker 内に保持する。
export class Slackパネル {
  状態: パネル状態 = { phase: 'idle', message: '未接続 · 接続ボタンで接続します。' };
  private bot?: Bot;
  private cancel?: () => void;
  private stopping?: Promise<void>;
  private generation = 0;
  private closed = false;
  private apiAbort = new AbortController();
  private apiInfo?: モデル初期情報;
  発言?: (value: パネル発言) => void;
  constructor(private changed: (state: パネル状態) => void,
    private readConfig = 設定読込,
    private createBot: (config: Slack設定) => Bot = config => new SlackBot(config),
    private settingsFile = パネル設定保存先(),
    private validateCLI = (config: Slack設定) => { 起動解決(config.cli, config.python, config.folder); },
    private timeoutMs = 40_000,
    private readAPI = モデル情報取得) {}
  private 状態変更(phase: パネル状態['phase'], message: string, details?: string) {
    this.状態 = { phase, message, ...(details ? { details } : {}) }; this.changed(this.状態);
  }
  /** 未保存時の初期表示は共通設定の CODE_AIDIY_HERMES_MODEL（AIコアの値を優先）。 */
  private 既定モデル(config: Slack設定) { return this.apiInfo?.settings.CODE_AIDIY_HERMES_MODEL || config.hermesModel; }
  private 保存値(config: Slack設定) { return パネル設定読込(this.既定モデル(config), this.settingsFile); }
  async 初期情報() {
    if (this.apiAbort.signal.aborted && !this.closed) this.apiAbort = new AbortController();
    const config = this.readConfig();
    this.apiInfo = await this.readAPI(config.coreUrl, undefined, config.coreRoot, { signal: this.apiAbort.signal });
    const saved = this.保存値(config);
    return { state: this.状態, firstRun: !saved, code: { cli: saved?.code_name ?? 既定コード名, model: saved?.code_model ?? this.既定モデル(config) }, folder: { name: basename(config.folder) || config.folder, path: config.folder } };
  }
  /** aidiy_hermes のモデル候補（auto / same / openai_oauth/gpt-… など）。 */
  async コード候補() {
    if (this.closed) throw new Error();
    return { models: Hermesモデル候補(this.apiInfo) };
  }
  コード選択保存(value: unknown) {
    if (this.closed || !['idle', 'error'].includes(this.状態.phase)) throw new Error('切断してからモデルを選択してください。');
    const model = Hermesモデル検証((value as { model?: unknown } | null)?.model);
    const saved = パネル設定保存({ code_name: 既定コード名, code_model: model }, this.settingsFile);
    return { cli: saved.code_name, model: saved.code_model };
  }
  /** 一度でも接続時の設定を保存したか。初回は自動接続せず、モデル設定画面から始める。 */
  設定済み() { return !!this.保存値(this.readConfig()); }
  /** 起動時の自動接続。初回は接続せず false を返す（Discord 版と同じ動き）。 */
  async 自動開始() {
    if (this.closed || !this.設定済み()) return false;
    await this.開始();
    return true;
  }
  async 開始() {
    if (this.closed || !['idle', 'error'].includes(this.状態.phase)) return;
    this.apiAbort.abort(); this.apiAbort = new AbortController();
    const run = ++this.generation;
    this.状態変更('connecting', 'Slack に接続しています…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stage: 接続段階 = '設定読込';
    const startedAt = Date.now();
    try {
      const config = this.readConfig();
      this.apiInfo = await this.readAPI(config.coreUrl, undefined, config.coreRoot, { signal: this.apiAbort.signal });
      if (run !== this.generation || this.closed) return;
      const saved = this.保存値(config);
      // 将来の別ハーネス用に code_name を保存している。現在は aidiy_hermes だけを実行できる。
      if (saved && !対応コード名.includes(saved.code_name)) throw new 設定エラー(`コード実行環境 ${saved.code_name} には未対応です。aidiy_hermes を選び直してください。`);
      stage = 'Hermes確認'; this.validateCLI(config);
      stage = 'Bot作成';
      const bot = this.createBot({ ...config, hermesModel: saved?.code_model ?? this.既定モデル(config) });
      this.bot = bot;
      bot.表示 = (who, text, role) => { if (run === this.generation) this.発言?.({ who: who.slice(0, 100), text: text.slice(0, 2000), role }); };
      const cancelled = new Promise<void>(resolve => { this.cancel = resolve; });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new 設定エラー(`${stage}が${this.timeoutMs / 1000}秒以内に完了しませんでした。Slack への通信状態を確認してください。`)), this.timeoutMs); });
      stage = 'Slack接続';
      await Promise.race([bot.起動(), cancelled, timeout]);
      if (run !== this.generation) return;
      this.状態変更('connected', '接続中 · 専用チャンネルの投稿にスレッドで返信します。');
    } catch (error) {
      if (run !== this.generation) return;
      const message = error instanceof 設定エラー || error instanceof Error && error.constructor === Error ? error.message : エラー案内(error);
      const details = 接続エラー詳細(error, stage, Date.now() - startedAt);
      console.error(`[Slack] 接続失敗: ${message}\n${details}`);
      await this.停止().catch(() => {});
      if (!this.closed) this.状態変更('error', message, details);
    } finally {
      clearTimeout(timer);
      if (run === this.generation) this.cancel = undefined;
    }
  }
  /** 定期取得の失敗が続く間は再接続中と表示する（Bot は自動で再試行を続ける）。 */
  接続確認() {
    if (!this.bot || !['connected', 'reconnecting'].includes(this.状態.phase)) return;
    const ready = this.bot.正常;
    if (ready && this.状態.phase !== 'connected') this.状態変更('connected', '接続中 · 専用チャンネルの投稿にスレッドで返信します。');
    if (!ready && this.状態.phase !== 'reconnecting') this.状態変更('reconnecting', 'Slack への再接続を待っています…');
  }
  停止(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.apiAbort.abort();
    ++this.generation; this.cancel?.(); this.cancel = undefined;
    const bot = this.bot; this.bot = undefined;
    if (!bot) { this.状態変更('idle', '切断しました。接続すると再接続します。'); return Promise.resolve(); }
    this.状態変更('stopping', 'コード要求を終了し、Slack から切断しています…');
    this.stopping = (async () => {
      try { await bot.終了(); this.状態変更('idle', '切断しました。接続すると再接続します。'); }
      catch {
        this.closed = true;
        this.状態変更('error', '終了処理に失敗しました。パネルを閉じて開き直してください。');
        throw new Error('Slack の終了処理に失敗しました。');
      } finally { this.stopping = undefined; }
    })();
    return this.stopping;
  }
  async 終了() {
    this.closed = true;
    await this.停止();
  }
}
