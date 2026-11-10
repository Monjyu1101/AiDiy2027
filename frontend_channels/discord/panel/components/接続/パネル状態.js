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

import { computed, reactive, watch, watchEffect, nextTick } from 'vue';
import { 音声表示 } from '../ライブ/音声表示.js';

// IPC / 設定 JSON の英語キーは外部契約。画面内の状態名は各アプリと同じ日本語に揃える。
const ライブ設定キー = { freeai_live: ['LIVE_FREEAI_MODEL', 'LIVE_FREEAI_VOICE'], gemini_live: ['LIVE_GEMINI_MODEL', 'LIVE_GEMINI_VOICE'], openai_live: ['LIVE_OPENAI_MODEL', 'LIVE_OPENAI_VOICE'] };
const AI候補 = { freeai_live: 'FreeAI Live', gemini_live: 'Gemini Live', openai_live: 'OpenAI Live' };
const 状態名 = { idle: '未接続', connecting: '接続中', connected: '接続済み', reconnecting: '再接続中', stopping: '切断中', error: 'エラー' };

export function パネル状態作成(api) {
  const モデル一覧 = reactive({}), 音声一覧 = reactive({});
  let 設定 = {}, 保存待ち = Promise.resolve(), 候補世代 = 0;
  let 終了済み = false, 状態通知済み = false, 状態案内 = false, 描画, 本文要素, 詳細要素;
  let 入力タイマー, 消去タイマー, 音声Context, 音声世代 = 0, 操作世代 = 0, 退避;
  let 再生時刻 = { input: 0, output: 0 };
  const 解除 = [];
  const 画面 = reactive({
    接続状態: { phase: 'idle' }, 読込済み: false, 保存中: false, 致命的: false, 操作中: false, 操作種別: '',
    機能: { live: true, code: true }, ライブAI: 'freeai_live', ライブモデル: '', 音声: '', AI候補,
    // コードは aidiy_hermes 固定。モデルは auto / same / openai_oauth/gpt-… などの1つの文字列（aidiy_code・Slack 版と同じ）。
    コードCLI: 'aidiy_hermes', コードモデル: '', コードモデル候補: [], フォルダ: {},
    案内: 'Live・コードとも、最後に選んだモデルを次回も使用します。', 案内エラー: false,
    発言表示: false, 発言消去中: false, 発言役割: 'ai', 発言者: '', 発言本文: '', 文字表示中: false,
    モニター: false, モニター切替中: false, 設定表示: false,
    状態名: computed(() => !画面.読込済み && 画面.接続状態.phase === 'idle' ? '設定を読み込んでいます…' : 状態名[画面.接続状態.phase] || 画面.接続状態.phase),
    ライブ画面: computed(() => ['connected', 'reconnecting'].includes(画面.接続状態.phase)),
    // 接続中に開いた設定（設定表示）は、適用まで保存せずに編集できる。
    編集可能: computed(() => 画面.読込済み && !画面.致命的 && (画面.設定表示 || ['idle', 'error'].includes(画面.接続状態.phase))),
    ライブ編集不可: computed(() => !画面.編集可能 || 画面.保存中 || !画面.機能.live || 画面.操作中),
    コード編集不可: computed(() => !画面.編集可能 || 画面.保存中 || 画面.操作中),
    接続操作不可: computed(() => !画面.読込済み || 画面.致命的 || 画面.保存中 || 画面.設定表示 || (画面.操作中 && !(画面.操作種別 === 'start' && 画面.接続状態.phase === 'connecting')) || 画面.接続状態.phase === 'stopping' || 画面.編集可能 && 画面.機能.live && (!画面.ライブモデル || !画面.音声)),
    接続ボタン: computed(() => 画面.接続状態.phase === 'connecting' ? '接続中…' : 画面.ライブ画面 ? '切断' : 画面.接続状態.phase === 'stopping' ? '切断中…' : '接続'),
    モデル候補: computed(() => モデル一覧[画面.ライブAI] || {}), 音声候補: computed(() => 音声一覧[画面.ライブAI] || {}),
    // 画面下部の表示は aidiy_live / aidiy_code と同じ「AI - モデル」。Live が OFF ならコードだけを示す。
    モデル表示: computed(() => {
      const コード = `${画面.コードCLI} - ${画面.コードモデル || 'auto'}`;
      const ライブ = [画面.ライブAI, 画面.ライブモデル].filter(Boolean).join(' - ');
      return 画面.機能.live && ライブ ? `Live: ${ライブ} · Code: ${コード}` : `Code: ${コード}`;
    }),
    モデル操作不可: computed(() => !画面.読込済み || 画面.致命的 || 画面.保存中 || 画面.操作中 || 画面.設定表示 || ['connecting', 'stopping'].includes(画面.接続状態.phase)),
    保存, 接続切替, 開始, 終了, モニター切替, モデル設定, 設定適用, 設定取消,
    ライブ切替() { if (!画面.編集可能 || 画面.保存中 || 画面.操作中) return; 画面.機能.live = !画面.機能.live; void 保存(); },
    ライブAI利用可能(id) { return Object.keys(モデル一覧[id] || {}).length > 0 && Object.keys(音声一覧[id] || {}).length > 0; },
    ライブAI変更() { モデル反映(); void 保存(); },
    // 保存済みの値が候補にない場合も、選択中の値として残す。
    コードモデル一覧: computed(() => 画面.コードモデル && !画面.コードモデル候補.some(item => item.id === 画面.コードモデル)
      ? [...画面.コードモデル候補, { id: 画面.コードモデル, label: 画面.コードモデル }] : 画面.コードモデル候補),
    async ウィンドウ操作(action) { try { if (action === 'close') await 保存待ち; await api.window(action); } catch { 案内表示('ウィンドウを操作できませんでした。', true); } },
  });
  // 起動時・接続色変更時・表示復帰時に共通バーの絶対時刻へ位相を合わせる。
  function 脈動同期() {
    if (終了済み || document.hidden) return;
    const bar = document.getElementById('activity-bar');
    if (!bar) return;
    // 同じ色のまま復帰しても過去のアニメーション経過時間を二重加算しない。
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.removeProperty('animation');
    bar.style.animationDelay = `${-(Date.now() % 4500)}ms`;
  }
  const 脈動監視解除 = watch(() => 画面.接続状態.phase === 'connected', () => { void nextTick(脈動同期); }, { immediate: true });
  document.addEventListener('visibilitychange', 脈動同期);
  const 監視解除 = watchEffect(() => {
    document.body.classList.toggle('connected', 画面.接続状態.phase === 'connected');
    document.body.classList.toggle('live-view', 画面.ライブ画面);
    document.body.classList.toggle('live-off', !画面.機能.live);
    document.body.classList.toggle('settings-open', 画面.設定表示);
  });
  function 案内表示(text, error = false) { if (終了済み) return; 画面.案内 = text; 画面.案内エラー = error; }
  function モデル反映() {
    const [modelKey, voiceKey] = ライブ設定キー[画面.ライブAI] || [];
    const 選択 = (候補, 値) => 値 ? Object.hasOwn(候補, 値) ? 値 : '' : Object.keys(候補)[0] || '';
    画面.ライブモデル = 選択(モデル一覧[画面.ライブAI] || {}, 設定[modelKey]);
    画面.音声 = 選択(音声一覧[画面.ライブAI] || {}, 設定[voiceKey]);
  }
  function 保存(対象) {
    if (終了済み) return Promise.resolve(false);
    // 接続中の設定は「適用して再接続」でまとめて検証・保存する。
    if (画面.設定表示) return Promise.resolve(true);
    // Code 単独の変更を、無関係な Live の候補欠落や保存失敗で拒否しない。
    // 接続時は引き続き全項目を検証・保存する。
    const コードのみ = 対象 === 'code';
    const [modelKey, voiceKey] = ライブ設定キー[画面.ライブAI] || [];
    if (!コードのみ && 画面.機能.live && (!modelKey || !画面.ライブモデル || !画面.音声)) {
      案内表示('モデルと音声を候補から選択してください。', true); return Promise.resolve(false);
    }
    // 保存中の別イベントが待ち行列の内容を書き換えないよう、要求時点の値を固定する。
    const 機能 = { live: 画面.機能.live, code: true };
    const ライブ = { LIVE_AI_NAME: 画面.ライブAI, [modelKey]: 画面.ライブモデル.trim(), [voiceKey]: 画面.音声 };
    const コード = { model: 画面.コードモデル.trim() };
    画面.保存中 = true;
    const job = 保存待ち.then(async () => {
      if (終了済み) return false;
      try {
        if (!コードのみ) {
          await api.selectFeatures(機能);
          if (機能.live) Object.assign(設定, await api.select(ライブ));
        }
        await api.selectCode(コード);
        案内表示(コードのみ ? 'モデルの選択を保存しました。' : 機能.live ? '選択を保存しました。次回もこのモデル・音声を使用します。' : '選択を保存しました。Live は OFF で接続します。');
        return true;
      } catch (error) { 案内表示(error?.message || '選択を保存できませんでした。保存先を確認して再試行してください。', true); return false; }
    });
    保存待ち = job;
    void job.finally(() => { if (保存待ち === job) 画面.保存中 = false; });
    return job;
  }
  async function 接続切替() {
    if (画面.接続操作不可) return;
    const run = ++操作世代;
    const stop = ['connecting', 'connected', 'reconnecting'].includes(画面.接続状態.phase);
    画面.操作中 = true; 画面.操作種別 = stop ? 'stop' : 'start';
    try {
      if (stop) await api.stop();
      else if (await 保存() && !終了済み) await api.start();
    } catch { 案内表示('操作できませんでした。設定を確認して再試行してください。', true); }
    finally { if (run === 操作世代) { 画面.操作中 = false; 画面.操作種別 = ''; } }
  }
  /** 画面下部の「モデル」。未接続なら設定欄へ移り、接続中なら設定を開いて適用時に再接続する。 */
  function モデル設定() {
    if (画面.モデル操作不可 || !画面.ライブ画面) return false;
    if (画面.モニター) void モニター切替();
    退避 = { 機能: { ...画面.機能 }, ライブAI: 画面.ライブAI, ライブモデル: 画面.ライブモデル, 音声: 画面.音声, コードモデル: 画面.コードモデル };
    画面.設定表示 = true;
    案内表示('変更後「適用して再接続」を押すと、Discord に再接続します。');
    return true;
  }
  function 設定取消() {
    if (!画面.設定表示) return;
    if (退避) Object.assign(画面, 退避);
    退避 = undefined; 画面.設定表示 = false; 案内表示('');
  }
  async function 設定適用() {
    if (!画面.設定表示 || 画面.操作中) return;
    const run = ++操作世代;
    画面.操作中 = true; 画面.操作種別 = 'stop';
    try {
      if (['connecting', 'connected', 'reconnecting'].includes(画面.接続状態.phase)) await api.stop();
      画面.設定表示 = false; 退避 = undefined;
      画面.操作種別 = 'start';
      if (await 保存() && !終了済み) await api.start();
    } catch { 画面.設定表示 = false; 案内表示('再接続できませんでした。設定を確認して接続してください。', true); }
    finally { if (run === 操作世代) { 画面.操作中 = false; 画面.操作種別 = ''; } }
  }
  async function コード候補取得() {
    const run = ++候補世代;
    try {
      const result = await api.catalogCode();
      if (!終了済み && run === 候補世代) 画面.コードモデル候補 = result.models || [];
    } catch { if (run === 候補世代) 案内表示('モデルの候補を取得できません。保存済みのモデルで接続できます。'); }
  }
  function 発言消去() {
    clearTimeout(入力タイマー); clearTimeout(消去タイマー);
    画面.発言表示 = false; 画面.発言消去中 = false; 画面.文字表示中 = false;
  }
  function 発言受信(value) {
    if (!画面.ライブ画面 || !value) return;
    発言消去(); 画面.発言表示 = true; 画面.文字表示中 = true;
    画面.発言役割 = value.role === 'user' ? 'user' : 'ai'; 画面.発言者 = value.who;
    画面.発言本文 = '';
    const text = String(value.text || ''), batch = Math.max(1, Math.floor(text.length / 50) + 1);
    let index = 0;
    const tick = () => {
      index = Math.min(index + batch, text.length); 画面.発言本文 = text.slice(0, index);
      void nextTick(() => { if (本文要素) 本文要素.scrollTop = 本文要素.scrollHeight; });
      if (index < text.length) 入力タイマー = setTimeout(tick, 10); else 画面.文字表示中 = false;
    };
    入力タイマー = setTimeout(tick, 500);
    消去タイマー = setTimeout(() => { 画面.発言消去中 = true; 消去タイマー = setTimeout(発言消去, 600); }, 60_000);
  }
  function モニター停止() {
    音声世代++;
    if (音声Context) void 音声Context.close().catch(() => {});
    音声Context = undefined; 再生時刻 = { input: 0, output: 0 }; 画面.モニター = false;
  }
  async function モニター切替() {
    if (画面.モニター切替中 || !画面.ライブ画面 || !画面.機能.live) return;
    画面.モニター切替中 = true;
    const on = !画面.モニター;
    try {
      if (on) { 音声Context = new AudioContext(); 画面.モニター = true; }
      else モニター停止();
      const 世代 = 音声世代;
      await api.monitor(on);
      if (on && (終了済み || 世代 !== 音声世代)) await api.monitor(false);
    } catch { モニター停止(); 案内表示('モニターを切り替えられませんでした。', true); }
    finally { 画面.モニター切替中 = false; }
  }
  function 音声受信(value) {
    const context = 音声Context;
    if (!context || !['input', 'output'].includes(value?.kind) || ![16000, 24000].includes(value.rate) || typeof value.data !== 'string') return;
    try {
      const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0));
      const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
      if (!samples.length) return;
      const buffer = context.createBuffer(1, samples.length, value.rate), channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      const start = Math.max(再生時刻[value.kind], context.currentTime + .08);
      if (start - context.currentTime > 1) return;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start(start);
      再生時刻[value.kind] = start + buffer.duration;
    } catch { /* 不正・終了直後の音声は捨て、後続通知を妨げない。 */ }
  }
  function 状態反映(value) {
    画面.接続状態 = value; 画面.致命的 ||= !!value.fatal;
    if (value.phase === 'error' && value.message) { 案内表示(value.message, true); 状態案内 = true; }
    else if (状態案内) { 案内表示(''); 状態案内 = false; }
    if (!画面.ライブ画面) {
      発言消去(); モニター停止();
      for (const kind of ['input', 'output']) { 描画?.level(kind, 0); 描画?.spectrum(kind, new Uint8Array(0)); }
    }
    if (value.details) void nextTick(() => 詳細要素?.scrollIntoView?.({ block: 'nearest' }));
  }
  function 購読(method, callback) {
    const cancel = api[method](value => { if (!終了済み) callback(value); });
    if (typeof cancel === 'function') 解除.push(cancel);
  }
  async function 開始(canvas, 本文, 詳細) {
    本文要素 = 本文; 詳細要素 = 詳細;
    描画 = new 音声表示(canvas, (width, height) => ({ x: width / 2, y: height * .58, radius: Math.min(width * .3, height * .3, 150) }));
    購読('onState', value => { 状態通知済み = true; 状態反映(value); });
    購読('onActivity', 発言受信); 購読('onAudio', 音声受信);
    購読('onMeter', value => {
      if (!画面.ライブ画面 || !画面.機能.live || !['input', 'output'].includes(value?.kind)) return;
      描画.level(value.kind, Math.max(0, Math.min(1, Number(value.level) || 0)));
      描画.spectrum(value.kind, Uint8Array.from(Array.isArray(value.bins) ? value.bins : []));
    });
    try {
      const data = await api.initial(); if (終了済み) return;
      設定 = data.settings; Object.assign(モデル一覧, data.models); Object.assign(音声一覧, data.voices);
      画面.機能 = { live: data.features?.live !== false, code: true };
      画面.ライブAI = 設定.LIVE_AI_NAME || 'freeai_live';
      画面.コードCLI = data.code.cli || 'aidiy_hermes'; 画面.コードモデル = data.code.model;
      画面.フォルダ = data.folder || {}; 画面.読込済み = true; モデル反映();
      if (!状態通知済み) 状態反映(data.state);
      if (data.notice && !状態案内) 案内表示(data.notice);
      else if (data.firstRun && !状態案内) 案内表示('初回起動です。モデルを確認して「接続」を押してください。次回からは起動時に自動で接続します。');
      void コード候補取得();
    } catch (error) { if (!終了済み) 状態反映({ phase: 'error', message: `${error?.message || ''} 共通設定を確認し、パネルを開き直してください。`.trim() }); }
  }
  function 終了() {
    if (終了済み) return;
    終了済み = true; 候補世代++;
    if (画面.モニター) void api.monitor(false).catch(() => {});
    発言消去(); モニター停止(); 描画?.dispose();
    for (const cancel of 解除) cancel(); 監視解除(); 脈動監視解除();
    document.removeEventListener('visibilitychange', 脈動同期);
    document.body.classList.remove('connected', 'live-view', 'live-off', 'settings-open');
  }
  return 画面;
}
