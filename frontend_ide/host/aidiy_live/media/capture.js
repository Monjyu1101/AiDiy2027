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

// AudioWorklet: 実際のデバイスレートから16/24kHzへ変換し、約64ms単位のPCM16を送る。
class LiveCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rate = options.processorOptions.rate;
    this.ratio = sampleRate / this.rate;
    this.pending = [];
    this.position = 0;
    this.chunk = new Int16Array(Math.round(this.rate * .064));
    this.offset = 0;
    this.speakerLevel = 0;
    this.port.onmessage = event => {
      const level = event.data?.speakerLevel;
      if (typeof level === 'number' && Number.isFinite(level)) this.speakerLevel = Math.max(0, Math.min(1, level));
    };
  }
  process(inputs) {
    const data = inputs[0]?.[0];
    if (!data) return true;
    // 既存 Web / Avatar の applyEchoSuppression と同じ振幅減衰。
    // 再生音量が0.01を超えた場合だけ、各サンプルから音量×1.5を差し引く。
    // PCM化・リサンプリング前に適用し、マイクのハードウェア音量は変更しない。
    const suppression = this.speakerLevel > .01 ? this.speakerLevel * 1.5 : 0;
    for (const sample of data) {
      this.pending.push(suppression ? Math.sign(sample) * Math.max(0, Math.abs(sample) - suppression) : sample);
    }
    while (this.position + this.ratio <= this.pending.length) {
      const start = this.position, end = start + this.ratio;
      let sum = 0;
      for (let i = Math.floor(start); i < Math.ceil(end); i++) {
        sum += this.pending[i] * (Math.min(end, i + 1) - Math.max(start, i));
      }
      const sample = Math.max(-1, Math.min(1, sum / this.ratio));
      this.chunk[this.offset++] = sample < 0 ? sample * 32768 : sample * 32767;
      this.position = end;
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(Math.round(this.rate * .064));
        this.offset = 0;
      }
    }
    const consumed = Math.floor(this.position);
    this.pending.splice(0, consumed);
    this.position -= consumed;
    return true;
  }
}
registerProcessor('aidiy-live-capture', LiveCapture);
