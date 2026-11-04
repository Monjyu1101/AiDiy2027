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

import type { Packet } from './protocol';

export class LiveAudio {
  private output?: AudioContext;
  private input?: AudioContext;
  private stream?: MediaStream;
  private processor?: AudioWorkletNode;
  private outputAnalyser?: AnalyserNode;
  private inputAnalyser?: AnalyserNode;
  private inputData?: Uint8Array<ArrayBuffer>;
  private outputData?: Uint8Array<ArrayBuffer>;
  private outputFrame = 0;
  private currentSpeakerLevel = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private generation = 0;
  private micGeneration = 0;
  private queue: Promise<void> = Promise.resolve();
  private releaseInput?: () => void;
  speaker = true;
  constructor(private send: (base64: string) => void, private level: (kind: 'input' | 'output', value: number) => void,
    private spectrum?: (kind: 'input' | 'output', values: Uint8Array) => void,
    private captureUrl = '',
    private acquire?: () => Promise<{ stream: MediaStream; dispose: () => void }>) {}

  async unlock() {
    if (!this.output) {
      this.output = new AudioContext({ sampleRate: 24000 });
      this.outputAnalyser = this.output.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputData = new Uint8Array(this.outputAnalyser.frequencyBinCount);
      this.outputAnalyser.connect(this.output.destination);
    }
    await this.output.resume();
  }
  async start(rate: number) {
    this.stop();
    const generation = this.micGeneration;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      const acquired = this.acquire ? await this.acquire() : undefined;
      stream = acquired?.stream || await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.micGeneration) { stream.getTracks().forEach(track => track.stop()); acquired?.dispose(); return false; }
      this.releaseInput = acquired?.dispose;
      this.stream = stream;
      context = new AudioContext();
      this.input = context;
      await context.audioWorklet.addModule(this.captureUrl || new URL('capture.js', location.href).href);
      if (generation !== this.micGeneration) return false;
      await context.resume();
      if (generation !== this.micGeneration) return false;
      const processor = new AudioWorkletNode(context, 'aidiy-live-capture', { processorOptions: { rate } });
      this.processor = processor;
      this.inputAnalyser = context.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      this.inputData = new Uint8Array(this.inputAnalyser.frequencyBinCount);
      processor.port.postMessage({ speakerLevel: this.currentSpeakerLevel });
      processor.port.onmessage = event => {
        if (generation !== this.micGeneration) return;
        const pcm = new Int16Array(event.data);
        const bytes = new Uint8Array(event.data);
        let sum = 0, binary = '';
        for (const value of pcm) sum += (value / 32768) ** 2;
        for (const byte of bytes) binary += String.fromCharCode(byte);
        this.level('input', Math.min(1, Math.sqrt(sum / pcm.length) * 5));
        if (this.inputAnalyser && this.inputData) {
          this.inputAnalyser.getByteFrequencyData(this.inputData);
          this.spectrum?.('input', this.inputData);
        }
        this.send(btoa(binary));
      };
      context.createMediaStreamSource(stream).connect(this.inputAnalyser);
      this.inputAnalyser.connect(processor);
      // Worklet出力はゼロ。destinationへの接続は音声処理の継続に必要。
      processor.connect(context.destination);
      return true;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      if (generation === this.micGeneration) this.stop();
      throw error;
    }
  }
  stop() {
    ++this.micGeneration;
    if (this.processor) { this.processor.port.onmessage = null; this.processor.disconnect(); this.processor = undefined; }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.releaseInput?.(); this.releaseInput = undefined;
    if (this.input && this.input.state !== 'closed') void this.input.close().catch(() => undefined);
    this.input = undefined; this.level('input', 0);
    this.inputAnalyser = undefined; this.inputData = undefined;
    this.spectrum?.('input', new Uint8Array(0));
  }
  play(packet: Packet) {
    if (!this.speaker || !packet.ファイル名) return;
    const generation = this.generation;
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation || !this.speaker) return;
      await this.unlock();
      const context = this.output!;
      const binary = atob(packet.ファイル名!);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      let buffer: AudioBuffer;
      if (String(packet.メッセージ内容).startsWith('audio/pcm')) {
        const count = Math.floor(bytes.length / 2);
        if (!count) return;
        buffer = context.createBuffer(1, count, 24000);
        const data = buffer.getChannelData(0), view = new DataView(bytes.buffer);
        for (let i = 0; i < count; i++) data[i] = view.getInt16(i * 2, true) / 32768;
      } else { buffer = await context.decodeAudioData(bytes.buffer); }
      if (generation !== this.generation || !this.speaker) return;
      // 切断や異常な大量受信時の無制限な再生予約を避ける。
      if (this.nextTime - context.currentTime > 15) this.cancel();
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.outputAnalyser!);
      this.sources.add(source);
      this.nextTime = Math.max(context.currentTime + .015, this.nextTime);
      source.start(this.nextTime); this.nextTime += buffer.duration;
      this.startOutputLevelLoop();
      source.onended = () => { source.disconnect(); this.sources.delete(source); if (!this.sources.size) this.stopOutputLevelLoop(); };
    }).catch(error => { console.error('音声再生:', error); });
  }
  cancel() {
    ++this.generation; this.queue = Promise.resolve();
    for (const source of this.sources) { try { source.stop(); } catch { /* 再生終了済み */ } source.disconnect(); }
    this.sources.clear(); this.nextTime = 0; this.stopOutputLevelLoop();
  }
  private updateSpeakerLevel(value: number) {
    this.currentSpeakerLevel = value;
    this.processor?.port.postMessage({ speakerLevel: value });
    this.level('output', value);
  }
  private startOutputLevelLoop() {
    if (this.outputFrame) return;
    const tick = () => {
      this.outputFrame = 0;
      if (!this.speaker || !this.sources.size || !this.outputAnalyser || !this.outputData) {
        this.updateSpeakerLevel(0); return;
      }
      this.outputAnalyser.getByteFrequencyData(this.outputData);
      this.spectrum?.('output', this.outputData);
      // Web版 computeOutputLevel と同じ正規化。予約中の音声で減衰しない。
      const sum = this.outputData.reduce((total, value) => total + value, 0);
      this.updateSpeakerLevel(Math.min(1, sum / this.outputData.length / 128));
      this.outputFrame = requestAnimationFrame(tick);
    };
    tick();
  }
  private stopOutputLevelLoop() {
    if (this.outputFrame) cancelAnimationFrame(this.outputFrame);
    this.outputFrame = 0;
    this.updateSpeakerLevel(0);
    this.spectrum?.('output', new Uint8Array(0));
  }
  mute(enabled: boolean) { this.speaker = enabled; if (!enabled) this.cancel(); }
  close() {
    this.stop(); this.cancel();
    if (this.output && this.output.state !== 'closed') void this.output.close().catch(() => undefined);
    this.output = undefined;
    this.outputAnalyser = undefined; this.outputData = undefined;
  }
}
