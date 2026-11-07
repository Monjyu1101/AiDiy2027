<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ナビ調査中の待ち時間の表示「時計」。黒い画面の左上に日付（yyyy-mm-dd）、中央に大きく時刻「hh:mm:ss」を出す（秒の後ろのミリ秒は出さない）。
// 時刻の数字は「文字の形のマスク」で、その裏に7色（赤・橙・黄・緑・水・青・紫）の虹色の色盤がある。
// 色盤の中心に目に見えないカラーピッカーがあり、これがランダムにゆっくり動き回るため、数字の色が虹色に移り変わる。
// 日付と「:」は色を変えない。時刻は表示端末の現在時刻。
import {ref, onMounted, onBeforeUnmount} from 'vue';
import {bindNavigationKeys} from './ナビ入力.js';
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
let cleanup = () => {};

// 虹色の7色。色盤は、この7色が角度に沿って一周する（円錐グラデーション）。
const PALETTE = [[255, 84, 84], [255, 168, 58], [255, 235, 80], [92, 236, 124], [72, 204, 255], [98, 122, 255], [190, 112, 255]];
const STATIC = [196, 208, 232];   // 日付と「:」の色（変化しない）
const rgb = (color, alpha = 1) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
const pad = value => String(value).padStart(2, '0');
const FONT = size => `700 ${size}px ui-monospace,"Cascadia Mono",Consolas,"Courier New",monospace`;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

onMounted(() => {
  const el = stage.value, surface = canvas.value;
  let ctx;
  try { ctx = surface.getContext('2d'); } catch { /* 非対応なら開始表示へ戻す */ }
  if (!ctx) { emit('unsupported'); return; }
  // 数字のマスク用の描画面（時刻の周りだけの大きさ）。
  const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
  if (!maskCtx) { emit('unsupported'); return; }
  // 見えないカラーピッカー：マスク内の相対位置（0〜1。少し外側まで）をランダムな目標へなめらかに動かす。
  const picker = {u: rand(.1, .9), v: rand(.2, .8), tu: .5, tv: .5, wait: 0, angle: rand(0, Math.PI * 2)};
  let raf = 0, frameOwner, disposed = false, fontSize = 0, fontWidth = 0, last = 0;

  function movePicker(dt) {
    picker.wait -= dt;
    if (picker.wait <= 0) { picker.tu = rand(-.1, 1.1); picker.tv = rand(-.15, 1.15); picker.wait = rand(1.2, 3.2); }
    const ease = 1 - Math.exp(-dt * 1.1);
    picker.u += (picker.tu - picker.u) * ease; picker.v += (picker.tv - picker.v) * ease;
    picker.angle += dt * .22;   // 色盤もゆっくり回る
  }
  function colorField(c, x, y, width, height) {
    // ピッカーの位置を中心にした虹色の円錐グラデーション（非対応の環境では横方向の虹色）。
    let gradient;
    if (c.createConicGradient) gradient = c.createConicGradient(picker.angle, x, y);
    else gradient = c.createLinearGradient(x - width, 0, x + width, 0);
    PALETTE.forEach((color, i) => gradient.addColorStop(i / PALETTE.length, rgb(color)));
    gradient.addColorStop(1, rgb(PALETTE[0]));
    return gradient;
  }

  function frame(now) {
    if (disposed) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    const doc = el.ownerDocument, owner = doc.defaultView, rect = el.getBoundingClientRect();
    if (!doc.hidden && rect.width > 0 && rect.height > 0) {
      const w = Math.floor(rect.width), h = Math.floor(rect.height), dpr = Math.min(owner.devicePixelRatio || 1, 2);
      if (surface.width !== Math.round(w * dpr) || surface.height !== Math.round(h * dpr)) { surface.width = Math.round(w * dpr); surface.height = Math.round(h * dpr); fontWidth = 0; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      movePicker(dt);
      const date = new Date(), text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * .62);
      glow.addColorStop(0, rgb(STATIC, .07)); glow.addColorStop(1, rgb(STATIC, 0)); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

      // 中央の大きな時刻「hh:mm:ss」を等幅で、画面の幅いっぱいに収める。
      if (!fontWidth) {
        ctx.font = FONT(100); const unit = ctx.measureText('00:00:00').width;
        fontSize = Math.max(14, Math.min(100 * (w * .92) / unit, h * .5)); fontWidth = w;
      }
      ctx.font = FONT(fontSize); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const cell = ctx.measureText('0').width, left = (w - cell * clock.length) / 2, centerY = h * .5;
      const padding = fontSize * .3, regionX = left - padding, regionY = centerY - fontSize * .75, regionW = cell * clock.length + padding * 2, regionH = fontSize * 1.5;

      // 「:」は色を変えない。
      ctx.shadowColor = rgb(STATIC, .5); ctx.shadowBlur = fontSize * .28; ctx.fillStyle = rgb(STATIC);
      for (let i = 0; i < clock.length; i++) if (clock[i] === ':') ctx.fillText(':', left + cell * i, centerY);
      ctx.shadowBlur = 0;

      // 数字：文字の形のマスクに、ピッカーを中心にした虹色の色盤を重ねる。
      const maskW = Math.max(1, Math.round(regionW * dpr)), maskH = Math.max(1, Math.round(regionH * dpr));
      if (mask.width !== maskW || mask.height !== maskH) { mask.width = maskW; mask.height = maskH; }
      maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0); maskCtx.clearRect(0, 0, regionW, regionH);
      maskCtx.globalCompositeOperation = 'source-over'; maskCtx.font = FONT(fontSize); maskCtx.textBaseline = 'middle'; maskCtx.textAlign = 'left'; maskCtx.fillStyle = '#fff';
      for (let i = 0; i < clock.length; i++) if (clock[i] !== ':') maskCtx.fillText(clock[i], padding + cell * i, regionH / 2);
      maskCtx.globalCompositeOperation = 'source-in';
      maskCtx.fillStyle = colorField(maskCtx, picker.u * regionW, picker.v * regionH, regionW, regionH); maskCtx.fillRect(0, 0, regionW, regionH);
      maskCtx.globalCompositeOperation = 'source-over';
      // にじみ（ぼかした下地）と本体を重ねる。
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${Math.max(2, fontSize * .08)}px)`; ctx.globalAlpha = .75; ctx.drawImage(mask, regionX, regionY, regionW, regionH);
      ctx.restore();
      ctx.drawImage(mask, regionX, regionY, regionW, regionH);

      // 左上の日付
      const dateSize = Math.max(12, Math.min(w, h) * .055);
      ctx.font = FONT(dateSize); ctx.fillStyle = rgb(STATIC); ctx.shadowColor = rgb(STATIC, .5); ctx.shadowBlur = dateSize * .4;
      ctx.fillText(text, dateSize * .8, dateSize * 1.3); ctx.shadowBlur = 0;
    }
    schedule();
  }
  function schedule() { frameOwner = el.ownerDocument.defaultView; raf = frameOwner.requestAnimationFrame(frame); }
  // 別ウィンドウへ移された直後も、移動先のフレームで描画を続ける。
  const unbind = bindNavigationKeys(el, {keydown() {}, blur() {}, moved: () => { if (raf) { frameOwner?.cancelAnimationFrame(raf); last = 0; schedule(); } }});
  schedule();
  cleanup = () => { disposed = true; frameOwner?.cancelAnimationFrame(raf); unbind(); };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" class="navigation-clock" role="img" aria-label="ナビ調査中の表示。左上に今日の日付、中央に大きく時分秒が表示され、数字の色は虹色に移り変わります。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
  </div>
</template>
<style>
.navigation-clock{position:absolute;inset:0;overflow:hidden;background:#000;outline:none}
.navigation-clock canvas{display:block;width:100%;height:100%}
</style>
