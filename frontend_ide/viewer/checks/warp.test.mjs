// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { warpMotion } from '../web/layout.js';

test('入る時は拡大、戻る時は縮小し、次の表示はぼけた状態から現れる', () => {
  const scale = frame => Number(frame.transform.match(/scale\((.*?)\)/)[1]);
  for (const direction of ['in', 'out']) {
    const { exit, entry } = warpMotion(direction);
    assert.equal(exit.frames[0].opacity, 1);
    assert.equal(exit.frames.at(-1).opacity, 0);
    assert(direction === 'in' ? scale(exit.frames.at(-1)) > 1 : scale(exit.frames.at(-1)) < 1);
    assert.equal(entry.frames[0].opacity, 0);
    assert.equal(entry.frames[0].filter, 'blur(18px)');
    assert.equal(entry.frames.at(-1).opacity, 1);
    assert.equal(entry.frames.at(-1).filter, 'blur(0px)');
    assert.equal(scale(entry.frames.at(-1)), 1);

  }
});
