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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ライブ候補読込, ライブ初期値 } from '../src/ライブ/ライブモデル候補';

test('合成ファイル未生成時は空になり、旧JSONの音声候補は使わない', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aidiy-live-catalog-'));
  try {
    const gemini = { models: { second: '2', first: '1' }, voices: { Kore: '声2', Zephyr: '声1' } };
    const openai = { models: { realtime: 'Realtime' }, voices: { cedar: 'Cedar', marin: 'Marin' } };
    writeFileSync(join(directory, 'AiDiy_live_gemini.json'), '\uFEFF' + JSON.stringify(gemini));
    writeFileSync(join(directory, 'AiDiy_live_openai.json'), JSON.stringify(openai));
    const catalog = ライブ候補読込(directory);
    assert.deepEqual(catalog.models, {});
    assert.deepEqual(catalog.voices, {});
    writeFileSync(join(directory, 'AiDiy_live_openai.json'), '{broken');
    assert.deepEqual(ライブ候補読込(directory).voices, {});
    writeFileSync(join(directory, 'AiDiy_live_openai.json'), JSON.stringify({ models: {}, voices: [] }));
    assert.deepEqual(ライブ候補読込(directory).voices, {});
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('診断のLive候補を優先し、共通初期値だけを補正する。声と有効な選択は保持する', () => {
  const root = mkdtempSync(join(tmpdir(), 'aidiy-diag-live-'));
  try {
    const config = join(root, '_config'), output = join(root, '_AIDIY/aidiy_diag');
    mkdirSync(config);mkdirSync(output,{recursive:true});
    const voiceFile=join(output,'live_voices_info.json');
    writeFileSync(voiceFile,JSON.stringify({freeai_live:{voices:{Zephyr:'Zephyr'}},openai_live:{voices:{marin:'Marin'}}}));
    const payload={freeai_live:{models:{'gemini-3.8-live':'new','gemini-3.1-live':'kept'}},openai_live:{models:{'gpt-realtime-2':'Realtime'}}};
    writeFileSync(join(output,'live_models_info.json'),JSON.stringify(payload));
    const catalog=ライブ候補読込(config);
    assert.deepEqual(Object.keys(catalog.models),['freeai_live','openai_live']);
    assert.deepEqual(Object.keys(catalog.voices),['freeai_live','openai_live']);
    assert.equal(catalog.voices.gemini_live,undefined);
    const settings={LIVE_AI_NAME:'removed',LIVE_FREEAI_MODEL:'removed',LIVE_FREEAI_VOICE:'Zephyr'};
    assert.equal(ライブ初期値(settings,catalog).LIVE_FREEAI_MODEL,'gemini-3.8-live');
    assert.equal(ライブ初期値(settings,catalog).LIVE_AI_NAME,'freeai_live');
    assert.equal(ライブ初期値({...settings,LIVE_FREEAI_MODEL:'gemini-3.1-live'},catalog).LIVE_FREEAI_MODEL,'gemini-3.1-live');
    assert.equal(settings.LIVE_AI_NAME,'removed');
    writeFileSync(voiceFile,'{}');
    assert.deepEqual(ライブ候補読込(config).voices,{});
    writeFileSync(voiceFile,'{"freeai_live":{"voices":[]}}');
    assert.throws(()=>ライブ候補読込(config),/live_voices_info/);
    writeFileSync(voiceFile,'{}');
    writeFileSync(join(output,'live_models_info.json'),'{broken');
    assert.throws(()=>ライブ候補読込(config),/live_models_info/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
