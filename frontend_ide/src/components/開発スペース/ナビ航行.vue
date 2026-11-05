<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ナビ調査中の待ち時間を遊べる表示にする。真っ黒な宇宙に透明な格子が浮かび、光るバイクが走る。
// バイクの背後には羽衣のような縦帯が長く伸びていく。ランダムに走るうち自分の帯へ戻ってきて、突っ切ると帯が光って火花が散る。
// ハンドルは0°（直進）から±15°まで、一定時間ごとに1°ずつ切れる。←→（A/D）を押している間はその方向へ、
// 押していなければ一定時間ごとにランダムに切る。ハンドル角に応じて車体も最大±15°傾く。↑↓（W/S）で加減速、押し続けると加速。
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
const ready = ref(false);
let cleanup = () => {};

const TRAIL_MAX = 1800;       // 帯の最大サンプル数（古いものから消える）。約540マス分
const TRAIL_STEP = 0.3;       // この距離進むごとに1サンプル追加
const SKIP_RECENT = 45;       // 直近の帯（約13マス）は交差判定から除く（自分の尾に毎回反応しないため）
const BAND_HEIGHT = 3.8;      // 羽衣の高さ
const CELL = 2;               // 格子の1マス
const GRID_SIZE = 240;        // 格子の一辺（バイクに追従して無限に見せる）
const ROWS = 3;               // 帯の縦方向の頂点数（下端・中ほど・上端）
const SPARKS = 96;
const MAX_STEER = 15;         // ハンドル角の上限（度）。車体の傾斜上限も同じ角度
const KEY_TICK = .08;         // キー操作中にハンドルを1°動かす間隔（秒）
const AUTO_TICK = .2;         // ランダム操作時にハンドルを1°動かす間隔（秒）
const WHEELBASE = 3.2;        // 旋回半径を決める軸間距離
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function glowTexture() {
  const size = 64, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.25, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

onMounted(() => {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, powerPreference: 'low-power' });
  } catch {
    emit('unsupported'); return;
  }
  ready.value = true;
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  // 床は塗らず線だけ。遠くは黒へ溶けて、宇宙空間に格子が浮かんで見える。
  scene.fog = new THREE.FogExp2(0x000000, 0.024);
  const camera = new THREE.PerspectiveCamera(62, 1, .1, 400);

  const gridFine = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / CELL, 0x0e4a5c, 0x0b2f3d);
  const gridBold = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / (CELL * 5), 0x1fa6c4, 0x1a7f98);
  gridBold.position.y = .01;
  scene.add(gridFine, gridBold);

  // バイク：進行方向 +X。接地点を軸に車体全体が傾き、前輪はハンドル角に合わせて切れる。
  const ship = new THREE.Group(), lean = new THREE.Group(); ship.add(lean);
  const shipMat = new THREE.MeshBasicMaterial({ color: 0xffffff }), wheelMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
  const bodyGeo = new THREE.BoxGeometry(1.5, .3, .26), noseGeo = new THREE.ConeGeometry(.2, .6, 4), riderGeo = new THREE.SphereGeometry(.28, 10, 8), wheelGeo = new THREE.TorusGeometry(.48, .09, 8, 22);
  const body = new THREE.Mesh(bodyGeo, shipMat); body.position.set(0, .62, 0);
  const nose = new THREE.Mesh(noseGeo, shipMat); nose.rotation.z = -Math.PI / 2; nose.position.set(1, .66, 0);
  const rider = new THREE.Mesh(riderGeo, shipMat); rider.position.set(-.15, 1.05, 0);
  const rearWheel = new THREE.Mesh(wheelGeo, wheelMat); rearWheel.position.set(-.8, .5, 0);
  const frontPivot = new THREE.Group(); frontPivot.position.set(.8, 0, 0);
  const frontWheel = new THREE.Mesh(wheelGeo, wheelMat); frontWheel.position.set(0, .5, 0); frontPivot.add(frontWheel);
  const tex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: tex, color: 0x00ffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const glow = new THREE.Sprite(glowMat); glow.scale.set(3.2, 3.2, 1); glow.position.y = .7;
  lean.add(body, nose, rider, rearWheel, frontPivot, glow); scene.add(ship);

  // 羽衣の帯：サンプルごとに縦ROWS点。古いほど暗くなり、加算合成で光らせる。
  const bandGeo = new THREE.BufferGeometry();
  bandGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * ROWS * 3), 3));
  bandGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * ROWS * 3), 3));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) for (let r = 0; r < ROWS - 1; r++) { const a = i * ROWS + r, b = a + ROWS; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  bandGeo.setIndex(idx); bandGeo.setDrawRange(0, 0);
  const bandMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const band = new THREE.Mesh(bandGeo, bandMat); band.frustumCulled = false; scene.add(band);
  const bandPos = bandGeo.attributes.position, bandCol = bandGeo.attributes.color;

  // 帯を突っ切ったときの火花。
  const sparkPos = new Float32Array(SPARKS * 3).fill(-999), sparkCol = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3)); sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.frustumCulled = false; scene.add(sparks);

  // リングバッファ（x, z, hue, 光り具合）。
  const sx = new Float32Array(TRAIL_MAX), sz = new Float32Array(TRAIL_MAX), sh = new Float32Array(TRAIL_MAX), sg = new Float32Array(TRAIL_MAX);
  let head = 0, count = 0;
  const tmp = new THREE.Color(), viewDir = new THREE.Vector3(), upVec = new THREE.Vector3();

  // steer: ハンドル角（度、整数。+で右）。tick: 次にハンドルを動かすまでの残り時間。dir/dirTicks: ランダム操作の向きと継続数。
  const st = { x: 0, z: 0, h: 0, speed: 7, hue: .5, steer: 0, lean: 0, camH: 0, camRoll: 0, tick: 0, dir: 1, dirTicks: 0, lastStep: { x: 0, z: 0 }, shake: 0, cooldown: 0 };
  const input = { hold: false, hover: false, keys: new Set() };

  function pushSample() {
    sx[head] = st.x; sz[head] = st.z; sh[head] = st.hue; sg[head] = 0; head = (head + 1) % TRAIL_MAX; count = Math.min(count + 1, TRAIL_MAX);
  }
  function resetTrail() { count = 0; head = 0; st.lastStep.x = st.x; st.lastStep.z = st.z; }

  function rebuildBand(dt, nowMs) {
    if (count < 2) { bandGeo.setDrawRange(0, 0); return; }
    const start = (head - count + TRAIL_MAX) % TRAIL_MAX, time = nowMs * .001, pa = bandPos.array, ca = bandCol.array;
    for (let n = 0; n < count; n++) {
      const i = (start + n) % TRAIL_MAX, a = (start + Math.max(n - 1, 0)) % TRAIL_MAX, b = (start + Math.min(n + 1, count - 1)) % TRAIL_MAX;
      let dx = sx[b] - sx[a], dz = sz[b] - sz[a]; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const px = -dz, pz = dx, t = n / (count - 1), fade = Math.pow(t, .8);
      const g = sg[i]; if (g > 0) sg[i] = Math.max(0, g - dt * 1.3);
      // 羽衣のゆらぎ：上へいくほど横へ大きく揺れ、突っ切った場所ではふくらんで光る。
      const sway = Math.sin(n * .11 - time * 2.1 + sh[i] * 6) * .45 + Math.sin(n * .047 + time * 1.2) * .35;
      const hh = BAND_HEIGHT * (1 + .1 * Math.sin(n * .08 + time * 1.6)) * (1 + g * .3), boost = 1 + g * 2.6;
      tmp.setHSL(sh[i], 1, .55);
      for (let r = 0; r < ROWS; r++) {
        const u = r / (ROWS - 1), o = (n * ROWS + r) * 3, lat = sway * u * u * (1 + g * .8);
        pa[o] = sx[i] + px * lat; pa[o + 1] = hh * u; pa[o + 2] = sz[i] + pz * lat;
        const lum = fade * boost * (r === 0 ? 1 : r === 1 ? .38 : .05);
        ca[o] = tmp.r * lum; ca[o + 1] = tmp.g * lum; ca[o + 2] = tmp.b * lum;
      }
    }
    bandPos.needsUpdate = true; bandCol.needsUpdate = true; bandGeo.setDrawRange(0, (count - 1) * (ROWS - 1) * 6);
  }

  // バイクの移動線分が古い帯と交差したか調べ、交差したら帯を光らせて火花を散らす。
  function crossBand(px, pz, qx, qz) {
    if (count <= SKIP_RECENT + 2) return;
    const start = (head - count + TRAIL_MAX) % TRAIL_MAX, rx = qx - px, rz = qz - pz;
    for (let n = 0; n < count - SKIP_RECENT; n++) {
      const i = (start + n) % TRAIL_MAX, j = (i + 1) % TRAIL_MAX, ex = sx[j] - sx[i], ez = sz[j] - sz[i];
      const den = rx * ez - rz * ex; if (Math.abs(den) < 1e-6) continue;
      const ox = sx[i] - px, oz = sz[i] - pz, u = (ox * ez - oz * ex) / den, v = (ox * rz - oz * rx) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      for (let k = -16; k <= 16; k++) { const m = n + k; if (m < 0 || m >= count) continue; const s = (start + m) % TRAIL_MAX; sg[s] = Math.max(sg[s], 1 - Math.abs(k) / 17); }
      burst(px + rx * u, pz + rz * u, sh[i]); st.shake = reduced ? 0 : .35; st.cooldown = .25;
      return;
    }
  }
  function burst(x, z, hue) {
    let spawned = 0;
    for (let s = 0; s < SPARKS && spawned < 34; s++) {
      if (sparkLife[s] > 0) continue;
      const ang = Math.random() * TAU, sp = 2 + Math.random() * 6; tmp.setHSL((hue + Math.random() * .12) % 1, .9, .7);
      sparkPos[s * 3] = x; sparkPos[s * 3 + 1] = .4 + Math.random() * 2.2; sparkPos[s * 3 + 2] = z;
      sparkVel[s * 3] = Math.cos(ang) * sp; sparkVel[s * 3 + 1] = 1 + Math.random() * 4; sparkVel[s * 3 + 2] = Math.sin(ang) * sp;
      sparkCol[s * 3] = tmp.r; sparkCol[s * 3 + 1] = tmp.g; sparkCol[s * 3 + 2] = tmp.b; sparkLife[s] = .6 + Math.random() * .6; spawned++;
    }
  }
  function updateSparks(dt) {
    for (let s = 0; s < SPARKS; s++) {
      if (sparkLife[s] <= 0) continue;
      sparkLife[s] -= dt;
      if (sparkLife[s] <= 0) { sparkPos[s * 3 + 1] = -999; continue; }
      sparkVel[s * 3 + 1] -= 9 * dt;
      for (let c = 0; c < 3; c++) sparkPos[s * 3 + c] += sparkVel[s * 3 + c] * dt;
      sparkCol[s * 3] *= 1 - dt * 1.5; sparkCol[s * 3 + 1] *= 1 - dt * 1.5; sparkCol[s * 3 + 2] *= 1 - dt * 1.5;
    }
    sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true;
  }

  // ハンドル操作。一定時間ごとに角度を1°ずつ動かし、角度に応じて進行方向が徐々に変わる。
  function steer(dt) {
    const k = input.keys;
    const left = k.has('ArrowLeft') || k.has('a') || k.has('A'), right = k.has('ArrowRight') || k.has('d') || k.has('D');
    const throttle = (k.has('ArrowUp') || k.has('w') || k.has('W') ? 1 : 0) - (k.has('ArrowDown') || k.has('s') || k.has('S') ? 1 : 0);
    const manual = left !== right;
    st.tick -= dt;
    while (st.tick <= 0) {
      st.tick += manual ? KEY_TICK : AUTO_TICK;
      if (manual) st.steer += right ? 1 : -1;
      else {
        // 向き（-1 / 0 / +1）を数ティックごとにランダムに選び直し、そのティックごとにハンドルを1°動かす。
        if (--st.dirTicks <= 0) {
          st.dirTicks = 6 + Math.floor(Math.random() * 12); st.dir = Math.floor(Math.random() * 3) - 1;
          // 原点から遠く離れたら引き戻す向きを選び、自分の帯へ戻ってくるようにする。
          if (Math.hypot(st.x, st.z) > 32) { const err = wrapAngle(Math.atan2(-st.z, -st.x) - st.h); if (Math.abs(err) > .4) st.dir = err > 0 ? 1 : -1; }
        }
        st.steer += st.dir;
      }
      if (st.steer >= MAX_STEER) { st.steer = MAX_STEER; if (st.dir > 0) st.dir = -1; }
      if (st.steer <= -MAX_STEER) { st.steer = -MAX_STEER; if (st.dir < 0) st.dir = 1; }
    }
    // 自転車モデル：ハンドル角が大きいほど旋回が速い（+で右＝進行方向角が増える向き）。
    const rate = st.speed * Math.tan(st.steer * DEG) / WHEELBASE;
    st.h = wrapAngle(st.h + rate * dt);
    const base = reduced ? 4 : 7;
    const target = base * (input.hold ? 2.1 : 1) * (throttle > 0 ? 1.5 : throttle < 0 ? .45 : 1);
    st.speed += (target - st.speed) * (1 - Math.exp(-dt * 3));
    // 車体はハンドル角に比例して旋回の内側へ傾く（最大±15°）。
    st.lean += (st.steer * DEG - st.lean) * (1 - Math.exp(-dt * 7));
  }

  let last = performance.now(), raf = 0, disposed = false, w = 0, hgt = 0;
  function frame(nowMs) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((nowMs - last) / 1000, .05); last = nowMs;
    if (!w || !hgt) return;
    steer(dt);
    const px = st.x, pz = st.z;
    st.x += Math.cos(st.h) * st.speed * dt; st.z += Math.sin(st.h) * st.speed * dt;
    st.hue = (st.hue + dt * (.03 + st.speed * .004)) % 1;
    st.cooldown = Math.max(0, st.cooldown - dt);
    if (!st.cooldown) crossBand(px, pz, st.x, st.z);
    if (Math.hypot(st.x - st.lastStep.x, st.z - st.lastStep.z) >= TRAIL_STEP) { pushSample(); st.lastStep.x = st.x; st.lastStep.z = st.z; }
    rebuildBand(dt, nowMs); updateSparks(dt);
    ship.position.set(st.x, 0, st.z); ship.rotation.set(0, -st.h, 0);
    lean.rotation.x = st.lean;                       // +で右へ傾く
    frontPivot.rotation.y = -st.steer * DEG * 1.6;   // 前輪を切る（見た目を強調）
    tmp.setHSL(st.hue, 1, .6); glowMat.color.copy(tmp); wheelMat.color.copy(tmp); shipMat.color.setHSL(st.hue, .6, .85);
    glow.scale.setScalar(3.2 + Math.sin(nowMs * .008) * .25 + (input.hold ? 1.2 : 0) + (st.cooldown > 0 ? st.cooldown * 10 : 0));
    // 格子をバイクに追従（10マス単位）
    const gx = Math.round(st.x / CELL / 5) * CELL * 5, gz = Math.round(st.z / CELL / 5) * CELL * 5;
    gridFine.position.set(gx, 0, gz); gridBold.position.set(gx, .01, gz);
    // カメラ：後方上空から少し遅れて追従し、バイクの傾きに合わせて画面も傾く。
    st.camH += wrapAngle(st.h - st.camH) * (1 - Math.exp(-dt * 2.4)); st.camH = wrapAngle(st.camH);
    const cx = st.x - Math.cos(st.camH) * 16, cz = st.z - Math.sin(st.camH) * 16;
    camera.position.x += (cx - camera.position.x) * (1 - Math.exp(-dt * 5));
    camera.position.z += (cz - camera.position.z) * (1 - Math.exp(-dt * 5));
    st.shake = Math.max(0, st.shake - dt);
    camera.position.y = 10 + (st.shake ? Math.sin(nowMs * .09) * st.shake * .5 : 0);
    st.camRoll += ((reduced ? 0 : st.lean * .6) - st.camRoll) * (1 - Math.exp(-dt * 4));
    const lx = st.x + Math.cos(st.camH) * 6, lz = st.z + Math.sin(st.camH) * 6;
    viewDir.set(lx - camera.position.x, -camera.position.y, lz - camera.position.z).normalize();
    camera.up.set(0, 1, 0).applyAxisAngle(viewDir, st.camRoll);
    camera.lookAt(lx, 0, lz);
    renderer.render(scene, camera);
  }

  function resize() {
    const r = stage.value.getBoundingClientRect(); w = Math.floor(r.width); hgt = Math.floor(r.height);
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(stage.value); resize();
  camera.position.set(-16, 10, 0); pushSample();

  const el = stage.value;
  const onDown = e => { input.hold = true; try { el.setPointerCapture(e.pointerId); } catch { /* 取得できなくても操縦は続く */ } };
  const onUp = () => { input.hold = false; };
  const onEnter = () => { input.hover = true; };
  const onLeave = () => { input.hover = false; };
  // キーは「この画面にフォーカスがある」か「マウスが画面上にある」ときだけ受け付け、文字入力欄の操作は邪魔しない。
  const active = e => navigationKeyActive(e, el, input.hover);
  const STEER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const onKeyDown = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !active(e)) return;
    if (STEER_KEYS.includes(e.key) || (e.key.length === 1 && 'awsdAWSD'.includes(e.key))) { input.keys.add(e.key); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { resetTrail(); e.preventDefault(); }
  };
  const onKeyUp = e => { input.keys.delete(e.key); };
  const onBlur = () => { input.keys.clear(); input.hold = false; input.hover = false; };
  el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave); el.addEventListener('dblclick', resetTrail);
  const unbindKeys = bindNavigationKeys(el, {keydown:onKeyDown, keyup:onKeyUp, blur:onBlur});
  raf = requestAnimationFrame(frame);

  cleanup = () => {
    disposed = true; cancelAnimationFrame(raf); ro.disconnect();
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave); el.removeEventListener('dblclick', resetTrail);
    unbindKeys();
    for (const g of [gridFine, gridBold]) { g.geometry.dispose(); g.material.dispose(); }
    bandGeo.dispose(); bandMat.dispose(); sparkGeo.dispose(); sparkMat.dispose();
    bodyGeo.dispose(); noseGeo.dispose(); riderGeo.dispose(); wheelGeo.dispose(); shipMat.dispose(); wheelMat.dispose(); glowMat.dispose(); tex.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" class="navigation-cruise" :class="{ ready }" tabindex="0" role="img" aria-label="ナビ調査中の遊び場。光るバイクが走り、背後に帯が伸びます。左右キーでハンドル、上下キーで加減速、押し続けると加速します。">
    <canvas ref="canvas"></canvas>
    <small v-if="ready" class="navigation-cruise-hint" aria-hidden="true">←→でハンドル / ↑↓で加減速 / 押し続けて加速 / 自分の帯を突っ切ろう / ダブルクリックで帯を消去</small>
  </div>
</template>
<style>
.navigation-cruise{position:absolute;inset:0;overflow:hidden;background:#000;outline:none;touch-action:none;cursor:crosshair}
.navigation-cruise canvas{display:block;width:100%;height:100%}
.navigation-cruise:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.navigation-cruise-hint{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#6f95a8;font-size:10px;pointer-events:none;text-shadow:0 0 4px #000}
</style>
