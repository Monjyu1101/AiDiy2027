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
import { DiscordBot } from '../接続/Bot接続';
import { 設定読込, 設定エラー, type Discord設定 } from '../接続/接続設定';
import { ライブ選択エラー, 起動解決 } from '../共通連携/IDE連携';
import { ライブ候補読込, ライブ初期値 } from '../ライブ/ライブモデル候補';
import { モデル情報取得, type モデル初期情報 } from '../モデル情報/モデル情報';
import { 接続失敗案内, 接続エラー詳細, type 接続段階 } from '../接続/接続エラー';
import { Hermesモデル候補, Hermesモデル検証, 既定コード名, 対応コード名 } from '../コード/Hermesモデル';
import { パネル設定保存先, パネル設定読込, パネル設定更新, type パネル設定 } from './パネル設定';

export type 機能設定 = { live: boolean; code: boolean };
/** Code は現在 ON 固定（パネルでは操作不可）。切替できるようになっても接続制御はそのまま使える。 */
export const コード固定ON = true;
export function 機能案内(features: 機能設定) {
  return features.live && features.code ? 'コード／音声会話' : features.live ? '音声会話' : features.code ? 'コード' : '機能なし';
}
export type パネル発言 = { who: string; text: string; role: 'user' | 'ai' };
export type パネル状態 = { phase: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopping' | 'error'; message: string; details?: string };
type Bot = Pick<DiscordBot, '起動' | '終了' | '表示' | 'メーター' | '音声'> & Partial<Pick<DiscordBot, 'モニター設定'>> & { client: { isReady(): boolean } };

// UI に渡すのは表示用モデル情報と状態だけ。トークンや接続 ID は worker 内に保持する。
export class Discordパネル {
  状態: パネル状態 = { phase: 'idle', message: '未接続 · 接続ボタンで接続します。' };
  private bot?: Bot;
  private cancel?: () => void;
  private stopping?: Promise<void>;
  private generation = 0;
  private closed = false;
  private apiAbort = new AbortController();
  private apiInfo?: モデル初期情報;
  発言?: (value: パネル発言) => void;
  音量?: (value: { kind: 'input' | 'output'; level: number; bins: number[] }) => void;
  音声?: (value: { kind: 'input' | 'output'; data: string; rate: number }) => void;
  constructor(private changed: (state: パネル状態) => void,
    private readConfig = 設定読込,
    private createBot: (config: Discord設定) => Bot = config => new DiscordBot(config),
    private settingsFile = パネル設定保存先(),
    private validateCLI = (config: Discord設定) => { 起動解決(config.cli, config.python, config.folder); },
    private timeoutMs = 40_000,
    private readCatalog = ライブ候補読込,
    private readAPI = モデル情報取得) {}
  /** 未保存時のコードモデルは共通設定の CODE_AIDIY_HERMES_MODEL（AIコアの値を優先）。 */
  private 既定モデル(config = this.readConfig()) { return this.apiInfo?.settings.CODE_AIDIY_HERMES_MODEL || config.hermesModel; }
  private 保存値(config = this.readConfig()): パネル設定 | undefined { return パネル設定読込(this.既定モデル(config), this.settingsFile); }
  /** 初回（未保存）は音声会話 OFF。保存後はその選択を使う。 */
  private get features(): 機能設定 { return { live: this.保存値()?.live ?? false, code: true }; }
  private get preferred(): Record<string, string> { return this.保存値()?.live_models ?? {}; }
  private 状態変更(phase: パネル状態['phase'], message: string, details?: string) {
    this.状態 = { phase, message, ...(details ? { details } : {}) }; this.changed(this.状態);
  }
  async 初期情報() {
    if (this.apiAbort.signal.aborted && !this.closed) this.apiAbort = new AbortController();
    const config = this.readConfig();
    this.apiInfo = await this.readAPI(config.coreUrl, undefined, config.coreRoot, { signal: this.apiAbort.signal });
    const { models, voices } = this.apiInfo?.catalog || this.readCatalog();
    const settings = { ...ライブ初期値(this.apiInfo?.settings || config.liveModels, {models, voices}), ...this.preferred };
    const notice = this.features.live ? ライブ選択エラー(settings, { models, voices }) : '';
    const saved = this.保存値(config);
    return { state: this.状態, firstRun: !saved, features: this.features, settings, models, voices, notice, code: { cli: saved?.code_name ?? 既定コード名, model: saved?.code_model ?? this.既定モデル(config) }, folder: { name: basename(config.folder) || config.folder, path: config.folder } };
  }
  /** aidiy_hermes のモデル候補（auto / same / openai_oauth/gpt-… など）。 */
  async コード候補() {
    if (this.closed) throw new Error();
    return { models: Hermesモデル候補(this.apiInfo) };
  }
  private 編集確認(what: string) {
    if (this.closed || !['idle', 'error'].includes(this.状態.phase)) throw new Error(`切断してから${what}を選択してください。`);
  }
  コード選択保存(value: unknown) {
    this.編集確認('モデル');
    const model = Hermesモデル検証((value as { model?: unknown } | null)?.model);
    const saved = パネル設定更新({ code_name: 既定コード名, code_model: model }, this.既定モデル(), this.settingsFile);
    return { cli: saved.code_name, model: saved.code_model };
  }
  機能選択保存(value: unknown) {
    this.編集確認('機能');
    const live = (value as { live?: unknown } | null)?.live;
    if (typeof live !== 'boolean') throw new 設定エラー('Live の ON/OFF を指定してください。');
    return { live: パネル設定更新({ live }, this.既定モデル(), this.settingsFile).live, code: コード固定ON };
  }
  選択保存(value: unknown) {
    this.編集確認('モデル');
    const error = ライブ選択エラー({ ...(this.apiInfo?.settings || this.readConfig().liveModels), ...value as Record<string, string> }, this.apiInfo?.catalog || this.readCatalog());
    if (error) throw new 設定エラー(error);
    return パネル設定更新({ live_models: value as Record<string, string> }, this.既定モデル(), this.settingsFile).live_models;
  }
  /** 一度でも接続時の設定を保存したか。初回は自動接続せず、モデル設定画面から始める。 */
  設定済み() { return !!this.保存値(); }
  /** 起動時の自動接続。初回は接続せず false を返す（Slack 版と同じ動き）。 */
  async 自動開始() {
    if (this.closed || !this.設定済み()) return false;
    await this.開始();
    return true;
  }
  async 開始() {
    if (this.closed || !['idle', 'error'].includes(this.状態.phase)) return;
    this.apiAbort.abort(); this.apiAbort = new AbortController();
    const run = ++this.generation;
    this.状態変更('connecting', 'Discord に接続しています…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setInterval> | undefined;
    let stage: 接続段階 = '設定読込';
    let token = '';
    const startedAt = Date.now();
    try {
      const config = this.readConfig(); token = config.token;
      this.apiInfo = await this.readAPI(config.coreUrl, undefined, config.coreRoot, { signal: this.apiAbort.signal });
      if (run !== this.generation || this.closed) return;
      let liveModels = { ...(this.apiInfo?.settings || config.liveModels), ...this.preferred };
      // 接続制御: 無効な機能は確認も接続もしない。
      const features = this.features;
      if (!features.live && !features.code) throw new 設定エラー('Live と Code の両方が OFF です。どちらかを ON にしてください。');
      const saved = this.保存値(config);
      // 将来の別ハーネス用に code_name を保存している。現在は aidiy_hermes だけを実行できる。
      if (features.code && saved && !対応コード名.includes(saved.code_name)) throw new 設定エラー(`コード実行環境 ${saved.code_name} には未対応です。aidiy_hermes を選び直してください。`);
      if (features.code) { stage = 'Hermes確認'; this.validateCLI(config); }
      if (features.live) {
        stage = 'モデル確認';
        const catalog = this.apiInfo?.catalog || this.readCatalog();
        liveModels = { ...ライブ初期値(this.apiInfo?.settings || config.liveModels, catalog), ...this.preferred };
        const error = ライブ選択エラー(liveModels, catalog);
        if (error) throw new 設定エラー(error);
      }
      stage = 'Bot作成';
      const bot = this.createBot({ ...config, hermesModel: saved?.code_model ?? this.既定モデル(config), liveModels, liveEnabled: features.live, codeEnabled: features.code });
      this.bot = bot;
      bot.音声 = (kind, pcm, rate) => { if (run === this.generation) this.音声?.({ kind, data: pcm.toString('base64'), rate }); };
      bot.メーター = (kind, level, bins) => { if (run === this.generation) this.音量?.({ kind, level, bins }); };
      bot.表示 = (who, text, role) => { if (run === this.generation) this.発言?.({ who: who.slice(0, 100), text: text.slice(0, 2000), role }); };
      const cancelled = new Promise<void>(resolve => { this.cancel = resolve; });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new 設定エラー(`${stage}が${this.timeoutMs / 1000}秒以内に完了しませんでした。Discordへの通信状態を確認してください。`)), this.timeoutMs); });
      const connected = (async () => {
        stage = 'Discord接続';
        await bot.起動();
        if (run !== this.generation) return;
        // Gateway の login 完了後、サーバー・チャンネルの受信完了を待つ。
        stage = '準備完了待ち';
        if (!bot.client.isReady()) await new Promise<void>(resolve => {
          readyTimer = setInterval(() => { if (bot.client.isReady()) resolve(); }, 100);
        });
      })();
      await Promise.race([connected, cancelled, timeout]);
      if (run !== this.generation) return;
      if (!bot.client.isReady()) throw new Error();
      this.状態変更('connected', `接続中 · ${機能案内(this.features)}を利用できます。`);
    } catch (error) {
      if (run !== this.generation) return;
      const message = 接続失敗案内(error, stage);
      const details = 接続エラー詳細(error, stage, token, Date.now() - startedAt);
      console.error(`[Discord] 接続失敗: ${message}\n${details}`);
      await this.停止();
      if (!this.closed) this.状態変更('error', message, details);
    } finally {
      clearTimeout(timer);
      clearInterval(readyTimer);
      if (run === this.generation) this.cancel = undefined;
    }
  }
  /** 接続中の音声をパネルで聞くかどうか。新しい接続は常に OFF から始まる。 */
  モニター(value: unknown) {
    if (typeof value !== 'boolean') throw new Error();
    if (value && !this.features.live) throw new 設定エラー('Live が OFF のためモニターできません。');
    if (value && this.状態.phase !== 'connected' && this.状態.phase !== 'reconnecting') throw new 設定エラー('接続中だけモニターできます。');
    this.bot?.モニター設定?.(value);
    return value;
  }
  接続確認() {
    if (!this.bot || !['connected', 'reconnecting'].includes(this.状態.phase)) return;
    const ready = this.bot.client.isReady();
    if (ready && this.状態.phase !== 'connected') this.状態変更('connected', `接続中 · ${機能案内(this.features)}を利用できます。`);
    if (!ready && this.状態.phase !== 'reconnecting') this.状態変更('reconnecting', 'Discord への再接続を待っています…');
  }
  停止(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.apiAbort.abort();
    ++this.generation; this.cancel?.(); this.cancel = undefined;
    const bot = this.bot; this.bot = undefined;
    if (!bot) { this.状態変更('idle', '切断しました。接続すると再接続します。'); return Promise.resolve(); }
    this.状態変更('stopping', '会話を終了し、Discord から切断しています…');
    this.stopping = (async () => {
      try { await bot.終了(); this.状態変更('idle', '切断しました。接続すると再接続します。'); }
      catch {
        this.closed = true;
        this.状態変更('error', '終了処理に失敗しました。パネルを閉じて開き直してください。');
        throw new Error('Discord の終了処理に失敗しました。');
      } finally { this.stopping = undefined; }
    })();
    return this.stopping;
  }
  async 終了() {
    this.closed = true;
    await this.停止();
  }
}
