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

import { Code接続 } from '../コード/コード会話';
import type { Slack設定 } from './接続設定';
import { コマンド解析, 会話キー, 利用許可, 本文エスケープ, 本文復元, 本文分割, ts比較, type Slackメッセージ } from './コマンド処理';
import { SlackAPIエラー, Slack通信, type SlackAPI } from './ネットワーク接続';

export const コマンド案内 = 'このチャンネルに、そのまま話しかけてください。AiDiy がスレッドで返信します。\nスレッド内の返信は同じ会話として続きます。\n`!stop` で停止、`!new` で会話をやり直し、`!status` で状態、`!help` で使い方を表示します。\n先頭の ! は全角の ！ でも使えます。`!chat 本文` でも会話できます。旧形式は使わず短いコマンドを入力してください。';

type スレッド = { lastSeen: string; touched: number };
export type 巡回設定 = { interval?: number; maxBackoff?: number; threadLimit?: number; threadIdleMs?: number };

const 案内エラー: Record<string, string> = {
  not_in_channel: 'Bot が専用チャンネルに参加していません。チャンネルにアプリを追加してください。',
  channel_not_found: 'slack_text_channel_id のチャンネルが見つかりません。',
  missing_scope: 'Bot の権限（channels:history / chat:write）が不足しています。',
  invalid_auth: 'slack_bot_token が無効です。', not_authed: 'slack_bot_token が無効です。',
  token_revoked: 'slack_bot_token は失効しています。', account_inactive: 'Bot が無効化されています。',
  network_error: 'Slack に接続できません。ネットワーク・プロキシ設定を確認してください。',
};
export const エラー案内 = (error: unknown) => error instanceof SlackAPIエラー
  ? 案内エラー[error.error] || error.message
  : '処理に失敗しました。設定・権限・接続状態を確認してください。';

// WebSocket（Socket Mode）を使わず、Web API の定期取得で専用チャンネルを監視する。
// 新規投稿は conversations.history、継続中のスレッドは conversations.replies で拾う。
export class SlackBot {
  private api: SlackAPI;
  private network?: Slack通信;
  private code: Code接続;
  private botUserId = '';
  private cursor = '0';
  private threads = new Map<string, スレッド>();
  private threadOrder: string[] = [];
  private seen = new Set<string>();
  private chatQueue = new Map<string, Promise<void>>();
  private chatState = new Map<string, { count: number; stopped: boolean }>();
  private closing = false;
  private shutdown?: Promise<void>;
  private loop?: Promise<void>;
  private wake?: () => void;
  private failures = 0;
  private 初回案内済み = false;
  private 返信待ち: Promise<void> = Promise.resolve();
  private lastError = '';
  private 最終会話時刻 = Date.now();
  private interval: number; private maxBackoff: number; private threadLimit: number; private threadIdleMs: number;
  // パネル下部に最後の発言を表示する。Slack への投稿とは独立している。
  表示?: (who: string, text: string, role: 'user' | 'ai') => void;
  constructor(private config: Slack設定, api?: SlackAPI, code?: Code接続, options: 巡回設定 = {}) {
    if (!api) this.network = new Slack通信(config.botToken);
    this.api = api ?? this.network!.呼出;
    this.code = code ?? new Code接続(config);
    this.interval = options.interval ?? 3000; this.maxBackoff = options.maxBackoff ?? 60_000;
    this.threadLimit = options.threadLimit ?? 20; this.threadIdleMs = options.threadIdleMs ?? 2 * 60 * 60_000;
  }
  get 経路() { return this.network?.経路 ?? '直接接続'; }
  /** 定期取得が連続して失敗している間は false。パネルの再接続表示に使う。 */
  get 正常() { return !this.closing && !!this.loop && this.failures === 0; }

  async 起動() {
    if (this.closing) throw new Error('Slack 接続は終了しています。');
    try {
      const auth = await this.api('auth.test', {});
      // token の形式だけを信用せず、返されたワークスペースを固定値と照合する。
      if (auth.team_id !== this.config.teamId) throw new Error('slack_bot_token のワークスペースが slack_team_id と一致しません。');
      if (typeof auth.user_id !== 'string') throw new Error('Bot ユーザーを確認できません。');
      this.botUserId = auth.user_id;
      // 起動前の投稿には返信しない。最新の投稿位置から監視を始める。
      const latest = await this.api('conversations.history', { channel: this.config.channelId, limit: '1' });
      const top = (latest.messages as Slackメッセージ[] | undefined)?.[0];
      this.cursor = typeof top?.ts === 'string' ? top.ts : '0';
    } catch (error) { await this.終了().catch(() => {}); throw error; }
    console.log(`[Slack] 接続しました（${this.経路}）。専用チャンネルに話しかけるとスレッドで返信します。`);
    this.最終会話時刻 = Date.now();
    this.loop = this.巡回ループ();
  }

  private async 巡回ループ() {
    while (!this.closing) {
      try {
        await this.巡回();
        if (this.failures) console.log('[Slack] 接続が回復しました。');
        this.failures = 0; this.lastError = '';
      } catch (error) {
        if (this.closing) return;
        this.failures++;
        const text = エラー案内(error);
        // 同じ失敗の連続は間引いて出力する。
        if (text !== this.lastError || this.failures % 10 === 0) console.error(`[Slack] ${text}`);
        this.lastError = text;
      }
      // 会話が10分なければ巡回を6秒へ落とす。回答待ちと新しい会話は通常間隔を使う。
      const busy = [...this.chatState.values()].some(state => state.count > 0);
      const interval = !busy && Date.now() - this.最終会話時刻 >= 10 * 60_000
        ? Math.max(this.interval, 6000) : this.interval;
      const wait = this.failures ? Math.min(this.interval * 2 ** Math.min(this.failures, 10), this.maxBackoff) : interval;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = undefined; resolve(); }, wait);
        this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
      });
    }
  }

  // 全ページの取得に成功するまで既読位置を変えない。途中で失敗した場合は同じ位置から再試行する。
  private async メッセージ取得(method: 'conversations.history' | 'conversations.replies', initial: Record<string, string>) {
    const messages: Slackメッセージ[] = [], cursors = new Set<string>();
    let params = { ...initial };
    while (!this.closing) {
      const result = await this.api(method, params);
      const page = ((result.messages as Slackメッセージ[] | undefined) ?? []).filter(message => typeof message?.ts === 'string');
      messages.push(...page);
      const metadata = result.response_metadata as { next_cursor?: unknown } | undefined;
      const cursor = typeof metadata?.next_cursor === 'string' ? metadata.next_cursor.trim() : '';
      if (cursor) {
        if (cursors.has(cursor)) throw new SlackAPIエラー(method, 'invalid_response');
        cursors.add(cursor); params = { ...params, cursor }; continue;
      }
      if (result.has_more !== true) return messages;
      // 時刻ページングだけの応答にも対応する。履歴は新しい順、返信は古い順。
      const sorted = page.map(message => message.ts as string).sort(ts比較);
      const boundary = method === 'conversations.history' ? sorted[0] : sorted.at(-1);
      const key = method === 'conversations.history' ? 'latest' : 'oldest';
      if (!boundary || (params[key] && (method === 'conversations.history'
        ? ts比較(boundary, params[key]) >= 0 : ts比較(boundary, params[key]) <= 0))) {
        throw new SlackAPIエラー(method, 'invalid_response');
      }
      params = { ...params, [key]: boundary, inclusive: 'false' }; delete params.cursor;
    }
    return [];
  }

  /** 1回分の取得。試験から直接呼べるよう公開する。 */
  async 巡回() {
    const history = await this.メッセージ取得('conversations.history', { channel: this.config.channelId, oldest: this.cursor, inclusive: 'false', limit: '100' });
    const messages = history.filter(m => ts比較(m.ts as string, this.cursor) > 0);
    messages.sort((a, b) => ts比較(a.ts as string, b.ts as string));
    for (const message of messages) {
      this.cursor = message.ts as string;
      if (this.closing) return;
      this.受信(message, typeof message.thread_ts === 'string' ? message.thread_ts : message.ts as string);
    }
    await this.スレッド巡回();
  }

  private async スレッド巡回() {
    const now = Date.now();
    for (const [root, thread] of this.threads) if (now - thread.touched > this.threadIdleMs) this.スレッド削除(root);
    // 呼出回数を抑えるため、1回の巡回で確認するスレッドは1つだけにする。
    const root = this.threadOrder.shift();
    if (!root) return;
    this.threadOrder.push(root);
    const thread = this.threads.get(root)!;
    let replies;
    try { replies = await this.メッセージ取得('conversations.replies', { channel: this.config.channelId, ts: root, oldest: thread.lastSeen, inclusive: 'false', limit: '100' }); }
    catch (error) {
      if (error instanceof SlackAPIエラー && error.error === 'thread_not_found') { this.スレッド削除(root); return; }
      throw error;
    }
    const messages = replies
      .filter(m => typeof m.ts === 'string' && m.ts !== root && ts比較(m.ts, thread.lastSeen) > 0);
    messages.sort((a, b) => ts比較(a.ts as string, b.ts as string));
    for (const message of messages) {
      thread.lastSeen = message.ts as string;
      if (this.closing) return;
      this.受信(message, root);
    }
  }

  private スレッド登録(root: string, ts: string) {
    const thread = this.threads.get(root);
    if (thread) { if (ts比較(ts, thread.lastSeen) > 0) thread.lastSeen = ts; thread.touched = Date.now(); return; }
    if (this.threads.size >= this.threadLimit) {
      const oldest = [...this.threads.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) this.スレッド削除(oldest[0]);
    }
    this.threads.set(root, { lastSeen: ts, touched: Date.now() });
    this.threadOrder.unshift(root);
  }
  private スレッド削除(root: string) {
    this.threads.delete(root);
    this.threadOrder = this.threadOrder.filter(item => item !== root);
  }

  private 受信(message: Slackメッセージ, root: string) {
    if (this.closing || !利用許可(this.config, message)) return;
    // 取得範囲の重なりや再取得で同じ投稿を二重に実行しない。
    if (this.seen.has(message.ts)) return;
    this.最終会話時刻 = Date.now();
    this.seen.add(message.ts);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    this.スレッド登録(root, message.ts);
    void this.メッセージ処理(本文復元(message.text), root).catch(() => console.error('[Slack] メッセージ処理・返信に失敗しました。権限と接続状態を確認してください。'));
  }

  private async メッセージ処理(content: string, root: string) {
    const command = コマンド解析(content, '!', this.botUserId);
    if (!command) return;
    const key = 会話キー(this.config.teamId, this.config.channelId, root);
    const reply = (text: string) => this.回答送信(root, text);
    try {
      switch (command.name) {
        case 'help':
          await reply(コマンド案内); return;
        case 'status': await reply(`Code: ${this.code.実行中(key) ? '実行中' : '待機中'}`); return;
        case 'stop': {
          const pending = this.chatState.get(key);
          const running = this.code.実行中(key) || !!pending?.count;
          if (pending) { pending.stopped = true; this.chatState.delete(key); }
          this.code.停止(key);
          await reply(running ? '停止を要求しました。実行済みの変更は残ります。' : '実行中のコード要求はありません。'); return;
        }
        case 'new': this.code.リセット(key); await reply('このスレッドで新しいコード会話を開始します。'); return;
        case 'chat': if (command.text) await this.チャット受付(key, root, command.text); return;
      }
    } catch (error) {
      if (this.closing) return;
      // API 内部エラーのオブジェクトは出力せず、案内文だけを返す。
      const text = error instanceof Error && error.constructor === Error ? error.message : エラー案内(error);
      await reply(text.slice(0, 1800));
    }
  }

  private async チャット受付(key: string, root: string, text: string) {
    const state = this.chatState.get(key) ?? { count: 0, stopped: false };
    if (state.count >= 10) throw new Error('返信待ちのメッセージが多いため、少し待ってから送ってください。');
    state.count++; this.chatState.set(key, state);
    const previous = this.chatQueue.get(key) || Promise.resolve();
    // users:read 権限を求めないため、投稿者の表示名は取得しない。
    this.表示?.('あなた', text, 'user');
    const pending = previous.catch(() => {}).then(async () => {
      if (this.closing || state.stopped) return;
      // 実行中であることを先に示し、回答で同じ投稿を書き換える。
      const placeholder = await this.投稿(root, '考えています…').catch(() => undefined);
      if (this.closing) return;
      if (state.stopped) {
        if (placeholder) await this.回答送信(root, '停止しました。', placeholder);
        return;
      }
      const answer = await this.code.実行(key, text);
      if (this.closing) return;
      // Slack アプリ名（Bot ユーザー名）ではなく、AiDiy として表示する。
      this.表示?.('AiDiy', answer, 'ai');
      await this.回答送信(root, answer, placeholder);
    });
    this.chatQueue.set(key, pending);
    try { await pending; }
    finally {
      state.count--;
      if (!state.count && this.chatState.get(key) === state) this.chatState.delete(key);
      if (this.chatQueue.get(key) === pending) this.chatQueue.delete(key);
    }
  }

  private async 回答送信(root: string, text: string, placeholder?: string) {
    if (this.closing) return;
    if (this.初回案内済み) return this.回答本文送信(root, text, placeholder);
    // 仮の「考えています…」は更新で消えるため対象外。確定返信を直列化し、
    // 初回案内を含む全チャンクが送れた時だけ消費する（失敗時は次の返信へ）。
    const pending = this.返信待ち.catch(() => {}).then(async () => {
      if (this.closing) return;
      const firstReply = !this.初回案内済み;
      await this.回答本文送信(root, text, placeholder, firstReply && text !== コマンド案内);
      if (firstReply) this.初回案内済み = true;
    });
    this.返信待ち = pending;
    await pending;
  }

  private async 回答本文送信(root: string, text: string, placeholder?: string, appendHelp = false) {
    const parts = 本文分割(text);
    if (appendHelp) {
      const suffix = `\n\n${コマンド案内}`;
      // help 自体をチャンク境界で割らず、末尾チャンクの成功で消費を確定する。
      if (parts.length && parts.at(-1)!.length + suffix.length <= 3500) parts[parts.length - 1] += suffix;
      else parts.push(suffix);
    }
    let first = parts.shift() ?? '';
    if (placeholder) {
      try { await this.api('chat.update', { channel: this.config.channelId, ts: placeholder, text: 本文エスケープ(first) }); first = ''; }
      catch { /* 書き換えに失敗した場合は新しい投稿で返す。 */ }
    }
    for (const part of [first, ...parts]) if (part) await this.投稿(root, part);
    this.最終会話時刻 = Date.now();
  }

  private async 投稿(root: string, text: string): Promise<string | undefined> {
    const result = await this.api('chat.postMessage', {
      channel: this.config.channelId, thread_ts: root, text: 本文エスケープ(text),
      unfurl_links: 'false', unfurl_media: 'false',
    });
    this.最終会話時刻 = Date.now();
    return typeof result.ts === 'string' ? result.ts : undefined;
  }

  終了(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true; this.wake?.();
    const cleanup = [() => this.code.終了(), () => this.network?.終了(), () => this.loop];
    this.shutdown = Promise.allSettled(cleanup.map(stop => Promise.resolve().then(stop))).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('Slack 接続の終了処理に失敗しました。');
    });
    return this.shutdown;
  }
}
