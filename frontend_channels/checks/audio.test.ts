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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpusScript from 'opusscript';
import { Discord音声出力, 音声入力ミキサー, 入力PCM変換, 出力PCM変換, 出力バッファ上限, 音声スペクトル, 音声レベル } from '../src/ライブ/音声処理';

test('48kHz stereo → 16/24kHz mono、24kHz mono → 48kHz stereo のレートと音量を検証', () => {
  const stereo = Buffer.alloc(3840);
  for (let i = 0; i < stereo.length; i += 4) { stereo.writeInt16LE(1000, i); stereo.writeInt16LE(3000, i + 2); }
  for (const rate of [16000, 24000]) {
    const pcm = 入力PCM変換(stereo, rate);
    assert.equal(pcm.length, rate * .02 * 2);
    for (let i = 0; i < pcm.length; i += 2) assert.equal(pcm.readInt16LE(i), 2000);
  }
  const output = 出力PCM変換(入力PCM変換(stereo, 24000));
  assert.equal(output.length, 3840);
  assert.equal(output.readInt16LE(3000), 2000);
});

test('同時話者を混合してクリップし、無音フレームと有界バッファを維持する', () => {
  const mixer = new 音声入力ミキサー();
  const pcm = Buffer.alloc(3840);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(30000, i);
  mixer.追加('one', pcm); mixer.追加('two', pcm);
  assert.equal(mixer.フレーム(16000).readInt16LE(0), 32767);
  assert.ok(mixer.フレーム(16000).equals(Buffer.alloc(640)));
  mixer.追加('one', Buffer.concat(Array(30).fill(pcm)));
  for (let i = 0; i < 12; i++) mixer.フレーム(24000);
  assert.ok(mixer.フレーム(24000).equals(Buffer.alloc(960)));
});

test('実Opusの1秒音声を16/24kHzへ変換しても時間・周波数・音量が維持される', () => {
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const decoded: Buffer[] = [];
  try {
    for (let frame = 0; frame < 50; frame++) {
      const stereo = Buffer.alloc(3840);
      for (let i = 0; i < 960; i++) {
        const sample = Math.round(10000 * Math.sin((frame * 960 + i) * Math.PI * 2 * 1000 / 48000));
        stereo.writeInt16LE(sample, i * 4); stereo.writeInt16LE(sample, i * 4 + 2);
      }
      decoded.push(decoder.decode(encoder.encode(stereo, 960)));
    }
    for (const rate of [16000, 24000]) {
      const pcm = Buffer.concat(decoded.map(frame => 入力PCM変換(frame, rate)));
      assert.equal(pcm.length, rate * 2, '1秒分のPCM16 monoになる');
      let crossings = 0, power = 0;
      const start = rate / 10; // コーデックの開始遅延を除く
      for (let i = start; i < rate; i++) {
        const sample = pcm.readInt16LE(i * 2);
        if (sample > 0 && pcm.readInt16LE((i - 1) * 2) <= 0) crossings++;
        power += sample * sample;
      }
      assert.ok(Math.abs(crossings / .9 - 1000) < 3, `${rate}Hzで音程が維持される`);
      const rms = Math.sqrt(power / (rate - start));
      assert.ok(rms > 6000 && rms < 8000, `${rate}Hzで音量が維持される: ${rms}`);
      if (rate === 24000) {
        const stereo = 出力PCM変換(pcm);
        assert.equal(stereo.length, 48000 * 2 * 2, '出力も48kHz stereoの1秒分になる');
        for (let i = 0; i < rate; i++) {
          for (let j = 0; j < 4; j++) assert.equal(stereo.readInt16LE(i * 8 + j * 2), pcm.readInt16LE(i * 2));
        }
      }
    }
  } finally { encoder.delete(); decoder.delete(); }
});

test('20ms未満のチャンクは続きが届くまで保持し、発話末尾だけ待機後に無音で埋める', context => {
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const stream = new Discord音声出力();
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  const packets: Buffer[] = [];
  stream.push = (packet: Buffer) => { packets.push(packet); return true; };
  try {
    const pcm = Buffer.alloc(960 * 2);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 2 * 440 / 24000)), i * 2);
    stream.追加(pcm.subarray(0, 480));
    stream._read();
    assert.deepEqual(packets.shift(), Buffer.from([0xf8, 0xff, 0xfe]), '不足分を無音で埋めて音声を消費しない');
    stream.追加(pcm.subarray(480, 1440));
    stream._read();
    assert.deepEqual(packets.shift(), encoder.encode(出力PCM変換(pcm.subarray(0, 960)), 960));
    stream._read();
    assert.deepEqual(packets.shift(), Buffer.from([0xf8, 0xff, 0xfe]));
    stream.追加(pcm.subarray(1440));
    stream._read();
    assert.deepEqual(packets.shift(), encoder.encode(出力PCM変換(pcm.subarray(960)), 960));
    stream.追加(pcm.subarray(0, 480));
    stream._read();
    assert.deepEqual(packets.shift(), Buffer.from([0xf8, 0xff, 0xfe]));
    now += 60;
    stream._read();
    const tail = Buffer.alloc(960);
    pcm.copy(tail, 0, 0, 480);
    assert.deepEqual(packets.shift(), encoder.encode(出力PCM変換(tail), 960));
    stream._read();
    assert.deepEqual(packets.shift(), Buffer.from([0xf8, 0xff, 0xfe]));
  } finally { stream.destroy(); encoder.delete(); }
});

test('再生側の要求ごとに20msのOpusを即座に供給し、余計な無音や送出待ちを挟まない', () => {
  const stream = new Discord音声出力();
  const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
  try {
    const pcm = Buffer.alloc(960 * 50);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 2 * 440 / 24000)), i * 2);
    stream.追加(pcm);
    for (let i = 0; i < 50; i++) {
      const opus = stream.read();
      assert.ok(opus, '再生側が要求した時点で、待機せずフレームを渡す');
      assert.notDeepEqual(opus, Buffer.from([0xf8, 0xff, 0xfe]));
      assert.equal(decoder.decode(opus).length, 3840);
    }
    assert.deepEqual(stream.read(), Buffer.from([0xf8, 0xff, 0xfe]));
    stream.追加(Buffer.alloc(24000 * 2 * 30)); // 30秒分の先行受信は長い応答として許容する
    assert.throws(() => stream.追加(Buffer.alloc(出力バッファ上限)), /上限/);
    assert.throws(() => stream.追加(Buffer.alloc(1)), /上限/);
  } finally { stream.destroy(); decoder.delete(); }
  assert.equal(stream.destroyed, true);
});

test('パネルの円型インジケーター用に、通過する PCM の音量と周波数分布を AnalyserNode と同じ尺度で求める', () => {
  // 24kHz で 750Hz は fftSize 256 の 8 番目の帯域に当たる。
  const sine = (amplitude: number) => {
    const pcm = Buffer.alloc(960);
    for (let i = 0; i < 480; i++) pcm.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 750 * i / 24000)), i * 2);
    return pcm;
  };
  // 255 で頭打ちにならない音量で、ピークの帯域を確認する。
  const bins = 音声スペクトル(sine(300)), tone = sine(10000);
  assert.equal(bins.length, 128);
  assert.equal(bins.indexOf(Math.max(...bins)), 8);
  assert.ok(bins.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
  assert.ok(音声レベル(tone) > 0.9);
  assert.deepEqual(new Set(音声スペクトル(Buffer.alloc(960))), new Set([0]));
  assert.equal(音声レベル(Buffer.alloc(0)), 0);
});
