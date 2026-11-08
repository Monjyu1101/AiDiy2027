// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// AiDiy IDE 星図ビューア。いつも1階層だけを宇宙として描く。
//  - 直下のフォルダ → 銀河（星の数 = 配下の全ファイル数）
//  - 直下のファイル → 名前で決まる位置の自由惑星
// 銀河をダブルクリックすると、そのフォルダを新しい宇宙として突入する。
// 依存なしの Canvas 2D。名前のハッシュから3D座標を作り、透視投影して描く。

import { spacePosition, WORLD_RADIUS, HOME_VIEW, warpMotion } from '../../../viewer/web/layout.js';
import { createAutoOrbit } from '../開発スペース/自動周回.js';
import { turnToTarget, cameraPosition, orbitAround, interpolateOrbit, interpolateCamera, cockpitLook, framingDistance, WARP_APPROACH_WIDTH, WARP_PEAK_WIDTH } from '../開発スペース/ワープ視点.js';
import { aiRouteRecords, aiRouteTargets } from '../開発スペース/検索経路.js';
import { restoreRoute, visitPoint, searchRouteRecords } from '../開発スペース/経路記録.js';
import { createUpdateMarks, updateFlash, UPDATE_FLASH_MS } from '../ファイル閲覧/更新の目印.js';
import { nextLocalMidnight, inTimeRange } from '../ファイル閲覧/ファイル日時.js';
import { createTextWidthCache } from '../開発スペース/文字幅キャッシュ.js';

export const ORBIT_PATH_SCALE = .9;

// メディアは従来サイズ。その他は20KB以下で半分、100KB以上で3倍にする。
export function fileSizeScale(name, size) {
  if (/\.(png|jpe?g|gif|svg|ico|webp|bmp|avif|heic|heif|tiff?|apng|psd|mp3|wav|ogg|oga|opus|flac|aac|m4a|aiff?|mid|midi|mp4|m4v|webm|mov|avi|mkv|wmv|mpeg|mpg|vrm|vrma|glb|gltf|fbx|obj|stl)$/i.test(name)) return 1;
  const progress = Math.log(Math.max(20 * 1024, size) / (20 * 1024)) / Math.log(5);
  return .5 + 2.5 * Math.min(1, progress);
}

export function createSpace(canvas, elements, { change = () => {}, layout = () => ({}), toggleExplorer = () => {} } = {}) {
let disposed = false, frameId = 0, loadGeneration = 0, refreshPending = null, sessionStartedAt;
let viewMode = '3d';
let refreshPaused = false;
function setRefreshPaused(value) {
  refreshPaused=!!value;
  if(refreshPaused){cancelRefresh();cancelScheduledFollow();if(following)invalidateNavigation();}
}
const listeners = new AbortController();
const listen = (target, name, callback, options = {}) => target.addEventListener(name, callback, { ...options, signal: listeners.signal });
// 2D は同じ状態を使うが、Canvas の描画ループを持たない。復帰時も予約は1本だけ。
const requestAnimationFrame = callback => {
  if (disposed || document.hidden || viewMode !== '3d') return 0;
  if (frameId) return frameId;
  const id = window.requestAnimationFrame(now => {
    if (frameId !== id) return;
    frameId = 0;
    callback(now);
  });
  return frameId = id;
};
const $ = id => elements[id];
const ctx = canvas.getContext('2d');
const textWidths = createTextWidthCache(ctx);
const updateTracker = createUpdateMarks();
let updateMarks = updateTracker.snapshot(), updateTimer = 0;
function scheduleUpdateMarks() {
  clearTimeout(updateTimer); updateTimer = 0;
  if (disposed || document.hidden || !world) return;
  const now = Date.now(), expiry = Object.values(updateMarks.flashes).map(flash => flash.at + UPDATE_FLASH_MS);
  // 当日マークも変更発光もなければ、日付更新の予約自体が不要。
  if (!Object.keys(updateMarks.levels).length && !expiry.length) return;
  const next = Math.min(nextLocalMidnight(now) + 20, ...expiry);
  updateTimer = setTimeout(() => { syncUpdateMarks(); notify(); }, Math.max(1, next - now));
}
function syncUpdateMarks() {
  updateMarks = updateTracker.snapshot(Date.now());
  scheduleUpdateMarks();
}
if (document.fonts) listen(document.fonts, 'loadingdone', () => textWidths.clear());
let W = 0, H = 0, DPR = 1, F = 800;
let CX = 0, CY = 0;          // 宇宙の画面中心。縦表示は上側の領域へ寄せる。

// ---------------------------------------------------------------- 種類と色
const KINDS = [
  { label: 'Python', color: '#ffd36b', ext: ['py', 'pyi', 'ipynb'] },
  { label: 'TS / JS', color: '#6fb8ff', ext: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx'] },
  { label: 'Vue', color: '#5cf2a6', ext: ['vue', 'svelte'] },
  { label: '文書', color: '#eef1ff', ext: ['md', 'txt', 'rst', 'pptx', 'pptm', 'docx', 'dotx', 'pdf', 'xlsx', 'xls', 'xlsm', 'ods'] },
  { label: '設定・データ', color: '#ffa25c', ext: ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'sql', 'db', 'sqlite', 'lock'] },
  { label: 'HTML / CSS', color: '#ff7ac8', ext: ['html', 'htm', 'css', 'scss', 'less'] },
  { label: '画像', color: '#b98cff', ext: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'] },
  { label: '音声・動画・3D', color: '#ff5c6a', ext: ['mp3', 'wav', 'ogg', 'mp4', 'webm', 'vrm', 'vrma', 'glb', 'fbx'] },
  { label: 'スクリプト', color: '#8ff7ea', ext: ['bat', 'cmd', 'sh', 'ps1'] },
  { label: 'その他', color: '#aab0c0', ext: [] },
];
const OTHER = KINDS.length - 1;
const KIND_BY_EXT = new Map();
KINDS.forEach((kind, index) => kind.ext.forEach(ext => KIND_BY_EXT.set(ext, index)));
function kindOf(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 8;
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? KIND_BY_EXT.get(lower.slice(dot + 1)) ?? OTHER : OTHER;
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;
const mix = (hex, to, t) => { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };

// 大量に描く光の粒・銀河の光・惑星は事前に下絵を作る。
function sprite(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}
const RECENCY = {
  1: { label: '本日更新', color: '#fff3ac', background: '#292719' },
  2: { label: '最終更新', color: '#ffd24a', background: '#302516' },
};
// 衛星・回転を使わず、星の縁から外側へ薄く消えるオーラで更新状態を示す。
// 下絵を共有し、大量ファイルでも専用Canvasや描画ループを追加しない。
const RECENCY_HALO = Object.fromEntries([1, 2].map(level => [level, sprite(128, (g, size) => {
  const c = size / 2, color = RECENCY[level].color;
  const glow = g.createRadialGradient(c, c, 35, c, c, 63);
  const strength = level === 2 ? .72 : .42;
  for (const [at, alpha] of [[0, 0], [.12, 1], [.3, .65], [.55, .28], [.8, .07], [1, 0]]) {
    glow.addColorStop(at, rgba(color, strength * alpha));
  }
  g.fillStyle = glow; g.fillRect(0, 0, size, size);
})]));
function radial(stops) {
  return sprite(128, (g, size) => {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}
const STAR = KINDS.map(k => radial([[0, '#fff'], [0.1, rgba(k.color, 1)], [0.28, rgba(k.color, 0.35)], [0.6, rgba(k.color, 0.06)], [1, rgba(k.color, 0)]]));
const DISK = KINDS.map(k => radial([[0, rgba(k.color, 0.5)], [0.3, rgba(k.color, 0.2)], [0.7, rgba(k.color, 0.05)], [1, rgba(k.color, 0)]]));
const CORE = radial([[0, 'rgba(255,250,235,1)'], [0.12, 'rgba(255,236,200,.75)'], [0.4, 'rgba(255,210,160,.18)'], [1, 'rgba(255,200,150,0)']]);
const FLARE = radial([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,250,220,.6)'], [1, 'rgba(255,240,200,0)']]);
function planetSprite(k, atmosphere) { return sprite(128, (g, size) => {
  const c = size / 2, r = size * 0.3;
  // 大気の光
  if (atmosphere) {
    const halo = g.createRadialGradient(c, c, r * 0.9, c, c, r * 1.6);
    halo.addColorStop(0, rgba(k.color, 0.45)); halo.addColorStop(1, rgba(k.color, 0));
    g.fillStyle = halo; g.fillRect(0, 0, size, size);
  }
  // 左上から光が当たる球
  const body = g.createRadialGradient(c - r * 0.45, c - r * 0.45, r * 0.05, c, c, r);
  body.addColorStop(0, mix(k.color, '#ffffff', 0.7)); body.addColorStop(0.45, k.color); body.addColorStop(1, mix(k.color, '#000010', 0.85));
  g.fillStyle = body;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  // 縞模様
  g.save(); g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.clip();
  g.globalAlpha = 0.12; g.fillStyle = '#000';
  for (let i = -3; i <= 3; i++) g.fillRect(c - r, c + i * r * 0.28 - r * 0.05, r * 2, r * 0.08);
  g.restore();
}); }
const PLANET = KINDS.map(k => planetSprite(k, true));
// 更新マークのある星は、種類色の大気を重ねず指定色のオーラを保つ。
const MARKED_PLANET = KINDS.map(k => planetSprite(k, false));

// ---------------------------------------------------------------- 乱数（パスから決まる）
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFor(text) {
  let a = hash(text) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 宇宙（1階層）の組み立て
let scan = null;            // サーバーの走査結果
let trail = [];             // ルートから今の宇宙までのフォルダ名
let world = null;           // { galaxies, stars, planets, radius }
let knownPaths = null;      // 前回観測した全パス（新しく生まれた星の判定用）

const galaxyRadius = 160;
const GATE_RING_STROKE = 0.07;

// 指定期間に更新したファイル（AI が触ったファイルを見つける目印）
let markMode = 'since', grepMatches = new Set(), grepController, grepRevision = 0;
const isFresh = file => markMode === 'grep' || markMode === 'ai' ? grepMatches.has(file.path) : inTimeRange(file.mtime, since, until);
const fastBlink = t => 0.5 + 0.5 * Math.sin(t * 1.8);          // ファイル: 約3.5秒周期で穏やかに明滅
const slowBlink = t => 0.5 + 0.5 * Math.sin(t * 1.4 - 1.2);    // フォルダ: 約4.5秒周期
function recountFresh() {
  if (!world) return;
  for (const g of world.galaxies) g.fresh = g.stars.reduce((n, s) => n + (isFresh(s) ? 1 : 0), 0);
}

function collectFiles(node, prefix, out = []) {
  for (const [name, size, mtime] of node.f) out.push({ name, path: prefix ? `${prefix}/${name}` : name, size, mtime });
  for (const child of node.d) collectFiles(child, prefix ? `${prefix}/${child.n}` : child.n, out);
  return out;
}
function nodeAt(names) {
  let node = scan?.tree;
  if (!node) return null;
  for (const name of names) {
    node = node.d.find(d => d.n === name);
    if (!node) return null;
  }
  return node;
}
const basePath = () => trail.join('/');

function buildWorld() {
  textWidths.clear();
  const node = nodeAt(trail);
  const prefix = basePath();
  const now = Date.now();
  const fileInfo = (file, rng) => {
    const ageDays = Math.max(0, (now - file.mtime) / 86400000);
    return {
      ...file, kind: kindOf(file.name), ageDays,
      mag: (1 + Math.log10(file.size + 1) * 0.55) * fileSizeScale(file.name, file.size),
      glow: 0.5 + 0.5 * Math.exp(-ageDays / 90),
      phase: rng() * Math.PI * 2, speed: 0.6 + rng() * 1.8,
      born: knownPaths && !knownPaths.has(file.path) ? now : 0,
      x: 0, y: 0, z: 0,
    };
  };

  // 名前のハッシュを、件数に左右されない球内の3D座標へ対応させる。
  const galaxies = node.d.map(child => ({
    name: child.n, path: prefix ? `${prefix}/${child.n}` : child.n,
    files: collectFiles(child, prefix ? `${prefix}/${child.n}` : child.n),
    sub: child.d.length, R: galaxyRadius, ...spacePosition(child.n),
  }));

  // 銀河の星（名前で決まる球内の固定3D位置）
  const stars = [];
  for (const g of galaxies) {
    const rng = rngFor(`shape:${g.path}`);
    g.arms = 1;
    g.tilt = (rng() - 0.5) * 1.6;
    g.turn = rng() * Math.PI * 2;
    g.ct = Math.cos(g.tilt); g.st = Math.sin(g.tilt); g.cs = Math.cos(g.turn); g.ss = Math.sin(g.turn);
    g.kinds = new Array(KINDS.length).fill(0);
    g.stars = [];
    g.fresh = 0;
    for (const file of g.files) {
      const s = rngFor(file.path);
      const star = fileInfo(file, s);
      star.galaxy = g;
      // 別の下位フォルダにある同名ファイルは相対パスで区別する。
      const local = spacePosition(file.name, {
        scale: g.R, identity: file.path.slice(g.path.length + 1),
      });
      star.lr = Math.hypot(local.x, local.y, local.z);
      const [wx, wy, wz] = rotateLocal(g, local.x, local.y, local.z);
      star.x = g.x + wx; star.y = g.y + wy; star.z = g.z + wz;
      g.kinds[star.kind]++;
      if (isFresh(star)) g.fresh++;
      g.stars.push(star);
      stars.push(star);
    }
    g.kind = g.kinds.indexOf(Math.max(...g.kinds));
    // 円盤の法線（見かけの楕円を描くため）
    g.normal = rotateLocal(g, 0, 1, 0);
  }

  // 直下のファイルも同じ球状空間に固定する。
  const radius = WORLD_RADIUS;
  const planets = node.f.map(([name, size, mtime]) => {
    const path = prefix ? `${prefix}/${name}` : name;
    const planet = fileInfo({ name, path, size, mtime }, rngFor(`planet:${path}`));
    Object.assign(planet, spacePosition(name));
    planet.R = (9 + Math.log10(size + 1) * 3) * fileSizeScale(name, size);
    planet.isPlanet = true;
    return planet;
  });

  const byPath = new Map();
  for (const s of stars) byPath.set(s.path, s);
  for (const p of planets) byPath.set(p.path, p);
  // 現在フォルダの目印は常に中心。ルートでも渦を表示する。
  const gate = {
    x: 0, y: 0, z: 0, R: 60,
    name: node.n,
  };
  updateMarks = updateTracker.update(planets, JSON.stringify([scan.root, prefix, fileFilter, sessionStartedAt]), now);
  // buildWorldの戻り値がworldへ代入された後、notifyで日付/発光の期限を予約する。
  return { galaxies, stars, planets, radius, byPath, gate };
}

function rotateLocal(g, x, y, z) {
  const y1 = y * g.ct - z * g.st, z1 = y * g.st + z * g.ct;
  return [x * g.cs - z1 * g.ss, y1, x * g.ss + z1 * g.cs];
}

// ---------------------------------------------------------------- 遠景の星（天の川）。色ごとにまとめて描く。
const FAR_GROUPS = [];
{
  const r = rngFor('far-sky');
  const colors = ['225,232,255', '255,214,170', '170,200,255'];
  for (let c = 0; c < 3; c++) for (let p = 0; p < 2; p++) FAR_GROUPS.push({ color: colors[c], phase: p * Math.PI, base: c === 0 ? 0.55 : 0.45, pts: [] });
  for (let i = 0; i < 2600; i++) {
    const band = i < 1500;
    const theta = r() * Math.PI * 2;
    const u = band ? (r() + r() + r() - 1.5) * 0.22 : r() * 2 - 1;
    const side = Math.sqrt(1 - u * u);
    const x = side * Math.cos(theta), y0 = u, z0 = side * Math.sin(theta);
    const tilt = 0.5, y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
    const tint = r(), group = (tint < 0.15 ? 1 : tint > 0.85 ? 2 : 0) * 2 + (r() < 0.5 ? 0 : 1);
    FAR_GROUPS[group].pts.push(x, y, z, r() < 0.03 ? 1.8 : band ? 0.5 + r() * 0.5 : 0.6 + r() * 0.8);
  }
}

// ---------------------------------------------------------------- カメラ
const cam = { tx: 0, ty: 0, tz: 0, ...HOME_VIEW, dist: 30000, roll:0 };
const goal = { ...cam };
let autoSpin = true;
const autoOrbit = createAutoOrbit();
let orbitLine = null, orbitLineLevel = 0, orbitLineFolder = '';
let cy = 1, sy = 0, cp = 1, sp = 0, cr=1, sr=0;
let look = (x,y,z) => [x,y,z];
const P = { x: 0, y: 0, k: 0, z: 0 };

function project(x, y, z) {
  x -= cam.tx; y -= cam.ty; z -= cam.tz;
  const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
  const [right,up,depth] = look(x1*cr+y2*sr,-x1*sr+y2*cr,z2+cam.dist);
  if (depth < 4) return false;
  P.k = F / depth; P.z = depth;
  P.x = W/2 + right * P.k; P.y = H/2 - up * P.k;
  return true;
}
// 描画寸法はワールド寸法×透視倍率。画面上の最小/最大サイズで遠近差を潰さない。
const depthLight = depth => 0.3 + 0.7 / (1 + (depth / 2400) ** 2);
const nearFade = depth => Math.min(1, Math.max(0, (depth - 4) / 40));
/** 向きだけをカメラ座標へ回す（平行移動なし）。 */
function turn(x, y, z) {
  const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
  const y2=y*cp-z1*sp;
  return look(x1*cr+y2*sr,-x1*sr+y2*cr,y*sp+z1*cp);
}
// 画面の短辺に合わせて全景を広く使う。件数によらず同じ倍率で初期表示・全体表示する。
const overviewDistance = () => (world ? world.radius * 2.25 : 4000) * (F / Math.min(W, H));

// ---------------------------------------------------------------- 状態
let focus = null;            // 注目中の銀河
let selected = null;         // 選択中の星・惑星
let hovered = null;          // マウス下の星・惑星
let hoveredGalaxy = null;    // マウス下の銀河
let labelBoxes = [];
let galaxyHits = [];         // 画面上の銀河の当たり判定 [銀河, x, y, 半径]
let introAt = performance.now();
let bodies = [];             // 当たり判定する星・惑星
let projected = new Float32Array(0);
let sceneDraws = [];
// 本体の下地は不透明。明るさは上に重ねる色で調整し、背景を透かさない。
function opaqueCore(x, y, radius) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
let diving = false;
let introFlight = null;      // オープニングのワープ { start, from, duration }。描画の時間で進める
let turnFlight = null;       // 船体位置を固定した旋回。完了するまで前進しない。
let warpBoost = 0;           // 階層切替のフェード中も前進の光跡を維持する。
let warpTravel = false;      // 同じ星系の接近にはワープ光跡を付けない。
let fileFilter = 'backup';   // フィルター（既定 ON）: AiDiy のバックアップ対象だけで宇宙を作る
let tracking = null;         // 追尾中の星・惑星
let manualOrbit = false;     // ドラッグだけは注視点を軸とした回り込みを許可する。
let orbitPivot = {x:0,y:0,z:0};
let hoveredGate = false;
let gateHit = null;          // 帰還ゲートの画面上の [x, y, 半径]
let since = null, until = null; // 開始・終了の次秒（ms、上限は未満）。開始nullは明滅なし、終了nullは上限なし。
let voyages = {};            // 階層ごとの航路 { 階層パス: [{ from, to }, ...] }
let voyageCurrent = {};       // 再訪は明細を増やさず、この現在点だけを更新する
let journal = [];            // 航海日誌（新しい順） [{ type, path, at }]
let routeMode = 'view', aiRoute = [], aiRecords = [], searchPaths = [];

// ---------------------------------------------------------------- 描画
function resize() {
  textWidths.clear();
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  F = Math.min(W, H) * 1.05;
}
listen(window, 'resize', resize);
resize();

/** 向きと一覧・ビューアの開閉に応じた空き領域の中央。ワープ中は固定する。 */
let coverShown = '';
let warpProjection = null;
function measureCover(plannedPreview) {
  const { left = 0, right = W, preview = false, centerX, centerY = H / 2, fixedCenter = false } = layout({preview:plannedPreview});
  return { x: centerX ?? (preview ? (left + right) / 2 : W / 2), y: centerY, fixedCenter };
}
function holdProjection() { warpProjection ??= { x: CX, y: CY }; }

let last = performance.now(), prevDist = cam.dist;
function frame(now) {
  frameId = 0;
  if (disposed || document.hidden || viewMode !== '3d') { last = now; return; }
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  const flight = autoOrbit.step(now,dt,cam,overviewDistance(),!autoSpin || !world || !!selected || following || diving || dragging || !!introFlight || document.hidden,world?.galaxies);
  if (flight) {
    Object.assign(goal,flight); Object.assign(cam,flight); tracking = null;
    orbitPivot={x:0,y:0,z:0};
    // 自動飛行（彗星の軌道）は何もない時の基本表示: 注目中の銀河（閉じたファイルの銀河など）を外し、全体を明るく戻す
    if (focus) { focus = null; notify(); }
  }
  if (tracking) { goal.tx = tracking.x; goal.ty = tracking.y; goal.tz = tracking.z; }
  const ease = 1 - Math.exp(-dt * 4);
  if (turnFlight) {
    const progress = Math.min(1, (now - turnFlight.start) / turnFlight.duration);
    Object.assign(cam, turnToTarget(turnFlight.from, turnFlight.target, progress));
    Object.assign(goal, cam);
    prevDist = cam.dist; // 注視点基準への表現変更を、移動速度として扱わない。
    if (progress >= 1) turnFlight = null;
  } else if (!flight) {
    if (introFlight) {
      // オープニングのワープ: 描画の始まりから duration で、遠くから全景へ（最初は速く、最後はゆっくり）
      introFlight.start ??= now; introFlight.from ??= cam.dist;
      const progress = Math.min(1, (now - introFlight.start) / introFlight.duration), k = 1 - (1 - progress) ** 3;
      cam.dist = Math.exp(Math.log(introFlight.from) * (1 - k) + Math.log(goal.dist) * k);
      if (progress >= 1) introFlight = null;
    } else if (manualOrbit) {
      Object.assign(cam,interpolateOrbit(cam,goal,orbitPivot,ease));
      cam.dist+=(goal.dist-cam.dist)*ease;
      if(!dragging && Math.abs(cam.yaw-goal.yaw)+Math.abs(cam.pitch-goal.pitch)+Math.abs(cam.roll-goal.roll)<1e-6)manualOrbit=false;
    } else if (Object.keys(cam).some(key=>Math.abs(goal[key]-cam[key])>1e-9)) {
      Object.assign(cam,interpolateCamera(cam,goal,ease));
    }
  }
  // 航行していない間の基本表示は3分で1周する低速回転。閲覧を閉じても現在の中心星を引き継ぐ。
  // 巡回の60秒待機中も回し、航行・姿勢合わせ・手動ドラッグ・ワープとは重ねない。
  if (autoSpin && world && !flight && !following && !diving && !dragging && !introFlight && !turnFlight && !manualOrbit) {
    const angle = Math.PI * 2 * dt / 180;
    const pivot = selected || orbitPivot;
    Object.assign(cam, orbitAround(cam, pivot, angle, 0));
    Object.assign(goal, orbitAround(goal, pivot, angle, 0));
  }
  // 予約された最終更新ファイルへの移動は、オープニングが終わり、追いかけてよい状態になってから始める
  if (pendingFollow && !introFlight && canFollow()) { const path = pendingFollow; pendingFollow = null; void follow(path); }
  // 自動運転中（視点移動 ON で、彗星の軌道か最終更新ファイルへの移動・表示をしている）かを UI へ知らせる
  const nowDriving = isDriving(now);
  if (nowDriving !== driving || notifiedOrbitPhase !== autoOrbit.phase || notifiedExplorationStatus !== explorationStatus()) { driving = nowDriving; notify(); }
  // パネル配置に合わせて操縦席から見回す。投影面は画面中央に固定する。
  const measured = measureCover(), center = measured.fixedCenter ? measured : warpProjection || measured;
  // VRの手動中心はワープ中も優先し、ドラッグ量へ遅延なく追従する。
  CX = center.fixedCenter || !CX ? center.x : CX + (center.x - CX) * ease;
  CY = center.fixedCenter || !CY ? center.y : CY + (center.y - CY) * ease;
  cy = Math.cos(cam.yaw); sy = Math.sin(cam.yaw); cp = Math.cos(cam.pitch); sp = Math.sin(cam.pitch);
  cr=Math.cos(cam.roll);sr=Math.sin(cam.roll);
  look = cockpitLook(CX-W/2,CY-H/2,F);
  const warp = Math.max(warpBoost, (introFlight || (diving && warpTravel)) ? Math.min(1.5, Math.abs(Math.log(cam.dist / prevDist)) / Math.max(dt, 1e-3) * 0.08) : 0);
  prevDist = cam.dist;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  drawFarSky(t, warp);
  drawOrbitPath(dt);
  if (world) drawFolderLinks(now);
  sceneDraws = [];
  gateHit = null;
  if (world) {
    drawVoyage(t);
    drawGalaxies(t, now);
    drawPlanets(t, now);
    if (world.gate && project(world.gate.x, world.gate.y, world.gate.z)) sceneDraws.push({depth:P.z,draw:()=>drawGate(t)});
    // フォルダ内の星・直下ファイル・中心星を一緒に奥から描き、手前の本体で隠す。
    for (const item of sceneDraws.sort((a,b)=>b.depth-a.depth)) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; item.draw(); ctx.restore();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  if (world) {
    drawLabels(t);
  }
  requestAnimationFrame(frame);
}

/** 計算済みの彗星軌道を、天体と同じ3D座標・投影で描く。 */
function drawOrbitPath(dt) {
  const folder=trail.join('/');
  // 星系が切り替わった後へ、前の星系の軌道を持ち越さない。
  if(folder!==orbitLineFolder || !world){orbitLine=null;orbitLineLevel=0;orbitLineFolder=folder;}
  const planned=world && autoSpin && !diving && !following && !selected ? autoOrbit.path : null;
  if(!orbitLine)orbitLine=planned;
  if(!orbitLine){orbitLineLevel=0;return;}
  // 古い線が柔らかく消えてから、最新の計算結果を浮かび上がらせる。
  // 途中で再計算・中断しても、現在の濃さから継続する。
  orbitLineLevel=orbitLine===planned && autoOrbit.phase!=='idle'
    ? autoOrbit.visibility : Math.max(0,orbitLineLevel-dt/1.2);
  if(!orbitLineLevel){orbitLine=planned;return;}
  const points=orbitLine;
  if(!points)return;
  // 船の航行位置は保ち、案内線だけ中心寄りへ10%縮めて内側に見せる。
  const opacity=orbitLineLevel*orbitLineLevel*(3-2*orbitLineLevel);
  ctx.save();ctx.globalCompositeOperation='source-over';ctx.setLineDash([]);
  ctx.filter=opacity<1?`blur(${(1-opacity)*3}px)`:'none';
  ctx.strokeStyle='#8aa9ed';ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
  let connected=false;
  for(const point of points){
    // カメラの背後を結ぶ線や、軌道末尾から先頭への架空の線は描かない。
    if(!project(point.x*ORBIT_PATH_SCALE,point.y*ORBIT_PATH_SCALE,point.z*ORBIT_PATH_SCALE)){connected=false;continue;}
    if(connected)ctx.lineTo(P.x,P.y);else ctx.moveTo(P.x,P.y);
    connected=true;
  }
  ctx.globalAlpha=.12*opacity;ctx.lineWidth=4+(1-opacity)*4;ctx.stroke();
  ctx.globalAlpha=.6*opacity;ctx.lineWidth=1.2;ctx.stroke();
  ctx.restore();
}

/** 現在フォルダの3D原点から、直下の銀河・ファイルへ静かな直線を引く。 */
function drawFolderLinks(now) {
  if (!project(0, 0, 0)) return;
  const x = P.x, y = P.y;
  const appear = Math.min(1, Math.max(0, (now - introAt) / 1000 - 0.8));
  if (!appear) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#7897bf';
  ctx.lineWidth = 0.7;
  // 配下の全ファイルには引かず、現在見ている1階層の関係だけを表示する。
  for (const item of [...world.galaxies, ...world.planets]) {
    if (!project(item.x, item.y, item.z)) continue;
    // 背後だけでなく、画面外の天体へ伸びる線も表示しない。
    if (P.x < 0 || P.x > W || P.y < 0 || P.y > H) continue;
    ctx.globalAlpha = 0.2 * appear * depthLight(P.z) * nearFade(P.z);
    if (!ctx.globalAlpha) continue;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(P.x, P.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFarSky(t, warp) {
  for (const group of FAR_GROUPS) {
    const pts = group.pts;
    ctx.globalAlpha = group.base * (0.8 + 0.2 * Math.sin(t * 0.9 + group.phase));
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 4) {
      const [x1, y2, z2] = turn(pts[i], pts[i + 1], pts[i + 2]);
      if (z2 < 0.05) continue;
      const px = W/2 + x1 / z2 * F, py = H/2 - y2 / z2 * F, s = pts[i + 3];
      if (px < -50 || px > W + 50 || py < -50 || py > H + 50) continue;
      if (warp > 0.04) {
        // ワープ中は中心から放射状の光の筋にする
        ctx.moveTo(px, py); ctx.lineTo(px - (px - CX) * warp * 0.45, py - (py - CY) * warp * 0.45);
      } else ctx.rect(px - s / 2, py - s / 2, s, s);
    }
    if (warp > 0.04) { ctx.strokeStyle = `rgb(${group.color})`; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.fillStyle = `rgb(${group.color})`; ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

const dimmed = g => focus && g !== focus;

function drawGalaxies(t, now) {
  const { galaxies } = world;
  const intro = (now - introAt) / 1000;
  const wallNow = Date.now();
  bodies = [];
  galaxyHits = [];
  let p = 0;
  if (projected.length < (world.stars.length + world.planets.length) * 4) projected = new Float32Array((world.stars.length + world.planets.length) * 4);

  for (const g of galaxies) {
    const centerVisible = project(g.x, g.y, g.z);
    const gx = P.x, gy = P.y, gk = P.k, depth = P.z;
    const fade = Math.min(1, Math.max(0, (intro - 0.1 - Math.hypot(g.x, g.z) / world.radius * 0.8) / 1.0));
    const dim = dimmed(g) ? 0.3 : 1;
    if (centerVisible) {
      const light = depthLight(depth) * nearFade(depth);
      galaxyHits.push([g, gx, gy, g.R * gk]);

      // 円盤の光（見かけの傾きに合わせて楕円にする）。指定期間に更新したファイルを含む銀河はゆっくり明滅する。
      const [nx, ny, nz] = turn(...g.normal);
      const size = g.R * 2.6 * gk;
      const pulse = g.fresh ? slowBlink(t) : 0;
      sceneDraws.push({depth,draw:()=>{
      if (size > 2) {
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(Math.atan2(-ny, nx));
        ctx.scale(Math.max(0.12, Math.abs(nz)), 1);
        ctx.globalAlpha = (0.4 + 0.4 * pulse) * fade * dim * light;
        ctx.drawImage(DISK[g.kind], -size / 2, -size / 2, size, size);
        ctx.restore();
        const core = g.R * (g.arms ? 0.7 : 1.0) * gk * (1 + 0.35 * pulse);
        opaqueCore(gx, gy, core * 0.1);
        // ファイル数の少ないフォルダも見失わないよう、中心光には明るさを残す。
        ctx.globalAlpha = Math.min(1, 0.85 + 0.15 * pulse) * fade * dim * light;
        ctx.drawImage(CORE, gx - core / 2, gy - core / 2, core, core);
      }
      if (g.fresh) {
        // 遠くからでも見つけられるよう、銀河を包む光の輪も明滅させる
        const halo = g.R * 3.2 * gk;
        ctx.globalAlpha = 0.22 * pulse * fade * light;
        ctx.drawImage(FLARE, gx - halo / 2, gy - halo / 2, halo, halo);
      }
      }});
    }

    // 銀河の中心が背後でも、手前にある個々の星は描く。
    for (const s of g.stars) {
      if (!project(s.x, s.y, s.z)) continue;
      const appear = Math.min(1, Math.max(0, fade * 1.6 - s.lr / g.R * 0.6));
      if (appear <= 0) continue;
      let alpha = s.glow * (0.78 + 0.22 * Math.sin(t * s.speed + s.phase)) * appear * dim;
      let size = s.mag * P.k * 4;
      // born は実時刻。RAFの相対時刻と混ぜず、新規の強調を6秒で終える。
      const bornAge = s.born ? (wallNow - s.born) / 1000 : 99;
      if (bornAge < 6) { alpha = 1; size *= 1 + 3 * (1 - bornAge / 6); }
      // 更新・検索対象は穏やかに明滅。選択中は白飛びを抑える。
      const fresh = isFresh(s);
      const blink = fresh ? fastBlink(t) : 0;
      if (fresh) { alpha = Math.min(s === selected ? 0.65 : 0.8, Math.max(alpha, (0.35 + 0.25 * blink) * appear)); size *= 1 + 0.08 * blink; }
      if (P.x < -size || P.x > W + size || P.y < -size || P.y > H + size) continue;
      // 明るさの下限は距離で減光する前に適用し、遠近差を残す。
      // 古い星も微かに瞬き、出現・フォーカス・至近距離では従来どおりフェードする。
      const visibleGlow = (0.7 + 0.08 * Math.sin(t * s.speed + s.phase)) * appear * dim;
      alpha = Math.max(alpha, visibleGlow) * depthLight(P.z) * nearFade(P.z);
      const x=P.x,y=P.y;
      sceneDraws.push({depth:P.z,draw:()=>{
      opaqueCore(x, y, size * 0.1);
      ctx.globalAlpha = alpha;
      ctx.drawImage(STAR[s.kind], x - size / 2, y - size / 2, size, size);
      if (s !== selected && ((fresh && blink > 0.45) || bornAge < 6) && appear >= 1) drawNova(x, y, size, alpha, t, s.phase);
      }});
      bodies.push(s);
      projected[p++] = P.x; projected[p++] = P.y; projected[p++] = size; projected[p++] = 0;
    }
  }
  ctx.globalAlpha = 1;
}

function drawNova(x, y, size, alpha, t, phase) {
  const flare = size * (1.3 + 0.15 * Math.sin(t * 1.8 + phase));
  ctx.globalAlpha = alpha * 0.18;
  ctx.drawImage(FLARE, x - flare / 2, y - flare / 2, flare, flare);
  ctx.strokeStyle = 'rgba(255,248,220,.22)'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x - flare, y); ctx.lineTo(x + flare, y);
  ctx.moveTo(x, y - flare * 0.7); ctx.lineTo(x, y + flare * 0.7);
  ctx.stroke();
}

function drawPlanets(t, now) {
  const intro = (now - introAt) / 1000;
  let p = bodies.length * 4;
  // 奥から順に描く
  const list = world.planets.map(planet => {
    return project(planet.x, planet.y, planet.z) ? { planet, x: P.x, y: P.y, k: P.k, z: P.z } : null;
  }).filter(Boolean).sort((a, b) => b.z - a.z);
  for (const { planet, x, y, k, z } of list) {
    const appear = Math.min(1, Math.max(0, intro - 1.2));
    let size = planet.R * k * 3.2;
    let alpha = appear * (focus ? 0.35 : 1);
    if (alpha <= 0) continue;
    const fresh = isFresh(planet);
    const blink = fresh ? fastBlink(t) : 0;
    if (fresh) { alpha = Math.max(alpha, appear * 0.6); size *= 1 + 0.025 * blink; }
    if (x < -size || x > W + size || y < -size || y > H + size) continue;
    alpha *= depthLight(z) * nearFade(z);
    sceneDraws.push({depth:z,draw:()=>{
    opaqueCore(x, y, size * 0.3);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const level = updateMarks.levels[planet.path];
    ctx.drawImage((level ? MARKED_PLANET : PLANET)[planet.kind], x - size / 2, y - size / 2, size, size);
    if (level) {
      const diameter = Math.max(22, size);
      ctx.drawImage(RECENCY_HALO[level], x - diameter / 2, y - diameter / 2, diameter, diameter);
    }
    const pulse = updateFlash(updateMarks.flashes[planet.path]);
    if (pulse) {
      ctx.globalAlpha = alpha * pulse * .32;
      ctx.drawImage(FLARE, x - size, y - size, size * 2, size * 2);
    }
    if (fresh) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * blink * (planet === selected ? 0.08 : 0.22);
      ctx.drawImage(FLARE, x - size * 0.55, y - size * 0.55, size * 1.1, size * 1.1);
      if (planet !== selected && blink > 0.45) drawNova(x, y, size * 0.45, alpha * blink, t, planet.phase);
      ctx.globalCompositeOperation = 'source-over';
    }
    }});
    bodies.push(planet);
    projected[p++] = x; projected[p++] = y; projected[p++] = size * 0.6; projected[p++] = 1;
  }
  ctx.globalAlpha = 1;
}

/** 帰還ゲート（親フォルダへ戻るワームホール）。 */
function drawGate(t) {
  const gate = world.gate;
  if (!project(gate.x, gate.y, gate.z)) return;
  const r = Math.max(16, gate.R * P.k);
  const alpha = Math.min(1, Math.max(0, (performance.now() - introAt) / 1000 - 1.2)) * (hoveredGate ? 1 : 0.8);
  gateHit = [P.x, P.y, r];
  ctx.globalAlpha = alpha * 0.8;
  ctx.drawImage(DISK[1], P.x - r * 2.4, P.y - r * 2.4, r * 4.8, r * 4.8);
  ctx.lineWidth = Math.max(1.2, r * GATE_RING_STROKE);
  for (let i = 0; i < 4; i++) {
    const rr = r * (1 - i * 0.2), spin = t * (0.8 + i * 0.5) * (i % 2 ? -1 : 1);
    ctx.globalAlpha = alpha * (0.9 - i * 0.15);
    ctx.strokeStyle = i % 2 ? '#9fd8ff' : '#c8b6ff';
    ctx.beginPath(); ctx.arc(P.x, P.y, rr, spin, spin + Math.PI * 1.2); ctx.stroke();
  }
  // 中心星の本体は加算合成を使わず、背後の星や軌道線を覆う不透明な球にする。
  if (alpha > 0) {
    const radius = r * 0.35;
    const body = ctx.createRadialGradient(P.x - radius * 0.3, P.y - radius * 0.3, 0, P.x, P.y, radius);
    body.addColorStop(0, '#abc3d2'); body.addColorStop(0.45, '#7293a9'); body.addColorStop(1, '#334f66');
    ctx.save();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(P.x, P.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = alpha * 0.18;
  ctx.drawImage(FLARE, P.x - r * 0.7, P.y - r * 0.7, r * 1.4, r * 1.4);
  ctx.globalAlpha = 1;
}

/** 各明細の出発点と到着点を結ぶ。再訪後の分岐を配列順で繋ぎ直さない。 */
function voyageTargets() {
  if(routeMode==='ai')return aiRouteRecords(aiRecords,trail,world);
  if(routeMode==='search'){const [origin,...targets]=aiRouteTargets(searchPaths,trail,world);return [...new Set(targets)].map(to=>({from:origin,to}));}
  const resolve = key => key === null ? null : key[0] === 'g'
    ? world.galaxies.find(g => g.path === key.slice(2)) : world.byPath.get(key.slice(2));
  return (voyages[basePath()] || []).map(({from,to}) => ({from:resolve(from),to:resolve(to)}));
}
function drawVoyage(t) {
  const records = voyageTargets();
  const screen = p => p && project(p.x,p.y,p.z) ? [P.x,P.y] : null;
  const points = records.map(({from,to}) => ({from:screen(from),to:screen(to)}));
  if (!points.length) return;
  const n = points.length;
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = routeMode==='ai'?'#83e5ee':'#ffd98c';
  ctx.setLineDash([5, 7]);
  ctx.lineDashOffset = -t * 18;
  points.forEach(({from:a,to:b},i) => {
    if (!a || !b) return;
    ctx.globalAlpha = 0.15 + 0.65 * ((i+1) / n);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.fillStyle = routeMode==='ai'?'#a7f6ff':'#ffe2a0';
  const marked = new Set();
  // 線の重複を除いても、検索の最後の参照点は元の順序から求める。
  const aiCurrent = routeMode!=='view' ? aiRouteTargets(routeMode==='ai'?aiRoute:searchPaths,trail,world).at(-1) : null;
  const markers=records.flatMap((record,i)=>[
    {point:record.from,screen:points[i].from,index:i},
    {point:record.to,screen:points[i].to,index:i},
  ]);
  markers.forEach(({point,screen:s,index:i}) => {
    if (!s || marked.has(point)) return;
    marked.add(point);
    const current = voyageCurrent[basePath()];
    const latest = routeMode!=='view' ? point===aiCurrent : point && point.path === current?.slice(2);
    const r = latest ? 5 + Math.sin(t * 3) * 1.2 : 3;
    ctx.globalAlpha = latest ? 0.95 : 0.25 + 0.5 * (i / n);
    ctx.beginPath();
    ctx.moveTo(s[0], s[1] - r); ctx.lineTo(s[0] + r, s[1]); ctx.lineTo(s[0], s[1] + r); ctx.lineTo(s[0] - r, s[1]);
    ctx.closePath(); ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawLabels(t) {
  const font = '"Segoe UI","Yu Gothic UI",sans-serif';
  const intro = (performance.now() - introAt) / 1000;
  labelBoxes = [];
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const placed = box => {
    if (labelBoxes.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) return false;
    labelBoxes.push(box);
    return true;
  };
  // 銀河の名前。更新のある銀河を優先して置き、残りは大きい順。
  // 重なる時は 下 → 上 → 右 → 左 の順に空いている位置を探す。
  for (const [g, gx, gy, r] of [...galaxyHits].sort((a, b) => (b[0].fresh ? 1 : 0) - (a[0].fresh ? 1 : 0) || b[3] - a[3])) {
    const hover = g === hoveredGalaxy;
    let alpha = Math.min(1, Math.max(0, intro - 1.0)) * (dimmed(g) ? 0.45 : 1);
    if (alpha <= 0.02) continue;
    // 「名前 (ファイル数)」の1行だけ。指定期間の更新があるフォルダは金色でゆっくり明滅させる。
    const name = `${g.name} (${g.files.length.toLocaleString()})`;
    ctx.font = `600 13px ${font}`;
    const w = textWidths.measure(name) + 12;
    const below = Math.min(Math.max(r * 0.45, 18), 160), side = Math.min(Math.max(r * 0.5, 14), 160);
    const spot = [[gx, gy + below], [gx, gy - below - 14], [gx + side + w / 2 + 6, gy], [gx - side - w / 2 - 6, gy]]
      .find(([cx, cy]) => placed({ x: cx - w / 2, y: cy - 10, w, h: 20, g }));
    if (!spot) continue;
    const [x, ly] = spot;
    ctx.globalAlpha = hover ? 1 : alpha * (g.fresh ? 0.6 + 0.4 * slowBlink(t) : 0.95);
    ctx.shadowColor = g.fresh ? '#ffd36b' : KINDS[g.kind].color; ctx.shadowBlur = hover ? 16 : 8;
    ctx.fillStyle = hover ? '#fff' : g.fresh ? '#ffe9a8' : 'rgba(235,242,255,.95)';
    ctx.fillText(name, x, ly);
    ctx.shadowBlur = 0;
  }
  // 中央のワームホールには現在フォルダ名を表示する。
  if (gateHit) {
    const [x, y, r] = gateHit;
    const text = world.gate.name;
    ctx.font = `600 12px ${font}`;
    const w = textWidths.measure(text) + 10;
    if (placed({ x: x - w / 2, y: y + r + 6, w, h: 20, gate: true })) {
      ctx.globalAlpha = hoveredGate ? 1 : 0.85;
      ctx.fillStyle = hoveredGate ? '#fff' : '#bfe3ff';
      ctx.shadowColor = '#7fc8ff'; ctx.shadowBlur = 10;
      ctx.fillText(text, x, y + r + 16);
      ctx.shadowBlur = 0;
    }
  }
  // 自由惑星の名前
  ctx.font = `11.5px ${font}`;
  ctx.textAlign = 'left';
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const o = i * 4;
    const near = !b.isPlanet && projected[o + 2] >= 22 && (!focus || b.galaxy === focus);
    if (!b.isPlanet && !near) continue;
    const mark = b.isPlanet ? RECENCY[updateMarks.levels[b.path]] : null;
    const x = projected[o] + Math.max(mark ? 12 : 0, projected[o + 2] * (b.isPlanet ? 0.75 : 0.22)) + 4, y = projected[o + 1];
    ctx.font = `11.5px ${font}`;
    const nameWidth = textWidths.measure(b.name);
    ctx.font = `600 10px ${font}`;
    const badgeWidth = mark ? textWidths.measure(mark.label) + 10 : 0;
    const w = nameWidth + (mark ? badgeWidth + 7 : 0) + 6;
    if (!placed({ x, y: y - 10, w, h: 20 })) continue;
    ctx.globalAlpha = b.isPlanet ? Math.min(0.9, Math.max(0, intro - 1.4)) * (focus ? 0.4 : 1) : Math.min(0.85, (projected[o + 2] - 22) / 20);
    if (mark) {
      const badgeX = x + nameWidth + 7;
      ctx.fillStyle = mark.background; ctx.fillRect(badgeX, y - 9, badgeWidth, 18);
      ctx.strokeStyle = mark.color; ctx.lineWidth = .65; ctx.strokeRect(badgeX, y - 9, badgeWidth, 18);
      ctx.fillStyle = mark.color; ctx.fillText(mark.label, badgeX + 5, y);
    }
    ctx.font = `11.5px ${font}`;
    ctx.fillStyle = mark?.color || (b.isPlanet ? 'rgba(215,225,250,1)' : 'rgba(200,212,240,1)');
    ctx.fillText(b.name, x, y);
  }
  // 選択中・マウス下の照準
  for (const target of [selected, hovered]) {
    if (!target) continue;
    const i = bodies.indexOf(target);
    if (i < 0) continue;
    const x = projected[i * 4], y = projected[i * 4 + 1];
    const r = Math.max(9, Math.min(60, projected[i * 4 + 2] * (target.isPlanet ? 0.6 : 0.35)));
    ctx.globalAlpha = target === selected ? 0.95 : 0.6;
    ctx.strokeStyle = KINDS[target.kind].color;
    ctx.lineWidth = 1.2;
    const spin = t / 1.4;
    for (let q = 0; q < 4; q++) {
      ctx.beginPath();
      ctx.arc(x, y, r, spin + q * Math.PI / 2, spin + q * Math.PI / 2 + Math.PI / 4);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 操作
let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;
const touch = new Map();
// 手動操作: 自動飛行を1分止め、自動で開いたファイルもユーザーが見ている扱いにする
const touchIdle = () => {
  ++navigationSequence;
  autoOrbit.interact(performance.now()); followedPath = null;
  // 到着済みの最終更新へは引き戻さず、未到着の新しい対象だけを保留する。
  pendingFollow = updatePaths.length || latestFollow !== lastFollowedPath ? latestFollow : null;
};

function interact() {
  if (disposed) return;
  touchIdle();
  if (following) invalidateNavigation();
  notify();
}

function setAutoSpin(value) {
  const entering = !autoSpin && !!value;
  autoSpin = !!value;
  if (autoSpin) { autoOrbit.resume(); if (entering) pendingFollow = updatePaths.length || latestFollow !== lastFollowedPath ? latestFollow : null; }
  else {
    cancelScheduledFollow();
    if (viewMode === '2d' && following) {
      pendingFollow ??= activeFollowPath;
      invalidateNavigation();
    }
    autoOrbit.reset();
    if (!selected && !focus && !diving) Object.assign(goal, cam);
  }
  notify();
}

listen(canvas, 'contextmenu', e => { if (viewMode === '3d') e.preventDefault(); });
listen(canvas, 'pointerdown', e => {
  if (viewMode !== '3d' || diving) return;
  canvas.setPointerCapture(e.pointerId);
  touch.set(e.pointerId, [e.clientX, e.clientY]);
  dragging = true; dragMoved = 0;
  lastX = e.clientX; lastY = e.clientY;
  canvas.classList.add('dragging');
  autoOrbit.reset();
  introFlight = null;  // オープニング中に触ったら、飛び込みをやめて操作を優先する
  Object.assign(goal,cam); tracking=null; manualOrbit=true;
});
listen(canvas, 'pointermove', e => {
  if (viewMode !== '3d' || diving) return;
  if (touch.has(e.pointerId) && touch.size === 2) {
    // 2本指: ピンチでズーム
    const [a, b] = [...touch.values()];
    const before = Math.hypot(a[0] - b[0], a[1] - b[1]);
    touch.set(e.pointerId, [e.clientX, e.clientY]);
    const [c, d] = [...touch.values()];
    const after = Math.hypot(c[0] - d[0], c[1] - d[1]);
    if (before > 0 && after > 0) goal.dist = clampDist(goal.dist * before / after);
    dragMoved += 10;
    touchIdle();
    return;
  }
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    // 傾いた姿勢でも画面の方向で球を回す。以後はその実位置を船の出発地点にする。
    Object.assign(goal,orbitAround(goal,orbitPivot,dx*.005,-dy*.005,look));
    touchIdle();
    return;
  }
  updateHover(e.clientX, e.clientY);
});
const endDrag = e => {
  if (viewMode !== '3d') return;
  touch.delete(e.pointerId);
  if (!dragging) return;
  dragging = touch.size > 0;
  if (dragMoved >= 5) touchIdle();
  canvas.classList.remove('dragging');
  if (dragMoved < 5 && e.type === 'pointerup') handleClick(e.clientX, e.clientY);
};
listen(canvas, 'pointerup', endDrag);
listen(canvas, 'pointercancel', endDrag);
listen(canvas, 'pointerleave', () => { hovered = null; hoveredGalaxy = null; $('tooltip').hidden = true; });
listen(canvas, 'wheel', e => {
  if (viewMode !== '3d' || !e.ctrlKey) return;
  // 宇宙上の Ctrl＋ホイールは、ブラウザ倍率ではなく視点の距離を変える。
  e.preventDefault();
  if (diving) return;
  introFlight = null;
  goal.dist = clampDist(goal.dist * Math.exp(e.deltaY * 0.0012));
  touchIdle();
}, { passive: false });
listen(canvas, 'dblclick', e => {
  if (viewMode !== '3d' || diving) return;
  handleDoubleClick(e.clientX, e.clientY);
});


const clampDist = d => Math.max(20, Math.min(overviewDistance() * 4, d));

function updateHover(mx, my) {
  if (!world) return;
  hovered = null;
  const inBox = b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
  hoveredGate = !!gateHit && (Math.hypot(mx - gateHit[0], my - gateHit[1]) < gateHit[2] * 1.2 || labelBoxes.some(b => b.gate && inBox(b)));
  hoveredGalaxy = hoveredGate ? null : labelBoxes.find(b => b.g && inBox(b))?.g ?? null;
  if (!hoveredGalaxy && !hoveredGate) {
    // 遠くの銀河は丸ごと1つの的にする。近づいた銀河と惑星は1つずつ選べる。
    let best = 196;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i], o = i * 4;
      if (!b.isPlanet) {
        const hit = galaxyHits.find(h => h[0] === b.galaxy);
        if (hit && hit[3] < 150) continue;
      }
      const d = (projected[o] - mx) ** 2 + (projected[o + 1] - my) ** 2;
      const reach = Math.max(144, (projected[o + 2] * 0.5) ** 2);
      if (d < best && d < reach) { best = d; hovered = b; }
    }
    if (!hovered) {
      let bestG = Infinity;
      for (const [g, x, y, r] of galaxyHits) {
        const d = Math.hypot(x - mx, y - my);
        if (d < Math.max(24, r * 0.75) && d < bestG) { bestG = d; hoveredGalaxy = g; }
      }
    }
  }
  canvas.classList.toggle('pointing', !!(hovered || hoveredGalaxy || hoveredGate));
  const tip = $('tooltip');
  const show = (title, sub) => {
    tip.innerHTML = '<div class="t-name"></div><div class="t-sub"></div>';
    tip.querySelector('.t-name').textContent = title;
    tip.querySelector('.t-sub').textContent = sub;
    tip.style.left = `${mx}px`; tip.style.top = `${my}px`;
    tip.hidden = false;
  };
  if (hoveredGate) show(world.gate.name, trail.length ? '現在のフォルダ ・ ダブルクリックで1つ上のフォルダへ' : '現在のフォルダ ・ ルート');
  // 星（ファイル）はファイル名だけを見せる（フォルダ名は出さない。場所はパンくずとプレビューで分かる）
  else if (hovered) show(hovered.name, `${formatSize(hovered.size)} ・ ${formatAge(hovered.mtime)} ・ クリックでズームとプレビュー`);
  else if (hoveredGalaxy) show(hoveredGalaxy.path, `ファイル ${hoveredGalaxy.files.length} ・ サブフォルダ ${hoveredGalaxy.sub} ・ ダブルクリックで開く`);
  else tip.hidden = true;
}

function handleClick(mx, my) {
  if (diving) return;
  updateHover(mx, my);
  if (hoveredGate) return;  // ダブルクリックが成立するまで階層を変えない。
  if (hovered) selectBody(hovered);
  else if (hoveredGalaxy) {
    touchIdle();
    // 初回クリックでカメラを動かさず、2回目も同じフォルダを押せるようにする。
    selected = null; focus = hoveredGalaxy; tracking = null;
    updateSide();
  } else selectBody(null);
}

function handleDoubleClick(mx, my) {
  if (diving) return;
  updateHover(mx, my);
  if (hoveredGate) { if (trail.length) ascend(trail.length - 1); return; }
  if (hoveredGalaxy) return dive(hoveredGalaxy);
  if (hovered) return approach(hovered);
  flyHome();
}

function flyTo(g) {
  selected = null;
  touchIdle();
  remember('dir', g.path);
  updateSide();
  return travelTo([...trail],{target:g,transition:false,arrivalDistance:Math.max(120,g.R*2.8),after:()=>{focus=g;updateSide();}});
}
async function flyHome({ valid: parentValid = () => true } = {}) {
  if (disposed) return false;
  if (viewMode === '2d') { selectBody(null); return true; }
  selected = null;
  focus = null;
  tracking = null;
  touchIdle();
  updateSide();
  const run=++navigationSequence, valid=()=>run===navigationSequence&&parentValid();
  const eye=cameraPosition(cam), radius=Math.hypot(eye.x,eye.y,eye.z);
  const scale=overviewDistance()/Math.max(radius,1);
  const destination=radius>1?{x:eye.x*scale,y:eye.y*scale,z:eye.z*scale}:{x:0,y:0,z:-overviewDistance()};
  // 全体表示へ戻る時も、後ろへ引かず、外側の観測位置へ向いて前進する。
  if(Math.abs(radius-overviewDistance())>30 && !await travelTo([...trail],{target:destination,transition:false,arrivalDistance:1,valid}))return;
  if(!valid())return;
  await travelTo([...trail],{target:{x:0,y:0,z:0},transition:false,arrivalDistance:Infinity,valid});
  if(!valid())return false;
  touchIdle();
  return true;
}
/** 星・惑星の選択を共通化する（一覧・検索・フォーカス操作も同じ）。 */
function approach(body) {
  return selectBody(body);
}

// ---------------------------------------------------------------- フォルダ移動のワープ
let warpSequence = 0;
let sceneAnimation = null;
const travelWaiters = new Set();
function setWarpBusy(value) {
  diving = value;
  canvas.classList.toggle('warping', value);
  canvas.setAttribute('aria-busy', String(value));
}

/** 古い移動はキャンセルし、最後に選ばれた階層だけへ切り替える。 */
async function travelTo(next, { direction = 'in', target = null, history = true, after = null, file = null, destinationFile = null, transition = true, arrivalDistance = null, valid = () => true } = {}) {
  if (disposed || viewMode !== '3d' || !nodeAt(next)) return false;
  const sequence = ++warpSequence;
  for (const cancel of [...travelWaiters]) cancel();
  holdProjection();
  sceneAnimation?.cancel();
  turnFlight = null; introFlight = null; warpBoost = 0;
  manualOrbit=false;
  setWarpBusy(true);
  warpTravel = transition;
  autoOrbit.reset();
  tracking = null;
  dragging = false; touch.clear(); canvas.classList.remove('dragging');
  $('tooltip').hidden = true;
  target ??= direction === 'out' ? world.gate : world.galaxies.find(g => g.path === next.slice(0, trail.length + 1).join('/'));
  const frameGate = transition && target === world.gate && arrivalDistance === null;
  const motion = warpMotion(target ? 'in' : direction, frameGate ? { inwardScale: WARP_PEAK_WIDTH / WARP_APPROACH_WIDTH } : {});
  const play = stage => new Promise(resolve => {
    sceneAnimation = canvas.animate(stage.frames, {
      duration: stage.duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards',
    });
    const finish = success => {
      travelWaiters.delete(cancel);
      resolve(success && !disposed && viewMode === '3d' && sequence === warpSequence);
    };
    const cancel = () => finish(false);
    travelWaiters.add(cancel);
    sceneAnimation.finished.then(() => finish(true), () => finish(false));
  });
  // カメラが目標へ十分近づくか上限時間まで待つ。別の移動が始まったら false（そこで打ち切る）。
  // 描画ループの frameId を上書きしないよう、待ちは setTimeout で刻む。
  const settle = (done, limit) => new Promise(resolve => {
    const end = performance.now() + limit;
    let timer = 0;
    const finish = success => {
      clearTimeout(timer);
      travelWaiters.delete(cancel);
      resolve(success);
    };
    const cancel = () => finish(false);
    travelWaiters.add(cancel);
    const check = () => {
      if (disposed || viewMode !== '3d' || sequence !== warpSequence || !valid()) return finish(false);
      if (done() || performance.now() >= end) return finish(true);
      timer = setTimeout(check, 16);
    };
    check();
  });
  try {
    if (target) {
      orbitPivot={x:target.x,y:target.y,z:target.z};
      // 1. 船体の位置は固定し、先に目的の星団（帰還時はゲート）へ向く。
      Object.assign(goal, cam);
      turnFlight = { from: { ...cam }, target, start: performance.now(), duration: 1100 };
      if (!await settle(() => !turnFlight, Infinity) || !valid()) return;
      // 2. 帰還時だけ、現在フォルダ中央の星を外周リングごと画面幅の約1/4へ収める。
      // 中心球だけを基準にするとリングが画面を覆う。既に近い場合も滑らかに適正距離へ戻す。
      if (frameGate) {
        goal.dist = framingDistance(target.R * (2 + GATE_RING_STROKE), W, F, CX - W / 2, CY - H / 2);
      } else {
        const distance = arrivalDistance ?? (file ? (file.isPlanet ? Math.max(180, file.R * 22) : 170) : Math.max(30, (target.R || 60) * 1.1));
        goal.dist = Math.min(cam.dist, distance * (F / Math.min(W, H)));
      }
      if (!await settle(() => Math.abs(Math.log(cam.dist / goal.dist)) < (frameGate ? 0.01 : 0.06), 1600) || !valid()) return;
    }
    if (!transition) {
      // 同じフォルダ内は旋回と直進だけ。拡縮・暗転・再出現を再生しない。
      Object.assign(goal, cam);
      if(file) {
        focus = file.galaxy ?? null; tracking = file;
        selectBody(file, { zoom: false });
      }
      after?.();
      return true;
    }
    // 3. ワープ: カメラは止め、画面全体の拡縮とフェードを重ねる（起点は星団＝画面中央付近）
    Object.assign(goal, cam);
    let originX = CX, originY = CY;
    if (target && project(target.x, target.y, target.z)) {
      originX = Math.max(0, Math.min(W, P.x)); originY = Math.max(0, Math.min(H, P.y));
    }
    canvas.style.transformOrigin = `${originX}px ${originY}px`;
    warpBoost = 0.65;
    if (!await play(motion.exit) || !valid()) return;
    warpBoost = 0;
    if (!file) {
      trail = [...next];
      enterWorld({ history, immediate: true });
    }
    after?.();
    // パネル開閉による画面中心の変更は、画面が消えている間に完了する。
    // 旋回・前進の最中に宇宙全体が横（縦）へ滑らないようにする。
    warpProjection = measureCover(!!file || !!destinationFile);
    CX = warpProjection.x; CY = warpProjection.y;
    // 次の全景を初めから表示し、従来の出現待ち・急なズームを重ねない。
    canvas.style.transformOrigin = `${CX}px ${CY}px`;
    sceneAnimation.cancel();
    if (!await play(motion.entry) || !valid()) return;
    const arrivedFile=file||(destinationFile?world.byPath.get(destinationFile):null);
    if (arrivedFile) {
      // 高速ワープは到着したフォルダのファイルを開き、追加の接近ワープを行わない。
      focus = file ? arrivedFile.galaxy ?? null : null;
      tracking = file ? arrivedFile : null;
      selectBody(arrivedFile, { zoom: false });
    }
    return true;
  } finally {
    if (sequence === warpSequence) {
      Object.assign(goal,cam);
      turnFlight = null; warpBoost = 0; warpTravel = false; warpProjection = null;
      sceneAnimation?.cancel(); sceneAnimation = null;
      canvas.style.removeProperty('transform-origin');
      setWarpBusy(false);
    }
  }
}

/** 入る時は、その場で星団へ旋回してから直進し、光跡と拡大を重ねて次の階層へ入る。 */
function dive(g) {
  if (viewMode === '2d') return goTo({ type: 'dir', path: g.path });
  if (disposed || diving) return;
  touchIdle();
  remember('dir', g.path);
  return travelTo(g.path.split('/'), { direction: 'in', target: g });
}
/** 戻る時も、現在フォルダのゲートへ旋回・前進して親階層へ入る。 */
function ascend(count) {
  if (disposed || count >= trail.length || count < 0) return;
  if (viewMode === '2d') return goTo({ type: 'dir', path: trail.slice(0, count).join('/') });
  touchIdle();
  return travelTo(trail.slice(0, count), { direction: 'out' });
}

// URL の #/フォルダ/… に今の階層を反映する。ブラウザの戻る・進むで階層を行き来できる。
const trailHash = () => `#/${trail.map(encodeURIComponent).join('/')}`;
function trailFromHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try { return parts.map(decodeURIComponent); } catch { return []; }
}
listen(window, 'popstate', () => {
  if (!scan) return;
  const next = trailFromHash();
  if ((!diving && next.join('/') === basePath()) || !nodeAt(next)) return;
  touchIdle();
  if (viewMode === '2d') {
    invalidateNavigation();
    enterFolderDirect(next, { history: false });
    return;
  }
  travelTo(next, { direction: next.length < trail.length ? 'out' : 'in', history: false });
});

function enterWorld({ from, leaving, history = true, immediate = false } = {}) {
  if (history && location.hash !== trailHash()) {
    if (location.hash || trail.length) window.history.pushState(null, '', trailHash());
  }
  world = buildWorld();
  orbitPivot={x:0,y:0,z:0};
  focus = null; selected = null; hovered = null; hoveredGalaxy = null; hoveredGate = false; tracking = null;
  introAt = performance.now();
  const home = overviewDistance();
  goal.tx = goal.ty = goal.tz = 0; goal.dist = home;
  // 別の星系に入っても船首方向は引き継ぐ。初回だけ基準方向を使う。
  Object.assign(goal, immediate ? {yaw:cam.yaw,pitch:cam.pitch} : HOME_VIEW);
  autoOrbit.reset();
  if (immediate) {
    Object.assign(cam, goal);
    prevDist = cam.dist;
    introAt = performance.now() - 5000;
  } else if (from === 'outside' || from === 'warp') {
    // 外から突入・ワープ: 遠くから光の筋をくぐって全景へ（時間で進めるので、重いフレームでも一瞬で終わらない）
    cam.tx = cam.ty = cam.tz = 0;
    cam.dist = home * 8;
    introFlight = { start: null, from: null, duration: 1800 };
    introAt = performance.now() - (from === 'warp' ? 1500 : 300);
  } else if (from === 'inside') {
    // 内から脱出: 出てきた銀河の中心から引いていく
    const g = world.galaxies.find(x => x.path === leaving);
    if (g) { cam.tx = g.x; cam.ty = g.y; cam.tz = g.z; cam.dist = Math.max(20, g.R * 0.2); }
    introAt = performance.now() - 5000;
  }
  renderAll();
  updateSide();
}

/** 全体検索・航海日誌から、そのファイル（自由惑星として）やフォルダ（銀河として）がある宇宙へワープする。 */
let navigationSequence = 0;
let fastWarp = false;
function stopTravel() {
  ++warpSequence; sceneAnimation?.cancel(); sceneAnimation = null;
  for (const cancel of [...travelWaiters]) cancel();
  turnFlight = null; introFlight = null; warpBoost = 0; warpTravel = false; warpProjection = null;
  canvas.style.removeProperty('transform-origin'); setWarpBusy(false);
  Object.assign(goal, cam);
}
function invalidateNavigation() {
  cancelScheduledFollow();
  ++navigationSequence; ++followSequence; following = false; activeFollowPath = null;
  stopTravel();
}
// 2D で別フォルダを見た後も、訪問済みの3D視点へ戻れる。単なるモード切替では world を再生成しない。
const folderViews = new Map();
function rememberView() {
  if (!world) return;
  const path = basePath();
  folderViews.delete(path);
  folderViews.set(path, { cam: { ...cam }, pivot: { ...orbitPivot } });
  if (folderViews.size > 80) folderViews.delete(folderViews.keys().next().value);
}
function restoreView() {
  const saved = folderViews.get(basePath());
  Object.assign(cam, saved?.cam || { tx: 0, ty: 0, tz: 0, ...HOME_VIEW, dist: overviewDistance(), roll: 0 });
  Object.assign(goal, cam);
  orbitPivot = saved ? { ...saved.pivot } : { x: 0, y: 0, z: 0 };
  prevDist = cam.dist;
  introAt = performance.now() - 5000;
}
function enterFolderDirect(next, { history = true } = {}) {
  const changed = next.join('/') !== basePath();
  if (changed) {
    rememberView();
    trail = [...next];
    world = buildWorld();
    restoreView();
    autoOrbit.reset();
  }
  if (history && location.hash !== trailHash() && (location.hash || trail.length)) window.history.pushState(null, '', trailHash());
  selected = null; tracking = null; focus = null;
  hovered = null; hoveredGalaxy = null; hoveredGate = false;
  notify();
}
function setViewMode(value) {
  if (disposed || (value !== '2d' && value !== '3d') || value === viewMode) return;
  // 描画・古い航行だけを止める。受信済みの更新は新モードで再検証して続ける。
  if (following) { pendingFollow ??= activeFollowPath; ++followRevision; }
  invalidateNavigation();
  if (value === '2d') rememberView();
  viewMode = value;
  window.cancelAnimationFrame(frameId); frameId = 0;
  last = performance.now(); prevDist = cam.dist;
  dragging = false; touch.clear(); canvas.classList.remove('dragging');
  manualOrbit = false; tracking = null;
  hovered = null; hoveredGalaxy = null; hoveredGate = false; $('tooltip').hidden = true;
  driving = false;
  notify();
  requestAnimationFrame(frame);
}
const selectionLocation = file => file?.line ? {
  line:file.line,column:file.column,query:file.query,caseSensitive:file.caseSensitive,
  matchMtime:file.matchMtime,matchLength:file.matchLength,navigationId:file.navigationId,
} : {};
function applyLocation(entry, run) {
  if (!selected || selected.path !== entry.path) return;
  const {line,column,query,caseSensitive,matchMtime,matchLength}=entry;
  // ファイル自体とジャンプ要求を分け、同じ箇所の再クリックもビューアへ届ける。
  const {line:oldLine,column:oldColumn,query:oldQuery,caseSensitive:oldCase,matchMtime:oldMtime,matchLength:oldLength,navigationId:oldId,...body}=selected;
  selected = line ? {...body,line,column,query,caseSensitive,matchMtime,matchLength,navigationId:run} : body;
  updateSide();
}
async function goTo(entry, {automatic=false, valid=()=>true} = {}) {
  if (disposed || !entry || typeof entry.path !== 'string') return false;
  if (automatic && viewMode === '2d' && (!autoSpin || document.hidden || performance.now() < autoOrbit.pausedUntil || (selected && selected.path !== followedPath))) return false;
  const parts = entry.path.split('/').filter(Boolean), isFile = entry.type !== 'dir';
  const level = isFile ? parts.slice(0, -1) : parts;
  if(!automatic) touchIdle();
  const run = ++navigationSequence, forFilter = fileFilter;
  const stale = () => disposed || run !== navigationSequence || forFilter !== fileFilter || !valid();
  const exists = () => { const node=nodeAt(level);return node && (!isFile || node.f.some(file=>file[0]===parts.at(-1))); };
  // クリックを先に予約し、読み直し中の別選択・フィルター切替・終了で必ず失効させる。
  // 最終更新・grep・Browser解析は、同じ手動経路で一覧を更新してから選択する。
  if(!automatic){cancelScheduledFollow();++followSequence;following=false;activeFollowPath=null;}
  stopTravel();
  if (entry.source === 'latest' || !exists()) {
    const joinedEarlierRequest=!!refreshPending;
    if (!await refresh(undefined,{fresh:true}) || stale()) return false;
    const file=nodeAt(level)?.f.find(file=>file[0]===parts.at(-1));
    // すでに進行していた走査はクリックより前の内容かもしれない。
    if(joinedEarlierRequest && (!exists() || (entry.mtime && file && file[2]<entry.mtime))) {
      if (!await refresh(undefined,{fresh:true}) || stale()) return false;
    }
  }
  if(stale())return false;
  if(!exists()) {
    // Browser解析もmain側で実在・プロジェクト境界を検証済み。読み取り専用ビューアへ渡す。
    if(!automatic && isFile && ['grep','browser-analysis'].includes(entry.source)) {
      if (viewMode === '2d' && nodeAt(level)) enterFolderDirect(level);
      tracking=null;focus=null;
      selectBody({path:entry.path,name:parts.at(-1),size:entry.size||0,mtime:entry.mtime,unlisted:true},{zoom:false});
      applyLocation(entry,run);return true;
    }
    if(!automatic)change({
      error:viewMode==='2d'
        ? `${scan?.truncated?'走査上限のため、':'現在の一覧には'}対象のフォルダ・ファイルが見つかりません。フィルターをOFFにするか、一覧を更新してください。移動・削除された可能性もあります。`
        : scan?.truncated?'一覧の走査上限により、このファイルを表示できません。':'ファイルが見つかりません。一覧のフィルター、移動・削除を確認してください。',
      loading:false,
    });
    return false;
  }
  change({error:'',loading:false});
  if (viewMode === '2d') {
    if (!isFile || level.join('/') !== basePath()) enterFolderDirect(level);
    tracking = null; focus = null;
    if (isFile) {
      selectBody(world.byPath.get(entry.path), { zoom: false });
      applyLocation(entry, run);
    } else {
      if (entry.path) remember('dir', entry.path, parentOf(entry.path));
      notify();
    }
    return true;
  }
  // ルート内の星へ接近中でも、ルートの再選択は解除だけでなく全景へ戻す。
  // 深い階層からは下の通常ワープが全景を作るので、余分な航行を加えない。
  if (!isFile && !parts.length && !trail.length) return flyHome({ valid });
  // 接近済みの同じファイルは飛び直さず、grepの行位置だけ更新する。
  if (!automatic && isFile && selected?.path === entry.path && tracking?.path === entry.path) {applyLocation(entry,run);return true;}
  holdProjection();
  // 同階層でも下のファイル接近へ進み、位置固定の旋回→正面への前進で移動する。
  selected = null; tracking = null; focus = null; updateSide();
  // 別の枝も共通の親まで戻り、1階層ずつ目的地へ向かう。各段で必ず旋回・前進する。
  let common = 0;
  while (common < trail.length && common < level.length && trail[common] === level[common]) common++;
  if (fastWarp && isFile && level.join('/') !== basePath()) {
    if (!await travelTo(level, { direction: common < trail.length ? 'out' : 'in', destinationFile: entry.path, valid: () => !stale() }) || stale()) return;
    applyLocation(entry,run);
    if(!automatic) touchIdle();
    return true;
  }
  while (trail.length > common) {
    if (!await travelTo(trail.slice(0, -1), { direction: 'out', valid:()=>!stale() }) || stale()) return;
  }
  while (trail.length < level.length) {
    const next = level.slice(0, trail.length + 1);
    if (!await travelTo(next, { valid:()=>!stale() }) || stale()) return;
  }
  if (isFile) {
    const body = world.byPath.get(entry.path);
    if (!body || !await travelTo([...trail], { target: body, file: body, transition: false, valid: () => !stale() }) || stale()) return;
  } else {
    if (entry.path) remember('dir', entry.path, parentOf(entry.path));
    revealCurrent(); notify();
  }
  applyLocation(entry,run);
  warpProjection = null;
  // 長い航路でも到着直後に自動運転へ奪われないよう、ここから手動操作の待機を数える。
  if(!automatic) touchIdle();
  return true;
}

// ---------------------------------------------------------------- 最終更新ファイルへの自動移動
// 視点移動（自動飛行）中にエクスプローラーの最終更新が変わったら、そのファイルまで1階層ずつワープして開く。
// この流れで開いたファイルは、閉じても元の階層へ戻らず、その場で自動飛行に戻る。
let followSequence = 0, followRevision = 0, followedPath = null, pendingFollow = null, latestFollow = null, following = false;
// 自動表示中かどうかと、最後に到着した場所の記憶を分ける。後者は手動操作でも消さない。
let lastFollowedPath = null, activeFollowPath = null;
let updatePaths = [];
let followTimer = 0, followSchedule = 0;
function cancelScheduledFollow() {
  ++followSchedule;
  clearTimeout(followTimer); followTimer = 0;
}
/** 2D は更新通知と状態変化だけで追跡する。手動猶予の終了時だけ単発で起き、枠の探索表示も3Dと揃える。 */
function scheduleFollow2D() {
  cancelScheduledFollow();
  if (disposed || viewMode !== '2d' || !autoSpin || !world || following || diving || dragging || document.hidden
    || (selected && selected.path !== followedPath)) return;
  const sequence = followSchedule;
  const start = () => {
    if (sequence !== followSchedule) return;
    followTimer = 0;
    if (!canFollow()) return;
    if (!pendingFollow) { notify(); return; }
    // 開始時に予約を消費する。取得失敗・欠落パスでも notify から即時再試行を繰り返さない。
    const path = pendingFollow; pendingFollow = null;
    void follow(path);
  };
  const delay = autoOrbit.pausedUntil - performance.now();
  if (delay > 0) followTimer = setTimeout(start, delay);
  else if (pendingFollow) queueMicrotask(start);
}
/** 移動を予約する（起動直後の最終更新も含む）。3D は frame、2D は更新通知から直接開始する。 */
function requestFollow(path) {
  if (disposed) return;
  if (Array.isArray(path)) {
    // 待機中の追加更新も経路に残し、移動先だけは常に最後のファイルにする。
    const received = new Set(path);
    updatePaths = [...updatePaths.filter(value => !received.has(value)), ...received];
    path = path.at(-1);
    if (!path) return;
  }
  ++followRevision;
  latestFollow = path;
  pendingFollow = !updatePaths.length && (path === lastFollowedPath || (following && path === activeFollowPath)) ? null : path;
  if (viewMode === '2d' && following && pendingFollow) invalidateNavigation();
  scheduleFollow2D();
}
/** 今追いかけてよいか: 視点移動が ON、手動操作の直後でない、ユーザーが自分で開いたファイルを見ていない。 */
function canFollow() {
  return !disposed && !refreshPaused && autoSpin && !!world && !following && !diving && !dragging && !document.hidden && performance.now() >= autoOrbit.pausedUntil
    && (!selected || selected.path === followedPath);
}
async function follow(path) {
  if (disposed || refreshPaused || (viewMode === '2d' && !canFollow())) return false;
  if(path === lastFollowedPath&&!updatePaths.length)return true;
  const parts = path.split('/'), level = parts.slice(0, -1);
  const run = ++followSequence, mode = viewMode;
  const stale = () => disposed || mode !== viewMode || document.hidden || run !== followSequence || !autoSpin || !!pendingFollow || (latestFollow && latestFollow !== path) || performance.now() < autoOrbit.pausedUntil;
  following = true; activeFollowPath = path;
  notify();
  try { return await followSteps(path, parts, level, stale); }
  finally {
    if (run === followSequence) {
      following = false; activeFollowPath = null;
      notify();
    }
    if (!diving) warpProjection = null;
  }
}
async function followSteps(path, parts, level, stale) {
  if (viewMode === '3d') { holdProjection(); Object.assign(goal, cam); }
  // 毎回読み直す。直前の走査後に新規作成されたファイルも、予約を失わず表示する。
  const joinedEarlierRequest = !!refreshPending;
  const predatesUpdate = refreshPending && refreshPending.followRevision < followRevision;
  if (!await refresh(undefined,{fresh:viewMode==='2d'}) || stale()) return false;
  const exists = () => nodeAt(level)?.f.some(file => file[0] === parts.at(-1));
  // 更新通知より前の走査は、既存・削除ファイルも含め1回だけ再確認する。
  // freshness通知後の同じ走査は共有し、モードに関係なく古い一覧で更新を失わない。
  if (predatesUpdate || (joinedEarlierRequest && !exists())) {
    if (!await refresh(undefined,{fresh:true}) || stale()) return false;
  }
  if (!exists()) return false;
  // 更新中は前の閲覧を維持し、移動先が存在すると確認できてから切り替える。
  if (path !== lastFollowedPath) { selected = null; tracking = null; updateSide(); }
  // 先行ファイルには移動・表示せず、階層ごとの経路と閲覧軌跡だけを保存する。
  const recorded = updatePaths; updatePaths = [];
  for (const updated of recorded) {
    const names = updated.split('/'), parent = names.slice(0, -1), directory = nodeAt(parent);
    if (!directory?.f.some(file => file[0] === names.at(-1))) continue;
    for (let i = 0; i < parent.length; i++) remember('dir', parent.slice(0, i + 1).join('/'), parent.slice(0, i).join('/'), false);
    remember('file', updated, parent.join('/'), false);
  }
  if (recorded.length) { saveVoyage(); notify(); }
  if (path === lastFollowedPath) return true;
  // 手動・軌跡・自動追跡で航行規則を共有し、同一星系の接近にはワープしない。
  if (!await goTo({type:'file',path},{automatic:true,valid:()=>!stale()}) || stale()) return false;
  followedPath = path; lastFollowedPath = path;
  return true;
}

// ---------------------------------------------------------------- 航路と航海日誌（ブラウザに保存）
const storeKey = () => `aidiy_ide:${scan.root}`;
function saveVoyage() {
  try { localStorage.setItem(storeKey(), JSON.stringify({ version: 2, voyages, voyageCurrent, journal })); } catch { /* 保存できない環境 */ }
}
function loadVoyage() {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey()) || '{}');
    voyages = Object.create(null); voyageCurrent = Object.create(null);
    for (const [base, value] of Object.entries(saved.voyages && typeof saved.voyages === 'object' ? saved.voyages : {})) {
      const restored = restoreRoute(value, saved.voyageCurrent?.[base]);
      voyages[base] = restored.records; voyageCurrent[base] = restored.current;
    }
    // journal は閲覧日時一覧。旧版の最近順を保ち、航路の形は voyages だけで管理する。
    journal = Array.isArray(saved.journal) ? saved.journal : [];
  } catch { voyages = Object.create(null); voyageCurrent = Object.create(null); journal = []; }
}
function remember(type, path, base = basePath(), save = true) {
  const route = voyages[base] ??= [];
  const key = `${type === 'dir' ? 'g' : 'f'}:${path}`;
  const visit = visitPoint(route, voyageCurrent[base], key);
  voyageCurrent[base] = visit.current;
  // 航路は末尾追加。閲覧日時一覧は同じ項目を更新し、別の航路明細を作らない。
  journal = [{ type, path, at: Date.now() }, ...journal.filter(j => !(j.type === type && j.path === path))].slice(0, 80);
  if (save) saveVoyage();
}
// 閲覧日時一覧だけを消す。階層別経路・現在点・AI検索の経路は保持する。
function clearViewHistory() {
  journal = journal.filter(entry => entry.type !== 'file');
  saveVoyage(); notify();
}
function clearVoyage() {
  delete voyages[basePath()]; delete voyageCurrent[basePath()];
  saveVoyage();
}

const tail = (text, max = 44) => (text.length > max ? `…${text.slice(-(max - 1))}` : text);
const parentOf = path => path.split('/').slice(0, -1).join('/');

function selectBody(body, { record = true, zoom = true } = {}) {
  // 星の直接選択も、自動追跡やエクスプローラーと同じ旋回・前進へ統一する。
  if (body && zoom) return goTo({ type: 'file', path: body.path });
  if (!body) {
    // ビューアを閉じても到着地点に留まる。移動中なら、その場で停止する。
    invalidateNavigation();
    manualOrbit=false;
    selected = null; tracking = null; focus=null;
    autoOrbit.reset();
    updateSide();
    return;
  }
  const sameFile = selected?.path === body.path;
  const followed = tracking?.path === body.path;
  if (!sameFile) followedPath = null;  // 自動で開いたファイルの扱いは follow が付け直す（ユーザーが開いたものは自動扱いにしない）
  selected = body;
  if (followed) tracking = body; // 再走査後も新しいオブジェクトを追う。
  if (record && !sameFile) remember('file', body.path);
  updateSide();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function formatAge(ms) {
  const sec = (Date.now() - ms) / 1000;
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間前`;
  if (sec < 86400 * 60) return `${Math.floor(sec / 86400)}日前`;
  return new Date(ms).toLocaleDateString('ja-JP');
}


/** 自動運転中か: 視点移動 ON で、手動操作の直後でなく、ユーザーが自分で開いたファイルを見ていない（自動で開いたファイルの表示中は含む）。 */
let driving = false, notifiedOrbitPhase = 'idle', notifiedExplorationStatus = '';
// 表示は実際に視点を管理している処理を優先する。手動待機と低速回転を「停止」と混同しない。
function explorationStatus() {
  if (!autoSpin || document.hidden) return '';
  if (!world || introFlight) return '出航準備中';
  if (dragging || manualOrbit) return '手動操縦中';
  if (diving || turnFlight) return warpTravel ? '目的地へワープ中' : '目的地へ接近中';
  if (following) return '航路確認中';
  if (viewMode === '2d') {
    if (selected) return '閲覧中';
    return '更新待ち';
  }
  if (autoOrbit.phase === 'flying') return '探索軌道航行中';
  if (autoOrbit.phase !== 'idle') return '軌道計算と姿勢制御中';
  if (selected) return '観測中';
  return '周回軌道航行中';
}
function isDriving(now) {
  if (!autoSpin || !world || document.hidden) return false;
  if (following) return true;
  return !dragging && !diving && now >= autoOrbit.pausedUntil && (!selected || selected.path === followedPath);
}
function notify() {
  if (disposed) return;
  scheduleUpdateMarks();
  notifiedOrbitPhase = autoOrbit.phase;
  notifiedExplorationStatus = explorationStatus();
  if (viewMode === '2d') driving = isDriving(performance.now());
  change({ scan, updateMarks, trail: [...trail], selected, focus, journal, voyages: Object.fromEntries(Object.entries(voyages).map(([base,records])=>[base,records.map(record=>({...record}))])), autoSpin, viewMode, driving, orbitPhase: notifiedOrbitPhase, explorationStatus: notifiedExplorationStatus, loading: !scan });
  scheduleFollow2D();
}
function updateSide() { notify(); }
function renderAll() { notify(); }
function revealCurrent() {}
/** フィルターの切り替え。一覧を取り直し、増えた星を「新しく生まれた」扱いで光らせないよう基準を消す。 */
function clearFollowRequests() {
  cancelScheduledFollow();
  pendingFollow = latestFollow = followedPath = lastFollowedPath = null; updatePaths = [];
}
function cancelRefresh() {
  ++loadGeneration; refreshPending?.controller.abort(); refreshPending = null;
}
function setFilter(on) {
  const next = on ? 'backup' : '';
  if (next === fileFilter) return;
  invalidateNavigation(); clearFollowRequests(); cancelRefresh();
  fileFilter = next; knownPaths = null;
  void refresh(undefined,{fresh:false});
}
// 監視の結果を今のページへ反映する。移動・手動更新中の結果は次回に回す。
function applyFolderSnapshot(context, result) {
  if (disposed || refreshPaused || viewMode !== '2d' || !autoSpin || refreshPending || context.path !== basePath() || context.filter !== fileFilter || !scan || result.truncated) return false;
  const current = nodeAt(trail);
  if (!current || !result.tree) return false;
  if (JSON.stringify(current) === JSON.stringify(result.tree)) return true;
  // 保存時の一時的な欠落では解除しない。全体の新しい走査で存在を再確認する。
  if (selected && !selected.unlisted && !containsSelected(result.tree, selected.path.slice(context.path ? context.path.length + 1 : 0))) {
    void refresh();
    return false;
  }
  const replace = (node, depth) => depth === trail.length ? result.tree : { ...node, d: node.d.map(child => child.n === trail[depth] ? replace(child, depth + 1) : child) };
  scan = { ...scan, tree: replace(scan.tree, 0), scannedAt: Date.now() };
  const previous = selected;
  world = buildWorld();
  if (previous) {
    const body = world.byPath.get(previous.path);
    if (body) selectBody({...body,...selectionLocation(previous)},{record:false,zoom:false});
    else if (!previous.unlisted) { selected=null;tracking=null;focus=null;updateSide(); }
  }
  knownPaths = new Set(collectFiles(scan.tree, '').map(file => file.path));
  notify(); return true;
}
function containsSelected(tree, path) {
  const names = path.split('/'), name = names.pop();
  for (const part of names) { tree = tree?.d.find(child => child.n === part); }
  return !!tree?.f.some(file => file[0] === name);
}
function refresh(startedAt, {fresh=true}={}) {
  if(disposed||refreshPaused)return Promise.resolve(false);
  if (Number.isFinite(startedAt)) {
    if(sessionStartedAt!==undefined && sessionStartedAt!==startedAt) {
      invalidateNavigation(); clearFollowRequests(); cancelRefresh();
      selected=null;tracking=null;focus=null;knownPaths=null;folderViews.clear();
    }
    sessionStartedAt=startedAt;since=startedAt;until=null;
  }
  // 同じ条件の読み込みを重ねず、手動選択と更新通知は同じ結果を待つ。
  if(refreshPending?.filter===fileFilter)return refreshPending.promise;
  const run=++loadGeneration, request={filter:fileFilter,followRevision,controller:new AbortController(),promise:null};
  refreshPending=request;
  request.promise=(async()=>{
    try {
      const stale=()=>disposed || run!==loadGeneration || request.filter!==fileFilter;
      const read=async fresh=>{
        const params=new URLSearchParams({...(request.filter?{filter:request.filter}:{}),...(fresh?{fresh:'1'}:{})});
        const response=await fetch('/api/galaxy'+(params.size?'?'+params:''),{cache:'no-store',signal:request.controller.signal});
        if(!response.ok)throw Error(await response.text());
        return response.json();
      };
      let data=await read(fresh);
      if(stale())return false;
      // 中間の一覧は公開しない。欠落だけはキャッシュを使わず一度確認してから反映する。
      if(selected&&!selected.unlisted&&!data.truncated&&!containsSelected(data.tree,selected.path)) {
        data=await read(true);
        if(stale())return false;
      }
      // 打ち切られた走査の親欠落で現在地・閲覧を巻き戻さない。
      if(data.truncated&&trail.length) {
        let node=data.tree;
        for(const part of trail)node=node?.d.find(child=>child.n===part);
        if(!node){change({error:'一覧の走査上限により、現在の表示を保持しています。',loading:false});return false;}
      }
      const first=!scan;scan=data;
      const available = [...trail];
      while(available.length&&!nodeAt(available))available.pop();
      if(first) {
        loadVoyage();const start=trailFromHash();if(nodeAt(start))trail=start;
        enterWorld({from:'outside',history:false,immediate:viewMode==='2d'});
        if(viewMode==='3d')cam.dist=overviewDistance()*10;
      } else if(viewMode==='2d' && available.join('/')!==basePath()) {
        enterFolderDirect(available);
      } else {
        trail=available;
        const previous=selected;world=buildWorld();
        // 再走査でも検索位置は保持する。新しいクリックの場所は後から上書きしない。
        if(previous){
          const body=world.byPath.get(previous.path);
          if(body)selectBody({...body,...selectionLocation(previous)},{record:false,zoom:false});
          else if(!scan.truncated&&!previous.unlisted){selected=null;tracking=null;focus=null;updateSide();}
        }
      }
      knownPaths=new Set(collectFiles(scan.tree,'').map(file=>file.path));
      change({error:'',loading:false});notify();return true;
    }catch(error){
      if(!disposed&&run===loadGeneration&&!request.controller.signal.aborted)change({error:error.message,loading:false});
      return false;
    }finally{if(refreshPending===request)refreshPending=null;}
  })();
  return request.promise;
}
listen(window, 'keydown', event => {
  if (disposed || diving) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleExplorer(); return; }
  if (viewMode !== '3d') return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"], .ai-component')) return;
  if (event.key === 'Escape') { if (selected) selectBody(null); else if (focus) flyHome(); else if (trail.length) ascend(trail.length - 1); }
  else if (event.key === 'Backspace' && trail.length) ascend(trail.length - 1);
  else if (event.key === ' ') { event.preventDefault(); setAutoSpin(!autoSpin); }
  else if (event.key.toLowerCase() === 'r') void refresh();
  else if (event.key.toLowerCase() === 'c') clearVoyage();
});
// 非表示中はCanvas描画と毎フレームのDOM寸法取得を止める。復帰時の時間差を飛行へ加算しない。
listen(document, 'visibilitychange', () => {
  syncUpdateMarks();
  window.cancelAnimationFrame(frameId); frameId = 0; last = performance.now();
  if (document.hidden) {
    cancelScheduledFollow();
    if (viewMode === '2d' && following) {
      pendingFollow ??= activeFollowPath;
      invalidateNavigation();
    }
    if (driving) { driving = false; notify(); }
  } else {
    requestAnimationFrame(frame);
    if (viewMode === '2d') notify();
  }
});
requestAnimationFrame(frame);
return {
  refresh, setRefreshPaused, applyFolderSnapshot, clearViewHistory, goTo, ascend, flyHome, dive, approach, interact, setViewMode, setAutoSpin, setFastWarp: value => { fastWarp = !!value; }, clear: () => selectBody(null), follow, canFollow, requestFollow, setFilter,
  get viewMode() { return viewMode; }, get selected() { return selected; },
  get updateMarks() { return updateMarks; },
  get world() { return world; }, get trail() { return trail; }, get focus() { return focus; }, get labels() { return labelBoxes; }, cam, goal,
  get projection() { return { x: CX, y: CY }; },
  get orbitPath() { return autoOrbit.path; },
  get orbitPhase() { return autoOrbit.phase; },
  get orbitTarget() { return autoOrbit.target; },
  get orbitVisibility() { return autoOrbit.visibility; },
  color: name => KINDS[kindOf(name)].color,
  route(value) {
    routeMode=value.mode;
    if(routeMode==='search'){searchPaths=[...new Set(value.paths||[])];return;}
    if(routeMode==='view')return;
    aiRoute=[...(value.paths||[])];
    const expected=searchRouteRecords(aiRoute);
    // 旧UIのpathsだけでも補完。外から渡す明細は検索順・両端が一致するものだけを採用する。
    aiRecords=Array.isArray(value.records)&&value.records.length===expected.length&&value.records.every((r,i)=>r?.from===expected[i].from&&r?.to===expected[i].to)
      ? value.records.map(({from,to})=>({from,to})) : expected;
  },
  get searchRouteRecords() { return routeMode==='search'?searchPaths.map(path=>({from:null,to:`f:${path}`})):aiRecords.map(record=>({...record})); },
  get routeState() { return {mode:routeMode,paths:[...(routeMode==='search'?searchPaths:aiRoute)]}; },
  marks(value) { markMode = value.mode; since = value.since; until = value.until ?? null; grepMatches = new Set(value.paths || []); recountFresh(); },
  dispose() { disposed = true; clearTimeout(updateTimer); updateTracker.clear(); cancelRefresh(); invalidateNavigation(); listeners.abort(); window.cancelAnimationFrame(frameId); frameId = 0; folderViews.clear(); },
};
}

