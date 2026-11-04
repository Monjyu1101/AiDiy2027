// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

/*
  Xドッグファイト — コックピット視点の 3D 空中戦。

  座標系はワールド 1 単位 = 1m。y が高度、xz が水平面。
  機体は「位置 + クォータニオン + 前進速度」で持ち、操作入力は
  ピッチ / ロール / ヨーの角速度として機体ローカル軸へ加える。

  描画は 2 枚。
    #game       … three.js の 3D 空域
    #hud-canvas … 計器一式と機内の縁（下部の丸いコーミング）を毎フレーム描画

  three.js はこの公開ディレクトリに固定版を同梱して module import する。
  CDN やネットワーク接続に依存せず、配布物だけで初期化できる。

  自動確認:
    index.html?demo=1     … 無操作デモを最初から再生する
    window.XDogfight      … 状態取得と操作注入
*/

import * as THREE from './vendor/three.module.js';

// ------------------------------------------------------------------
// 定数（挙動調整はここへ集約する）
// ------------------------------------------------------------------

const 設定 = {
  最低速度: 55,
  最高速度: 360,
  初期速度: 165,
  失速速度: 78,
  加速度: 62,
  減速度: 78,

  重力: 9.8,
  音速: 340,

  ピッチ速度: 1.05,
  ロール速度: 2.3,
  ヨー速度: 0.5,

  // 自動水平復帰：姿勢キー（矢印 / WASD）を全て離してから
  // 自動水平待ち 秒だけ待ち、そこから 自動水平立上り 秒かけて効きを上げる。
  // 追従 = 傾きに対する戻しの強さ（1/s）、最大 = 戻す角速度の上限（rad/s）
  自動水平待ち: 3.0,
  自動水平立上り: 1.2,
  ロール復帰追従: 1.9,
  ロール復帰最大: 1.30,
  ピッチ復帰追従: 1.3,
  ピッチ復帰最大: 0.42,

  機体耐久: 100,
  被弾ダメージ: 9,
  地面接触高度: 42,

  機銃連射間隔: 0.075,
  機銃弾速: 900,
  機銃射程: 2200,
  機銃威力: 8,
  機銃当たり半径: 30,
  機銃過熱上限: 100,
  機銃発熱: 34,
  機銃冷却: 27,

  ミサイル初期数: 8,
  ミサイル速度: 420,
  ミサイル加速: 190,
  ミサイル寿命: 9.0,
  ミサイル威力: 100,   // ロック済みの一撃は撃墜とする（機銃は削り役）
  ミサイル旋回: 2.5,
  ミサイル爆発半径: 90,

  ロック角度: 0.30,
  ロック距離: 4200,
  ロック所要: 1.1,

  敵体力: 100,
  敵機銃威力: 7,
  敵射程: 1400,
  敵視野: 0.22,

  空域半径: 12000,
  最高高度: 8200,

  視野角: 62,
  視点遷移秒: 0.75,   // V キーでの視点切替にかける時間
};

const 編成表 = [
  { 名称: 'MISSION 1', 敵数: 3, 練度: 0.72 },
  { 名称: 'MISSION 2', 敵数: 4, 練度: 0.84 },
  { 名称: 'MISSION 3', 敵数: 5, 練度: 0.96 },
  { 名称: 'MISSION 4', 敵数: 6, 練度: 1.08 },
];

const 空色 = 0x88bad6;
const 霧色 = 0x9fc4dc;

const HUD色 = '#7ff0d0';
const HUD暗 = 'rgba(127, 240, 208, .45)';
const 警告色 = '#ff6a4d';
const ロック色 = '#ffd166';

// ------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------

const el = (id) => document.getElementById(id);

const dom = {
  canvas: el('game'),
  hud: el('hud-canvas'),
  loadError: el('load-error'),
  announcer: el('announcer'),
  commentary: el('commentary'),
  commentaryText: el('commentary-text'),
  damageFlash: el('damage-flash'),
  touchPad: el('touch-pad'),
  overlay: el('overlay'),
  overlayText: el('overlay-text'),
  startBtn: el('start-btn'),
};

let hudCtx = null;

// ------------------------------------------------------------------
// 状態
// ------------------------------------------------------------------

let renderer = null;
let scene = null;
let camera = null;

let 実行中 = false;
let 進行中 = false;
let 一時停止 = false;
let デモ中 = false;
let 初期化失敗 = false;

let rafId = 0;
const タイマー一覧 = new Set();

let 前回時刻 = 0;
let 経過 = 0;

let 得点 = 0;
let 最高得点 = 0;
let 面番号 = 0;
let 視点 = 'cockpit';     // cockpit | chase
let HUD表示 = true;
let 視点遷移 = 1;         // 0=切替直後、1=落ち着いた状態

// 計器用の派生値
let ピッチ角 = 0;         // deg（上が正）
let ロール角 = 0;         // deg（右回りが正）
let 方位 = 0;             // deg（0=北）
let 垂直速度 = 0;         // m/s
let G値 = 1;
let 対地高度 = 0;

const 入力 = {
  pitchUp: false, pitchDown: false,
  rollLeft: false, rollRight: false,
  yawLeft: false, yawRight: false,
  throttleUp: false, throttleDown: false,
  gun: false, missile: false,
};

const 自機 = {
  obj: null,
  pos: new THREE.Vector3(0, 1800, 0),
  quat: new THREE.Quaternion(),
  速度: 設定.初期速度,
  耐久: 設定.機体耐久,
  機銃熱: 0,
  機銃冷却待ち: false,
  次弾: 0,
  ミサイル残: 設定.ミサイル初期数,
  ミサイル待ち: 0,
  生存: true,
};

let 敵一覧 = [];
let 弾一覧 = [];
let ミサイル一覧 = [];
let 効果一覧 = [];

let ロック対象 = null;
let ロック進捗 = 0;
let ロック完了 = false;
let 被ロック = false;

let 無操作姿勢時間 = 0;   // 姿勢キーを全て離してからの経過秒
let デモ入力タイマー = 0;
let デモ次ミサイル = 0;
let 無操作時間 = 0;

// 再利用ベクタ（毎フレームの new を避ける）
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _前 = new THREE.Vector3();
const _上 = new THREE.Vector3();
const _右 = new THREE.Vector3();

const X軸 = new THREE.Vector3(1, 0, 0);
const Y軸 = new THREE.Vector3(0, 1, 0);
const Z軸 = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------
// タイマー管理
// ------------------------------------------------------------------

function 予約(fn, ms) {
  const id = setTimeout(() => { タイマー一覧.delete(id); fn(); }, ms);
  タイマー一覧.add(id);
  return id;
}

function 予約全解除() {
  for (const id of タイマー一覧) clearTimeout(id);
  タイマー一覧.clear();
}

// ------------------------------------------------------------------
// 生成ヘルパ
// ------------------------------------------------------------------

/**
 * 機体（F-35 系のステルス戦闘機を双発にした形）。
 *
 * 箱と円柱の寄せ集めだと輪郭が野暮ったくなるので、上から見た平面形を
 * THREE.Shape で起こして薄く押し出す。これで前縁の後退角と翼端が出る。
 * 機首は -Z、尾は +Z、Y が上。
 *
 * 構成: LERX 付きデルタ翼 / угловой な胴 / バブルキャノピー /
 *       外傾双垂直尾翼 / 双発ノズル。
 */
/*
  機体ジオメトリは全機で共有する。1 機ずつ作ると編隊を出すたびに
  ExtrudeGeometry が増え、撃墜で scene から外しても解放されずに積み上がる。
  色だけをマテリアルで変える。
*/
const 機体geo = {};

function 機体ジオメトリ準備() {
  if (機体geo.翼) return;

  // ---- 平面形（右半分。y が前方＋、x が右） ----
  // ExtrudeGeometry は XY 平面の Shape を +Z へ押し出す。
  // rotateX(-90°) すると Shape の +y が -Z（＝前方）へ向く。
  const 半輪郭 = [
    [0.0, 17.5],    // 機首
    [1.15, 13.0],
    [1.7, 7.5],
    [2.0, 3.0],     // LERX 付け根
    [11.6, -5.4],   // 主翼前縁（後退角）
    [12.4, -8.2],   // 翼端
    [3.6, -9.0],    // 主翼後縁
    [3.4, -11.2],
    [7.0, -13.4],   // 水平尾翼（スタビレーター）
    [6.8, -15.4],
    [2.6, -14.4],
    [2.2, -16.6],   // 尾端
  ];

  const 平面形 = new THREE.Shape();
  平面形.moveTo(半輪郭[0][0], 半輪郭[0][1]);
  for (let i = 1; i < 半輪郭.length; i++) 平面形.lineTo(半輪郭[i][0], 半輪郭[i][1]);
  for (let i = 半輪郭.length - 1; i >= 1; i--) 平面形.lineTo(-半輪郭[i][0], 半輪郭[i][1]);
  平面形.closePath();

  const 厚み = 1.0;
  機体geo.翼 = new THREE.ExtrudeGeometry(平面形, { depth: 厚み, bevelEnabled: false });
  機体geo.翼.rotateX(-Math.PI / 2);
  機体geo.翼.translate(0, -厚み / 2, 0);

  // 胴（角張ったステルス断面。6 角柱で近似）と機首。
  // 平面形は z -17.5(機首) 〜 +16.6(尾端)。機首コーンの先端が
  // 平面形の機首とほぼ一致するよう、長さと配置を合わせる。
  // 断面は 8 角。6 角だと頂点が真上に来て「屋根の棟」ができ、
  // 斜めから見たときに家のような塊に見える。
  機体geo.胴 = new THREE.CylinderGeometry(1.8, 2.2, 22, 8);
  機体geo.機首 = new THREE.ConeGeometry(1.8, 8.0, 8);

  // キャノピー（半球を前後に伸ばす）
  機体geo.キャノピー = new THREE.SphereGeometry(1.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);

  // 外傾双垂直尾翼
  const 尾翼形 = new THREE.Shape();
  尾翼形.moveTo(0, 0);
  尾翼形.lineTo(4.4, 0);
  尾翼形.lineTo(2.6, 4.3);
  尾翼形.lineTo(0.4, 4.1);
  尾翼形.closePath();
  機体geo.尾翼 = new THREE.ExtrudeGeometry(尾翼形, { depth: .42, bevelEnabled: false });
  機体geo.尾翼.translate(0, 0, -.21);

  // 双発ノズルと排気炎
  機体geo.ノズル = new THREE.CylinderGeometry(1.15, 1.35, 4.6, 8);
  機体geo.炎 = new THREE.ConeGeometry(1.0, 6.0, 8);
}

/** 機体のマテリアルだけ解放する（ジオメトリは全機共有なので破棄しない） */
function 機体を捨てる(obj) {
  obj.traverse((o) => {
    if (o.isMesh && o.material) o.material.dispose();
  });
}

/**
 * 機体（F-35 系のステルス戦闘機を双発にした形）を 1 機組み立てる。
 * ジオメトリは共有し、色だけマテリアルで変える。
 */
function 機体を作る(色, 主翼色) {
  機体ジオメトリ準備();
  const g = new THREE.Group();

  const 機体材 = new THREE.MeshStandardMaterial({
    color: 色, metalness: .62, roughness: .40, flatShading: true,
  });
  const 翼材 = new THREE.MeshStandardMaterial({
    color: 主翼色, metalness: .52, roughness: .46, flatShading: true,
  });
  const 暗部材 = new THREE.MeshStandardMaterial({
    color: 0x20262e, metalness: .5, roughness: .6, flatShading: true,
  });

  g.add(new THREE.Mesh(機体geo.翼, 翼材));

  // 胴は翼へ半分埋める。丸いままだと乗せただけに見えるので上下を潰す。
  // 断面の回し込みは rotation.y で行う。
  // rotation.x = 90° と併せて rotation.z を使うと、Euler XYZ（Rx·Ry·Rz）の
  // 順で z が機体の上下軸まわりに効き、胴だけがヨーして斜めに刺さる。
  const 胴 = new THREE.Mesh(機体geo.胴, 機体材);
  胴.rotation.x = Math.PI / 2;
  胴.rotation.y = Math.PI / 8;      // 上下と左右を平らな面にする（F-22 系の断面）
  胴.position.set(0, .18, -3.0);
  胴.scale.set(1, 1, .74);          // 回転前の Z（＝機体の上下）を潰す
  g.add(胴);

  // 機首コーンの先端を平面形の機首（z = -17.5）へ合わせる
  const 機首 = new THREE.Mesh(機体geo.機首, 機体材);
  機首.rotation.x = -Math.PI / 2;
  機首.rotation.y = Math.PI / 8;
  機首.position.set(0, .18, -13.8);
  機首.scale.set(1, 1, .74);
  g.add(機首);

  const キャノピー = new THREE.Mesh(機体geo.キャノピー, new THREE.MeshStandardMaterial({
    color: 0x9fd8e8, metalness: .9, roughness: .12, transparent: true, opacity: .62,
  }));
  キャノピー.scale.set(.92, .85, 2.9);
  キャノピー.position.set(0, 1.05, -8.4);
  g.add(キャノピー);

  for (const 側 of [-1, 1]) {
    const 尾翼 = new THREE.Mesh(機体geo.尾翼, 翼材);
    // Shape の x を後方（+Z）、y を上へ向ける
    尾翼.rotation.y = -Math.PI / 2;

    // 外傾は親グループで与える。mesh に rotation.y と rotation.z を
    // 同時指定すると Euler XYZ（Rx·Ry·Rz）の順で z が向き直す前の軸に
    // 効いてしまい、外へ倒れず垂直の棒に見える。
    const 台 = new THREE.Group();
    台.position.set(側 * 3.2, .5, 10.6);
    台.rotation.z = 側 * .40;
    台.add(尾翼);
    g.add(台);
  }

  const 炎群 = [];
  for (const 側 of [-1, 1]) {
    const ノズル = new THREE.Mesh(機体geo.ノズル, 暗部材);
    ノズル.rotation.x = Math.PI / 2;
    ノズル.position.set(側 * 1.75, .18, 9.4);
    g.add(ノズル);

    const 炎 = new THREE.Mesh(機体geo.炎, new THREE.MeshBasicMaterial({
      color: 0x7fd6ff, transparent: true, opacity: .8,
    }));
    炎.rotation.x = Math.PI / 2;
    炎.position.set(側 * 1.75, .18, 14.2);
    g.add(炎);
    炎群.push(炎);
  }
  g.userData.炎群 = 炎群;

  return g;
}

function 地形を作る() {
  const 幅 = 設定.空域半径 * 2;
  const 分割 = 128;
  const geo = new THREE.PlaneGeometry(幅, 幅, 分割, 分割);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h =
      Math.sin(x * 0.00042) * Math.cos(z * 0.00037) * 780 +
      Math.sin(x * 0.00119 + 1.7) * Math.cos(z * 0.00093 - .6) * 320 +
      Math.sin(x * 0.00301 - .4) * Math.cos(z * 0.00277 + 1.1) * 96;
    pos.setY(i, Math.max(0, h));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4b6144, roughness: .96, metalness: .02, flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -60;
  return mesh;
}

/** 地形と同じ式で標高を求める（対地高度の表示に使う） */
function 標高(x, z) {
  const h =
    Math.sin(x * 0.00042) * Math.cos(z * 0.00037) * 780 +
    Math.sin(x * 0.00119 + 1.7) * Math.cos(z * 0.00093 - .6) * 320 +
    Math.sin(x * 0.00301 - .4) * Math.cos(z * 0.00277 + 1.1) * 96;
  return Math.max(0, h) - 60;
}

function 海を作る() {
  const geo = new THREE.PlaneGeometry(設定.空域半径 * 4, 設定.空域半径 * 4);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b4f6b, roughness: .35, metalness: .35 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -70;
  return mesh;
}

function 雲を作る() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: .17, depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < 58; i++) {
    const 塊 = new THREE.Group();
    const 数 = 3 + ((i * 7) % 3);
    for (let j = 0; j < 数; j++) {
      const m = new THREE.Mesh(geo, mat);
      const s = 150 + ((i * 31 + j * 53) % 150);
      m.scale.set(s * 1.6, s * .5, s);
      m.position.set(
        ((i * 97 + j * 41) % 420) - 210,
        ((i * 17 + j * 23) % 60) - 30,
        ((i * 53 + j * 71) % 420) - 210,
      );
      塊.add(m);
    }
    const 角 = (i / 58) * Math.PI * 2 * 3.7;
    const r = 2600 + ((i * 137) % 9000);
    塊.position.set(Math.cos(角) * r, 5200 + ((i * 211) % 2600), Math.sin(角) * r);
    g.add(塊);
  }
  return g;
}

function 爆発を作る(位置, 大きさ = 1) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, opacity: .95, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(14 * 大きさ, 12, 10), mat);
  m.position.copy(位置);
  scene.add(m);
  効果一覧.push({ obj: m, 寿命: 0.75, 経過: 0, 大きさ: 大きさ });
}

// ------------------------------------------------------------------
// 初期化
// ------------------------------------------------------------------

function 初期化() {
  renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));

  hudCtx = dom.hud.getContext('2d');
  if (!hudCtx) throw new Error('2D コンテキストを取得できません');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(空色);
  scene.fog = new THREE.Fog(霧色, 3200, 17000);

  camera = new THREE.PerspectiveCamera(設定.視野角, 1, 0.1, 40000);

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x40503c, 1.05));
  const 太陽 = new THREE.DirectionalLight(0xfff2d8, 1.5);
  太陽.position.set(-4200, 5200, 2600);
  scene.add(太陽);

  scene.add(海を作る());
  scene.add(地形を作る());
  scene.add(雲を作る());

  自機.obj = 機体を作る(0xd8dee6, 0x9aa7b4);
  scene.add(自機.obj);

  // コックピット内装は 2D（描画_機内の縁）で描くため、3D 側は持たない。
  // 左右と上を黒い部材で塞ぐと視界が潰れるので、下部の丸い縁だけにする。
  scene.add(camera);

  リサイズ();
}

// ------------------------------------------------------------------
// 敵
// ------------------------------------------------------------------

function 敵を出す(数, 練度) {
  for (let i = 0; i < 数; i++) {
    const obj = 機体を作る(0x8d4a4a, 0xb06060);
    scene.add(obj);

    const 角 = (i / 数) * Math.PI * 2 + Math.random() * .6;
    const r = 2200 + Math.random() * 1600;
    敵一覧.push({
      obj,
      pos: new THREE.Vector3(
        自機.pos.x + Math.cos(角) * r,
        Math.max(700, 自機.pos.y + (Math.random() - .4) * 900),
        自機.pos.z + Math.sin(角) * r,
      ),
      quat: new THREE.Quaternion(),
      速度: 150 + Math.random() * 40,
      体力: 設定.敵体力,
      練度,
      次弾: 0,
      回避: 0,
      回避方向: Math.random() < .5 ? -1 : 1,
      生存: true,
    });
  }
}

function 敵AI(敵, dt) {
  _v1.copy(自機.pos).sub(敵.pos);
  const 距離 = _v1.length();
  _v1.normalize();

  _前.set(0, 0, -1).applyQuaternion(敵.quat);

  if (敵.回避 > 0) {
    敵.回避 -= dt;
  } else if (距離 < 420) {
    敵.回避 = 1.6 + Math.random();
    敵.回避方向 = Math.random() < .5 ? -1 : 1;
  }

  const 目標 = _v2.copy(_v1);
  if (敵.回避 > 0) {
    _右.set(1, 0, 0).applyQuaternion(敵.quat);
    目標.copy(_前).addScaledVector(_右, 敵.回避方向 * 1.2).normalize();
  }
  if (敵.pos.y < 500) 目標.y += .8;
  if (敵.pos.y > 6500) 目標.y -= .6;
  目標.normalize();

  const 旋回 = 1.5 * 敵.練度 * dt;
  _q1.setFromUnitVectors(_前, 目標);
  _q1.slerp(new THREE.Quaternion(), Math.max(0, 1 - 旋回));
  敵.quat.premultiply(_q1).normalize();

  const 目標速度 = 敵.回避 > 0 ? 230 : 175;
  敵.速度 += Math.sign(目標速度 - 敵.速度) * 40 * dt;

  _前.set(0, 0, -1).applyQuaternion(敵.quat);
  敵.pos.addScaledVector(_前, 敵.速度 * dt);

  敵.obj.position.copy(敵.pos);
  敵.obj.quaternion.copy(敵.quat);

  敵.次弾 -= dt;
  if (進行中 && 自機.生存 && 距離 < 設定.敵射程 && 敵.回避 <= 0) {
    _v3.copy(自機.pos).sub(敵.pos).normalize();
    if (_前.dot(_v3) > 1 - 設定.敵視野 && 敵.次弾 <= 0) {
      敵.次弾 = 0.42 / 敵.練度;
      弾を撃つ(敵.pos, _v3, false, 設定.敵機銃威力);
    }
  }
}

function 敵残数() {
  let n = 0;
  for (const e of 敵一覧) if (e.生存) n++;
  return n;
}

// ------------------------------------------------------------------
// 武装
// ------------------------------------------------------------------

function 弾を撃つ(位置, 方向, 自弾, 威力) {
  const mat = new THREE.MeshBasicMaterial({ color: 自弾 ? 0xffe9a8 : 0xff8a6a });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 5), mat);
  m.position.copy(位置);
  scene.add(m);
  弾一覧.push({
    obj: m,
    pos: 位置.clone(),
    vel: 方向.clone().multiplyScalar(設定.機銃弾速),
    残距離: 自弾 ? 設定.機銃射程 : 設定.敵射程,
    自弾,
    威力,
  });
}

function ミサイルを撃つ(対象) {
  if (自機.ミサイル残 <= 0 || !対象 || !対象.生存) return false;
  自機.ミサイル残--;

  const m = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 8, 7),
    new THREE.MeshBasicMaterial({ color: 0xfff3d0 }),
  );
  m.rotation.x = Math.PI / 2;
  scene.add(m);

  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  _右.set(1, 0, 0).applyQuaternion(自機.quat);

  ミサイル一覧.push({
    obj: m,
    pos: 自機.pos.clone().addScaledVector(_右, (ミサイル一覧.length % 2 ? 1 : -1) * 9),
    vel: _前.clone().multiplyScalar(自機.速度 + 60),
    対象,
    残寿命: 設定.ミサイル寿命,
  });

  合図('FOX 2');
  解説('ミサイル発射。目標を追尾しながら向かいます。', 2.8, 解説優先度.戦闘);
  return true;
}

// ------------------------------------------------------------------
// 自機の更新
// ------------------------------------------------------------------

/**
 * 姿勢キーを全て離したあと、機体を徐々に水平へ戻す。
 *
 * 離してすぐには効かせない。設定.自動水平待ち 秒そのままの姿勢を保ち、
 * そこから 設定.自動水平立上り 秒かけて効きを 0 → 1 へ上げる。
 * 待ち時間を置くことで、機首を上げたまま少し飛ぶ・バンクを保つ、
 * といった操作を妨げない。
 *
 * ロールは「翼を水平に」（機体右方向の y 成分を 0 へ）、
 * ピッチは「機首を水平に」（機体前方向の y 成分を 0 へ）近づける。
 * 戻す量は傾きに比例させ、上限で頭打ちにする。急に立て直すと
 * 操作を奪われた感じになるため、ピッチは弱め・ロールは強めにする。
 */
function 自動水平復帰(dt) {
  if (無操作姿勢時間 < 設定.自動水平待ち) return;

  // 待ち明けに急に効き始めないよう、強さをなめらかに立ち上げる
  const 経過 = 無操作姿勢時間 - 設定.自動水平待ち;
  const 強さ = Math.min(1, 経過 / 設定.自動水平立上り);
  if (強さ <= 0) return;

  _上.set(0, 1, 0).applyQuaternion(自機.quat);
  _右.set(1, 0, 0).applyQuaternion(自機.quat);
  // 背面飛行では ±180° 付近になる。近い側へ回して水平へ戻す
  const 現ロール = Math.atan2(_右.y, _上.y);
  if (Math.abs(現ロール) > 0.004) {
    const 上限 = 設定.ロール復帰最大 * 強さ * dt;
    const 戻し = Math.max(-上限, Math.min(上限, -現ロール * 設定.ロール復帰追従 * 強さ * dt));
    _q1.setFromAxisAngle(Z軸, 戻し);
    自機.quat.multiply(_q1);
  }

  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  const 現ピッチ = Math.asin(Math.max(-1, Math.min(1, _前.y)));
  if (Math.abs(現ピッチ) > 0.004) {
    const 上限 = 設定.ピッチ復帰最大 * 強さ * dt;
    const 戻し = Math.max(-上限, Math.min(上限, -現ピッチ * 設定.ピッチ復帰追従 * 強さ * dt));
    _q1.setFromAxisAngle(X軸, 戻し);
    自機.quat.multiply(_q1);
  }

  自機.quat.normalize();
}

function 自機更新(dt) {
  if (!自機.生存) return;

  const 前回上昇 = 垂直速度;

  let pitch = 0, roll = 0, yaw = 0;
  if (入力.pitchUp) pitch += 1;
  if (入力.pitchDown) pitch -= 1;
  if (入力.rollLeft) roll += 1;
  if (入力.rollRight) roll -= 1;
  if (入力.yawLeft) yaw += 1;
  if (入力.yawRight) yaw -= 1;

  const 効き = Math.min(1, Math.max(.28, 自機.速度 / 190));

  _q1.setFromAxisAngle(X軸, pitch * 設定.ピッチ速度 * 効き * dt);
  自機.quat.multiply(_q1);
  _q1.setFromAxisAngle(Z軸, roll * 設定.ロール速度 * 効き * dt);
  自機.quat.multiply(_q1);
  _q1.setFromAxisAngle(Y軸, yaw * 設定.ヨー速度 * 効き * dt);
  自機.quat.multiply(_q1);
  自機.quat.normalize();

  // --- 自動水平復帰 ---
  // 姿勢キー（矢印 / WASD）を全て離してからの経過を数え、
  // 一定時間そのままなら徐々に水平へ戻す。
  if (pitch !== 0 || roll !== 0) 無操作姿勢時間 = 0;
  else 無操作姿勢時間 += dt;
  自動水平復帰(dt);

  if (入力.throttleUp) 自機.速度 += 設定.加速度 * dt;
  if (入力.throttleDown) 自機.速度 -= 設定.減速度 * dt;

  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  自機.速度 -= _前.y * 設定.重力 * 2.6 * dt;
  自機.速度 -= (自機.速度 - 設定.初期速度) * 0.06 * dt;
  自機.速度 = Math.min(設定.最高速度, Math.max(設定.最低速度, 自機.速度));

  if (自機.速度 < 設定.失速速度) {
    _q1.setFromAxisAngle(X軸, -0.7 * dt);
    自機.quat.multiply(_q1);
  }

  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  自機.pos.addScaledVector(_前, 自機.速度 * dt);

  const 水平距離 = Math.hypot(自機.pos.x, 自機.pos.z);
  if (水平距離 > 設定.空域半径) {
    合図('RETURN TO AIRSPACE');
    自機.pos.x *= 設定.空域半径 / 水平距離;
    自機.pos.z *= 設定.空域半径 / 水平距離;
  }
  if (自機.pos.y > 設定.最高高度) 自機.pos.y = 設定.最高高度;

  if (自機.pos.y < 設定.地面接触高度) {
    自機.pos.y = 設定.地面接触高度;
    被弾(設定.機体耐久, true);
  }

  自機.obj.position.copy(自機.pos);
  自機.obj.quaternion.copy(自機.quat);
  // コックピットへ寄り切るまでは自機を消さない（遷移中に機体が消えるのを防ぐ）
  自機.obj.visible = (視点 === 'chase') || 視点遷移 < .92;
  // 双発なので両方のノズルの炎を伸縮させる
  const 炎群 = 自機.obj.userData.炎群;
  if (炎群) {
    const s = .6 + (自機.速度 / 設定.最高速度) * 1.5;
    for (const 炎 of 炎群) 炎.scale.set(1, s, 1);
  }

  // --- 計器用の派生値 ---
  _上.set(0, 1, 0).applyQuaternion(自機.quat);
  _右.set(1, 0, 0).applyQuaternion(自機.quat);
  ピッチ角 = Math.asin(Math.max(-1, Math.min(1, _前.y))) * 180 / Math.PI;
  ロール角 = Math.atan2(_右.y, _上.y) * 180 / Math.PI;
  方位 = (Math.atan2(_前.x, -_前.z) * 180 / Math.PI + 360) % 360;
  垂直速度 = _前.y * 自機.速度;
  対地高度 = 自機.pos.y - 標高(自機.pos.x, 自機.pos.z);
  // 上下方向の加速度から簡易的な G を出す
  const 上下加速 = (垂直速度 - 前回上昇) / Math.max(dt, 1e-4);
  G値 = Math.max(-3, Math.min(12, 1 + 上下加速 / 設定.重力));

  // --- 機銃 ---
  自機.次弾 -= dt;
  if (自機.機銃冷却待ち) {
    自機.機銃熱 -= 設定.機銃冷却 * dt;
    if (自機.機銃熱 <= 0) { 自機.機銃熱 = 0; 自機.機銃冷却待ち = false; }
  } else if (入力.gun && 自機.次弾 <= 0) {
    自機.次弾 = 設定.機銃連射間隔;
    _v1.copy(自機.pos).addScaledVector(_前, 16);
    弾を撃つ(_v1, _前, true, 設定.機銃威力);
    自機.機銃熱 += 設定.機銃発熱 * 設定.機銃連射間隔;
    if (自機.機銃熱 >= 設定.機銃過熱上限) {
      自機.機銃熱 = 設定.機銃過熱上限;
      自機.機銃冷却待ち = true;
      合図('GUN OVERHEAT');
    }
  } else {
    自機.機銃熱 = Math.max(0, 自機.機銃熱 - 設定.機銃冷却 * dt);
  }

  // --- ミサイル ---
  自機.ミサイル待ち -= dt;
  if (入力.missile && ロック完了 && 自機.ミサイル待ち <= 0) {
    if (ミサイルを撃つ(ロック対象)) 自機.ミサイル待ち = 0.6;
    入力.missile = false;
  }
}

// ------------------------------------------------------------------
// ロックオン
// ------------------------------------------------------------------

function ロック更新(dt) {
  _前.set(0, 0, -1).applyQuaternion(自機.quat);

  let 最良 = null;
  let 最良角 = 設定.ロック角度;
  for (const 敵 of 敵一覧) {
    if (!敵.生存) continue;
    _v1.copy(敵.pos).sub(自機.pos);
    const 距離 = _v1.length();
    if (距離 > 設定.ロック距離) continue;
    _v1.normalize();
    const 角 = Math.acos(Math.min(1, Math.max(-1, _前.dot(_v1))));
    if (角 < 最良角) { 最良角 = 角; 最良 = 敵; }
  }

  if (最良 !== ロック対象) {
    ロック対象 = 最良;
    ロック進捗 = 0;
    ロック完了 = false;
  }

  if (ロック対象 && ロック対象.生存) {
    ロック進捗 = Math.min(設定.ロック所要, ロック進捗 + dt);
    if (!ロック完了 && ロック進捗 >= 設定.ロック所要) {
      ロック完了 = true;
      合図('LOCK ON');
      解説('ロックオン完了。ミサイルの発射が可能になりました。', 2.6, 解説優先度.戦闘);
    }
  } else {
    ロック進捗 = 0;
    ロック完了 = false;
  }

  被ロック = false;
  for (const 敵 of 敵一覧) {
    if (!敵.生存) continue;
    _v1.copy(自機.pos).sub(敵.pos);
    if (_v1.length() > 設定.敵射程 * 1.3) continue;
    _v1.normalize();
    _v2.set(0, 0, -1).applyQuaternion(敵.quat);
    if (_v2.dot(_v1) > .965) { 被ロック = true; break; }
  }
}

// ------------------------------------------------------------------
// 弾・ミサイル・効果
// ------------------------------------------------------------------

/** 線分 AB と点 P の最短距離（弾のすり抜け防止に使う） */
function 線分と点の距離(a, b, p) {
  _v4.copy(b).sub(a);
  const 長さ2 = _v4.lengthSq();
  if (長さ2 < 1e-6) return a.distanceTo(p);
  let t = ((p.x - a.x) * _v4.x + (p.y - a.y) * _v4.y + (p.z - a.z) * _v4.z) / 長さ2;
  t = Math.max(0, Math.min(1, t));
  _v3.copy(a).addScaledVector(_v4, t);
  return _v3.distanceTo(p);
}

function 弾更新(dt) {
  for (let i = 弾一覧.length - 1; i >= 0; i--) {
    const b = 弾一覧[i];
    _v1.copy(b.pos);                       // 移動前
    const 移動 = _v2.copy(b.vel).multiplyScalar(dt);
    b.pos.add(移動);
    b.残距離 -= 移動.length();
    b.obj.position.copy(b.pos);

    // 1フレームの移動量が当たり半径を超えるため、線分で判定する
    let 命中 = false;
    if (b.自弾) {
      for (const 敵 of 敵一覧) {
        if (!敵.生存) continue;
        if (線分と点の距離(_v1, b.pos, 敵.pos) < 設定.機銃当たり半径) {
          敵ダメージ(敵, b.威力);
          命中 = true;
          break;
        }
      }
    } else if (自機.生存 && 線分と点の距離(_v1, b.pos, 自機.pos) < 26) {
      被弾(b.威力, false);
      命中 = true;
    }

    if (命中 || b.残距離 <= 0) {
      scene.remove(b.obj);
      b.obj.geometry.dispose();
      b.obj.material.dispose();
      弾一覧.splice(i, 1);
    }
  }
}

function ミサイル更新(dt) {
  for (let i = ミサイル一覧.length - 1; i >= 0; i--) {
    const m = ミサイル一覧[i];
    m.残寿命 -= dt;

    if (m.対象 && m.対象.生存) {
      _v1.copy(m.対象.pos).sub(m.pos).normalize();
      _v2.copy(m.vel).normalize();
      _v2.lerp(_v1, Math.min(1, 設定.ミサイル旋回 * dt)).normalize();
      const 速さ = Math.min(設定.ミサイル速度, m.vel.length() + 設定.ミサイル加速 * dt);
      m.vel.copy(_v2).multiplyScalar(速さ);
    }

    _v1.copy(m.pos);
    m.pos.addScaledVector(m.vel, dt);
    m.obj.position.copy(m.pos);
    m.obj.quaternion.setFromUnitVectors(Z軸, _v2.copy(m.vel).normalize());

    let 爆発した = false;
    if (m.対象 && m.対象.生存 &&
        線分と点の距離(_v1, m.pos, m.対象.pos) < 設定.ミサイル爆発半径) {
      敵ダメージ(m.対象, 設定.ミサイル威力);
      爆発を作る(m.pos, 1.7);
      爆発した = true;
    }

    if (爆発した || m.残寿命 <= 0) {
      scene.remove(m.obj);
      m.obj.geometry.dispose();
      m.obj.material.dispose();
      ミサイル一覧.splice(i, 1);
    }
  }
}

function 効果更新(dt) {
  for (let i = 効果一覧.length - 1; i >= 0; i--) {
    const e = 効果一覧[i];
    e.経過 += dt;
    const t = e.経過 / e.寿命;
    if (t >= 1) {
      scene.remove(e.obj);
      e.obj.geometry.dispose();
      e.obj.material.dispose();
      効果一覧.splice(i, 1);
      continue;
    }
    const s = 1 + t * 4.2 * e.大きさ;
    e.obj.scale.set(s, s, s);
    e.obj.material.opacity = .95 * (1 - t);
  }
}

// ------------------------------------------------------------------
// ダメージ
// ------------------------------------------------------------------

function 敵ダメージ(敵, 量) {
  敵.体力 -= 量;
  if (敵.体力 > 0) return;

  敵.生存 = false;
  scene.remove(敵.obj);
  機体を捨てる(敵.obj);
  爆発を作る(敵.pos, 2.4);
  得点加算(1200);

  if (ロック対象 === 敵) { ロック対象 = null; ロック進捗 = 0; ロック完了 = false; }
  if (敵残数() === 0) 予約(() => 次の面へ(), 1500);
}

function 被弾(量, 墜落) {
  if (!自機.生存) return;
  自機.耐久 -= 量;

  dom.damageFlash.classList.add('on');
  予約(() => dom.damageFlash.classList.remove('on'), 170);
  if (自機.耐久 > 0) {
    解説(`被弾しました。機体耐久 ${Math.max(0, Math.round(自機.耐久))}%。回避行動に移ります。`,
        3.0, 解説優先度.戦闘);
  }

  if (自機.耐久 <= 0) {
    自機.耐久 = 0;
    自機.生存 = false;
    爆発を作る(自機.pos, 3.2);
    自機.obj.visible = false;
    終了(墜落 ? 'CRASHED' : 'SHOT DOWN');
  }
}

// ------------------------------------------------------------------
// 得点・進行
// ------------------------------------------------------------------

function 得点加算(点) {
  得点 += 点;
  if (得点 > 最高得点) { 最高得点 = 得点; 最高得点を保存(); }
}

function 最高得点を読む() {
  try {
    const v = window.localStorage.getItem('Xドッグファイト.最高得点');
    最高得点 = v ? parseInt(v, 10) || 0 : 0;
  } catch { 最高得点 = 0; }
}

function 最高得点を保存() {
  try { window.localStorage.setItem('Xドッグファイト.最高得点', String(最高得点)); } catch { /* 保存不可でも進行する */ }
}

// ------------------------------------------------------------------
// デモの実況解説
// ------------------------------------------------------------------

/*
  デモ飛行中だけ、自動操縦が「いま何を狙っているか」を文章で出す。
  優先度で上書きを制御し、低優先の解説が高優先（撃墜・被弾など）を
  塗り潰さないようにする。何も起きていない間は HUD の読み方を挟む。
*/

const 解説優先度 = { ヒント: 1, 状況: 2, 戦闘: 3, 重要: 4 };

let 解説文 = '';
let 解説残り = 0;
let 解説優先 = 0;
let 解説次ヒント = 0;
let ヒント番号 = 0;
let 前回敵残数 = -1;
let 前回被ロック = false;
let 解説_低高度済 = false;
let 解説_失速済 = false;

const HUDヒント = [
  '左のテープが対気速度（km/h）、右が高度（m）です。右下の R は対地高度を示します。',
  '中央のはしごはピッチラダー。機首の上下角を 5 度刻みで表し、破線は機首下げ側です。',
  '上部のテープが方位。N・E・S・W と 10 度刻みの数字で向きを読みます。',
  '中央の円は速度ベクトル。機体が実際に進んでいく方向を示します。',
  '敵機は四隅の括弧で囲まれます。囲みの外周リングはロックオンの進捗です。',
  '右下はレーダー。機首を上に、半径 6km の敵機を表示します。縦棒は高度差です。',
  '左下の計器盤は、武装・エンジン出力・G・機体損傷を示します。',
  'ミサイルはロックオン完了後に発射すると目標を追尾します。機銃は偏差点を狙います。',
];

function 解説(文, 秒 = 3.4, 優先 = 解説優先度.状況) {
  if (!デモ中) return;
  // 表示中のものより優先度が低ければ捨てる
  if (解説残り > 0 && 優先 < 解説優先) return;
  解説文 = 文;
  解説残り = 秒;
  解説優先 = 優先;
  dom.commentaryText.textContent = 文;
  dom.commentary.classList.add('on');
}

function 解説更新(dt) {
  if (!デモ中) {
    if (解説残り !== 0 || 解説文) {
      解説文 = ''; 解説残り = 0; 解説優先 = 0;
      dom.commentary.classList.remove('on');
    }
    return;
  }

  if (解説残り > 0) {
    解説残り -= dt;
    if (解説残り <= 0) {
      解説残り = 0;
      解説優先 = 0;
      dom.commentary.classList.remove('on');
      解説次ヒント = 2.2;      // 少し間を置いてから次の解説へ
    }
  } else if (進行中) {
    解説次ヒント -= dt;
    if (解説次ヒント <= 0) 状況解説();
  }
}

/** 何も起きていないときに、状況か HUD の読み方を出す */
function 状況解説() {
  const 残 = 敵残数();

  if (ロック対象 && ロック対象.生存) {
    const 距離 = 自機.pos.distanceTo(ロック対象.pos);
    if (ロック完了) {
      解説(`目標をロックオン。距離 ${(距離 / 1000).toFixed(1)}km。ミサイルの発射機会をうかがいます。`);
    } else {
      解説(`目標を照準内に捉えました。距離 ${(距離 / 1000).toFixed(1)}km、ロックオン中です。`);
    }
    return;
  }

  if (残 > 0 && Math.random() < .45) {
    解説(`残り ${残} 機。レーダーで位置を確認し、機首を向けて捕捉に向かいます。`);
    return;
  }

  // 手が空いていれば HUD の読み方を挟む
  解説(HUDヒント[ヒント番号 % HUDヒント.length], 4.6, 解説優先度.ヒント);
  ヒント番号++;
}

/** 毎フレームの状態変化から解説のきっかけを拾う */
function 解説を拾う() {
  if (!デモ中 || !進行中) return;

  const 残 = 敵残数();
  if (前回敵残数 >= 0 && 残 < 前回敵残数) {
    解説(残 > 0
      ? `命中、撃墜しました。残り ${残} 機、次の目標へ向かいます。`
      : '全機撃墜。空域を確保しました。', 3.2, 解説優先度.重要);
  }
  前回敵残数 = 残;

  if (被ロック && !前回被ロック) {
    解説('敵機に照準を取られています。旋回して射線から外れます。', 3.0, 解説優先度.戦闘);
  }
  前回被ロック = 被ロック;

  if (対地高度 < 500 && !解説_低高度済) {
    解説_低高度済 = true;
    解説('地表が近づきました。機首を上げて高度を回復します。', 3.0, 解説優先度.戦闘);
  } else if (対地高度 > 900) {
    解説_低高度済 = false;
  }

  if (自機.速度 < 設定.失速速度 + 6 && !解説_失速済) {
    解説_失速済 = true;
    解説('速度が落ちています。失速を避けるため加速します。', 3.0, 解説優先度.戦闘);
  } else if (自機.速度 > 設定.失速速度 + 30) {
    解説_失速済 = false;
  }
}

function 解説を初期化() {
  解説文 = '';
  解説残り = 0;
  解説優先 = 0;
  解説次ヒント = 0;
  前回敵残数 = -1;
  前回被ロック = false;
  解説_低高度済 = false;
  解説_失速済 = false;
  dom.commentary.classList.remove('on');
  dom.commentaryText.textContent = '';
}

function 合図(文言) {
  dom.announcer.textContent = 文言;
  dom.announcer.classList.add('on');
  予約(() => dom.announcer.classList.remove('on'), 1400);
}

function 次の面へ() {
  if (!進行中) return;
  面番号++;
  if (面番号 >= 編成表.length) { 終了('MISSION COMPLETE'); return; }
  面開始();
}

function 面開始() {
  const 面 = 編成表[面番号];
  自機.ミサイル残 = 設定.ミサイル初期数;
  自機.耐久 = Math.min(設定.機体耐久, 自機.耐久 + 25);
  合図(`${面.名称} — ${面.敵数} BANDITS`);
  解説(`${面.名称} 開始。敵編隊 ${面.敵数} 機を確認しました。自動操縦で交戦に入ります。`,
      4.0, 解説優先度.重要);
  敵を出す(面.敵数, 面.練度);
}

// ------------------------------------------------------------------
// 開始・終了・リセット
// ------------------------------------------------------------------

function 場をきれいにする() {
  for (const 敵 of 敵一覧) {
    if (敵.obj.parent) { scene.remove(敵.obj); 機体を捨てる(敵.obj); }
  }
  for (const b of 弾一覧) { scene.remove(b.obj); b.obj.geometry.dispose(); b.obj.material.dispose(); }
  for (const m of ミサイル一覧) { scene.remove(m.obj); m.obj.geometry.dispose(); m.obj.material.dispose(); }
  for (const e of 効果一覧) { scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); }
  敵一覧 = []; 弾一覧 = []; ミサイル一覧 = []; 効果一覧 = [];
  ロック対象 = null; ロック進捗 = 0; ロック完了 = false; 被ロック = false;
}

function 初期状態へ() {
  予約全解除();
  場をきれいにする();

  自機.pos.set(0, 1800, 2400);
  自機.quat.identity();
  自機.速度 = 設定.初期速度;
  自機.耐久 = 設定.機体耐久;
  自機.機銃熱 = 0;
  自機.機銃冷却待ち = false;
  自機.次弾 = 0;
  自機.ミサイル残 = 設定.ミサイル初期数;
  自機.ミサイル待ち = 0;
  自機.生存 = true;
  自機.obj.visible = (視点 === 'chase');
  視点遷移 = 1;
  自機.obj.position.copy(自機.pos);
  自機.obj.quaternion.copy(自機.quat);

  for (const k of Object.keys(入力)) 入力[k] = false;
  無操作姿勢時間 = 0;

  得点 = 0; 面番号 = 0; 経過 = 0;
  ピッチ角 = 0; ロール角 = 0; 方位 = 0; 垂直速度 = 0; G値 = 1;
  対地高度 = 自機.pos.y - 標高(自機.pos.x, 自機.pos.z);

  dom.damageFlash.classList.remove('on');
}

/** 通常プレイとデモを同じ入口から開始する */
function 開始(demo = false) {
  初期状態へ();
  デモ中 = demo;
  進行中 = true;
  一時停止 = false;
  無操作時間 = 0;
  デモ入力タイマー = 0;
  デモ次ミサイル = 2.5;

  dom.overlay.classList.remove('show');
  解説を初期化();
  面開始();
  ループ開始();
}

function 終了(見出し) {
  進行中 = false;
  予約全解除();
  dom.commentary.classList.remove('on');

  dom.overlayText.innerHTML = デモ中
    ? 'デモ飛行を終了しました。<br>MISSION START で操作できます。'
    : `<b>${見出し}</b><br>SCORE ${String(得点).padStart(7, '0')}`;
  dom.overlay.classList.add('show');
  dom.startBtn.textContent = 'RETRY';

  if (デモ中) 予約(() => { if (!進行中) 開始(true); }, 2600);
}

// ------------------------------------------------------------------
// デモ操作
// ------------------------------------------------------------------

function デモ操作(dt) {
  デモ入力タイマー -= dt;
  デモ次ミサイル -= dt;

  入力.gun = !!ロック対象 && ロック進捗 > .35;

  入力.missile = false;
  if (ロック完了 && 自機.ミサイル残 > 0 && デモ次ミサイル <= 0) {
    入力.missile = true;
    デモ次ミサイル = 5.5;
  }

  // ロック対象がいなくても、最も近い敵へ向かい続ける。
  // 放置すると探索で流れて敵を見失い、延々と旋回するだけになる。
  let 目標機 = (ロック対象 && ロック対象.生存) ? ロック対象 : null;
  if (!目標機) {
    let 最短 = Infinity;
    for (const 敵 of 敵一覧) {
      if (!敵.生存) continue;
      const d = 自機.pos.distanceToSquared(敵.pos);
      if (d < 最短) { 最短 = d; 目標機 = 敵; }
    }
  }

  if (目標機) {
    _v1.copy(目標機.pos).sub(自機.pos).normalize();
    _前.set(0, 0, -1).applyQuaternion(自機.quat);
    _上.set(0, 1, 0).applyQuaternion(自機.quat);
    _右.set(1, 0, 0).applyQuaternion(自機.quat);

    const 縦 = _v1.dot(_上);
    const 横 = _v1.dot(_右);
    const 正対 = _前.dot(_v1);

    // 背後にいる場合はロールを優先して機首を回し込む
    入力.rollLeft = 横 < -.05;
    入力.rollRight = 横 > .05;
    入力.pitchUp = 縦 > .04 || 正対 < -.2;
    入力.pitchDown = 縦 < -.04 && 正対 > .2;
    入力.throttleUp = 正対 > .5;
    入力.throttleDown = 正対 > .95 && 自機.pos.distanceTo(目標機.pos) < 300;
  } else if (デモ入力タイマー <= 0) {
    デモ入力タイマー = 1.4 + Math.random() * 1.6;
    入力.rollLeft = Math.random() < .5;
    入力.rollRight = !入力.rollLeft;
    入力.pitchUp = Math.random() < .35;
    入力.pitchDown = false;
    入力.throttleUp = true;
  }

  // 地表回避は最優先。山があるので海抜ではなく対地高度で見る。
  // バンクしたままでは上昇できないため、翼も水平へ戻す。
  if (対地高度 < 700) {
    入力.pitchUp = true;
    入力.pitchDown = false;
    入力.throttleUp = true;
    入力.gun = false;
    入力.missile = false;
    入力.rollRight = ロール角 > 6;
    入力.rollLeft = ロール角 < -6;
  } else if (自機.pos.y > 6800) {
    入力.pitchDown = true;
    入力.pitchUp = false;
  }
}

// ------------------------------------------------------------------
// カメラ
// ------------------------------------------------------------------

function カメラ更新(dt) {
  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  _上.set(0, 1, 0).applyQuaternion(自機.quat);

  // 視点切替の進み具合（0=切替直後、1=落ち着いた状態）
  if (視点遷移 < 1) 視点遷移 = Math.min(1, 視点遷移 + dt / 設定.視点遷移秒);
  // 両端がなめらかになるイージング
  const t = 視点遷移 < .5
    ? 2 * 視点遷移 * 視点遷移
    : 1 - Math.pow(-2 * 視点遷移 + 2, 2) / 2;

  if (視点 === 'cockpit') {
    // 操縦席の位置。機首より少し後ろ、キャノピー内へ置く
    _v1.copy(自機.pos).addScaledVector(_前, 2.5).addScaledVector(_上, 2.2);
    if (視点遷移 >= 1) {
      // 落ち着いたら完全に一致させる（HUD のボアサイトをずらさない）
      camera.position.copy(_v1);
      camera.quaternion.copy(自機.quat);
    } else {
      // 客観視点から操縦席へ吸い込まれるように寄せる
      camera.position.lerp(_v1, Math.min(1, t * .5 + 3.0 * dt));
      camera.quaternion.slerp(自機.quat, Math.min(1, t * .5 + 3.0 * dt));
    }
    return;
  }

  const 引き = 46 + (自機.速度 / 設定.最高速度) * 34;
  _v1.copy(自機.pos).addScaledVector(_前, -引き).addScaledVector(_上, 13);
  camera.position.lerp(_v1, Math.min(1, 7.5 * dt));
  camera.quaternion.slerp(自機.quat, Math.min(1, 6.5 * dt));
}

// ==================================================================
// HUD 描画
// ==================================================================

let HUD幅 = 0;
let HUD高 = 0;

/**
 * コンバイナ（HUD ガラス）の矩形。
 * 実機の HUD は操縦席正面の 1 枚のガラスに символ が集まっているので、
 * 飛行計器はすべてこの中へ収め、はみ出す分は clip で切る。
 * 中心は必ず画面中心（ボアサイト）に合わせる。目標枠の投影位置と一致させるため。
 */
const 結合器 = { x: 0, y: 0, w: 0, h: 0, 左: 0, 右: 0, 上: 0, 下: 0 };

function 結合器を測る() {
  // コックピットでは正面のガラス 1 枚に収める。
  // 第三者視点は実機の HUD ではないので、画面いっぱいに広げる。
  let w, h;
  if (視点 === 'cockpit') {
    w = Math.min(HUD幅 * 0.56, 860);
    h = Math.min(HUD高 * 0.66, 600);
  } else {
    w = HUD幅 * 0.97;
    h = HUD高 * 0.84;
  }
  結合器.w = w;
  結合器.h = h;
  結合器.x = HUD幅 / 2;
  結合器.y = HUD高 / 2;
  結合器.左 = 結合器.x - w / 2;
  結合器.右 = 結合器.x + w / 2;
  結合器.上 = 結合器.y - h / 2;
  結合器.下 = 結合器.y + h / 2;
}

/** 度あたりのピクセル数（垂直画角から算出） */
function 度ピクセル() {
  return (HUD高 / 2) / (設定.視野角 / 2);
}

/**
 * 機内表示の縁。
 * 左右と上は塞がず、下部だけを円弧で丸く落とす。
 * 楕円の下半分を使い、中央がいちばん深く（＝視界が広く）、
 * 両端へ向かって黒がせり上がる形にする。
 */
function 描画_機内の縁(ctx) {
  if (視点 !== 'cockpit') return;
  // 客観視点から戻る途中は、縁も一緒に浮かび上がらせる
  const 濃さ = Math.max(0, Math.min(1, (視点遷移 - .35) / .65));
  if (濃さ <= 0) return;

  const rx = HUD幅 / 2;
  const ry = HUD高 * 0.12;
  const 中心y = HUD高 * 0.72;          // 楕円の中心。下半分だけを使う
  const 中央上端 = 中心y + ry;         // 画面中央での縁の高さ

  ctx.save();
  ctx.shadowBlur = 0;

  // 黒い部分（縁より下）
  ctx.beginPath();
  ctx.moveTo(0, HUD高);
  ctx.lineTo(0, 中心y);
  ctx.ellipse(HUD幅 / 2, 中心y, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(HUD幅, HUD高);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, 中心y, 0, HUD高);
  g.addColorStop(0, `rgba(10, 16, 22, ${(.92 * 濃さ).toFixed(3)})`);
  g.addColorStop(1, `rgba(4, 8, 13, ${(.98 * 濃さ).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fill();

  // 縁のコーミング（明るい線）
  ctx.beginPath();
  ctx.ellipse(HUD幅 / 2, 中心y, rx, ry, 0, Math.PI, 0, true);
  ctx.strokeStyle = `rgba(127, 240, 208, ${(.40 * 濃さ).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 内側にもう一本、細く入れて厚みを出す
  ctx.beginPath();
  ctx.ellipse(HUD幅 / 2, 中心y + 5, rx * .995, ry, 0, Math.PI, 0, true);
  ctx.strokeStyle = 'rgba(127, 240, 208, .16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
  return 中央上端;
}

/** コンバイナのガラスと枠 */
function 描画_結合器(ctx) {
  // 第三者視点ではガラス越しではないので、着色も枠も出さない
  if (視点 !== 'cockpit') return;

  const { 左, 上, w, h } = 結合器;
  ctx.save();
  ctx.shadowBlur = 0;

  // ガラスのごく薄い着色（外が見える濃さに留める）
  ctx.fillStyle = 'rgba(86, 214, 178, .055)';
  ctx.fillRect(左, 上, w, h);

  // 枠は四隅だけ。全周を囲うと窓のように見えて視界が狭く感じる
  ctx.strokeStyle = 'rgba(127, 240, 208, .40)';
  ctx.lineWidth = 1.6;
  const c = 26;
  ctx.beginPath();
  ctx.moveTo(左, 上 + c); ctx.lineTo(左, 上); ctx.lineTo(左 + c, 上);
  ctx.moveTo(結合器.右 - c, 上); ctx.lineTo(結合器.右, 上); ctx.lineTo(結合器.右, 上 + c);
  ctx.moveTo(左, 結合器.下 - c); ctx.lineTo(左, 結合器.下); ctx.lineTo(左 + c, 結合器.下);
  ctx.moveTo(結合器.右 - c, 結合器.下); ctx.lineTo(結合器.右, 結合器.下); ctx.lineTo(結合器.右, 結合器.下 - c);
  ctx.stroke();
  ctx.restore();
}

/** 以降の描画をコンバイナ内へ限定する */
function 結合器で切る(ctx) {
  ctx.beginPath();
  ctx.rect(結合器.左, 結合器.上, 結合器.w, 結合器.h);
  ctx.clip();
}

function 線(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function 枠(ctx, x, y, w, h) {
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

/**
 * 計器の下敷きになる半透明パネル。
 * 黒ベタで塗らず、外の景色がうっすら透ける濃さにする。
 */
function パネル(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowBlur = 0;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(20, 42, 52, .46)');
  g.addColorStop(1, 'rgba(8, 22, 30, .60)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(127, 240, 208, .30)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  // 上辺だけ明るくしてガラス感を出す
  ctx.strokeStyle = 'rgba(127, 240, 208, .55)';
  線(ctx, x + 1, y + .5, x + w - 1, y + .5);
  ctx.restore();
}

/** 画面外へ出る目標の方向を示す矢印を縁に描く */
function 縁の矢印(ctx, x, y, 色) {
  const m = 16;
  const cx = Math.max(結合器.左 + m, Math.min(結合器.右 - m, x));
  const cy = Math.max(結合器.上 + m, Math.min(結合器.下 - m, y));
  const 角 = Math.atan2(y - 結合器.y, x - 結合器.x);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(角);
  ctx.fillStyle = 色;
  ctx.beginPath();
  ctx.moveTo(11, 0); ctx.lineTo(-6, 6); ctx.lineTo(-6, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------- ピッチラダー（人工水平儀） ---------- */

function 描画_ピッチラダー(ctx) {
  const cx = HUD幅 / 2;
  const cy = HUD高 / 2;
  const ppd = 度ピクセル();

  ctx.save();
  // 上辺は方位テープの帯を空ける
  ctx.beginPath();
  ctx.rect(結合器.左, 結合器.上 + 54, 結合器.w, 結合器.h - 54);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-ロール角 * Math.PI / 180);
  ctx.translate(0, ピッチ角 * ppd);

  ctx.lineWidth = 1.4;
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  // 水平線（0°）
  ctx.strokeStyle = HUD色;
  ctx.globalAlpha = .95;
  線(ctx, -190, 0, -46, 0);
  線(ctx, 46, 0, 190, 0);
  線(ctx, -46, 0, -46, 7);
  線(ctx, 46, 0, 46, 7);

  // 5度刻みのバー（上は実線、下は破線）
  for (let d = -85; d <= 85; d += 5) {
    if (d === 0) continue;
    const y = -d * ppd;
    if (Math.abs(y) > HUD高 * .78) continue;

    const 主 = (d % 10 === 0);
    const 幅 = 主 ? 132 : 74;
    ctx.globalAlpha = 主 ? .85 : .55;
    ctx.strokeStyle = d > 0 ? HUD色 : HUD暗;
    ctx.setLineDash(d < 0 ? [7, 6] : []);

    // 中央を空けて左右に引く
    線(ctx, -幅, y, -34, y);
    線(ctx, 34, y, 幅, y);
    // 端の下向き / 上向きの爪
    const 爪 = d > 0 ? 7 : -7;
    線(ctx, -幅, y, -幅, y + 爪);
    線(ctx, 幅, y, 幅, y + 爪);
    ctx.setLineDash([]);

    if (主) {
      ctx.fillStyle = d > 0 ? HUD色 : HUD暗;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.abs(d)), -幅 - 6, y);
      ctx.textAlign = 'left';
      ctx.fillText(String(Math.abs(d)), 幅 + 6, y);
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ---------- バンク角指示 ---------- */

function 描画_バンク(ctx) {
  const cx = HUD幅 / 2;
  const cy = HUD高 / 2;
  const r = Math.min(結合器.w, 結合器.h) * .40;

  ctx.save();
  ctx.strokeStyle = HUD暗;
  ctx.fillStyle = HUD色;
  ctx.lineWidth = 1.3;

  // 目盛（±60°まで）
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (-90 + d) * Math.PI / 180;
    const 長 = (d === 0) ? 13 : (Math.abs(d) % 30 === 0 ? 10 : 6);
    const x1 = cx + Math.cos(a) * r;
    const y1 = cy + Math.sin(a) * r;
    const x2 = cx + Math.cos(a) * (r + 長);
    const y2 = cy + Math.sin(a) * (r + 長);
    ctx.strokeStyle = (d === 0) ? HUD色 : HUD暗;
    線(ctx, x1, y1, x2, y2);
  }

  // 現在のバンクを示す三角
  const a = (-90 + ロール角) * Math.PI / 180;
  ctx.save();
  ctx.translate(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
  ctx.rotate(a + Math.PI / 2);
  ctx.fillStyle = Math.abs(ロール角) > 75 ? 警告色 : HUD色;
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(7, 3); ctx.lineTo(-7, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/* ---------- 方位テープ（上部） ---------- */

function 描画_方位テープ(ctx) {
  const cx = 結合器.x;
  const y = 結合器.上 + 30;
  const 幅 = Math.min(420, 結合器.w * .72);
  const 度幅 = 幅 / 90;   // 表示範囲 90°

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - 幅 / 2, y - 18, 幅, 34);
  ctx.clip();

  ctx.strokeStyle = HUD暗;
  ctx.fillStyle = HUD色;
  ctx.lineWidth = 1.2;
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const 記号 = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = -50; d <= 50; d += 5) {
    const 実角 = (Math.round(方位 / 5) * 5 + d + 360) % 360;
    const x = cx + ((実角 - 方位 + 540) % 360 - 180) * 度幅;
    if (x < cx - 幅 / 2 - 20 || x > cx + 幅 / 2 + 20) continue;
    const 主 = (実角 % 10 === 0);
    線(ctx, x, y - 12, x, y - (主 ? 3 : 7));
    if (主) {
      const t = 記号[実角] || String(実角 / 10);
      ctx.fillStyle = 記号[実角] ? ロック色 : HUD色;
      ctx.fillText(t, x, y);
    }
  }
  ctx.restore();

  // 現在方位の指針と数値
  ctx.save();
  ctx.fillStyle = HUD色;
  ctx.strokeStyle = HUD色;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, y - 20); ctx.lineTo(cx - 6, y - 27); ctx.lineTo(cx + 6, y - 27);
  ctx.closePath();
  ctx.fill();

  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const t = String(Math.round(方位)).padStart(3, '0');
  枠(ctx, cx, y + 26, 46, 20);
  ctx.fillText(t, cx, y + 19);
  ctx.restore();
}

/* ---------- 速度テープ（左） ---------- */

function 描画_速度テープ(ctx) {
  const kmh = 自機.速度 * 3.6;
  const x = 結合器.左 + 46;
  const cy = 結合器.y;
  const 高 = Math.min(250, 結合器.h * .52);
  const 目盛間隔 = 25;                   // km/h
  const px = 高 / 200;                   // 表示範囲 200km/h

  ctx.save();
  ctx.strokeStyle = HUD暗;
  ctx.lineWidth = 1.2;
  枠(ctx, x, cy, 74, 高);

  ctx.beginPath();
  ctx.rect(x - 37, cy - 高 / 2, 74, 高);
  ctx.clip();

  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const 基準 = Math.round(kmh / 目盛間隔) * 目盛間隔;
  for (let i = -6; i <= 6; i++) {
    const v = 基準 + i * 目盛間隔;
    if (v < 0) continue;
    const y = cy + (kmh - v) * px;
    const 主 = (v % 50 === 0);
    ctx.strokeStyle = HUD暗;
    線(ctx, x + 37, y, x + 37 - (主 ? 13 : 7), y);
    if (主) {
      ctx.fillStyle = HUD色;
      ctx.textAlign = 'left';
      ctx.fillText(String(v), x - 32, y);
    }
  }
  ctx.restore();

  // 現在値の窓
  ctx.save();
  ctx.strokeStyle = HUD色;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x - 37, cy - 13, 82, 26);
  ctx.fillStyle = 自機.速度 < 設定.失速速度 ? 警告色 : HUD色;
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(kmh)), x + 40, cy);
  ctx.restore();

  // 見出しと補助値（マッハ / G / スロットル）
  ctx.save();
  ctx.fillStyle = HUD暗;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('KM/H', x, cy - 高 / 2 - 8);

  ctx.textAlign = 'left';
  ctx.fillStyle = HUD色;
  ctx.font = '11px "Segoe UI", sans-serif';
  const mach = 自機.速度 / 設定.音速;
  ctx.fillText(`M ${mach.toFixed(2)}`, x - 37, cy + 高 / 2 + 18);
  ctx.fillStyle = Math.abs(G値) > 7 ? 警告色 : HUD色;
  ctx.fillText(`G ${G値.toFixed(1)}`, x - 37, cy + 高 / 2 + 34);

  // スロットル棒
  const 割合 = (自機.速度 - 設定.最低速度) / (設定.最高速度 - 設定.最低速度);
  ctx.strokeStyle = HUD暗;
  ctx.strokeRect(x - 37, cy + 高 / 2 + 44, 74, 7);
  ctx.fillStyle = HUD色;
  ctx.fillRect(x - 36, cy + 高 / 2 + 45, 72 * Math.max(0, Math.min(1, 割合)), 5);
  ctx.restore();
}

/* ---------- 高度テープ（右） ---------- */

function 描画_高度テープ(ctx) {
  const alt = 自機.pos.y;
  const x = 結合器.右 - 50;
  const cy = 結合器.y;
  const 高 = Math.min(250, 結合器.h * .52);
  const 目盛間隔 = 200;                  // m
  const px = 高 / 2000;                  // 表示範囲 2000m

  ctx.save();
  ctx.strokeStyle = HUD暗;
  ctx.lineWidth = 1.2;
  枠(ctx, x, cy, 82, 高);

  ctx.beginPath();
  ctx.rect(x - 41, cy - 高 / 2, 82, 高);
  ctx.clip();

  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const 基準 = Math.round(alt / 目盛間隔) * 目盛間隔;
  for (let i = -6; i <= 6; i++) {
    const v = 基準 + i * 目盛間隔;
    if (v < 0) continue;
    const y = cy + (alt - v) * px;
    const 主 = (v % 500 === 0);
    ctx.strokeStyle = HUD暗;
    線(ctx, x - 41, y, x - 41 + (主 ? 13 : 7), y);
    if (主) {
      ctx.fillStyle = HUD色;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), x + 36, y);
    }
  }
  ctx.restore();

  // 現在値の窓
  ctx.save();
  ctx.strokeStyle = HUD色;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x - 45, cy - 13, 86, 26);
  ctx.fillStyle = 対地高度 < 400 ? 警告色 : HUD色;
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(alt)), x + 37, cy);
  ctx.restore();

  // 見出しと補助値（対地高度 / 昇降計）
  ctx.save();
  ctx.fillStyle = HUD暗;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ALT m', x, cy - 高 / 2 - 8);

  // レーダーと重ならないよう、テープの左側へ寄せて出す
  ctx.textAlign = 'left';
  ctx.fillStyle = 対地高度 < 400 ? 警告色 : HUD色;
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillText(`R ${Math.max(0, Math.round(対地高度))}`, x - 45, cy + 高 / 2 + 18);
  ctx.fillStyle = HUD色;
  const vs = Math.round(垂直速度);
  ctx.fillText(`VS ${vs >= 0 ? '+' : ''}${vs}`, x - 45, cy + 高 / 2 + 34);
  ctx.restore();

  // 昇降計（縦棒。中央が水平）
  const bx = x + 46;
  ctx.save();
  ctx.strokeStyle = HUD暗;
  ctx.lineWidth = 1.2;
  線(ctx, bx, cy - 高 / 2, bx, cy + 高 / 2);
  for (const t of [-1, -.5, 0, .5, 1]) {
    const y = cy - t * (高 / 2);
    線(ctx, bx - 4, y, bx + 4, y);
  }
  const vsy = cy - Math.max(-1, Math.min(1, 垂直速度 / 120)) * (高 / 2);
  ctx.fillStyle = HUD色;
  ctx.beginPath();
  ctx.moveTo(bx - 8, vsy); ctx.lineTo(bx, vsy - 5); ctx.lineTo(bx, vsy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------- 速度ベクトル（進行方向マーカー） ---------- */

function 描画_速度ベクトル(ctx) {
  // 機首方向は常に画面中心なので、迎角ぶんだけ下にずらして表す
  const ppd = 度ピクセル();
  const x = HUD幅 / 2;
  const y = HUD高 / 2 + Math.max(-60, Math.min(60, (設定.初期速度 - 自機.速度) * .08 * ppd * .1));

  ctx.save();
  ctx.strokeStyle = HUD色;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = .9;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  線(ctx, x - 7, y, x - 18, y);
  線(ctx, x + 7, y, x + 18, y);
  線(ctx, x, y - 7, x, y - 15);
  ctx.restore();
}

/* ---------- 機銃照準 ---------- */

function 描画_照準(ctx) {
  const x = HUD幅 / 2;
  const y = HUD高 / 2;
  const 撃ってる = 入力.gun && !自機.機銃冷却待ち;

  ctx.save();
  ctx.strokeStyle = 撃ってる ? 警告色 : HUD色;
  ctx.lineWidth = 1.6;

  // 十字（中心を空ける）
  線(ctx, x, y - 16, x, y - 7);
  線(ctx, x, y + 7, x, y + 16);
  線(ctx, x - 16, y, x - 7, y);
  線(ctx, x + 7, y, x + 16, y);
  ctx.fillStyle = 撃ってる ? 警告色 : HUD色;
  ctx.fillRect(x - 1, y - 1, 2, 2);

  // 機銃の残弾（過熱）を円弧で表す
  const 熱 = 自機.機銃熱 / 設定.機銃過熱上限;
  ctx.beginPath();
  ctx.strokeStyle = 自機.機銃冷却待ち ? 警告色 : HUD暗;
  ctx.lineWidth = 2.4;
  ctx.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - 熱));
  ctx.stroke();
  ctx.restore();
}

/* ---------- 目標表示 ---------- */

function 描画_目標(ctx) {
  for (const 敵 of 敵一覧) {
    if (!敵.生存) continue;

    _v1.copy(敵.pos).project(camera);
    const 前方 = _v1.z < 1;
    const x = (_v1.x * .5 + .5) * HUD幅;
    const y = (-_v1.y * .5 + .5) * HUD高;
    const 距離 = 自機.pos.distanceTo(敵.pos);
    const ロック中 = (敵 === ロック対象);

    const 内側 = 前方 && x > 結合器.左 && x < 結合器.右 && y > 結合器.上 && y < 結合器.下;
    if (!内側) {
      if (ロック中) 縁の矢印(ctx, x, y, ロック色);
      continue;
    }

    // 距離に応じて枠を小さくする
    const s = Math.max(18, Math.min(70, 24000 / Math.max(距離, 120)));
    ctx.save();
    ctx.lineWidth = ロック中 ? 2 : 1.3;
    ctx.strokeStyle = ロック中 ? (ロック完了 ? 警告色 : ロック色) : HUD暗;

    // 四隅のかぎ括弧
    const h = s / 2;
    const c = s / 3.2;
    ctx.beginPath();
    ctx.moveTo(x - h, y - h + c); ctx.lineTo(x - h, y - h); ctx.lineTo(x - h + c, y - h);
    ctx.moveTo(x + h - c, y - h); ctx.lineTo(x + h, y - h); ctx.lineTo(x + h, y - h + c);
    ctx.moveTo(x - h, y + h - c); ctx.lineTo(x - h, y + h); ctx.lineTo(x - h + c, y + h);
    ctx.moveTo(x + h - c, y + h); ctx.lineTo(x + h, y + h); ctx.lineTo(x + h, y + h - c);
    ctx.stroke();

    if (ロック中) {
      // ロック進捗のリング
      ctx.beginPath();
      ctx.strokeStyle = ロック完了 ? 警告色 : ロック色;
      ctx.lineWidth = 2.2;
      const t = ロック進捗 / 設定.ロック所要;
      ctx.arc(x, y, h + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();

      // 目標データ
      ctx.fillStyle = ロック完了 ? 警告色 : ロック色;
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${(距離 / 1000).toFixed(1)}km`, x + h + 12, y - h);
      ctx.fillText(`HP ${Math.max(0, Math.round(敵.体力))}`, x + h + 12, y - h + 14);
      if (ロック完了) ctx.fillText('LOCK', x + h + 12, y - h + 28);

      // 偏差点（機銃を当てる目安）
      if (距離 < 設定.機銃射程) {
        const 到達 = 距離 / 設定.機銃弾速;
        _v2.set(0, 0, -1).applyQuaternion(敵.quat).multiplyScalar(敵.速度 * 到達);
        _v3.copy(敵.pos).add(_v2).project(camera);
        if (_v3.z < 1) {
          const lx = (_v3.x * .5 + .5) * HUD幅;
          const ly = (-_v3.y * .5 + .5) * HUD高;
          ctx.strokeStyle = HUD色;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(lx, ly, 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = .5;
          線(ctx, x, y, lx, ly);
          ctx.globalAlpha = 1;
        }
      }
    } else {
      ctx.fillStyle = HUD暗;
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${(距離 / 1000).toFixed(1)}`, x, y + h + 4);
    }
    ctx.restore();
  }
}

/* ---------- レーダー（右下） ---------- */

function 描画_レーダー(ctx) {
  const r = Math.min(74, HUD幅 * .09);
  const cx = HUD幅 - r - 22;
  const cy = HUD高 - r - 26;
  const 範囲 = 6000;

  ctx.save();
  ctx.fillStyle = 'rgba(16, 38, 48, .52)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = HUD暗;
  ctx.lineWidth = 1.2;
  for (const f of [1, .66, .33]) {
    ctx.beginPath(); ctx.arc(cx, cy, r * f, 0, Math.PI * 2); ctx.stroke();
  }
  線(ctx, cx - r, cy, cx + r, cy);
  線(ctx, cx, cy - r, cx, cy + r);

  // 前方視野の扇
  ctx.strokeStyle = 'rgba(127, 240, 208, .25)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
  ctx.closePath();
  ctx.stroke();

  // 機首を上にした相対配置
  _前.set(0, 0, -1).applyQuaternion(自機.quat);
  const 機首角 = Math.atan2(_前.x, -_前.z);
  const cos = Math.cos(-機首角);
  const sin = Math.sin(-機首角);

  for (const 敵 of 敵一覧) {
    if (!敵.生存) continue;
    const dx = 敵.pos.x - 自機.pos.x;
    const dz = 敵.pos.z - 自機.pos.z;
    if (Math.hypot(dx, dz) > 範囲) continue;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    const px = cx + (rx / 範囲) * r;
    const py = cy + (rz / 範囲) * r;
    ctx.fillStyle = (敵 === ロック対象) ? ロック色 : 警告色;
    ctx.beginPath(); ctx.arc(px, py, 3.4, 0, Math.PI * 2); ctx.fill();
    // 高度差を短い縦棒で表す
    const dy = Math.max(-12, Math.min(12, (敵.pos.y - 自機.pos.y) / 120));
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.2;
    線(ctx, px, py, px, py - dy);
  }

  // 自機
  ctx.fillStyle = HUD色;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4.5, cy + 5); ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx - 4.5, cy + 5);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = HUD暗;
  ctx.font = '9px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RDR 6km', cx, cy + r + 12);
  ctx.restore();
}

/* ---------- 武装・機体パネル（左下） ---------- */

function 描画_武装(ctx) {
  const x = 24;
  const y = HUD高 - 118;

  ctx.save();
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  パネル(ctx, x, y, 172, 96);

  ctx.fillStyle = HUD暗;
  ctx.fillText('ARMAMENT', x + 8, y + 7);

  // ミサイル残数（アイコン列）
  ctx.fillStyle = 自機.ミサイル残 > 0 ? HUD色 : 警告色;
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.fillText(`MSL ${自機.ミサイル残}`, x + 8, y + 24);
  for (let i = 0; i < 設定.ミサイル初期数; i++) {
    const bx = x + 84 + i * 11;
    ctx.fillStyle = i < 自機.ミサイル残 ? HUD色 : 'rgba(127, 240, 208, .18)';
    ctx.fillRect(bx, y + 26, 8, 10);
  }

  // 機銃（過熱バー）
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillStyle = 自機.機銃冷却待ち ? 警告色 : HUD色;
  ctx.fillText('GUN', x + 8, y + 54);
  const 残 = 1 - 自機.機銃熱 / 設定.機銃過熱上限;
  ctx.strokeStyle = HUD暗;
  ctx.strokeRect(x + 46, y + 54, 118, 8);
  ctx.fillStyle = 自機.機銃冷却待ち ? 警告色 : HUD色;
  ctx.fillRect(x + 47, y + 55, 116 * Math.max(0, 残), 6);

  // 機体耐久
  ctx.fillStyle = HUD暗;
  ctx.fillText('HULL', x + 8, y + 72);
  const 耐久割合 = Math.max(0, 自機.耐久) / 設定.機体耐久;
  ctx.strokeStyle = HUD暗;
  ctx.strokeRect(x + 46, y + 72, 118, 8);
  ctx.fillStyle = 耐久割合 > .6 ? HUD色 : (耐久割合 > .3 ? ロック色 : 警告色);
  ctx.fillRect(x + 47, y + 73, 116 * 耐久割合, 6);
  ctx.restore();
}

/* ---------- 下部計器盤（ダッシュボード上に描く） ---------- */

function 描画_下部パネル(ctx) {
  const y = HUD高 - 118;
  const x = 214;                       // ARMAMENT パネルの右隣から

  ctx.save();
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 1.2;

  // ---- エンジン出力 / 燃料 / 任務時計 ----
  パネル(ctx, x, y, 150, 96);
  ctx.fillStyle = HUD暗;
  ctx.textAlign = 'left';
  ctx.fillText('ENGINE', x + 8, y + 7);

  const 出力 = (自機.速度 - 設定.最低速度) / (設定.最高速度 - 設定.最低速度);
  // 縦棒 6 本で出力段を表す
  for (let i = 0; i < 6; i++) {
    const on = 出力 > i / 6;
    ctx.fillStyle = on ? HUD色 : 'rgba(127, 240, 208, .16)';
    ctx.fillRect(x + 8 + i * 13, y + 24 + (5 - i) * 2, 9, 18 - (5 - i) * 2);
  }
  ctx.fillStyle = HUD色;
  ctx.font = 'bold 13px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(出力 * 100)}%`, x + 142, y + 24);

  // 燃料（任務経過で減る演出。飛行には影響しない）
  const 燃料 = Math.max(0, 1 - 経過 / 600);
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD暗;
  ctx.fillText('FUEL', x + 8, y + 50);
  ctx.strokeStyle = HUD暗;
  ctx.strokeRect(x + 44, y + 50, 98, 8);
  ctx.fillStyle = 燃料 > .25 ? HUD色 : 警告色;
  ctx.fillRect(x + 45, y + 51, 96 * 燃料, 6);

  // 任務時計
  const 分 = Math.floor(経過 / 60);
  const 秒 = Math.floor(経過 % 60);
  ctx.fillStyle = HUD暗;
  ctx.fillText('T +', x + 8, y + 68);
  ctx.fillStyle = HUD色;
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.fillText(`${String(分).padStart(2, '0')}:${String(秒).padStart(2, '0')}`, x + 32, y + 64);

  // ---- G メーター（円弧） ----
  パネル(ctx, x + 166, y, 84, 96);
  パネル(ctx, x + 258, y, 84, 96);
  const gx = x + 208;
  const gy = y + 42;
  const gr = 30;
  ctx.strokeStyle = HUD暗;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(gx, gy, gr, Math.PI * .75, Math.PI * 2.25);
  ctx.stroke();
  // 目盛（-2G 〜 +10G）
  for (let g = -2; g <= 10; g += 2) {
    const t = (g + 2) / 12;
    const a = Math.PI * .75 + t * Math.PI * 1.5;
    const 長 = (g % 4 === 0) ? 7 : 4;
    線(ctx, gx + Math.cos(a) * (gr - 長), gy + Math.sin(a) * (gr - 長),
          gx + Math.cos(a) * gr, gy + Math.sin(a) * gr);
  }
  // 針
  const gt = Math.max(0, Math.min(1, (G値 + 2) / 12));
  const ga = Math.PI * .75 + gt * Math.PI * 1.5;
  ctx.strokeStyle = Math.abs(G値) > 7 ? 警告色 : HUD色;
  ctx.lineWidth = 2;
  線(ctx, gx, gy, gx + Math.cos(ga) * (gr - 6), gy + Math.sin(ga) * (gr - 6));
  ctx.fillStyle = HUD暗;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('G', gx, gy + gr - 4);
  ctx.fillStyle = Math.abs(G値) > 7 ? 警告色 : HUD色;
  ctx.font = 'bold 13px "Segoe UI", sans-serif';
  ctx.fillText(G値.toFixed(1), gx, gy + gr + 8);

  // ---- 機体ダメージ図（上から見たシルエット） ----
  const dx = x + 300;
  const dy = y + 46;
  const 割合 = Math.max(0, 自機.耐久) / 設定.機体耐久;
  const 機体色 = 割合 > .6 ? HUD色 : (割合 > .3 ? ロック色 : 警告色);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.strokeStyle = 機体色;
  ctx.fillStyle = 'rgba(127, 240, 208, .10)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -30);            // 機首
  ctx.lineTo(4, -12);
  ctx.lineTo(30, 2);             // 右主翼
  ctx.lineTo(30, 8);
  ctx.lineTo(4, 6);
  ctx.lineTo(5, 18);
  ctx.lineTo(15, 26);            // 右尾翼
  ctx.lineTo(15, 30);
  ctx.lineTo(0, 26);
  ctx.lineTo(-15, 30);
  ctx.lineTo(-15, 26);
  ctx.lineTo(-5, 18);
  ctx.lineTo(-4, 6);
  ctx.lineTo(-30, 8);
  ctx.lineTo(-30, 2);
  ctx.lineTo(-4, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = HUD暗;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('AIRFRAME', dx, y + 80);
  ctx.fillStyle = 機体色;
  ctx.font = 'bold 13px "Segoe UI", sans-serif';
  ctx.fillText(`${Math.round(割合 * 100)}%`, dx, y + 8);

  ctx.restore();
}

/* ---------- 任務情報（上部左右） ---------- */

function 描画_情報(ctx) {
  ctx.save();
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';

  // 左上：得点
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD暗;
  ctx.fillText('SCORE', 24, 20);
  ctx.fillStyle = HUD色;
  ctx.font = 'bold 20px "Segoe UI", sans-serif';
  ctx.fillText(String(得点).padStart(7, '0'), 24, 34);
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillStyle = HUD暗;
  ctx.fillText(`HIGH ${String(最高得点).padStart(7, '0')}`, 24, 58);

  // 右上：任務と残敵
  ctx.textAlign = 'right';
  const 面 = 編成表[Math.min(面番号, 編成表.length - 1)];
  ctx.fillStyle = HUD暗;
  ctx.fillText('MISSION', HUD幅 - 24, 20);
  ctx.fillStyle = HUD色;
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.fillText(面.名称, HUD幅 - 24, 33);
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillStyle = 警告色;
  ctx.fillText(`BANDITS ${敵残数()}`, HUD幅 - 24, 52);

  // 中央上：モード
  ctx.textAlign = 'center';
  ctx.fillStyle = デモ中 ? ロック色 : HUD暗;
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillText(デモ中 ? 'DEMO FLIGHT' : 'PLAYER', HUD幅 / 2, 88);
  ctx.restore();
}

/* ---------- 警告灯 ---------- */

function 描画_警告(ctx) {
  const 警告 = [];
  if (自機.速度 < 設定.失速速度) 警告.push('STALL');
  if (対地高度 < 400) 警告.push('PULL UP');
  if (被ロック) 警告.push('MISSILE ALERT');
  if (自機.機銃冷却待ち) 警告.push('GUN OVERHEAT');
  if (自機.耐久 <= 30) 警告.push('HULL CRITICAL');
  if (一時停止) 警告.push('PAUSE');
  if (!警告.length) return;

  // 点滅（PAUSE だけは常時点灯）
  const 点滅 = Math.floor(経過 * 3) % 2 === 0;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  let y = 結合器.下 - 84;
  for (const w of 警告) {
    const 常時 = (w === 'PAUSE');
    if (!常時 && !点滅) { y += 24; continue; }
    ctx.fillStyle = 'rgba(255, 60, 40, .12)';
    ctx.fillRect(HUD幅 / 2 - 88, y - 11, 176, 22);
    ctx.strokeStyle = 警告色;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(HUD幅 / 2 - 88, y - 11, 176, 22);
    ctx.fillStyle = 警告色;
    ctx.fillText(w, HUD幅 / 2, y);
    y += 24;
  }
  ctx.restore();
}

/* ---------- HUD 全体 ---------- */

function HUD描画() {
  const ctx = hudCtx;
  ctx.clearRect(0, 0, HUD幅, HUD高);
  結合器を測る();   // 視点で範囲が変わるため毎フレーム求める

  // 機内の縁は計器の表示切替に関係なく描く（機体そのものなので）
  描画_機内の縁(ctx);
  if (!HUD表示) return;

  // --- コンバイナ（HUD ガラス）本体 ---
  描画_結合器(ctx);

  ctx.save();
  ctx.shadowColor = 'rgba(127, 240, 208, .55)';
  ctx.shadowBlur = 6;

  // 飛行計器はガラスの内側だけ。外へ流れると HUD に見えない
  ctx.save();
  結合器で切る(ctx);
  描画_バンク(ctx);
  描画_方位テープ(ctx);
  描画_速度テープ(ctx);
  描画_高度テープ(ctx);
  描画_速度ベクトル(ctx);
  描画_照準(ctx);
  描画_目標(ctx);
  描画_警告(ctx);
  ctx.restore();

  // ピッチラダーは自前で切り抜く（回転前に clip する必要があるため）
  描画_ピッチラダー(ctx);

  // --- 計器盤（ガラスの外・ダッシュボード上） ---
  描画_レーダー(ctx);
  描画_武装(ctx);
  描画_下部パネル(ctx);
  描画_情報(ctx);

  ctx.restore();
}

// ------------------------------------------------------------------
// ループ
// ------------------------------------------------------------------

function ループ開始() {
  if (実行中) return;
  実行中 = true;
  前回時刻 = 0;
  rafId = requestAnimationFrame(拍);
}

function ループ停止() {
  実行中 = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function 拍(時刻) {
  if (!実行中) return;
  rafId = requestAnimationFrame(拍);

  if (!前回時刻) 前回時刻 = 時刻;
  let dt = (時刻 - 前回時刻) / 1000;
  前回時刻 = 時刻;
  if (dt > 0.05) dt = 0.05;      // タブ復帰直後の巨大 dt を抑える
  if (dt <= 0) return;

  if (!一時停止) {
    経過 += dt;

    if (進行中) {
      if (デモ中) デモ操作(dt);
      自機更新(dt);
      for (const 敵 of 敵一覧) if (敵.生存) 敵AI(敵, dt);
      ロック更新(dt);
      弾更新(dt);
      ミサイル更新(dt);

      if (!デモ中) {
        無操作時間 += dt;
        if (無操作時間 > 22) 開始(true);
      }

      解説を拾う();
    }

    解説更新(dt);

    効果更新(dt);
    カメラ更新(dt);
  } else {
    経過 += dt;    // 警告の点滅は止めない
  }

  renderer.render(scene, camera);
  HUD描画();
}

// ------------------------------------------------------------------
// 入力
// ------------------------------------------------------------------

const キー対応 = {
  KeyW: 'pitchDown', KeyS: 'pitchUp',
  ArrowUp: 'pitchDown', ArrowDown: 'pitchUp',
  KeyA: 'rollLeft', KeyD: 'rollRight',
  ArrowLeft: 'rollLeft', ArrowRight: 'rollRight',
  KeyQ: 'yawLeft', KeyE: 'yawRight',
  ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown', ControlRight: 'throttleDown',
  Space: 'gun', KeyF: 'missile',
};

function 視点切替() {
  視点 = 視点 === 'cockpit' ? 'chase' : 'cockpit';
  視点遷移 = 0;
  合図(視点 === 'cockpit' ? 'COCKPIT VIEW' : 'CHASE VIEW');
}

function キー押下(ev) {
  if (ev.repeat) return;

  if (ev.code === 'KeyV') { ev.preventDefault(); 視点切替(); return; }
  if (ev.code === 'KeyH') {
    ev.preventDefault();
    HUD表示 = !HUD表示;
    dom.hud.classList.toggle('hidden', !HUD表示);
    return;
  }
  if (ev.code === 'KeyP') {
    ev.preventDefault();
    if (進行中) { 一時停止 = !一時停止; 合図(一時停止 ? 'PAUSE' : 'RESUME'); }
    return;
  }
  if (ev.code === 'Enter' && !進行中) { ev.preventDefault(); 開始(false); return; }

  const 操作 = キー対応[ev.code];
  if (!操作) return;
  ev.preventDefault();
  入力[操作] = true;
  操作された();
}

function キー解放(ev) {
  const 操作 = キー対応[ev.code];
  if (!操作) return;
  ev.preventDefault();
  入力[操作] = false;
}

function 操作された() {
  無操作時間 = 0;
  if (デモ中 && 進行中) {
    デモ中 = false;
    合図('CONTROL TAKEN');
    解説を初期化();
  }
}

function パッド設定() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  dom.touchPad.classList.add('on');

  for (const btn of dom.touchPad.querySelectorAll('.pad-btn')) {
    const 操作 = btn.dataset.key;
    const 押す = (ev) => { ev.preventDefault(); 入力[操作] = true; btn.classList.add('pressed'); 操作された(); };
    const 離す = (ev) => { ev.preventDefault(); 入力[操作] = false; btn.classList.remove('pressed'); };
    btn.addEventListener('pointerdown', 押す);
    btn.addEventListener('pointerup', 離す);
    btn.addEventListener('pointercancel', 離す);
    btn.addEventListener('pointerleave', 離す);
  }
}

// ------------------------------------------------------------------
// リサイズ・離脱
// ------------------------------------------------------------------

function リサイズ() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();

  // HUD は CSS ピクセル基準で描き、DPR ぶんだけ内部解像度を上げる
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  dom.hud.width = Math.round(w * dpr);
  dom.hud.height = Math.round(h * dpr);
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  HUD幅 = w;
  HUD高 = h;
  結合器を測る();
}

function 離脱時停止() {
  ループ停止();
  予約全解除();
  for (const k of Object.keys(入力)) 入力[k] = false;
}

// ------------------------------------------------------------------
// 起動
// ------------------------------------------------------------------

function 配線() {
  window.addEventListener('keydown', キー押下);
  window.addEventListener('keyup', キー解放);
  window.addEventListener('resize', リサイズ);
  window.addEventListener('pagehide', 離脱時停止);
  window.addEventListener('blur', () => {
    for (const k of Object.keys(入力)) 入力[k] = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) 離脱時停止();
    else if (!初期化失敗) { 前回時刻 = 0; ループ開始(); }
  });

  dom.startBtn.addEventListener('click', () => 開始(false));
  パッド設定();
}

function 起動() {
  try {
    初期化();
  } catch (e) {
    初期化失敗 = true;
    dom.loadError.textContent =
      '3D 空域を初期化できませんでした。WebGL が無効か、同梱の three.js を読み込めていません。';
    return;
  }

  dom.loadError.classList.add('hidden');
  最高得点を読む();
  初期状態へ();
  配線();

  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1') {
    開始(true);
  } else {
    ループ開始();
    予約(() => { if (!進行中) 開始(true); }, 9000);
  }
}

// ------------------------------------------------------------------
// 自動確認用 API
// ------------------------------------------------------------------

window.XDogfight = {
  getState: () => ({
    実行中, 進行中, 一時停止, デモ中, 初期化失敗,
    面番号,
    面名: 編成表[Math.min(面番号, 編成表.length - 1)].名称,
    得点, 最高得点,
    経過: Number(経過.toFixed(2)),
    視点, HUD表示,
    自機: {
      pos: [自機.pos.x, 自機.pos.y, 自機.pos.z].map((v) => Math.round(v)),
      速度: Math.round(自機.速度),
      速度kmh: Math.round(自機.速度 * 3.6),
      マッハ: Number((自機.速度 / 設定.音速).toFixed(2)),
      高度: Math.round(自機.pos.y),
      対地高度: Math.round(対地高度),
      垂直速度: Math.round(垂直速度),
      ピッチ: Math.round(ピッチ角),
      ロール: Math.round(ロール角),
      方位: Math.round(方位),
      G: Number(G値.toFixed(1)),
      無操作姿勢時間: Number(無操作姿勢時間.toFixed(2)),
      耐久: Math.round(自機.耐久),
      機銃熱: Math.round(自機.機銃熱),
      ミサイル残: 自機.ミサイル残,
      生存: 自機.生存,
    },
    敵: 敵一覧.filter((e) => e.生存).map((e) => ({
      距離: Math.round(自機.pos.distanceTo(e.pos)),
      体力: Math.round(e.体力),
    })),
    敵残数: 敵残数(),
    弾数: 弾一覧.length,
    ミサイル数: ミサイル一覧.length,
    ロック: { 対象あり: !!ロック対象, 進捗: Number(ロック進捗.toFixed(2)), 完了: ロック完了 },
    被ロック,
  }),

  start: () => 開始(false),
  demo: () => 開始(true),
  視点切替: () => { 視点切替(); return 視点; },
  視点遷移取得: () => Number(視点遷移.toFixed(2)),

  step: (秒 = 1, 刻み = 1 / 60) => {
    const 回数 = Math.max(1, Math.round(秒 / 刻み));
    for (let i = 0; i < 回数; i++) {
      if (!進行中) break;
      if (デモ中) デモ操作(刻み);
      自機更新(刻み);
      for (const 敵 of 敵一覧) if (敵.生存) 敵AI(敵, 刻み);
      ロック更新(刻み);
      弾更新(刻み);
      ミサイル更新(刻み);
      効果更新(刻み);
    }
    return window.XDogfight.getState();
  },

  設定入力: (名, 値) => { if (名 in 入力) 入力[名] = !!値; },

  probeLock: () => {
    const 敵 = 敵一覧.find((e) => e.生存);
    if (!敵) return { ok: false, 理由: '敵がいない' };
    _前.set(0, 0, -1).applyQuaternion(自機.quat);
    敵.pos.copy(自機.pos).addScaledVector(_前, 900);
    敵.obj.position.copy(敵.pos);
    for (let i = 0; i < 120; i++) ロック更新(1 / 60);
    return { ok: ロック完了, 進捗: Number(ロック進捗.toFixed(2)), 完了: ロック完了 };
  },

  /** 機銃の当たり判定を至近距離で確認する */
  probeGun: () => {
    const 敵 = 敵一覧.find((e) => e.生存);
    if (!敵) return { ok: false, 理由: '敵がいない' };
    _前.set(0, 0, -1).applyQuaternion(自機.quat);
    敵.pos.copy(自機.pos).addScaledVector(_前, 320);
    敵.obj.position.copy(敵.pos);
    const 前体力 = 敵.体力;
    入力.gun = true;
    for (let i = 0; i < 90; i++) {
      自機更新(1 / 60);
      弾更新(1 / 60);
      敵.pos.copy(自機.pos).addScaledVector(_前.set(0, 0, -1).applyQuaternion(自機.quat), 320);
    }
    入力.gun = false;
    return { 前体力, 後体力: Math.round(敵.体力), 命中: 敵.体力 < 前体力 };
  },
};

起動();
