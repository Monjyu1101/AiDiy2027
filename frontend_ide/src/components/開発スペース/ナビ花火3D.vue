<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
defineOptions({name:'ナビ花火3D'});
// ナビ調査中の待ち時間を遊べる表示にする（ナビ羽衣ライディングと並ぶもう一つの表示。どちらを出すかはナビごとにランダム）。
// 真っ黒な夜空に花火が上がり続ける。スペースキーを押し下げている間は力を貯め、離すと大玉を打ち上げる。それ以外はランダムに上がる。
// 視点は常に花火の中心を見たまま自動航行し、花火の中心を焦点にしたランダムな楕円軌道を飛ぶ。
// 軌道は打ち上げの円の中を突っ切り、中心に近いほど速く、火花の真ん中を通過していく。
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
const ready = ref(false), charge = ref(0);
let cleanup = () => {};

const POOL = 14000;            // 火花の最大数（古いものから上書き）
const GRAVITY = 6;
const TIME_SCALE = .5;         // 花火の時間係数。火花の動き・寿命・打ち上げ間隔が実時間の半分の速さで進む（視点の航行とキー操作は実時間）
const RING_R = 18;             // 打ち上げ位置の仮想の円（この円の内側ならどこからでも上がる）の半径
const DECEL = 3;               // 打ち上げ中の減速
const CHARGE_SECONDS = 1.6;    // スペースキーで満タンになるまで
const CENTER = new THREE.Vector3(0, 15, 0); // 花火の中心＝視点の楕円軌道の焦点
const ORBIT_SPEED = .13;       // 平均運動（rad/s）。ケプラー軌道なので近点（中心付近）ほど速い（以前の半分）
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

const VERT = `attribute float size; attribute vec3 aColor; varying vec3 vC; uniform float uScale;
void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 0.0, 96.0); gl_Position = projectionMatrix * mv; }`;
const FRAG = `varying vec3 vC;
void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; gl_FragColor = vec4(vC * a, 1.0); }`;

// ケプラー方程式 E - e sin E = M をニュートン法で解く。
function kepler(M, e) {
  let E = e < .8 ? M : Math.PI;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

onMounted(() => {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, powerPreference: 'low-power' });
  } catch {
    emit('unsupported'); return;
  }
  ready.value = true;
  const reduced = false;
  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();scene.name='ナビ花火3D';
  scene.fog = new THREE.FogExp2(0x000000, .006);
  const camera = new THREE.PerspectiveCamera(62, 1, .1, 600);

  // 地面の薄い格子（奥行きの目安）と星。
  const ground = new THREE.GridHelper(300, 30, 0x0d2b3a, 0x081a24);
  scene.add(ground);
  const starCount = 360, starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 260, th = Math.random() * TAU, ph = Math.random() * 1.3 + .05;
    starPos[i * 3] = r * Math.cos(th) * Math.cos(ph); starPos[i * 3 + 1] = r * Math.sin(ph); starPos[i * 3 + 2] = r * Math.sin(th) * Math.cos(ph);
  }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0x8fb8c8, size: 1.3, sizeAttenuation: false, transparent: true, opacity: .55, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);

  // 火花：1つの Points で全粒子を描く。位置・色・大きさは毎フレームCPUで更新する。
  const pos = new Float32Array(POOL * 3).fill(-999), col = new Float32Array(POOL * 3), siz = new Float32Array(POOL);
  const vel = new Float32Array(POOL * 3), base = new Float32Array(POOL * 3), life = new Float32Array(POOL), maxLife = new Float32Array(POOL);
  const drag = new Float32Array(POOL), grav = new Float32Array(POOL), size0 = new Float32Array(POOL), trailing = new Uint8Array(POOL);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 300 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; scene.add(points);
  let cursor = 0;
  const tmp = new THREE.Color();

  function spark(x, y, z, vx, vy, vz, r, g, b, lifeSec, dragK, gravK, size, trail) {
    const i = cursor, o = i * 3; cursor = (cursor + 1) % POOL;
    pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    base[o] = r; base[o + 1] = g; base[o + 2] = b; life[i] = maxLife[i] = lifeSec; drag[i] = dragK; grav[i] = gravK; size0[i] = size; trailing[i] = trail ? 1 : 0;
  }
  function color(h, l = .55) { tmp.setHSL(h % 1, 1, l); return tmp; }

  // 球面上の一様な方向。
  function dirOnSphere(out) {
    const u = rand(-1, 1), t = rand(0, TAU), s = Math.sqrt(1 - u * u); out[0] = s * Math.cos(t); out[1] = u; out[2] = s * Math.sin(t);
  }
  const d3 = [0, 0, 0];

  function burst(x, y, z, type, hue, scale) {
    // 一瞬の閃光。
    for (let k = 0; k < 4; k++) spark(x, y, z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 1.2, 1.2, 1.2, .22 + k * .04, 2, 0, 5 * scale + 2, false);
    if (type === 'sphere' || type === 'double') {
      const n = Math.round(230 * scale);
      for (let k = 0; k < n; k++) { dirOnSphere(d3); const sp = rand(8, 12) * scale; const c = color(hue + rand(-.03, .03), .55); spark(x, y, z, d3[0] * sp, d3[1] * sp, d3[2] * sp, c.r, c.g, c.b, rand(1.7, 2.6), 1.15, GRAVITY, .55, k % 5 === 0); }
      if (type === 'double') {
        const n2 = Math.round(130 * scale), h2 = hue + .45;
        for (let k = 0; k < n2; k++) { dirOnSphere(d3); const sp = rand(4, 6.5) * scale; const c = color(h2, .6); spark(x, y, z, d3[0] * sp, d3[1] * sp, d3[2] * sp, c.r, c.g, c.b, rand(1.6, 2.2), 1.2, GRAVITY, .5, false); }
      }
    } else if (type === 'ring') {
      const ax = [0, 0, 0]; dirOnSphere(ax);
      // ax に直交する2軸 u, v を作り、その平面上に円状に飛ばす。
      const ux = Math.abs(ax[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
      const u = [ax[1] * ux[2] - ax[2] * ux[1], ax[2] * ux[0] - ax[0] * ux[2], ax[0] * ux[1] - ax[1] * ux[0]], ul = Math.hypot(...u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
      const v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
      const n = Math.round(150 * scale);
      for (let k = 0; k < n; k++) { const t = (k / n) * TAU, sp = 10.5 * scale, c = color(hue + k / n * .25, .58); spark(x, y, z, (u[0] * Math.cos(t) + v[0] * Math.sin(t)) * sp, (u[1] * Math.cos(t) + v[1] * Math.sin(t)) * sp, (u[2] * Math.cos(t) + v[2] * Math.sin(t)) * sp, c.r, c.g, c.b, rand(1.8, 2.3), 1.3, GRAVITY * .6, .55, false); }
    } else { // willow：ゆっくり垂れ落ちる金色の長い尾
      const n = Math.round(170 * scale);
      for (let k = 0; k < n; k++) { dirOnSphere(d3); const sp = rand(5, 9) * scale; const c = color(.11 + rand(-.02, .02), .6); spark(x, y, z, d3[0] * sp, d3[1] * sp, d3[2] * sp, c.r, c.g, c.b, rand(3, 4.2), 1.7, GRAVITY * .7, .5, true); }
    }
  }
  // 大玉：スペースキーで貯めた力（0〜1）に応じて、数・速さ・層が増える。
  function bigBurst(x, y, z, power, hue) {
    const s = .7 + power * .9;
    for (let k = 0; k < 10; k++) spark(x, y, z, rand(-3, 3), rand(-3, 3), rand(-3, 3), 1.5, 1.5, 1.5, .35 + k * .04, 1.5, 0, 8 * s + 3, false);
    const outer = Math.round(520 + 900 * power);
    for (let k = 0; k < outer; k++) { dirOnSphere(d3); const sp = rand(15, 21) * s; const c = color(hue + rand(-.05, .05), .55); spark(x, y, z, d3[0] * sp, d3[1] * sp, d3[2] * sp, c.r, c.g, c.b, rand(2.4, 3.6), 1.05, GRAVITY, .8, k % 4 === 0); }
    const inner = Math.round(300 + 400 * power);
    for (let k = 0; k < inner; k++) { dirOnSphere(d3); const sp = rand(7, 11) * s; const c = color(hue + .5, .62); spark(x, y, z, d3[0] * sp, d3[1] * sp, d3[2] * sp, c.r, c.g, c.b, rand(2.2, 3), 1.1, GRAVITY, .7, false); }
  }

  // 打ち上げ中の玉。頂点（目標高度）に達したら開く。
  const shells = [];
  // 打ち上げは、中心を囲む仮想の円（地面上の半径 RING_R）の内側のランダムな点（円内で一様）から、中心へ向けて発射する。
  function launch({ big = false, power = 0, type } = {}) {
    const hue = Math.random(), ang = rand(0, TAU), r = RING_R * Math.sqrt(Math.random());
    const target = big ? CENTER.y + rand(4, 12) + power * 6 : CENTER.y + rand(-4, 10);
    const sx = Math.cos(ang) * r, sz = Math.sin(ang) * r;
    const aim = rand(0, TAU), reach = big ? rand(0, 2) : rand(0, 7);   // 開く場所（中心からの距離）。大玉はほぼ中心
    const tx = Math.cos(aim) * reach, tz = Math.sin(aim) * reach;
    const rise = big ? 26 : rand(18, 22), t = (rise - Math.sqrt(rise * rise - 2 * DECEL * target)) / DECEL;
    shells.push({ x: sx, y: 0, z: sz, vx: (tx - sx) / t, vy: rise, vz: (tz - sz) / t, target, big, power, hue,
      type: type || ['sphere', 'sphere', 'double', 'ring', 'willow'][Math.floor(Math.random() * 5)], scale: rand(.85, 1.25) });
  }
  function updateShells(dt) {
    for (let s = shells.length - 1; s >= 0; s--) {
      const sh = shells[s];
      sh.vy -= DECEL * dt; sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.z += sh.vz * dt;
      const warm = sh.big ? .9 : .6;
      for (let k = 0; k < 1; k++) spark(sh.x + rand(-.1, .1), sh.y, sh.z + rand(-.1, .1), rand(-.6, .6), rand(-2, 0), rand(-.6, .6), warm, warm * .7, warm * .35, rand(.4, .75), 1.5, 2, sh.big ? .7 : .45, false);
      if (sh.y >= sh.target || sh.vy <= 2) {
        if (sh.big) bigBurst(sh.x, sh.y, sh.z, sh.power, sh.hue); else burst(sh.x, sh.y, sh.z, sh.type, sh.hue, sh.scale);
        shells.splice(s, 1);
      }
    }
  }

  // 視点の楕円軌道（ケプラー軌道）。焦点は花火の中心で、近点付近（中心部）ほど速く通り抜ける。
  // 軌道は遠点（動きが遅い所）を通過するたびに、次のランダムな軌道（大きさ・扁平さ・向き・傾き・回る向き）へ滑らかに移る。
  const orbit = { a: 30, e: .72, om: rand(0, TAU), inc: rand(.1, .8), M: rand(0, TAU), dir: 1 }, target = { ...orbit };
  function newOrbit() {
    // 近点距離 rp を中心付近（打ち上げの円の内側、火花の真ん中）に取り、そこを速く突っ切る軌道にする。e = 1 - rp / a。
    target.a = rand(22, 40); target.e = 1 - rand(2.5, 9) / target.a; target.om = rand(0, TAU); target.inc = rand(-.9, .9); target.dir = Math.random() < .5 ? 1 : -1;
  }
  const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3(0, 1, 0), ez = new THREE.Vector3();
  const camPos = new THREE.Vector3(), prevCam = new THREE.Vector3(), look = CENTER.clone(), lookGoal = new THREE.Vector3(), vdir = new THREE.Vector3();
  let fovNow = 62, rollNow = 0, apoPassed = false;
  function orbitPosition(out) {
    const { a, e, om, inc, M, dir } = orbit, E = kepler(M, e), b = a * Math.sqrt(1 - e * e);
    out.set(a * (Math.cos(E) - e), 0, dir * b * Math.sin(E)).applyAxisAngle(ex, inc).applyAxisAngle(ey, om).add(CENTER);
    out.y = Math.max(out.y, 2.5);
  }
  function updateCamera(dt) {
    prevCam.copy(camPos);
    orbit.M += ORBIT_SPEED * (reduced ? .5 : 1) * dt;
    if (orbit.M >= TAU) { orbit.M -= TAU; apoPassed = false; }
    if (!apoPassed && orbit.M >= Math.PI) { apoPassed = true; newOrbit(); }
    const k = 1 - Math.exp(-dt * .9);
    orbit.a = lerp(orbit.a, target.a, k); orbit.e = lerp(orbit.e, target.e, k); orbit.inc = lerp(orbit.inc, target.inc, k);
    const dOm = ((target.om - orbit.om + Math.PI) % TAU + TAU) % TAU - Math.PI; orbit.om += dOm * k;
    if (orbit.dir !== target.dir && orbit.M > 2.9 && orbit.M < 3.4) orbit.dir = target.dir; // 向きの反転は動きの遅い遠点付近でだけ行う
    orbitPosition(camPos);
    const speed = prevCam.distanceTo(camPos) / Math.max(dt, 1e-3);
    vdir.subVectors(camPos, prevCam); if (vdir.lengthSq() > 1e-8) vdir.normalize(); else vdir.set(1, 0, 0);
    // 視点はいつも花火の中心を向く。
    look.copy(CENTER);
    // 中心を速く駆け抜けるほど画角が広がり、軌道の曲がり方向へ少し傾く（スピード感）。
    const rush = Math.min(1, speed / 26);
    fovNow += ((reduced ? 62 : 58 + rush * 26) - fovNow) * (1 - Math.exp(-dt * 5));
    if (Math.abs(camera.fov - fovNow) > .05) { camera.fov = fovNow; camera.updateProjectionMatrix(); if (hgt) mat.uniforms.uScale.value = hgt * pixelRatio / (2 * Math.tan(camera.fov * Math.PI / 360)); }
    ez.subVectors(look, camPos).normalize();
    const turn = new THREE.Vector3().crossVectors(vdir, ez).y;
    rollNow += ((reduced ? 0 : Math.max(-.35, Math.min(.35, turn * rush * 1.2))) - rollNow) * (1 - Math.exp(-dt * 4));
    camera.up.set(0, 1, 0).applyAxisAngle(ez, rollNow);
    camera.position.copy(camPos); camera.lookAt(look);
  }

  // 入力：スペースキーを押し下げている間だけ力を貯める。
  const input = { hover: false, space: false, held: 0 };
  let nextAuto = 1, salvo = 0, last = performance.now(), raf = 0, disposed = false, w = 0, hgt = 0;
  function frame(nowMs) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min((nowMs - last) / 1000, .05); last = nowMs;
    const sdt = dt * TIME_SCALE; // 花火の世界の経過時間
    if (!w || !hgt) return;
    // ランダム打ち上げ
    nextAuto -= sdt;
    if (nextAuto <= 0) {
      launch(); if (salvo > 0) { salvo--; nextAuto = rand(.12, .3); } else { nextAuto = rand(.5, 1.9); if (Math.random() < .25) salvo = 1 + Math.floor(Math.random() * 3); }
    }
    // 力を貯めている間は、仮想の円の内側のあちこちから火花が立ちのぼり、貯まるほど勢いが増す。
    if (input.space) {
      input.held += dt; charge.value = Math.min(1, input.held / CHARGE_SECONDS);
      const p = charge.value, n = 4 + Math.round(p * 10);
      for (let k = 0; k < n; k++) { const t = rand(0, TAU), rr = RING_R * Math.sqrt(Math.random()), c = color(.08 + p * .55, .6); spark(Math.cos(t) * rr, .2, Math.sin(t) * rr, rand(-.8, .8), 4 + 12 * p + rand(0, 4), rand(-.8, .8), c.r, c.g, c.b, rand(.5, .9), 1, 2, .4 + p * .5, false); }
    }
    updateShells(sdt);
    // 火花の更新
    const tp = Math.min(1, sdt * 18);
    for (let i = 0; i < POOL; i++) {
      if (life[i] <= 0) continue;
      life[i] -= sdt; const o = i * 3;
      if (life[i] <= 0) { siz[i] = 0; pos[o + 1] = -999; col[o] = col[o + 1] = col[o + 2] = 0; continue; }
      const dk = Math.exp(-drag[i] * sdt); vel[o] *= dk; vel[o + 1] = vel[o + 1] * dk - grav[i] * sdt; vel[o + 2] *= dk;
      pos[o] += vel[o] * sdt; pos[o + 1] += vel[o + 1] * sdt; pos[o + 2] += vel[o + 2] * sdt;
      if (pos[o + 1] < 0) { pos[o + 1] = 0; vel[o + 1] *= -.2; }
      const f = life[i] / maxLife[i], fade = f < .35 ? f / .35 : 1, tw = .75 + .25 * Math.sin(nowMs * .03 + i);
      col[o] = base[o] * fade * tw; col[o + 1] = base[o + 1] * fade * tw; col[o + 2] = base[o + 2] * fade * tw; siz[i] = size0[i] * (.45 + .55 * f);
      if (trailing[i] && Math.random() < tp) spark(pos[o], pos[o + 1], pos[o + 2], 0, 0, 0, base[o] * .7, base[o + 1] * .7, base[o + 2] * .7, .5, 1, 1, size0[i] * .6, false);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.aColor.needsUpdate = true; geo.attributes.size.needsUpdate = true;
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  function resize() {
    const r = stage.value.getBoundingClientRect(); w = Math.floor(r.width); hgt = Math.floor(r.height);
    if (!w || !hgt) return;
    renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix();
    mat.uniforms.uScale.value = hgt * pixelRatio / (2 * Math.tan(camera.fov * Math.PI / 360));
  }
  const ro = new ResizeObserver(resize); ro.observe(stage.value); resize();
  orbitPosition(camPos); camera.position.copy(camPos); camera.lookAt(CENTER);
  launch(); launch();

  const el = stage.value;
  const onEnter = () => { input.hover = true; };
  const onLeave = () => { input.hover = false; };
  // キーは「この画面にフォーカスがある」か「マウスが画面上にある」ときだけ受け付け、文字入力欄の操作は邪魔しない。
  const active = e => navigationKeyActive(e, el, input.hover);
  const release = () => {
    if (!input.space) return;
    input.space = false;
    const power = Math.min(1, input.held / CHARGE_SECONDS);
    if (input.held >= .15) launch({ big: true, power: Math.max(power, .15) }); else launch();
    input.held = 0; charge.value = 0;
  };
  const onKeyDown = e => {
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || !active(e)) return;
    e.preventDefault();
    if (!e.repeat && !input.space) { input.space = true; input.held = 0; }
  };
  const onKeyUp = e => { if (e.code === 'Space') { if (input.space) e.preventDefault(); release(); } };
  const onBlur = () => { input.space = false; input.held = 0; input.hover = false; charge.value = 0; };
  el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave);
  const unbindKeys = bindNavigationKeys(el, {keydown:onKeyDown, keyup:onKeyUp, blur:onBlur});
  raf = requestAnimationFrame(frame);

  cleanup = () => {
    disposed = true; cancelAnimationFrame(raf); ro.disconnect();
    el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave);
    unbindKeys();
    ground.geometry.dispose(); ground.material.dispose(); starGeo.dispose(); starMat.dispose(); geo.dispose(); mat.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" data-scene="ナビ花火3D" class="ナビ花火3D" :class="{ ready }" tabindex="0" role="img" aria-label="ナビ花火3D。ナビ調査中の花火。スペースキーを押し続けて力を貯め、離すと大玉を打ち上げます。">
    <canvas ref="canvas"></canvas>
    <div v-show="charge > 0" class="navigation-fireworks-gauge" aria-hidden="true"><i :style="{ width: charge * 100 + '%' }"></i></div>
    <small v-if="ready" class="navigation-fireworks-hint" aria-hidden="true">スペースキーを押し続けて貯め、離して大玉を打ち上げ</small>
  </div>
</template>
<style>
.ナビ花火3D{position:absolute;inset:0;overflow:hidden;background:#000;outline:none;touch-action:none}
.ナビ花火3D canvas{display:block;width:100%;height:100%}
.ナビ花火3D:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.navigation-fireworks-hint{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#6f95a8;font-size:10px;pointer-events:none;text-shadow:0 0 4px #000}
.navigation-fireworks-gauge{position:absolute;left:25%;right:25%;bottom:24px;height:5px;background:#10202a;border:1px solid #2c5a6c;pointer-events:none}
.navigation-fireworks-gauge>i{display:block;height:100%;background:linear-gradient(to right,#ffb347,#ff5ea8,#7fe8ff)}
</style>
