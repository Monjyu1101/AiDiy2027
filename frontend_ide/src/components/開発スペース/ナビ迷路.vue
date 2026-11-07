<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ナビ調査中の待ち時間の表示「迷路」。暗い3D空間で、迷路ができていく過程を見せる（派手にしない、落ち着いた暗い色）。
// 壁は下（地面の下）から生えてくる。通路を掘るときは壁が揺れて砕け、破片が飛び散って落ちる。ブロックの間に隙間は置かない。
// 流れ：①生成アルゴリズム（深さ優先・Prim・Kruskal・Wilson・ハントアンドキル＝壁の塊から通路を掘る／再帰分割・壁伸ばし法＝何もない広場へ壁を作る、からランダム）で迷路ができていく
//       →②解法（幅優先・深さ優先・A*・右手法・行き止まり埋めからランダム）が探索する経過を見せる →③見つけた経路を入口から順に光らせる
//       →④答え合わせ（壁を通らない・つながっている・最短か）を出し、2秒後に壁が崩れて次の迷路へ。無限に繰り返す。
// 描いている間は盤面（迷路）がゆっくり回転し続ける（カメラは動かさず、盤面を回すので光の当たり方も変わる）。
// 操作：ドラッグで回転、ホイールで拡大縮小、Spaceで今の迷路を終えて次へ。
import {ref, onMounted, onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
import {MAZE_ALGORITHMS, MAZE_SOLVERS, buildMaze, solveMaze, verifyRoute, initialGrid, mazeSize, blockOf} from './ナビ迷路.js';
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref();
const labelBuild = ref(''), labelSolve = ref(''), labelCheck = ref(''), ready = ref(false);
let cleanup = () => {};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pickDifferent = (list, previous) => { const options = list.filter(item => item.id !== previous); return options[Math.floor(Math.random() * options.length)]; };

// 状態：0=壁 1=通路 2=仮の跡 3=探索した 4=経路 5=埋めた行き止まり 6=引き返した
const WALL = 0, PATH = 1, TEMP = 2, EXPLORED = 3, ROUTE = 4, FILLED = 5, DEAD = 6;
const WALL_HEIGHT = 2;   // 壁の高さ（通路の高さの比較用の基準）
const HEIGHT = [WALL_HEIGHT, .06, .2, .12, .24, .42, .08];
// 暗く落ち着いた色（光らせすぎない）。
const COLOR = [0x4f68a0, 0x18253d, 0x3a6288, 0x9a8240, 0x5fb8a2, 0x2a3650, 0x434d66].map(value => new THREE.Color(value));
const FLASH_COLOR = new THREE.Color(0x5b9ac0), FLASH_TIME = .7;
const BUILD_TIME = 1.5, CHECK_TIME = 1.2, CLEAR_TIME = .8, CRUMBLE_TIME = .3;   // 答え合わせの表示1.2秒＋崩れる0.8秒＝2秒で次へ

onMounted(() => {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas: canvas.value, antialias: true, powerPreference: 'low-power'}); }
  catch { emit('unsupported'); return; }
  ready.value = true;
  const el = stage.value, reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  renderer.setClearColor(0x04060c, 1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // 壁が通路へ落とす影で立体感を出す
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04060c, .014);
  const camera = new THREE.PerspectiveCamera(52, 1, .3, 400);
  const disposables = [], track = item => { disposables.push(item); return item; };
  // 光源は盤面の斜め上（水平から約35°）に固定する。盤面だけが回るので、壁の影が盤面の上をゆっくり動く。
  scene.add(new THREE.AmbientLight(0x9aabcc, 1.15));
  const sun = new THREE.DirectionalLight(0xd8e2f4, 2.7); sun.position.set(36, 30, 26); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0005; sun.shadow.normalBias = .04; sun.shadow.radius = 3;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 140; scene.add(sun);
  function fitShadow() { const half = M * .76; Object.assign(sun.shadow.camera, {left: -half, right: half, top: half, bottom: -half}); sun.shadow.camera.updateProjectionMatrix(); }
  // 盤面（迷路・注目点の光）は1つのグループにまとめ、これをゆっくり回す。
  const board = new THREE.Group(); scene.add(board);
  const headLight = new THREE.PointLight(0x6a9ac0, 0, 0, 2); board.add(headLight);

  // 床と、1ブロック=1つのインスタンス
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(260, 260)), track(new THREE.MeshStandardMaterial({color: 0x05080f, roughness: 1})));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; floor.receiveShadow = true; scene.add(floor);
  const MAX_CELLS = 14, MAX_BLOCKS = mazeSize(MAX_CELLS) ** 2;
  const boxGeo = track(new THREE.BoxGeometry(1.002, 1, 1.002).translate(0, .5, 0));
  const blocks = new THREE.InstancedMesh(boxGeo, track(new THREE.MeshStandardMaterial({roughness: .65, metalness: .1})), MAX_BLOCKS);
  blocks.frustumCulled = false; blocks.count = 0; blocks.castShadow = true; blocks.receiveShadow = true; board.add(blocks);
  // 注目点（生成・探索・経路の先頭）の淡いにじみ
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 64;
  { const g = glowCanvas.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255,255,255,.9)'); grad.addColorStop(.3, 'rgba(255,255,255,.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grad; g.fillRect(0, 0, 64, 64); }
  const glowTex = track(new THREE.CanvasTexture(glowCanvas));
  const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({map: glowTex, color: 0x4d86a8, blending: THREE.AdditiveBlending, transparent: true, opacity: .7, depthWrite: false}))); glow.scale.set(3, 3, 1); glow.visible = false; board.add(glow);

  // 砕けた壁の破片（小さな立方体のインスタンス。数を上限で抑えて軽くする）
  const MAX_DEBRIS = 480, debris = new THREE.InstancedMesh(track(new THREE.BoxGeometry(.2, .2, .2)), track(new THREE.MeshStandardMaterial({roughness: .7})), MAX_DEBRIS);
  debris.frustumCulled = false; board.add(debris);
  const dPos = new Float32Array(MAX_DEBRIS * 3), dVel = new Float32Array(MAX_DEBRIS * 3), dRot = new Float32Array(MAX_DEBRIS * 3), dSpin = new Float32Array(MAX_DEBRIS * 3), dLife = new Float32Array(MAX_DEBRIS);
  { const hidden = new THREE.Matrix4().makeScale(0, 0, 0), base = new THREE.Color(0x2a3856); for (let k = 0; k < MAX_DEBRIS; k++) { debris.setMatrixAt(k, hidden); debris.setColorAt(k, base); } }
  let debrisCursor = 0, debrisBudget = 0, debrisAlive = 0;
  const debrisColor = new THREE.Color();

  // 迷路の状態
  let maze = null, M = 0, state = new Uint8Array(0), h = new Float32Array(0), flash = new Float32Array(0), wallTint = new Float32Array(0);
  let yOff = new Float32Array(0), yVel = new Float32Array(0), wait = new Float32Array(0), crumbleT = new Float32Array(0);
  const active = new Set(), dummy = new THREE.Object3D(), tmpColor = new THREE.Color();
  let phase = 'build', phaseTime = 0, playhead = 0, ops = [], rate = 1, algorithm = null, solver = null, lastAlgorithm = '', lastSolver = '', start = 0, goal = 0, solved = null, routeOps = [], collapsing = false;
  const position = i => [(i % M) - (M - 1) / 2, Math.floor(i / M) - (M - 1) / 2];

  function spawnDebris(i, count) {
    const [x, z] = position(i);
    for (let k = 0; k < count && debrisBudget > 0; k++, debrisBudget--) {
      const j = debrisCursor++ % MAX_DEBRIS; if (dLife[j] <= 0) debrisAlive++;
      dPos[j * 3] = x + rnd(-.4, .4); dPos[j * 3 + 1] = Math.max(.15, Math.min(WALL_HEIGHT, h[i]) * rnd(.2, 1)); dPos[j * 3 + 2] = z + rnd(-.4, .4);
      dVel[j * 3] = rnd(-2.4, 2.4); dVel[j * 3 + 1] = rnd(1.6, 4.6); dVel[j * 3 + 2] = rnd(-2.4, 2.4);
      for (let c = 0; c < 3; c++) { dRot[j * 3 + c] = rnd(0, 6.28); dSpin[j * 3 + c] = rnd(-9, 9); }
      dLife[j] = rnd(.7, 1.1);
      debris.setColorAt(j, debrisColor.copy(COLOR[WALL]).offsetHSL(0, 0, wallTint[i] + rnd(-.04, .06)));
    }
    if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
  }
  function stepDebris(dt) {
    if (!debrisAlive) return;
    for (let j = 0; j < MAX_DEBRIS; j++) {
      if (dLife[j] <= 0) continue;
      dLife[j] -= dt; const j3 = j * 3;
      if (dLife[j] <= 0) { debrisAlive--; dummy.scale.set(0, 0, 0); dummy.position.set(0, -5, 0); dummy.updateMatrix(); debris.setMatrixAt(j, dummy.matrix); continue; }
      dVel[j3 + 1] -= 13 * dt; for (let c = 0; c < 3; c++) { dPos[j3 + c] += dVel[j3 + c] * dt; dRot[j3 + c] += dSpin[j3 + c] * dt; }
      if (dPos[j3 + 1] < .1) { dPos[j3 + 1] = .1; dVel[j3 + 1] *= -.25; dVel[j3] *= .6; dVel[j3 + 2] *= .6; }
      dummy.position.set(dPos[j3], dPos[j3 + 1], dPos[j3 + 2]); dummy.rotation.set(dRot[j3], dRot[j3 + 1], dRot[j3 + 2]);
      dummy.scale.setScalar(Math.min(1, dLife[j] * 2.8)); dummy.updateMatrix(); debris.setMatrixAt(j, dummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }

  function setBlock(i, next, pulse = true) {
    const previous = state[i];
    if (previous === next) return;
    state[i] = next; active.add(i);
    if (next === WALL) { h[i] = HEIGHT[WALL]; yOff[i] = -(WALL_HEIGHT + .06); yVel[i] = 0; wait[i] = 0; crumbleT[i] = 0; }   // 壁は下から生える
    else if (previous === WALL) { crumbleT[i] = CRUMBLE_TIME; spawnDebris(i, 5); }                              // 壁が揺れて砕け、破片が飛ぶ
    if (pulse) { flash[i] = FLASH_TIME; if (next === PATH || next === EXPLORED || next === ROUTE) h[i] = Math.max(h[i], .3); }
  }
  function colorOf(i) {
    tmpColor.copy(COLOR[state[i]]);
    if (state[i] === WALL) tmpColor.offsetHSL(0, 0, wallTint[i]);
    if (flash[i] > 0) tmpColor.lerp(FLASH_COLOR, clamp(flash[i] / FLASH_TIME, 0, 1) * .8);
    return tmpColor;
  }
  function writeBlock(i) {
    const [x, z] = position(i), shake = crumbleT[i] > 0 ? crumbleT[i] / CRUMBLE_TIME * .07 : 0;
    dummy.position.set(x + (shake ? rnd(-shake, shake) : 0), yOff[i], z + (shake ? rnd(-shake, shake) : 0)); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, Math.max(.001, h[i]), 1); dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix); blocks.setColorAt(i, colorOf(i));
  }
  function stepBlocks(dt) {
    if (!active.size) return;
    const speed = 1 - Math.exp(-dt * 9), crumble = 1 - Math.exp(-dt * 16), sink = 1 - Math.exp(-dt * 7);
    for (const i of active) {
      if (wait[i] > 0) { wait[i] = Math.max(0, wait[i] - dt); writeBlock(i); continue; }
      const target = HEIGHT[state[i]], yTarget = collapsing ? -(WALL_HEIGHT + .1) : 0;
      h[i] += (target - h[i]) * (state[i] !== WALL && h[i] > target ? crumble : speed);   // 砕けるときは速く崩れ落ちる
      if (collapsing) yOff[i] += (yTarget - yOff[i]) * sink;   // 片付けでは地面の下へ沈む
      else { yVel[i] += (-yOff[i] * 190 - yVel[i] * 17) * dt; yOff[i] += yVel[i] * dt; }   // 下から生えるときは、少しだけ突き抜けて落ち着く
      if (crumbleT[i] > 0) crumbleT[i] = Math.max(0, crumbleT[i] - dt);
      if (flash[i] > 0) flash[i] = Math.max(0, flash[i] - dt);
      if (Math.abs(target - h[i]) < .002 && Math.abs(yTarget - yOff[i]) < .003 && Math.abs(yVel[i]) < .02 && flash[i] <= 0 && crumbleT[i] <= 0) { h[i] = target; yOff[i] = yTarget; yVel[i] = 0; active.delete(i); }
      writeBlock(i);
    }
    blocks.instanceMatrix.needsUpdate = true; if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  }
  // 片付け：壁がばらばらのタイミングで地面の下へ沈み、いくつかは砕ける
  function startCollapse() {
    collapsing = true; debrisBudget = 120;
    for (let i = 0; i < M * M; i++) { active.add(i); wait[i] = rnd(0, .35); if (state[i] === WALL && Math.random() < .06) spawnDebris(i, 4); }
    glow.visible = false; headLight.intensity = 0;
  }
  function moveHead(i, color, light) {
    if (i === undefined || i === null) return;
    const [x, z] = position(i); glow.position.set(x, .7, z); glow.visible = true; glow.material.color.setHex(color);
    headLight.position.set(x, 1.6, z); headLight.intensity = light; headLight.color.setHex(color);
  }

  function startRound() {
    algorithm = pickDifferent(MAZE_ALGORITHMS, lastAlgorithm); lastAlgorithm = algorithm.id;
    const cells = 8 + Math.floor(Math.random() * (MAX_CELLS - 7));
    maze = buildMaze(cells, algorithm.id); M = mazeSize(cells);
    // 入口と出口は、向かい合う角のセル
    const flipX = Math.random() < .5, flipY = Math.random() < .5;
    start = blockOf(cells, flipX ? cells - 1 : 0, flipY ? cells - 1 : 0); goal = blockOf(cells, flipX ? 0 : cells - 1, flipY ? 0 : cells - 1);
    state = Uint8Array.from(initialGrid(cells, maze.init)); h = new Float32Array(M * M); flash = new Float32Array(M * M); wallTint = new Float32Array(M * M);
    yOff = new Float32Array(M * M); yVel = new Float32Array(M * M); wait = new Float32Array(M * M); crumbleT = new Float32Array(M * M);
    // 最初の壁は、ばらばらのタイミングで地面の下から生えてくる
    for (let i = 0; i < M * M; i++) { wallTint[i] = rnd(-.025, .03); active.add(i); if (state[i] === WALL) { h[i] = HEIGHT[WALL]; yOff[i] = -(WALL_HEIGHT + .06); wait[i] = rnd(0, .8); } }
    blocks.count = M * M; fitShadow(); collapsing = false; solved = null; solver = null; routeOps = [];
    explored = 0; ops = maze.ops; rate = Math.max(4, ops.length / rnd(14, 18)); playhead = 0;   // 生成にゆっくり14〜18秒かける
    labelBuild.value = `生成  ${algorithm.label}（${algorithm.how}）`; labelSolve.value = ''; labelCheck.value = '';
    glow.visible = false; headLight.intensity = 0; phase = 'build'; phaseTime = 0;
  }
  function applyGeneration(op) {
    const [code, index, head] = op;
    if (code === 'c') setBlock(index, PATH); else if (code === 'W') setBlock(index, WALL); else if (code === 't') setBlock(index, TEMP); else if (code === 'u') setBlock(index, WALL, false);
    moveHead(head ?? index, 0x5a96bc, 18);
  }
  function applySolve(op) {
    const [code, index, head] = op;
    if (code === 'v') { setBlock(index, EXPLORED); explored++; } else if (code === 'b') setBlock(index, DEAD); else if (code === 'x') setBlock(index, FILLED);
    moveHead(head ?? index, 0xa88540, 16);
  }
  // 操作を一定の速さで再生する。終わったら true。
  function play(list, dt, apply) {
    playhead = Math.min(list.length, playhead + rate * dt);
    while (applied < Math.floor(playhead)) apply(list[applied++]);
    return applied >= list.length;
  }
  let applied = 0, explored = 0;
  function enter(next) { phase = next; phaseTime = 0; playhead = 0; applied = 0; }

  function stepPhase(dt) {
    phaseTime += dt;
    if (phase === 'build') { if (phaseTime >= BUILD_TIME) enter('generate'); return; }
    if (phase === 'generate') {
      if (play(ops, dt, applyGeneration)) {
        solver = pickDifferent(MAZE_SOLVERS, lastSolver); lastSolver = solver.id;
        solved = solveMaze(maze.grid, maze.cells, solver.id, start, goal); ops = solved.ops; rate = Math.max(4, ops.length / rnd(8, 11));   // 探索にゆっくり8〜11秒かける
        setBlock(start, ROUTE, false); setBlock(goal, ROUTE, false);
        labelBuild.value = `生成  ${algorithm.label}（${algorithm.how}）  完了`; labelSolve.value = `解法  ${solver.label}`; enter('solve');
      } else labelBuild.value = `生成  ${algorithm.label}（${algorithm.how}）  ${Math.floor(playhead / ops.length * 100)}%`;
      return;
    }
    if (phase === 'solve') {
      if (play(ops, dt, applySolve)) {
        routeOps = solved.route; rate = clamp(routeOps.length / 4.5, 12, 40); labelSolve.value = `解法  ${solver.label}  探索 ${explored}マス → 経路を表示`; enter('route');
      } else labelSolve.value = `解法  ${solver.label}  探索 ${explored}マス`;
      return;
    }
    if (phase === 'route') {
      if (play(routeOps, dt, i => { setBlock(i, ROUTE); moveHead(i, 0x3b7f70, 10); })) {
        const check = verifyRoute(maze.grid, maze.cells, routeOps, start, goal);
        labelCheck.value = check.valid ? `答え合わせ  OK  壁を通らず連結  経路 ${check.length}マス  ${check.extra === 0 ? '最短' : '最短より +' + check.extra}` : `答え合わせ  不一致（${check.reason}）`;
        enter('check');
      }
      return;
    }
    if (phase === 'check') { if (phaseTime >= CHECK_TIME) { startCollapse(); enter('clear'); } return; }
    if (phase === 'clear' && phaseTime >= CLEAR_TIME) startRound();
  }
  function skip() {
    if (phase === 'clear' || phase === 'check') return;
    startCollapse(); labelCheck.value = ''; enter('clear');
  }

  // 視点：カメラは固定（斜め上から迷路の中心を見る）。盤面をゆっくり回す（ドラッグで回転、ホイールで拡大縮小）
  const view = {az: rnd(0, Math.PI * 2), el: .95, zoom: 1, time: 0};
  let dragging = null;
  const onDown = event => { dragging = {x: event.clientX, y: event.clientY}; try { el.setPointerCapture(event.pointerId); } catch { /* 取得できなくても操作は続く */ } };
  const onMove = event => { if (!dragging) return; view.az += (event.clientX - dragging.x) * .008; view.el = clamp(view.el + (event.clientY - dragging.y) * .006, .35, 1.45); dragging = {x: event.clientX, y: event.clientY}; };
  const onUp = () => { dragging = null; };
  const onWheel = event => { view.zoom = clamp(view.zoom * (event.deltaY > 0 ? 1.08 : .92), .5, 1.8); event.preventDefault(); };
  let hover = false;
  const onEnter = () => { hover = true; }, onLeave = () => { hover = false; };
  const onKeyDown = event => { if (event.ctrlKey || event.metaKey || event.altKey || !navigationKeyActive(event, el, hover)) return; if (!event.repeat && event.code === 'Space') { skip(); event.preventDefault(); } };
  el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, {passive: false}); el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave);

  let raf = 0, frameOwner, disposed = false, last = 0, width = 0, height = 0, labelTimer = 0;
  function frame(nowMs) {
    if (disposed) return;
    // 描画は約30fpsに抑える（ゆっくりした動きなので十分で、CPU使用率を下げる）。
    if (last && nowMs - last < 28) { schedule(); return; }
    const dt = last ? Math.min(.1, (nowMs - last) / 1000) : 0; last = nowMs;
    const doc = el.ownerDocument, owner = doc.defaultView, rect = el.getBoundingClientRect();
    if (!doc.hidden && rect.width > 0 && rect.height > 0) {
      const nw = Math.floor(rect.width), nh = Math.floor(rect.height), dpr = Math.min(owner.devicePixelRatio || 1, 1.5);   // CPU/GPU負荷を抑える
      if (nw !== width || nh !== height) { width = nw; height = nh; renderer.setPixelRatio(dpr); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
      const step = dt * (reduced ? .5 : 1);
      debrisBudget = 40; stepPhase(step); stepBlocks(dt); stepDebris(dt);
      view.time += step; if (!dragging) view.az += step * .16; view.el = clamp(view.el + (Math.sin(view.time * .17) * .0016), .6, 1.3);
      const distance = M * 1.65 * view.zoom * (camera.aspect < 1 ? 1 / Math.max(.6, camera.aspect) : 1);
      board.rotation.y = view.az;   // 盤面を回す
      camera.position.set(0, Math.sin(view.el) * distance, Math.cos(view.el) * distance);
      camera.lookAt(0, .2, 0); renderer.render(scene, camera);
    }
    schedule();
  }
  function schedule() { frameOwner = el.ownerDocument.defaultView; raf = frameOwner.requestAnimationFrame(frame); }
  const unbindKeys = bindNavigationKeys(el, {keydown: onKeyDown, blur: () => { hover = false; dragging = null; }, moved: () => { if (raf) { frameOwner?.cancelAnimationFrame(raf); last = 0; schedule(); } }});
  startRound(); schedule();

  cleanup = () => {
    disposed = true; frameOwner?.cancelAnimationFrame(raf); unbindKeys(); clearTimeout(labelTimer);
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel); el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave);
    blocks.dispose(); debris.dispose(); for (const item of disposables) item.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" class="navigation-maze" tabindex="0" role="img" aria-label="ナビ調査中の表示。暗い3D空間で迷路ができる過程と、その迷路を解く経過、答え合わせを見せ、2秒後に次の迷路へ進みます。ドラッグで回転、ホイールで拡大縮小、Spaceで次の迷路へ進みます。">
    <canvas ref="canvas" aria-hidden="true"></canvas>
    <div v-if="ready" class="navigation-maze-labels" aria-hidden="true">
      <span>{{ labelBuild }}</span><span v-if="labelSolve">{{ labelSolve }}</span><span v-if="labelCheck" class="navigation-maze-check">{{ labelCheck }}</span>
    </div>
    <small v-if="ready" class="navigation-maze-hint" aria-hidden="true">ドラッグで回転 / ホイールで拡大縮小 / Spaceで次の迷路へ</small>
  </div>
</template>
<style>
.navigation-maze{position:absolute;inset:0;overflow:hidden;background:#04060c;outline:none;touch-action:none;cursor:grab}
.navigation-maze canvas{display:block;width:100%;height:100%}
.navigation-maze:focus-visible{box-shadow:inset 0 0 0 2px #3f5f7a}
.navigation-maze-labels{position:absolute;left:12px;top:10px;display:flex;flex-direction:column;gap:3px;font:11px/1.35 ui-monospace,"Cascadia Mono",Consolas,monospace;color:#93abc6;pointer-events:none;text-shadow:0 0 4px #000}
.navigation-maze-check{color:#a8c4d8}
.navigation-maze-hint{position:absolute;left:0;right:0;bottom:5px;text-align:center;color:#56708a;font-size:10px;pointer-events:none}
</style>
