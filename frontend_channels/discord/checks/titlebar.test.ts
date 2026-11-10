// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const palette = readFileSync(new URL('../panel/titlebar.css', import.meta.url), 'utf8');
const css = readFileSync(new URL('../panel/style.css', import.meta.url), 'utf8');

test('Discord のタイトル配色はmodule内のコピーだけを読み、Web と Electron で同じ色にする', async () => {
  assert.match(css, /@import "\.\/titlebar\.css"/);
  const bar=css.match(/#activity-bar\s*\{([^}]+)\}/)![1];
  assert.match(bar,/box-sizing:\s*content-box/);assert.match(bar,/height:\s*2px/);assert.match(bar,/border-top:\s*1px solid #242424/);
  const window = new Window({ settings: { disableCSSFileLoading: true } });
  try {
    // OS描画ではなく、配布CSSの変数・継承・状態別の適用範囲を確認する。
    const style = window.document.createElement('style');
    // 外部読込を使わず、先頭の import を同じ配布CSSで解決する。
    style.textContent = css.replace('@import "./titlebar.css";', palette);
    window.document.head.append(style);
    window.document.body.innerHTML = '<header><div id="status"><i id="dot" data-phase="idle"></i>未接続</div><div class="brand"><strong>AiDiy Discord</strong></div><div class="window-actions"><button id="minimize">－</button><button class="window-pin"><span>📌</span></button><button class="window-pin pinned"><span>📌</span></button></div></header><div id="activity-bar"></div><div class="conversation-toolbar">プロジェクト</div><main>本文<input id="settings-input"><div id="stage-idle"><div class="stage-text">案内</div></div><div id="stage-message" data-role="user"><div id="stage-text" class="stage-text">応答</div></div></main>';
    const computed = (selector: string) => window.getComputedStyle(window.document.querySelector(selector)!);
    for (const browser of [false, true]) for (const live of [false, true]) {
      window.document.documentElement.classList.toggle('browser-mode', browser);
      window.document.body.classList.toggle('live-view', live);
      assert.equal(computed('header').backgroundColor, '#30343a');
      assert.equal(computed('html').backgroundColor, '#000');
      assert.equal(computed('body').backgroundColor, '#000');
      assert.equal(computed('body').borderTopColor, '#30343a');
      assert.equal(computed('body').borderTopWidth, '1px');
      assert.equal(computed('body').boxSizing, 'border-box');
      assert.equal(computed('#stage-idle .stage-text').backgroundColor, '#000');
      assert.equal(computed('#stage-text').backgroundColor, '#000');
      assert.notEqual(computed('main').backgroundColor, '#30343a', '本文へタイトル背景を転用しない');
      assert.equal(computed('#settings-input').backgroundColor, '#1b202c', '入力の階層色は維持する');
      assert.equal(computed('.brand strong').color, '#fff');
      assert.equal(computed('#status').color, '#fff');
      assert.equal(computed('#minimize').color, '#fff');
      assert.equal(computed('.window-pin').color, '#778394');
      assert.equal(computed('.window-pin.pinned').color, '#c3f7ff');
      assert.equal(computed('#activity-bar').backgroundColor, '#ff4500');
      assert.equal(computed('#activity-bar').animation, 'orange-bar-breathe 4.5s linear infinite');
      assert.equal(computed('.conversation-toolbar').backgroundColor, '#000');
      assert.equal(computed('.conversation-toolbar').color, '#9aa7b8');
      assert.equal(computed('header').minHeight, '31px');
      assert.equal(computed('#minimize').width, '28px');
    }
    window.document.body.classList.add('connected');
    assert.equal(computed('#activity-bar').backgroundColor, '#00ff00');
    assert.equal(computed('#activity-bar').animation, 'green-bar-breathe 4.5s linear infinite');
    // 接続断・再接続待ち・復帰を繰り返しても赤橙と緑が切り替わる。
    for (const connected of [false, true, false, true]) {
      window.document.body.classList.toggle('connected', connected);
      assert.equal(computed('#activity-bar').backgroundColor, connected ? '#00ff00' : '#ff4500');
      assert.equal(computed('#activity-bar').animation, connected ? 'green-bar-breathe 4.5s linear infinite' : 'orange-bar-breathe 4.5s linear infinite');
    }
    for (const phase of ['idle', 'connecting', 'connected', 'reconnecting', 'connected', 'stopping', 'error']) {
      window.document.querySelector('#dot')!.setAttribute('data-phase', phase);
      window.document.body.classList.toggle('connected', phase === 'connected');
      const expected = phase === 'connected' ? '#00ff00' : '#ff4500';
      assert.equal(computed('#dot').backgroundColor, expected, phase);
      assert.equal(computed('#activity-bar').backgroundColor, expected, phase);
    }
    for (const [name, peak] of [['orange', '255, 69, 0'], ['green', '0, 255, 0']]) {
      const frames = css.slice(css.indexOf(`@keyframes ${name}-bar-breathe`)).split('\n}')[0];
      assert.ok(frames.includes('0%, 100% { background-color: rgb(0, 0, 0); }'));
      assert.ok(frames.includes(`50% { background-color: rgb(${peak}); }`));
    }
  } finally { await window.happyDOM.close(); }
});
