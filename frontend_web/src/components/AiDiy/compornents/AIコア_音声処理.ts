// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

/**
 * AIコア 音声ストリーム処理モジュール
 * 音声入力（マイク）と音声出力（スピーカー）の処理を管理
 */

import type { Ref } from 'vue';
import type { IWebSocketClient } from '@/api/websocket';

// 音声入力状態
interface InputAudioState {
  mediaRecorder: MediaRecorder | null;
  audioContext: AudioContext | null;
  audioProcessor: ScriptProcessorNode | null;
  isRecording: boolean;
  audioAnalyser: AnalyserNode | null;
  audioDataArray: Uint8Array | null;
  stream: MediaStream | null;
}

// 音声出力状態
interface OutputAudioState {
  currentAudioSources: Array<{ source: AudioBufferSourceNode; id: number }>;
  currentVisualizerSources: Array<{ source: AudioBufferSourceNode; id: number }>;
  audioSourceCounter: number;
  audioQueue: Array<{ base64Audio: string; mimeType: string }>;
  isPlaying: boolean;
  isQueueProcessing: boolean;
  nextPlayTime: number;
  audioContext: AudioContext | null;
  audioAnalyser: AnalyserNode | null;
  audioDataArray: Uint8Array | null;
  isVisualizerProcessing: boolean;
  // ビジュアライザー専用analyser（destinationに接続しない）
  visualizerAnalyser: AnalyserNode | null;
  visualizerDataArray: Uint8Array | null;
  // フェードアウト用GainNode
  outputGain: GainNode | null;
}

export class AudioController {
  // 音声入力状態
  private inputAudioState: InputAudioState = {
    mediaRecorder: null,
    audioContext: null,
    audioProcessor: null,
    isRecording: false,
    audioAnalyser: null,
    audioDataArray: null,
    stream: null
  };

  // 音声出力状態
  private outputAudioState: OutputAudioState = {
    currentAudioSources: [],
    currentVisualizerSources: [],
    audioSourceCounter: 0,
    audioQueue: [],
    isPlaying: false,
    isQueueProcessing: false,
    nextPlayTime: 0,
    audioContext: null,
    audioAnalyser: null,
    audioDataArray: null,
    isVisualizerProcessing: false,
    visualizerAnalyser: null,
    visualizerDataArray: null,
    outputGain: null
  };

  // サンプリングレート
  private inputSampleRate = 16000; // Gemini default
  private outputSampleRate = 24000;

  // 音声入力開始フラグ
  private audioInputStarted = false;

  // ビジュアライザー要素
  private inputVisualizerBars: HTMLElement[] = [];
  private outputVisualizerBars: HTMLElement[] = [];

  // WebSocketクライアント
  private wsClient: Ref<IWebSocketClient | null>;

  // セッションID
  private セッションID: Ref<string>;

  // スピーカー状態
  private isSpeakerOn: Ref<boolean>;

  // ビジュアライザーコンテナ要素
  private audioVisualizerOverlay: HTMLElement | null = null;
  private isVisualizerVisible = false;
  private isVisualizerLoopStarted = false;

  // エコー抑制関連
  private currentSpeakerLevel = 0;           // スピーカー出力の現在レベル（0〜1）、エコー抑制に使用
  private suppressionBuffer: Float32Array | null = null;  // エコー抑制用バッファ（事前確保）
  private fadeOutTimer: ReturnType<typeof setTimeout> | null = null;  // フェードアウトタイマーID（競合防止）

  // フェードアウト・エコー抑制パラメータ
  private static readonly FADE_OUT_DURATION = 0.1;           // キャンセル時フェードアウト秒数（人間の割り込みを最優先）
  private static readonly ECHO_SUPPRESSION_GAIN = 1.5;       // 抑制係数（1.0=等倍、大きいほど強く抑制）
  private static readonly ECHO_SUPPRESSION_THRESHOLD = 0.01; // この値未満のスピーカーレベルは処理をスキップ

  constructor(wsClient: Ref<IWebSocketClient | null>, セッションID: Ref<string>, isSpeakerOn: Ref<boolean>) {
    this.wsClient = wsClient;
    this.セッションID = セッションID;
    this.isSpeakerOn = isSpeakerOn;
  }

  /**
   * サンプリングレート設定（LiveAIプロバイダーに応じて切り替え）
   */
  setSampleRate(liveAIProvider: string) {
    if (liveAIProvider && liveAIProvider.toLowerCase() === 'openai') {
      this.inputSampleRate = 24000;
      this.outputSampleRate = 24000;
    } else {
      this.inputSampleRate = 16000;
      this.outputSampleRate = 24000;
    }

    // AudioContextを再作成
    if (this.outputAudioState.audioContext) {
      this.outputAudioState.audioContext.close();
    }
    this.setupOutputAudio();
  }

  /**
   * ビジュアライザーセットアップ
   */
  setupAudioVisualizer(audioBarsElement: HTMLElement | null, overlayElement: HTMLElement | null) {
    console.log('[AudioController] ビジュアライザーセットアップ開始', { audioBarsElement, overlayElement });

    if (!audioBarsElement) {
      console.warn('[AudioController] audioBarsElement が見つかりません');
      return;
    }

    this.audioVisualizerOverlay = overlayElement;
    audioBarsElement.innerHTML = '';
    this.inputVisualizerBars = [];
    this.outputVisualizerBars = [];

    const barCount = 64;

    for (let i = 0; i < barCount; i++) {
      const container = document.createElement('div');
      container.className = 'audio-bar-container';
      container.style.cssText = 'flex: 1; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-end; height: 100%; gap: 0px; min-width: 1px;';

      const outputBar = document.createElement('div');
      outputBar.className = 'audio-bar output-audio';
      outputBar.style.cssText = 'width: 100%; min-height: 2px; height: 10%; background: #44ff44; order: 1;';

      const inputBar = document.createElement('div');
      inputBar.className = 'audio-bar input-audio';
      inputBar.style.cssText = 'width: 100%; min-height: 2px; height: 10%; background: #ff4444; order: 2;';

      container.appendChild(outputBar);
      container.appendChild(inputBar);
      audioBarsElement.appendChild(container);

      this.inputVisualizerBars.push(inputBar);
      this.outputVisualizerBars.push(outputBar);
    }

    console.log('[AudioController] ビジュアライザーセットアップ完了', {
      barCount: this.inputVisualizerBars.length,
      overlayElement: this.audioVisualizerOverlay,
      firstInputBar: this.inputVisualizerBars[0],
      firstOutputBar: this.outputVisualizerBars[0]
    });
  }

  /**
   * 音声ビジュアライザー更新ループ
   */
  startAudioVisualization() {
    if (this.isVisualizerLoopStarted) return;
    this.isVisualizerLoopStarted = true;
    const visualize = () => {
      if (!this.inputAudioState.isRecording && !this.outputAudioState.isPlaying && !this.outputAudioState.isVisualizerProcessing) {
        requestAnimationFrame(visualize);
        return;
      }

      // 入力音声のビジュアライザー更新
      if (this.inputAudioState.isRecording && this.inputAudioState.audioAnalyser) {
        this.inputAudioState.audioAnalyser.getByteFrequencyData(this.inputAudioState.audioDataArray! as any);
        this.updateVisualizerBars(this.inputVisualizerBars, this.inputAudioState.audioDataArray!);
      }

      // 出力音声のビジュアライザー更新
      if (this.outputAudioState.isPlaying && this.outputAudioState.audioAnalyser) {
        // スピーカー再生中は通常のanalyserを使用
        this.outputAudioState.audioAnalyser.getByteFrequencyData(this.outputAudioState.audioDataArray! as any);
        this.updateSpeakerLevel(this.computeOutputLevel(this.outputAudioState.audioDataArray!));
        this.updateVisualizerBars(this.outputVisualizerBars, this.outputAudioState.audioDataArray!);
      } else if (this.outputAudioState.isVisualizerProcessing && this.outputAudioState.visualizerAnalyser) {
        // ビジュアライザー専用処理中はビジュアライザー専用analyserを使用
        this.outputAudioState.visualizerAnalyser.getByteFrequencyData(this.outputAudioState.visualizerDataArray! as any);
        this.updateSpeakerLevel(this.computeOutputLevel(this.outputAudioState.visualizerDataArray!));
        this.updateVisualizerBars(this.outputVisualizerBars, this.outputAudioState.visualizerDataArray!);
      } else {
        // 出力がない場合はスピーカーレベルをリセット
        this.currentSpeakerLevel = 0;
      }

      requestAnimationFrame(visualize);
    };

    visualize();
  }

  /**
   * ビジュアライザーバー更新
   */
  private updateVisualizerBars(bars: HTMLElement[], dataArray: Uint8Array) {
    for (let i = 0; i < bars.length; i++) {
      const value = dataArray[i] || 0;
      const height = Math.max(10, (value / 255) * 100);
      bars[i].style.height = `${height}%`;
    }
  }

  /**
   * ビジュアライザーをゼロ表示にリセット
   */
  private resetVisualizerBars() {
    const reset = (bars: HTMLElement[]) => {
      for (let i = 0; i < bars.length; i++) {
        bars[i].style.height = '2px';
      }
    };
    reset(this.inputVisualizerBars);
    reset(this.outputVisualizerBars);
  }

  private resetBars(bars: HTMLElement[]) {
    for (let i = 0; i < bars.length; i++) {
      bars[i].style.height = '2px';
    }
  }

  /**
   * マイク開始
   */
  async startMicrophone(): Promise<{ success: boolean; error?: string }> {
    // WebSocket接続チェック
    if (!this.wsClient.value || !this.wsClient.value.isConnected()) {
      return { success: false, error: 'サーバーに接続されていません。\n接続が完了してからマイクをオンにしてください。' };
    }

    try {
      await this.startAudioCapture();

      // ビジュアライザー表示
      console.log('[AudioController] ビジュアライザー表示', this.audioVisualizerOverlay);
      if (this.audioVisualizerOverlay) {
        this.audioVisualizerOverlay.style.display = 'flex';
        console.log('[AudioController] ビジュアライザー表示設定完了');
      } else {
        console.warn('[AudioController] audioVisualizerOverlay が null です');
      }

      this.startAudioVisualization();

      // 音声録音開始時に再生中の音声をキャンセル
      this.cancelAudioOutput();

      return { success: true };
    } catch (error) {
      console.error('マイク開始エラー:', error);
      this.inputAudioState.isRecording = false;
      this.audioInputStarted = false;
      if (this.audioVisualizerOverlay) {
        this.audioVisualizerOverlay.style.display = 'none';
      }
      return { success: false, error: 'マイクアクセスに失敗しました。' };
    }
  }

  /**
   * マイク停止
   */
  stopMicrophone() {
    this.inputAudioState.isRecording = false;
    this.audioInputStarted = false;

    // audioProcessorを停止・切断
    if (this.inputAudioState.audioProcessor) {
      this.inputAudioState.audioProcessor.disconnect();
      this.inputAudioState.audioProcessor = null;
    }

    if (this.inputAudioState.stream) {
      this.inputAudioState.stream.getTracks().forEach(track => track.stop());
      this.inputAudioState.stream = null;
    }

    if (this.inputAudioState.audioContext) {
      this.inputAudioState.audioContext.close();
      this.inputAudioState.audioContext = null;
    }

    this.suppressionBuffer = null;

    // ビジュアライザー表示は updateVisualizerVisibility に委譲
  }

  /**
   * 音声キャプチャ開始
   */
  private async startAudioCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.inputSampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    this.inputAudioState.stream = stream;

    // AudioContextセットアップ
    this.inputAudioState.audioContext = new AudioContext({ sampleRate: this.inputSampleRate });
    const source = this.inputAudioState.audioContext.createMediaStreamSource(stream);

    // 音声分析用
    this.inputAudioState.audioAnalyser = this.inputAudioState.audioContext.createAnalyser();
    this.inputAudioState.audioAnalyser.fftSize = 128;
    source.connect(this.inputAudioState.audioAnalyser);
    this.inputAudioState.audioDataArray = new Uint8Array(this.inputAudioState.audioAnalyser.frequencyBinCount);

    // ScriptProcessorNodeを使用
    const bufferSize = 1024;
    const processor = this.inputAudioState.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.suppressionBuffer = new Float32Array(bufferSize);  // エコー抑制用バッファを事前確保

    processor.onaudioprocess = (event) => {
      if (this.wsClient.value && this.wsClient.value.isConnected()) {
        const rawInput = event.inputBuffer.getChannelData(0);
        const inputBuffer = this.applyEchoSuppression(rawInput);

        // Float32ArrayをInt16Arrayに変換（16-bit PCM）
        const pcmData = new Int16Array(inputBuffer.length);
        for (let i = 0; i < inputBuffer.length; i++) {
          pcmData[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32767));
        }

        // ArrayBufferをBase64エンコード
        const base64Audio = this.arrayBufferToBase64(pcmData.buffer);

        // 音声データ送信前にキャンセル通知（初回のみ）
        if (!this.audioInputStarted) {
          this.audioInputStarted = true;
          this.cancelAudioOutput();
        }

        // リアルタイムストリーミング送信
        this.wsClient.value.send({
          セッションID: this.wsClient.value.セッションID取得?.() ?? '',
          チャンネル: 'audio',
          メッセージ識別: 'input_audio',
          メッセージ内容: 'audio/pcm',
          ファイル名: base64Audio,
          サムネイル画像: null
        });
      }
    };

    // 音声処理チェーンを接続
    source.connect(processor);
    processor.connect(this.inputAudioState.audioContext.destination);

    this.inputAudioState.audioProcessor = processor;
    this.inputAudioState.isRecording = true;
  }

  /**
   * ArrayBufferをBase64エンコード
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * 音声出力AudioContextセットアップ
   */
  setupOutputAudio() {
    this.outputAudioState.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: this.outputSampleRate
    });
    this.outputAudioState.nextPlayTime = 0;
    this.outputAudioState.currentAudioSources = [];
    this.outputAudioState.currentVisualizerSources = [];
    this.outputAudioState.isPlaying = false;
    this.outputAudioState.isVisualizerProcessing = false;

    // スピーカー出力用analyser → GainNode（フェードアウト制御）→ destination
    this.outputAudioState.audioAnalyser = this.outputAudioState.audioContext.createAnalyser();
    this.outputAudioState.audioAnalyser.fftSize = 256;
    this.outputAudioState.outputGain = this.outputAudioState.audioContext.createGain();
    this.outputAudioState.outputGain.gain.value = this.isSpeakerOn.value ? 1 : 0;
    this.outputAudioState.audioAnalyser.connect(this.outputAudioState.outputGain);
    this.outputAudioState.outputGain.connect(this.outputAudioState.audioContext.destination);
    this.outputAudioState.audioDataArray = new Uint8Array(this.outputAudioState.audioAnalyser.frequencyBinCount);

    // ビジュアライザー専用analyser（destinationに接続しない）
    this.outputAudioState.visualizerAnalyser = this.outputAudioState.audioContext.createAnalyser();
    this.outputAudioState.visualizerAnalyser.fftSize = 256;
    this.outputAudioState.visualizerDataArray = new Uint8Array(this.outputAudioState.visualizerAnalyser.frequencyBinCount);

    console.log('[AudioController] 出力AudioContextセットアップ完了（analyser × 2 + GainNode）');
  }

  /**
   * 音声メッセージ処理
   */
  handleAudioMessage(data: any) {
    const messageType = data?.メッセージ識別 || data?.type;
    if (messageType === 'output_audio') {
      const base64Audio = data?.ファイル名 || data?.base64_data || data?.audio || data?.data;
      const mimeType = data?.メッセージ内容 || data?.mime_type || 'audio/pcm';
      if (base64Audio) {
        // 受信キューは一本化し、デコードは1回だけ実行する
        this.queueAudio({ base64Audio, mimeType });
      }
    }
  }

  /**
   * 音声をキューに追加（スピーカー再生＋ビジュアライザー共通）
   */
  private queueAudio(audioData: { base64Audio: string; mimeType: string }) {
    this.outputAudioState.audioQueue.push(audioData);
    if (!this.outputAudioState.isQueueProcessing) {
      void this.processAudioQueue();
    }
  }

  /**
   * 音声キュー処理（デコードを一度だけ実行し、先行スケジューリング）
   */
  private async processAudioQueue() {
    if (this.outputAudioState.isQueueProcessing) return;
    this.outputAudioState.isQueueProcessing = true;
    try {
      while (this.outputAudioState.audioQueue.length > 0) {
        const { base64Audio, mimeType } = this.outputAudioState.audioQueue.shift()!;
        const audioBuffer = await this.decodeAudioBuffer(base64Audio, mimeType);
        this.scheduleAudioBuffer(audioBuffer);
      }
    } finally {
      this.outputAudioState.isQueueProcessing = false;
    }
  }

  /**
   * Base64音声をAudioBufferへ変換
   */
  private async decodeAudioBuffer(base64Audio: string, mimeType: string = 'audio/pcm'): Promise<AudioBuffer> {
    const binaryString = window.atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    if (!this.outputAudioState.audioContext) {
      this.setupOutputAudio();
    }

    if (this.outputAudioState.audioContext!.state === 'suspended') {
      try {
        await this.outputAudioState.audioContext!.resume();
      } catch (e) {
        console.warn('audioContext resume失敗:', e);
      }
    }

    // audio/pcmは手動でFloat32に変換
    if (mimeType && mimeType.toLowerCase().includes('pcm')) {
      const pcmData = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768;
      }
      const audioBuffer = this.outputAudioState.audioContext!.createBuffer(1, float32Data.length, this.outputSampleRate);
      audioBuffer.copyToChannel(float32Data, 0);
      return audioBuffer;
    } else {
      try {
        return await this.outputAudioState.audioContext!.decodeAudioData(bytes.buffer);
      } catch (e) {
        const pcmData = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / 32768;
        }
        const audioBuffer = this.outputAudioState.audioContext!.createBuffer(1, float32Data.length, this.outputSampleRate);
        audioBuffer.copyToChannel(float32Data, 0);
        return audioBuffer;
      }
    }
  }

  /**
   * AudioBufferを先行スケジューリングして再生
   */
  private scheduleAudioBuffer(audioBuffer: AudioBuffer) {
    if (!this.outputAudioState.audioContext) {
      this.setupOutputAudio();
    }
    const context = this.outputAudioState.audioContext!;
    const now = context.currentTime;
    const startAt = Math.max(now + 0.03, this.outputAudioState.nextPlayTime || 0);
    this.outputAudioState.nextPlayTime = startAt + audioBuffer.duration;
    this.outputAudioState.isVisualizerProcessing = true;
    if (this.audioVisualizerOverlay) {
      this.audioVisualizerOverlay.style.display = 'flex';
      this.isVisualizerVisible = true;
    }

    // ビジュアライザーは常時更新する（スピーカーOFF時も可視化）
    const visualizerSource = context.createBufferSource();
    visualizerSource.buffer = audioBuffer;
    this.outputAudioState.audioSourceCounter++;
    const visualizerSourceId = this.outputAudioState.audioSourceCounter;
    this.outputAudioState.currentVisualizerSources.push({ source: visualizerSource, id: visualizerSourceId });
    visualizerSource.connect(this.outputAudioState.visualizerAnalyser!);
    visualizerSource.onended = () => {
      this.outputAudioState.currentVisualizerSources = this.outputAudioState.currentVisualizerSources.filter((x) => x.id !== visualizerSourceId);
      this.refreshPlaybackFlags();
    };
    visualizerSource.start(startAt);

    if (this.isSpeakerOn.value) {
      this.outputAudioState.isPlaying = true;
      const speakerSource = context.createBufferSource();
      speakerSource.buffer = audioBuffer;
      this.outputAudioState.audioSourceCounter++;
      const speakerSourceId = this.outputAudioState.audioSourceCounter;
      this.outputAudioState.currentAudioSources.push({ source: speakerSource, id: speakerSourceId });
      speakerSource.connect(this.outputAudioState.audioAnalyser!);
      speakerSource.onended = () => {
        this.outputAudioState.currentAudioSources = this.outputAudioState.currentAudioSources.filter((x) => x.id !== speakerSourceId);
        this.refreshPlaybackFlags();
      };
      speakerSource.start(startAt);
    }
  }

  private refreshPlaybackFlags() {
    const now = this.outputAudioState.audioContext?.currentTime ?? 0;
    this.outputAudioState.isPlaying = this.outputAudioState.currentAudioSources.length > 0;
    this.outputAudioState.isVisualizerProcessing = this.outputAudioState.currentVisualizerSources.length > 0;
    if (
      this.outputAudioState.currentAudioSources.length === 0 &&
      this.outputAudioState.currentVisualizerSources.length === 0 &&
      this.outputAudioState.audioQueue.length === 0 &&
      !this.outputAudioState.isQueueProcessing
    ) {
      this.outputAudioState.nextPlayTime = Math.max(now, 0);
    }
  }

  /**
   * 音声出力キャンセル
   * 0.1秒フェードアウト後にソースを停止（人間の割り込みを妨げない最短フェード）
   * ※フェード中もエコー抑制（currentSpeakerLevel）を維持し、AI音声をマイクが拾わないようにする
   */
  cancelAudioOutput() {
    // キューを即時クリア（新規追加をブロック）
    this.outputAudioState.audioQueue = [];
    this.outputAudioState.isQueueProcessing = false;
    this.outputAudioState.nextPlayTime = this.outputAudioState.audioContext?.currentTime ?? 0;

    const context = this.outputAudioState.audioContext;
    const gain = this.outputAudioState.outputGain;
    const hasSources = this.outputAudioState.currentAudioSources.length > 0;

    if (context && gain && hasSources) {
      // 0.1秒フェードアウト（GainNodeで振幅を下げる）
      const now = context.currentTime;
      const fadeDuration = AudioController.FADE_OUT_DURATION;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeDuration);

      // ソース参照を退避してクリア
      const sourcesToStop = [...this.outputAudioState.currentAudioSources];
      const vizSourcesToStop = [...this.outputAudioState.currentVisualizerSources];
      this.outputAudioState.currentAudioSources = [];
      this.outputAudioState.currentVisualizerSources = [];
      this.outputAudioState.isPlaying = false;
      this.outputAudioState.isVisualizerProcessing = false;

      // ビジュアライザーは即時停止
      for (const item of vizSourcesToStop) {
        try { item.source.stop(); } catch { /* 既に停止済み */ }
      }

      // 旧タイマーをキャンセルして競合防止（0.1秒以内の連続キャンセル時にゲインが誤復元されないよう）
      if (this.fadeOutTimer !== null) clearTimeout(this.fadeOutTimer);
      this.fadeOutTimer = setTimeout(() => {
        this.fadeOutTimer = null;
        // スピーカーソースを物理停止
        for (const item of sourcesToStop) {
          try { item.source.stop(); } catch { /* 既に停止済み */ }
        }
        // フェード完了後にエコー抑制レベルをリセット（フェード中は抑制を維持）
        this.currentSpeakerLevel = 0;
        // ゲインを元に戻す
        if (this.outputAudioState.outputGain && this.outputAudioState.audioContext) {
          const t = this.outputAudioState.audioContext.currentTime;
          const targetGain = this.isSpeakerOn.value ? 1 : 0;
          this.outputAudioState.outputGain.gain.cancelScheduledValues(t);
          this.outputAudioState.outputGain.gain.setValueAtTime(targetGain, t);
        }
      }, (AudioController.FADE_OUT_DURATION * 1000) + 20);
    } else {
      // ソースなし：即時停止＋即時リセット
      for (const item of this.outputAudioState.currentAudioSources) {
        try { item.source.stop(); } catch { /* 既に停止済み */ }
      }
      for (const item of this.outputAudioState.currentVisualizerSources) {
        try { item.source.stop(); } catch { /* 既に停止済み */ }
      }
      this.outputAudioState.currentAudioSources = [];
      this.outputAudioState.currentVisualizerSources = [];
      this.outputAudioState.isPlaying = false;
      this.outputAudioState.isVisualizerProcessing = false;
      this.currentSpeakerLevel = 0;
    }

    // サーバーにキャンセル通知（統一フォーマット）
    if (this.wsClient.value && this.wsClient.value.isConnected()) {
      this.wsClient.value.send({
        セッションID: this.セッションID.value,
        チャンネル: 'audio',
        メッセージ識別: 'cancel_audio',
        メッセージ内容: null,
        ファイル名: null,
        サムネイル画像: null
      });
    }
  }

  /**
   * スピーカーOFF時のクリーンアップ（即時停止）
   */
  clearAudioPlayback() {
    for (const item of this.outputAudioState.currentAudioSources) {
      try {
        item.source.stop();
      } catch (e) {
        // Already stopped
      }
    }
    this.outputAudioState.currentAudioSources = [];
    this.outputAudioState.audioQueue = [];
    this.outputAudioState.isQueueProcessing = false;
    this.outputAudioState.isPlaying = false;
    this.outputAudioState.nextPlayTime = this.outputAudioState.audioContext?.currentTime ?? 0;
    this.currentSpeakerLevel = 0;
    // GainNodeをゼロにリセット（スピーカーOFF）
    if (this.outputAudioState.outputGain && this.outputAudioState.audioContext) {
      this.outputAudioState.outputGain.gain.cancelScheduledValues(this.outputAudioState.audioContext.currentTime);
      this.outputAudioState.outputGain.gain.setValueAtTime(0, this.outputAudioState.audioContext.currentTime);
    }
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    if (this.inputAudioState.isRecording) {
      this.stopMicrophone();
    }

    for (const item of this.outputAudioState.currentAudioSources) {
      try {
        item.source.stop();
      } catch (e) {
        // Already stopped
      }
    }
    for (const item of this.outputAudioState.currentVisualizerSources) {
      try {
        item.source.stop();
      } catch (e) {
        // Already stopped
      }
    }
    this.outputAudioState.currentAudioSources = [];
    this.outputAudioState.currentVisualizerSources = [];
    this.outputAudioState.audioQueue = [];
    this.outputAudioState.isQueueProcessing = false;
    this.outputAudioState.isPlaying = false;
    this.outputAudioState.isVisualizerProcessing = false;
    this.outputAudioState.nextPlayTime = 0;
    this.currentSpeakerLevel = 0;  // クリーンアップ時にエコー抑制レベルをリセット

    if (this.inputAudioState.audioContext) {
      this.inputAudioState.audioContext.close();
    }
    if (this.outputAudioState.audioContext) {
      this.outputAudioState.audioContext.close();
    }
  }

  /**
   * マイク録音中かどうか
   */
  isRecording(): boolean {
    return this.inputAudioState.isRecording;
  }

  /**
   * 音声再生中かどうか
   */
  isPlaying(): boolean {
    return this.outputAudioState.isPlaying;
  }

  /**
   * ビジュアライザー表示/非表示を更新
   */
  updateVisualizerVisibility(microphoneEnabled: boolean, speakerEnabled: boolean) {
    if (!this.audioVisualizerOverlay) return;

    const shouldShow = microphoneEnabled || speakerEnabled;

    if (shouldShow) {
      this.audioVisualizerOverlay.style.display = 'flex';
      if (!this.isVisualizerVisible) {
        this.resetVisualizerBars();
      }
      if (!microphoneEnabled) {
        this.resetBars(this.inputVisualizerBars);
      }
      if (!speakerEnabled) {
        this.resetBars(this.outputVisualizerBars);
      }
      this.startAudioVisualization();
      this.isVisualizerVisible = true;
      console.log('[AudioController] ビジュアライザー表示 (マイク:', microphoneEnabled, 'スピーカー:', speakerEnabled, ')');
    } else {
      this.resetVisualizerBars();
      this.audioVisualizerOverlay.style.display = 'none';
      this.isVisualizerVisible = false;
      console.log('[AudioController] ビジュアライザー非表示');
    }
  }

  /**
   * 出力音声レベルを計算（エコー抑制に使用）
   */
  private computeOutputLevel(dataArray: Uint8Array): number {
    if (dataArray.length === 0) return 0;
    const sum = dataArray.reduce((acc, value) => acc + value, 0);
    return Math.min(1, sum / dataArray.length / 128);
  }

  /**
   * スピーカーレベルを即時更新（人の声割り込みを最優先）
   */
  private updateSpeakerLevel(newLevel: number): void {
    this.currentSpeakerLevel = newLevel;
  }

  /**
   * スピーカー出力レベル分をマイク入力振幅から差し引くエコー抑制処理
   * マイクのハードウェアレベルは変えず、数値的に振幅を削減する
   */
  private applyEchoSuppression(rawInput: Float32Array): Float32Array {
    const speakerLevel = this.currentSpeakerLevel;
    if (speakerLevel <= AudioController.ECHO_SUPPRESSION_THRESHOLD) {
      return rawInput;
    }
    const suppression = speakerLevel * AudioController.ECHO_SUPPRESSION_GAIN;
    const buffer = this.suppressionBuffer ?? new Float32Array(rawInput.length);
    for (let i = 0; i < rawInput.length; i++) {
      const sample = rawInput[i] ?? 0;
      const sign = sample >= 0 ? 1 : -1;
      buffer[i] = sign * Math.max(0, Math.abs(sample) - suppression);
    }
    return buffer;
  }
}

export { AudioController as AudioStreamProcessor };


