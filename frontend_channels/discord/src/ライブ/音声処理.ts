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

import { Readable } from 'node:stream';
import OpusScript from 'opusscript';

const FRAME_BYTES = 960 * 2 * 2; // Discord: 48kHz / stereo / PCM16、20ms
// LiveAI は実時間より速く音声を送るため、長い応答でも途切れない余裕を持たせる（暴走時の安全上限）。
export const 出力バッファ上限 = 24000 * 2 * 120;

export function 入力PCM変換(stereo: Buffer, rate: number): Buffer {
  if (rate !== 16000 && rate !== 24000) throw new Error('入力レートが不正です。');
  const step = 48000 / rate;
  const count = Math.floor(stereo.length / 4 / step);
  const output = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) {
      const offset = (i * step + j) * 4;
      sum += stereo.readInt16LE(offset) + stereo.readInt16LE(offset + 2);
    }
    output.writeInt16LE(Math.round(sum / (step * 2)), i * 2);
  }
  return output;
}

export function 出力PCM変換(mono: Buffer): Buffer {
  if (mono.length % 2) throw new Error('PCM16 のバイト数が不正です。');
  const output = Buffer.alloc(mono.length * 4);
  for (let i = 0; i < mono.length / 2; i++) {
    const sample = mono.readInt16LE(i * 2);
    for (let j = 0; j < 4; j++) output.writeInt16LE(sample, i * 8 + j * 2);
  }
  return output;
}

// 複数話者を同じ20ms枠に混ぜる。無音も送信し、LiveAI の VAD が発話終了を検出できるようにする。
export class 音声入力ミキサー {
  private queues = new Map<string, Buffer>();
  追加(user: string, pcm: Buffer) {
    const pending = Buffer.concat([this.queues.get(user) ?? Buffer.alloc(0), pcm]);
    this.queues.set(user, pending.subarray(-FRAME_BYTES * 12)); // 遅延を240ms以内に制限
  }
  削除(user: string) { this.queues.delete(user); }
  フレーム(rate: number): Buffer {
    const mixed = new Int32Array(FRAME_BYTES / 2);
    for (const [user, queue] of this.queues) {
      const size = Math.min(FRAME_BYTES, queue.length - queue.length % 2);
      for (let i = 0; i < size / 2; i++) mixed[i] += queue.readInt16LE(i * 2);
      if (size >= queue.length) this.queues.delete(user);
      else this.queues.set(user, queue.subarray(size));
    }
    const pcm = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < mixed.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, mixed[i])), i * 2);
    return 入力PCM変換(pcm, rate);
  }
}

// Opus を直接供給するため FFmpeg は不要。20ms の送出間隔は AudioPlayer が管理する。
export class Discord音声出力 extends Readable {
  private pcm: Buffer = Buffer.alloc(0);
  private lastAudioAt = 0;
  private encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  /** 再生へ渡した20ms分の PCM（無音時は空）。パネルの音量表示に使う。 */
  通過?: (pcm: Buffer) => void;
  constructor() { super({ objectMode: true, highWaterMark: 2 }); }
  追加(pcm: Buffer) {
    if (this.destroyed) return;
    if (pcm.length % 2 || this.pcm.length + pcm.length > 出力バッファ上限) throw new Error('AI 音声の再生バッファ上限を超えました。');
    if (pcm.length) this.lastAudioAt = Date.now();
    this.pcm = Buffer.concat([this.pcm, pcm]);
  }
  override _read() {
    if (this.destroyed) return;
    try {
      // チャンク境界を発話末尾と扱わない。続きは最大60ms待ち、末尾の端数だけ無音で埋める。
      if (!this.pcm.length || this.pcm.length < 960 && Date.now() - this.lastAudioAt < 60) {
        this.通過?.(Buffer.alloc(0));
        this.push(Buffer.from([0xf8, 0xff, 0xfe])); return;
      }
      const frame = Buffer.alloc(960); // 24kHz mono、20ms
      this.pcm.copy(frame, 0, 0, 960);
      this.pcm = this.pcm.subarray(Math.min(960, this.pcm.length));
      this.通過?.(frame);
      // ここでも20ms待つとエンコード時間分だけ遅れ、AudioPlayer が無音を挟んでしまう。
      this.push(this.encoder.encode(出力PCM変換(frame), 960));
    } catch { this.destroy(new Error('Discord 音声の変換に失敗しました。')); }
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.pcm = Buffer.alloc(0); this.encoder.delete(); callback(error);
  }
}

// パネルの円型インジケーター用。aidiy_live の AnalyserNode（fftSize 256・Blackman 窓・-100〜-30dB）と同じ尺度で
// 通過する PCM16 mono の周波数分布（0〜255 の128帯域）と音量を求める。音声そのものはパネルへ渡さない。
const SPECTRUM_SIZE = 256;
const blackman = Float64Array.from({ length: SPECTRUM_SIZE }, (_, i) => {
  const x = 2 * Math.PI * i / (SPECTRUM_SIZE - 1);
  return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
});
export function 音声スペクトル(pcm: Buffer): number[] {
  const count = Math.min(SPECTRUM_SIZE, Math.floor(pcm.length / 2)), start = Math.floor(pcm.length / 2) - count;
  const samples = new Float64Array(SPECTRUM_SIZE);
  for (let i = 0; i < count; i++) samples[SPECTRUM_SIZE - count + i] = pcm.readInt16LE((start + i) * 2) / 32768 * blackman[SPECTRUM_SIZE - count + i];
  const bins: number[] = [];
  for (let k = 0; k < SPECTRUM_SIZE / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < SPECTRUM_SIZE; n++) {
      const angle = 2 * Math.PI * k * n / SPECTRUM_SIZE;
      re += samples[n] * Math.cos(angle); im -= samples[n] * Math.sin(angle);
    }
    const db = 20 * Math.log10(Math.hypot(re, im) / SPECTRUM_SIZE || 1e-12);
    bins.push(Math.max(0, Math.min(255, Math.round((db + 100) / 70 * 255))));
  }
  return bins;
}
export function 音声レベル(pcm: Buffer): number {
  const count = Math.floor(pcm.length / 2);
  if (!count) return 0;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
  return Math.min(1, Math.sqrt(sum / count) * 5);
}
