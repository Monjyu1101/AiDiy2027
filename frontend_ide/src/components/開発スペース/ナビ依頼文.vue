<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ナビ調査中の待ち時間の表示「依頼文」。作業中の依頼文（プロンプト案）を短い断片に分け、3D空間の遠くから視点（自分）へ迫り、
// 左右をかすめて背後へ通り過ぎるコメントとして流す。視点はゆっくり揺れる。
// 文字の大きさ・迫る速さ・文字色・位置・横への流れはコメントごとにランダム。文字は断片ごとに1度だけ絵（テクスチャ）にして、
// 移動はGPUに任せるので、毎フレーム文字を描き直さず、なめらかに動く。
import {ref, watch, onMounted, onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {bindNavigationKeys} from './ナビ入力.js';
import {requestSegments, pickFlight, COMMENT_ALPHA, FLIGHT} from './ナビ依頼文.js';
const props = defineProps({text: {type: String, default: ''}});
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
let cleanup = () => {};
const FONT = size => `700 ${size}px "Yu Gothic UI","Meiryo","Noto Sans JP",system-ui,sans-serif`;
const MAX_COMMENTS = 34, TEXTURE_PX = 72, BACKGROUND = 0x05070c;

onMounted(() => {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas: canvas.value, antialias: true, powerPreference: 'low-power'}); }
  catch { emit('unsupported'); return; }
  const el = stage.value;
  renderer.setClearColor(BACKGROUND, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BACKGROUND, 25, 150);   // 遠くのコメントは暗く、近づくほどはっきり見える
  const camera = new THREE.PerspectiveCamera(62, 1, .2, 300);
  const plane = new THREE.PlaneGeometry(1, 1);

  // 文字は断片ごとに1度だけテクスチャにする（白＋黒の縁取り。色はマテリアルの色で掛ける）。
  const textures = new Map();
  function textureOf(text) {
    let item = textures.get(text);
    if (item) return item;
    const measure = document.createElement('canvas').getContext('2d'); measure.font = FONT(TEXTURE_PX);
    const width = Math.min(2048, Math.ceil(measure.measureText(text).width) + TEXTURE_PX), height = Math.ceil(TEXTURE_PX * 1.5);
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const g = c.getContext('2d'); g.font = FONT(TEXTURE_PX); g.textBaseline = 'middle'; g.textAlign = 'center'; g.lineJoin = 'round';
    g.lineWidth = TEXTURE_PX * .17; g.strokeStyle = 'rgba(0,0,0,.9)'; g.strokeText(text, width / 2, height / 2); g.fillStyle = '#fff'; g.fillText(text, width / 2, height / 2);
    const texture = new THREE.CanvasTexture(c); texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; texture.colorSpace = THREE.SRGBColorSpace;
    item = {texture, aspect: width / height}; textures.set(text, item); return item;
  }
  let segments = requestSegments(props.text);
  const prepare = () => { for (const text of segments.slice(0, 80)) textureOf(text); };   // 先に作っておき、表示中に引っかからないようにする
  prepare();
  const stopWatch = watch(() => props.text, value => { segments = requestSegments(value); prepare(); });

  // コメント（板）。使い回して、作り直しを避ける。
  const pool = [], active = [];
  function spawn(farOffset = 0) {
    if (active.length >= MAX_COMMENTS) return;
    const flight = pickFlight(segments), {texture, aspect} = textureOf(flight.text);
    let mesh = pool.pop();
    if (!mesh) { mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, opacity: COMMENT_ALPHA})); scene.add(mesh); }
    mesh.material.map = texture; mesh.material.color.set(flight.color); mesh.visible = true;
    const textHeight = Math.min(flight.height, Math.max(.45, FLIGHT.width / (aspect * 1.5)));   // 幅が広がりすぎる長い断片は文字を小さく
    mesh.scale.set(textHeight * aspect * 1.5, textHeight * 1.5, 1);
    flight.z -= farOffset;   // 最初は、見え始める前の遠くに順に書いておく（見え出したら次々と通り過ぎる）
    mesh.position.set(flight.x, flight.y, flight.z); mesh.userData = flight; active.push(mesh);
  }
  function recycle(index) { const mesh = active[index]; mesh.visible = false; active.splice(index, 1); pool.push(mesh); }

  let raf = 0, frameOwner, disposed = false, last = 0, width = 0, height = 0, nextSpawn = 0, time = 0, started = false;
  function frame(nowMs) {
    if (disposed) return;
    const dt = last ? Math.min(.1, (nowMs - last) / 1000) : 0; last = nowMs;
    const doc = el.ownerDocument, owner = doc.defaultView, rect = el.getBoundingClientRect();
    if (!doc.hidden && rect.width > 0 && rect.height > 0) {
      const nw = Math.floor(rect.width), nh = Math.floor(rect.height), dpr = Math.min(owner.devicePixelRatio || 1, 1.5);
      if (nw !== width || nh !== height) { width = nw; height = nh; renderer.setPixelRatio(dpr); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
      if (!started) { started = true; let far = 0; for (let k = 0; k < 18; k++) { spawn(far); far += 6 + Math.random() * 10; } }
      time += dt; nextSpawn -= dt; if (nextSpawn <= 0) { spawn(); nextSpawn = .2 + Math.random() * .4; }
      for (let i = active.length - 1; i >= 0; i--) {
        const mesh = active[i], flight = mesh.userData;
        mesh.position.z += flight.speed * dt; mesh.position.x += flight.vx * dt;
        if (mesh.position.z > FLIGHT.passed) { recycle(i); continue; }
        mesh.rotation.y = -mesh.position.x * .012;   // 少しだけ視点側へ向け、かすめて通り過ぎる感じを出す
      }
      // 視点：ゆっくり揺れる（急な動きはしない）
      camera.position.set(Math.sin(time * .31) * 1.4, Math.sin(time * .23) * .8, 0); camera.rotation.set(Math.sin(time * .19) * .02, Math.sin(time * .27) * .03, Math.sin(time * .17) * .035);
      renderer.render(scene, camera);
    }
    schedule();
  }
  function schedule() { frameOwner = el.ownerDocument.defaultView; raf = frameOwner.requestAnimationFrame(frame); }
  // 別ウィンドウへ移された直後も、移動先のフレームで描画を続ける。
  const unbind = bindNavigationKeys(el, {keydown() {}, blur() {}, moved: () => { if (raf) { frameOwner?.cancelAnimationFrame(raf); last = 0; schedule(); } }});
  schedule();
  cleanup = () => {
    disposed = true; stopWatch(); frameOwner?.cancelAnimationFrame(raf); unbind();
    for (const mesh of [...active, ...pool]) mesh.material.dispose();
    for (const {texture} of textures.values()) texture.dispose();
    plane.dispose(); renderer.dispose(); renderer.forceContextLoss();
  };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" class="navigation-request" role="img" aria-label="ナビ調査中の表示。作業中の依頼文が、大きさ・速さ・色をランダムに変えながら、遠くから自分へ迫って左右をかすめ、背後へ通り過ぎるように流れます。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
  </div>
</template>
<style>
.navigation-request{position:absolute;inset:0;overflow:hidden;background:#05070c;outline:none}
.navigation-request canvas{display:block;width:100%;height:100%}
</style>
