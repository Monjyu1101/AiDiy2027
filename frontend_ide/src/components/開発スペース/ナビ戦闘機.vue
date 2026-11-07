<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// ナビ調査中の待ち時間の表示「戦闘機」。コックピットからの視点だけで、夜の森林の上を無限に飛び続ける（機体の外観は描かない）。
// 左右の地上から花火が打ち上がり、飛行コースを横切る火花の中を突っ切る。機体は少し傾いて、その分だけ曲がる。
// ←→（A/D）で傾けて旋回、押していなければランダムに傾く。↑↓（W/S）で加減速（↑・押し続けでアフターバーナー）、Spaceで横転。
// キャノピーの上枠・計器盤・HUD（青系の控えめな色。ピッチ梯子・方位・速度・高度・バンク・レーダー・ロックオン枠）を重ねる。
import {ref, onMounted, onBeforeUnmount} from 'vue';
import * as THREE from 'three';
import {navigationKeyActive, bindNavigationKeys} from './ナビ入力.js';
const emit = defineEmits(['unsupported']);
const stage = ref(), canvas = ref(), hud = ref();
const ready = ref(false);
let cleanup = () => {};

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapAngle = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
// 起伏する地形（無限に続く擬似ノイズ）。
const terrain = (x, z) => (Math.sin(x * .0113) + Math.sin(z * .0137 + 1.7) + Math.sin((x + z) * .0071 + .6) * 1.3 + Math.sin(x * .027 - z * .021) * .5) * 2.7 + 4;

const MAX_ROLL = 45 * DEG;     // 傾きの上限
const TURN_RATE = 1.05;        // 傾き（sin）に掛けて旋回角速度（rad/s）にする
const CRUISE = 90, BOOST = 150, BRAKE = 55;   // 速度（単位/秒）。表示は ×10.5 で km/h
const FLY_ABOVE = 30;
// システムリカバリー（衝突からの経過秒）：真っ黒のダウン状態で始まり、HUD最下部に「SYSTEM RECOVERY」が明滅して発動する。
// 順に 計器類 → ランプ → 燃料 → ダメージ（機体）、次に機体を正しく（姿勢を水平へ）、次にHUD表示を順に回復し、0秒の表示のあとテイクオフする。
const RECOVERY = Object.freeze({
  start: 0, blackout: 2,   // 最初の2秒は、HUD最下部の「SYSTEM RECOVERY」だけが明滅して発動を知らせる。景色は暗転せず、いつも見える（暗いのは計器盤だけ）
  gauges: [2.2, 2.9], lamps: [3.1, 3.7], fuel: [3.9, 4.8], damage: [5, 6], level: [6.2, 7.7],
  hud: [7.9, 8.4, 8.9, 9.4, 9.9],   // 1:水平線・バンク 2:方位 3:速度・高度 4:各種表示 5:レーダー・ロックオン
  ready: 10.9, takeoff: 11.3,
});
const progress = (rec, range) => clamp((rec - range[0]) / (range[1] - range[0]), 0, 1);
// テイクオフ：地面すぐ上を、速度を上げながら滑走し、一定の速度（ROTATE_SPEED）に達したら機首を上げて上昇する。森林との当たり判定はない。
const ROTATE_SPEED = 60, TAKEOFF_ACCEL = 4.5, CLIMB_RATE = 9;   // 加速をゆるやかにして、約12秒（距離400）走ってから離陸する。上昇は毎秒9まで（約8°）
// 滑走路の長さ：滑走する距離（v²/2a＝200）に、浮いて木より高く上がるまでの余裕（120）を足した範囲。木の消去もこの範囲だけ。
const RUNWAY_LENGTH = ROTATE_SPEED * ROTATE_SPEED / (2 * TAKEOFF_ACCEL) + 120;
const FUEL_START = .3, FUEL_SECONDS = 300;   // 燃料は少ない状態（タンクの30%）から始まり、巡航で約5分（300秒）で尽きて墜落する          // 地表からの飛行高度
const TREES = 3000, TILE = 720;
const GROUND = 760, SEGMENTS = 76, CELL = GROUND / SEGMENTS;
const POOL = 9000, SHELL_G = 10, SPARK_G = 4.5;   // 重力は従来の1/2（ゆっくり落ちる）
const FIREWORK_COLORS = [[1, .35, .25], [1, .8, .25], [.3, 1, .55], [.3, .8, 1], [.7, .45, 1], [1, .45, .85], [1, 1, .85]];

function glowTexture() {
  const size = 64, c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.22, 'rgba(255,255,255,.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
// 2つのジオメトリを1つへ（インスタンス用の木の形）。
function mergeGeometries(list) {
  const parts = list.map(geometry => geometry.toNonIndexed());
  const total = parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3);
  let offset = 0;
  for (const part of parts) { position.set(part.attributes.position.array, offset * 3); normal.set(part.attributes.normal.array, offset * 3); offset += part.attributes.position.count; part.dispose(); }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return merged;
}

// ---- HUD（2Dキャンバス）----
function drawHud(g, w, h, t, S) {
  g.clearRect(0, 0, w, h);
  // 被弾の赤み（外枠だけうっすら）・衝突の閃光・暗転は、計器より後ろ（世界側）にだけ重ねる。計器やHUDは赤くならない。
  const redLevel = S.crashState === 2 ? 0 : Math.max(S.hit * .62, S.hp < 35 ? .14 + .08 * Math.sin(t * 6) : 0);
  if (redLevel > .005) {
    // 外枠のすぐ近くだけを濃い赤にする（中央側へ向かって急に消える）。
    const band = Math.min(w, h) * .11, edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(255,24,24,${redLevel})`); grad.addColorStop(.45, `rgba(255,24,24,${redLevel * .28})`); grad.addColorStop(1, 'rgba(255,24,24,0)');
      g.fillStyle = grad; g.fillRect(rx, ry, rw, rh);
    };
    edge(0, 0, 0, band, 0, 0, w, band); edge(0, h, 0, h - band, 0, h - band, w, band);
    edge(0, 0, band, 0, 0, 0, band, h); edge(w, 0, w - band, 0, w - band, 0, band, h);
  }
  if (S.flash > .01) { g.fillStyle = `rgba(255,236,200,${Math.min(1, S.flash) * .85})`; g.fillRect(0, 0, w, h); }
  if (S.fade > .01) { g.fillStyle = `rgba(0,0,0,${Math.min(1, S.fade)})`; g.fillRect(0, 0, w, h); }
  const k = clamp(Math.min(w / 460, h / 340), .55, 1.8), cx = w / 2, cy = h * .47;
  const MAIN = '#4d9be6', CYAN = '#7cc4f0', AMBER = '#e3b95f', RED = '#e4606f';
  g.lineWidth = Math.max(1, 1.2 * k); g.textBaseline = 'middle'; g.textAlign = 'center';
  const font = size => `${Math.round(size * k)}px ui-monospace,"Cascadia Mono",Consolas,monospace`;
  g.font = font(10.5); g.shadowBlur = 3 * k; g.shadowColor = MAIN; g.strokeStyle = MAIN; g.fillStyle = MAIN;
  const kmh = S.speed * 10.5, mach = kmh / 1225, rollDeg = S.roll / DEG, pitchDeg = S.pitch / DEG;
  const heading = ((S.h / DEG) % 360 + 360) % 360;
  // 墜落後（衝突のあと〜復帰まで）：真っ黒のダウン状態で始め、HUDは消して、手順に沿って順に回復する。
  const down = S.crashState === 2, rec = S.rec;
  if (down && rec < RECOVERY.blackout) {
    g.shadowBlur = 0; g.globalAlpha = 1; g.textAlign = 'center'; g.textBaseline = 'middle';   // 景色は見えたまま、リカバリーの表示だけを重ねる
    drawCanopy(g, w, h, t, k, S, () => {});   // 計器盤は見えたまま（部品の表示はオフ）
    drawRecoveryLog(g, w, h, k, S);
    return;
  }
  const hudStep = down ? RECOVERY.hud.filter(at => rec >= at).length : 5;
  // HUDが表示され始めた直後は、少し左右に揺れて落ち着く（機器が立ち上がるときのリアルな揺れ）。
  const sinceHud = down ? rec - RECOVERY.hud[0] : 99, sway = sinceHud >= 0 && sinceHud < 1.8 ? Math.sin(sinceHud * 11) * 7 * k * (1 - sinceHud / 1.8) ** 2 : 0;
  g.save(); g.translate(sway + (Math.random() - .5) * 3 * k * S.rattle, (Math.random() - .5) * 2.4 * k * S.rattle);   // 離陸中のがたがたで、HUDも細かく揺れる
  const topY = h * .05 + 12 * k, blink = Math.floor(t * 4) % 2 === 0;
  if (hudStep >= 1) {

  // ピッチ梯子と水平線（機体のロールに合わせて回る）
  g.save(); g.beginPath(); g.rect(cx - 110 * k, cy - 92 * k, 220 * k, 184 * k); g.clip();
  g.translate(cx, cy); g.rotate(-S.roll);
  const ppd = 2.3 * k;
  for (let p = -50; p <= 50; p += 10) {
    const y = -(p - pitchDeg) * ppd;
    if (y < -140 * k || y > 140 * k) continue;
    if (p === 0) {
      g.beginPath(); g.moveTo(-100 * k, y); g.lineTo(-26 * k, y); g.moveTo(26 * k, y); g.lineTo(100 * k, y); g.stroke();
    } else {
      const dir = p > 0 ? 1 : -1, len = 34 * k;
      g.setLineDash(p < 0 ? [5 * k, 4 * k] : []);
      g.beginPath(); g.moveTo(-len - 14 * k, y + dir * 6 * k); g.lineTo(-len - 14 * k, y); g.lineTo(-14 * k, y);
      g.moveTo(len + 14 * k, y + dir * 6 * k); g.lineTo(len + 14 * k, y); g.lineTo(14 * k, y); g.stroke(); g.setLineDash([]);
      g.fillText(String(Math.abs(p)), -len - 28 * k, y); g.fillText(String(Math.abs(p)), len + 28 * k, y);
    }
  }
  g.restore();

  // 中央の照準（飛行経路マーカー）
  g.beginPath(); g.arc(cx, cy, 8 * k, 0, TAU); g.moveTo(cx - 20 * k, cy); g.lineTo(cx - 8 * k, cy); g.moveTo(cx + 8 * k, cy); g.lineTo(cx + 20 * k, cy); g.moveTo(cx, cy - 8 * k); g.lineTo(cx, cy - 15 * k); g.stroke();
  const ring = 48 * k + Math.sin(t * 3) * 1.5 * k;
  g.strokeStyle = CYAN; g.shadowColor = CYAN; g.beginPath(); g.arc(cx, cy, ring, -.5, .5); g.stroke(); g.beginPath(); g.arc(cx, cy, ring, Math.PI - .5, Math.PI + .5); g.stroke();
  g.strokeStyle = MAIN; g.shadowColor = MAIN;

  // バンク角スケール（上側の円弧）
  const br = 104 * k;
  g.beginPath(); g.arc(cx, cy, br, -Math.PI / 2 - 60 * DEG, -Math.PI / 2 + 60 * DEG); g.stroke();
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const ang = -Math.PI / 2 + a * DEG, len = a % 30 === 0 ? 9 * k : 5 * k;
    g.beginPath(); g.moveTo(cx + Math.cos(ang) * br, cy + Math.sin(ang) * br); g.lineTo(cx + Math.cos(ang) * (br - len), cy + Math.sin(ang) * (br - len)); g.stroke();
  }
  const pa = -Math.PI / 2 + clamp(S.roll, -75 * DEG, 75 * DEG);
  g.fillStyle = Math.abs(rollDeg) > 38 ? AMBER : MAIN;
  g.beginPath(); g.moveTo(cx + Math.cos(pa) * (br + 2 * k), cy + Math.sin(pa) * (br + 2 * k));
  g.lineTo(cx + Math.cos(pa + .06) * (br + 12 * k), cy + Math.sin(pa + .06) * (br + 12 * k)); g.lineTo(cx + Math.cos(pa - .06) * (br + 12 * k), cy + Math.sin(pa - .06) * (br + 12 * k)); g.closePath(); g.fill();
  g.fillStyle = MAIN;
  }
  if (hudStep >= 2) {
  // 方位テープ（上）
  const hy = topY + 22 * k;
  g.save(); g.beginPath(); g.rect(cx - 100 * k, hy - 10 * k, 200 * k, 34 * k); g.clip();
  const first = Math.floor((heading - 36) / 5) * 5;
  for (let d = first; d <= heading + 36; d += 5) {
    const x = cx + (d - heading) * 2.8 * k, deg = ((d % 360) + 360) % 360, major = deg % 10 === 0;
    g.beginPath(); g.moveTo(x, hy + 4 * k); g.lineTo(x, hy + (major ? 12 : 8) * k); g.stroke();
    if (major) { const cardinal = {0: 'N', 90: 'E', 180: 'S', 270: 'W'}[deg]; g.fillStyle = cardinal ? AMBER : MAIN; g.fillText(cardinal || String(deg / 10).padStart(2, '0'), x, hy + 20 * k); g.fillStyle = MAIN; }
  }
  g.restore();
  g.beginPath(); g.moveTo(cx, hy + 1 * k); g.lineTo(cx - 5 * k, hy - 6 * k); g.lineTo(cx + 5 * k, hy - 6 * k); g.closePath(); g.fill();
  g.font = font(11); g.fillText(String(Math.round(heading) % 360).padStart(3, '0') + '°', cx, hy - 11 * k); g.font = font(10.5);

  }
  if (hudStep >= 3) {
  // 速度テープ（左）／高度テープ（右）
  const tape = (x, value, step, unit, label, align) => {
    const half = 66 * k;
    g.save(); g.beginPath(); g.rect(x - 60 * k, cy - half, 120 * k, half * 2); g.clip();
    const base = Math.floor(value / step) * step;
    for (let v = base - step * 6; v <= base + step * 6; v += step) {
      const y = cy - (v - value) / step * 14 * k;
      g.beginPath(); g.moveTo(x + align * 8 * k, y); g.lineTo(x + align * (v % (step * 2) === 0 ? 16 : 12) * k, y); g.stroke();
      if (v % (step * 2) === 0 && v >= 0) { g.textAlign = align < 0 ? 'right' : 'left'; g.fillText(String(Math.round(v)), x + align * 20 * k, y); }
    }
    g.restore(); g.textAlign = 'center';
    g.strokeRect(x - 26 * k + (align < 0 ? -6 : 6) * k, cy - 8 * k, 52 * k, 16 * k);
    g.fillText(unit, x + (align < 0 ? -6 : 6) * k, cy);
    g.font = font(9); g.fillText(label, x, cy - half - 8 * k); g.font = font(10.5);
  };
  const leftX = Math.max(48 * k, cx - 158 * k), rightX = Math.min(w - 48 * k, cx + 158 * k);
  tape(leftX, kmh, 50, String(Math.round(kmh)), 'KM/H', -1);
  tape(rightX, S.y * 8, 20, String(Math.round(S.y * 8)), 'ALT m', 1);
  g.font = font(9); g.fillText('M ' + mach.toFixed(2), leftX, cy + 82 * k); g.fillText('R ' + Math.round(Math.max(0, S.y - S.ground) * 8), rightX, cy + 82 * k); g.font = font(10.5);

  }
  if (hudStep >= 4) {
  // 警告・状態表示
  g.font = font(12);
  if (!S.crashState && S.fuel < .1 && blink) { g.fillStyle = AMBER; g.shadowColor = AMBER; g.fillText(S.fuel <= 0 ? 'FUEL EMPTY' : 'LOW FUEL', cx, cy + 72 * k); }
  if (S.crashState === 1) { if (blink) { g.fillStyle = AMBER; g.shadowColor = AMBER; g.fillText('MAYDAY  MAYDAY', cx, cy - 66 * k); } }
  else if (S.sparkFlash > .05) { g.fillStyle = AMBER; g.shadowColor = AMBER; g.globalAlpha = clamp(S.sparkFlash * 1.5, 0, 1); g.fillText('SPARK  PASS', cx, cy - 66 * k); g.globalAlpha = 1; }
  else if (Math.abs(rollDeg) > 38 && blink) { g.fillStyle = AMBER; g.shadowColor = AMBER; g.fillText('BANK', cx, cy - 66 * k); }
  if (S.boost && blink) { g.fillStyle = RED; g.shadowColor = RED; g.fillText('AFTERBURNER', cx, cy + 72 * k); }
  g.fillStyle = MAIN; g.shadowColor = MAIN; g.font = font(10.5);

  // 左上・右上の表示
  g.textAlign = 'left'; g.fillText('NAVI-01  SORTIE', 12 * k, topY); g.fillStyle = CYAN; g.fillText('FIREWORKS  x∞', 12 * k, topY + 14 * k); g.fillStyle = MAIN;
  g.textAlign = 'right';
  const bars = Math.floor(t * 2.2) % 9; g.fillText('ANALYZING ' + '▮'.repeat(bars) + '▯'.repeat(8 - bars), w - 12 * k, topY);
  g.fillStyle = CYAN; g.fillText('G ' + S.g.toFixed(1) + '  THR ' + Math.round(S.throttle * 100) + '%', w - 12 * k, topY + 14 * k); g.fillStyle = MAIN; g.textAlign = 'center';

  }
  let radar = () => {};
  if (hudStep >= 5) {
  // ロックオン枠（直近の花火）
  let shown = 0;
  for (const b of S.crashState ? [] : S.targets) {   // 墜落中・墜落後はターゲットマーカーを出さない
    if (shown >= 4) break;
    if (!b.screen || b.screen.z > 1 || b.screen.z < -1) continue;
    const bx = (b.screen.x * .5 + .5) * w, by = (-b.screen.y * .5 + .5) * h;
    if (bx < 16 * k || bx > w - 16 * k || by < 40 * k || by > h * .78) continue;
    const size = (26 - Math.min(10, b.age * 5)) * k, c = size * .45;
    g.strokeStyle = AMBER; g.shadowColor = AMBER; g.fillStyle = AMBER;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(bx + sx * size, by + sy * (size - c)); g.lineTo(bx + sx * size, by + sy * size); g.lineTo(bx + sx * (size - c), by + sy * size); }
    g.stroke(); g.font = font(8.5); g.fillText('FW-' + String(b.id % 100).padStart(2, '0') + ' ' + Math.round(b.dist * 4) + 'm', bx, by + size + 9 * k);
    g.strokeStyle = MAIN; g.shadowColor = MAIN; g.fillStyle = MAIN; g.font = font(10.5); shown++;
  }

  // レーダー（左の計器盤に表示）
  radar = (rx, ry, r) => {
    g.save(); g.strokeStyle = MAIN; g.fillStyle = 'rgba(8,24,52,.5)'; g.beginPath(); g.arc(rx, ry, r, 0, TAU); g.fill(); g.stroke();
    g.globalAlpha = .55; g.beginPath(); g.arc(rx, ry, r * .5, 0, TAU); g.moveTo(rx - r, ry); g.lineTo(rx + r, ry); g.moveTo(rx, ry - r); g.lineTo(rx, ry + r); g.stroke(); g.globalAlpha = 1;
    const sweep = (t * 1.6) % TAU;
    for (let i = 0; i < 14; i++) { g.globalAlpha = (1 - i / 14) * .5; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(sweep - i * .05) * r, ry + Math.sin(sweep - i * .05) * r); g.stroke(); }
    g.globalAlpha = 1;
    const fx = Math.sin(S.h), fz = -Math.cos(S.h), rx2 = Math.cos(S.h), rz2 = Math.sin(S.h);
    for (const b of S.bursts) {
      const dx = b.x - S.x, dz = b.z - S.z, lx = dx * rx2 + dz * rz2, ly = dx * fx + dz * fz, d = Math.hypot(lx, ly), scale = Math.min(1, 300 / Math.max(d, 1)) * r / 300;
      g.fillStyle = b.age < 2.5 ? AMBER : CYAN; g.globalAlpha = clamp(1 - b.age / 5, .25, 1);
      g.beginPath(); g.arc(rx + lx * scale, ry - ly * scale, 2.2 * k, 0, TAU); g.fill();
    }
    g.globalAlpha = 1; g.fillStyle = MAIN; g.beginPath(); g.moveTo(rx, ry - 5 * k); g.lineTo(rx - 4 * k, ry + 4 * k); g.lineTo(rx + 4 * k, ry + 4 * k); g.closePath(); g.fill();
    g.restore();
  };
  }
  g.restore();
  drawCanopy(g, w, h, t, k, S, radar);
  g.shadowBlur = 0;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (down) {
    drawRecoveryLog(g, w, h, k, S);
  } else {
    // テイクオフの滑走・上昇の間（規定高度＝巡航の高さに着くまで）は、復旧済みの手順をそのまま表示し続ける。
    if (S.takeoff) drawRecoveryLog(g, w, h, k, S, 99);
    if (S.takeShow > 0) {
    g.globalAlpha = clamp(S.takeShow, 0, 1); g.fillStyle = CYAN; g.shadowColor = CYAN; g.shadowBlur = 4 * k; g.font = font(14); g.fillText('TAKEOFF', cx, cy - 66 * k); g.globalAlpha = 1; g.shadowBlur = 0;
    }
  }
}

// HUD最下部の「SYSTEM RECOVERY」表示：発動で明滅し、手順の行を順に出し、0秒の表示のあとテイクオフする。
// 鮮やかな緑（SYSTEM RECOVERY の表示はHUDの青とは別に、この緑にする）
const RECOVERY_GREEN = '#2cff6b', RECOVERY_GREEN_OFF = '#0f5a26';   // 表示はすべて鮮やかな緑（OFFは明滅の消灯側だけ）
function drawRecoveryLog(g, w, h, k, S, rec = S.rec) {
  const font = size => `${Math.round(size * k)}px ui-monospace,"Cascadia Mono",Consolas,monospace`;
  const cx = w / 2, lineH = 10.5 * k, baseY = h * .775, plateW = 190 * k, left = cx - plateW / 2 + 8 * k, right = cx + plateW / 2 - 8 * k;
  const rows = [['INSTRUMENTS', RECOVERY.gauges, null], ['LAMPS', RECOVERY.lamps, null], ['FUEL SYSTEM', RECOVERY.fuel, FUEL_START], ['DAMAGE REPAIR', RECOVERY.damage, 1], ['ATTITUDE LEVEL', RECOVERY.level, null],
    ['HUD RESTORE', [RECOVERY.hud[0], RECOVERY.ready - 1], null]];
  // 一番下の行に「SYSTEM RECOVERY」が出て、次の行が出るたびに、それまでの行が1行ぶんずり上がり、新しい行が一番下に入る（端末のように下から積み上がる）。
  const appear = at => { const p = progress(rec, [at, at + .45]); return 1 - (1 - p) ** 3; };
  const lines = [{header: true, at: RECOVERY.start}, ...rows.map(([label, range, full]) => ({label, range, full, at: range[0]}))];
  const shown = lines.map(line => appear(line.at)), bottom = baseY - .5 * lineH;
  const activating = rec < RECOVERY.blackout;
  g.save(); g.textAlign = 'left'; g.textBaseline = 'middle'; g.shadowBlur = 0;
  // 背景はなし（透明）。HUDに映し出しているように、文字だけを光らせて重ねる。
  lines.forEach((line, n) => {
    if (shown[n] <= 0) return;
    let above = 0; for (let m = n + 1; m < lines.length; m++) above += shown[m];   // 後から出た行の数（なめらかに増える）だけ、この行は上へずり上がる
    const y = bottom - above * lineH + (1 - shown[n]) * lineH * 1.6;   // 新しい行は、一番下の少し下から入ってくる
    g.globalAlpha = shown[n];
    if (line.header) {
      // 発動：最初の2秒は明滅して知らせ、手順が始まったら点灯したままにする。残り秒は表示せず、順に復旧してテイクオフする。
      const lit = !activating || Math.floor(rec * 6) % 2 === 0;
      g.font = font(10.5); g.fillStyle = lit ? RECOVERY_GREEN : RECOVERY_GREEN_OFF; g.shadowColor = RECOVERY_GREEN; g.shadowBlur = lit ? 6 * k : 0;
      g.textAlign = 'center'; g.fillText('SYSTEM RECOVERY', cx, y); g.textAlign = 'left'; g.shadowBlur = 0;   // 見出しの行だけ中央寄せ（手順の行は左寄せ）
      return;
    }
    const {label, range, full} = line, done = rec >= range[1], ratio = progress(rec, range);
    g.font = font(9); g.fillStyle = RECOVERY_GREEN; g.fillText(label, left, y);
    const detail = label === 'HUD RESTORE' ? `${rec >= 99 ? 5 : S.hudStep}/5` : full === null ? '' : `${Math.round(full * ratio * 100)}%`;
    g.textAlign = 'right'; g.fillText(done ? (detail ? detail + '  OK' : 'OK') : (detail ? detail + '  ' : '') + '▮'.repeat(Math.round(ratio * 6)) + '▯'.repeat(6 - Math.round(ratio * 6)), right, y); g.textAlign = 'left';
  });
  g.restore();
}

// 計器盤の部品の状態。通常は実際の値、リカバリー中は手順の進み具合に合わせて順に有効になる。
function panelState(S) {
  if (S.crashState !== 2) return {gauges: true, lamps: true, fuel: clamp(S.fuel, 0, 1), hull: clamp(S.hp / 100, 0, 1)};
  return {gauges: S.rec >= RECOVERY.gauges[0], lamps: S.rec >= RECOVERY.lamps[0], fuel: FUEL_START * progress(S.rec, RECOVERY.fuel), hull: progress(S.rec, RECOVERY.damage)};
}

// コックピットの枠・計器盤（固定表示）
function drawCanopy(g, w, h, t, k, S, radar) {
  const panel = panelState(S);
  // 計器盤の構造（枠・計器の文字盤・ランプ・バーの枠）はダウン中も常に見える。オフなのは各部品の表示（針・ランプの点灯・バーの量・レーダー）だけで、回復した順に点く。
  const dim = 1;
  g.save(); g.shadowBlur = 0; g.textAlign = 'center'; g.globalAlpha = dim;
  // 周辺減光
  const vig = g.createRadialGradient(w / 2, h * .47, Math.min(w, h) * .35, w / 2, h * .47, Math.max(w, h) * .75);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.62)'); g.fillStyle = vig; g.fillRect(0, 0, w, h);
  // キャノピーの骨組み（上のアーチだけ。左右のピラーは置かない）
  const frame = g.createLinearGradient(0, 0, w, 0);
  frame.addColorStop(0, '#05070b'); frame.addColorStop(.5, '#0d121a'); frame.addColorStop(1, '#05070b');
  g.fillStyle = frame; g.strokeStyle = '#2b384a'; g.lineWidth = Math.max(1, k);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h * .03); g.quadraticCurveTo(w / 2, h * .06, 0, h * .03); g.closePath(); g.fill(); g.stroke();
  // ガラスの反射
  const glass = g.createLinearGradient(w * .2, 0, w * .75, h * .5);
  glass.addColorStop(0, 'rgba(130,190,255,0)'); glass.addColorStop(.5, 'rgba(130,190,255,.07)'); glass.addColorStop(1, 'rgba(130,190,255,0)');
  g.fillStyle = glass; g.fillRect(w * .2, h * .05, w * .6, h * .5);
  // 計器盤（高さを抑え、左：レーダー／中央：小型計器と警告灯／右：エンジン表示 の3区画に整理する）
  const top = .80, mid = .83, edge = .865;
  const dash = g.createLinearGradient(0, h * top, 0, h);
  dash.addColorStop(0, '#171d29'); dash.addColorStop(1, '#06080c'); g.fillStyle = dash;
  g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * edge); g.lineTo(w * .30, h * top); g.lineTo(w * .42, h * mid); g.lineTo(w * .58, h * mid); g.lineTo(w * .70, h * top); g.lineTo(w, h * edge); g.lineTo(w, h); g.closePath(); g.fill();
  g.strokeStyle = '#3a4a60'; g.stroke();
  g.strokeStyle = 'rgba(90,160,230,.35)'; g.beginPath(); g.moveTo(w * .42, h * mid); g.lineTo(w * .58, h * mid); g.stroke();
  const mfd = (x, y, mw, mh) => { g.fillStyle = '#02070a'; g.strokeStyle = '#4b5d78'; g.lineWidth = Math.max(1.5, 1.5 * k); g.fillRect(x, y, mw, mh); g.strokeRect(x, y, mw, mh); g.lineWidth = Math.max(1, k); };
  const mfdW = w * .24, mfdH = h * .095, mfdY = h * .87, leftX = w * .08, rightX = w * .68;
  mfd(leftX, mfdY, mfdW, mfdH); mfd(rightX, mfdY, mfdW, mfdH);
  // 左：レーダー
  g.save(); g.beginPath(); g.rect(leftX, mfdY, mfdW, mfdH); g.clip();
  radar(leftX + mfdW / 2, mfdY + mfdH / 2, Math.min(mfdW, mfdH) * .46); g.restore();
  // 右：エンジン・燃料・油圧のバー
  g.font = `${Math.round(8 * k)}px ui-monospace,Consolas,monospace`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const rows = [['ENG', panel.gauges ? S.throttle : 0], ['FUEL', panel.fuel], ['HULL', panel.hull]];
  rows.forEach(([name, value], i) => {
    const y = mfdY + mfdH * (.2 + i * .3), x = rightX + 8 * k;
    g.fillStyle = '#4d9be6'; g.fillText(name, x, y); g.strokeStyle = '#2a4f80'; g.strokeRect(x + 34 * k, y - 3 * k, mfdW - 50 * k, 6 * k);
    g.globalAlpha = 1; g.fillStyle = value > .9 && name === 'ENG' ? '#e4606f' : name === 'HULL' && value < .3 ? '#e3b95f' : '#4d9be6'; g.fillRect(x + 35 * k, y - 2 * k, (mfdW - 52 * k) * value, 4 * k); g.globalAlpha = dim;
  });
  // 中央：小型計器3つ（速度・ロール・高度）と警告灯
  for (let i = -1; i <= 1; i++) {
    const x = w / 2 + i * w * .07, y = h * .925, r = Math.min(w, h) * .034;
    g.fillStyle = '#05080c'; g.strokeStyle = '#4b5d78'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
    const needle = (i === 0 ? S.roll * .9 : i < 0 ? S.speed / 160 * 4 - 2 : S.y / 80 * 4 - 2);
    if (panel.gauges) { g.globalAlpha = 1; g.strokeStyle = '#e3b95f'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(needle) * r * .85, y - Math.cos(needle) * r * .85); g.stroke(); g.globalAlpha = dim; }
  }
  g.globalAlpha = panel.lamps ? 1 : dim;
  for (let i = 0; i < 6; i++) { g.fillStyle = !panel.lamps ? '#121a26' : (i === 2 && S.boost) || (i === 4 && S.sparkFlash > .2) ? '#e4606f' : (Math.floor(t * 1.5 + i) % 5 === 0 ? '#e3b95f' : '#1f4a78'); g.fillRect(w * .44 + i * w * .02, h * .838, w * .012, h * .009); }
  g.restore();
}

onMounted(() => {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas: canvas.value, antialias: true, powerPreference: 'low-power'}); }
  catch { emit('unsupported'); return; }
  const el = stage.value, hudCanvas = hud.value, hudCtx = hudCanvas.getContext('2d');
  if (!hudCtx) { renderer.dispose(); emit('unsupported'); return; }
  ready.value = true;
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  renderer.setClearColor(0x03060e, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1226, .0068);
  const camera = new THREE.PerspectiveCamera(68, 1, .3, 1800);
  const disposables = [];
  const track = item => { disposables.push(item); return item; };
  const glowTex = track(glowTexture());

  // 空・星・月
  const sky = new THREE.Mesh(track(new THREE.SphereGeometry(900, 24, 16)), track(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 v;void main(){float h=clamp(v.y,-.2,1.);vec3 top=vec3(.010,.018,.065),mid=vec3(.035,.06,.16),hor=vec3(.22,.12,.26);vec3 c=mix(hor,mid,smoothstep(0.,.25,h));c=mix(c,top,smoothstep(.2,.9,h));c+=vec3(.05,.12,.14)*pow(1.-abs(v.y),9.)*.7;gl_FragColor=vec4(c,1.);}',
  })));
  sky.renderOrder = -2; scene.add(sky);
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { const a = rnd(0, TAU), e = Math.acos(rnd(.02, 1)), r = 860; starPos[i * 3] = Math.sin(e) * Math.cos(a) * r; starPos[i * 3 + 1] = Math.cos(e) * r; starPos[i * 3 + 2] = Math.sin(e) * Math.sin(a) * r; }
  const starGeo = track(new THREE.BufferGeometry()); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, track(new THREE.PointsMaterial({color: 0xcfe4ff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: .85, depthWrite: false})));
  stars.renderOrder = -1; scene.add(stars);
  const moon = new THREE.Sprite(track(new THREE.SpriteMaterial({map: glowTex, color: 0xbcd6ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false})));
  moon.scale.set(150, 150, 1); scene.add(moon);

  // 光源（月明かり＋花火の閃光）
  scene.add(new THREE.AmbientLight(0x6f86c0, .85), new THREE.HemisphereLight(0x7aa0ff, 0x10200f, .6));
  const moonLight = new THREE.DirectionalLight(0xb9d0ff, 1.5); moonLight.position.set(-40, 70, -30); scene.add(moonLight);
  const flashLights = [0, 1, 2].map(() => { const light = new THREE.PointLight(0xffffff, 0, 0, 2); scene.add(light); return {light, power: 0, base: 0}; });
  let flashIndex = 0;

  // 地面（起伏・頂点色）と森（インスタンス）
  const groundGeo = track(new THREE.PlaneGeometry(GROUND, GROUND, SEGMENTS, SEGMENTS)); groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position, localX = new Float32Array(gp.count), localZ = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i++) { localX[i] = gp.getX(i); localZ[i] = gp.getZ(i); }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(gp.count * 3), 3));
  const gc = groundGeo.attributes.color;
  const ground = new THREE.Mesh(groundGeo, track(new THREE.MeshStandardMaterial({vertexColors: true, roughness: .96, metalness: 0}))); ground.frustumCulled = false; scene.add(ground);
  let groundKey = '';
  function updateGround(jx, jz) {
    const cx = Math.round(jx / CELL) * CELL, cz = Math.round(jz / CELL) * CELL, key = cx + ',' + cz;
    if (key === groundKey) return; groundKey = key;
    for (let i = 0; i < gp.count; i++) {
      const wx = cx + localX[i], wz = cz + localZ[i], y = terrain(wx, wz), n = (Math.sin(wx * .07) * Math.sin(wz * .061) + 1) * .5;
      gp.setY(i, y); gc.setXYZ(i, .025 + n * .04, .075 + n * .09 + (y + 8) * .003, .04 + n * .035);
    }
    gp.needsUpdate = true; gc.needsUpdate = true; groundGeo.computeVertexNormals(); ground.position.set(cx, 0, cz);
  }
  const treeGeo = track(mergeGeometries([new THREE.ConeGeometry(2.3, 5.2, 7).translate(0, 2.6, 0), new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 5.6, 0)]));
  const treeMat = track(new THREE.MeshStandardMaterial({roughness: .9, flatShading: true}));
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREES); trees.frustumCulled = false; scene.add(trees);
  const treeX = new Float32Array(TREES), treeZ = new Float32Array(TREES), treeScale = new Float32Array(TREES);
  const treeColor = new THREE.Color();
  for (let i = 0; i < TREES; i++) {
    treeX[i] = rnd(0, TILE); treeZ[i] = rnd(0, TILE); treeScale[i] = rnd(1, 2.3);
    treeColor.setHSL(rnd(.33, .45), rnd(.35, .6), rnd(.07, .17)); trees.setColorAt(i, treeColor);
  }
  const dummy = new THREE.Object3D();
  // 滑走路（機首の向きに、前方 RUNWAY_LENGTH・幅±16）。ここの木は、機体を立て直すタイミングで消去し、テイクオフが終われば再び生やす。
  const runway = {on: false, x: 0, z: 0, fx: 0, fz: 0, rx: 0, rz: 0}, treeFactor = new Float32Array(TREES).fill(1);
  const onRunway = (x, z, margin = 0) => {
    if (!runway.on) return false;
    const dx = x - runway.x, dz = z - runway.z, along = dx * runway.fx + dz * runway.fz;
    return along > -40 && along < RUNWAY_LENGTH && Math.abs(dx * runway.rx + dz * runway.rz) < 16 + margin;
  };
  function updateTrees(jx, jz, dt = 0) {
    const ease = 1 - Math.exp(-dt * 4);
    for (let i = 0; i < TREES; i++) {
      const x = treeX[i] + TILE * Math.round((jx - treeX[i]) / TILE), z = treeZ[i] + TILE * Math.round((jz - treeZ[i]) / TILE);
      let target = 1;
      if (onRunway(x, z)) target = 0;
      if (treeFactor[i] !== target) { treeFactor[i] += (target - treeFactor[i]) * ease; if (Math.abs(target - treeFactor[i]) < .01) treeFactor[i] = target; }
      const f = Math.max(.0001, treeFactor[i]);
      dummy.position.set(x, terrain(x, z) - .3 - (1 - f) * 2, z); dummy.scale.set(treeScale[i] * f, treeScale[i] * 1.15 * f, treeScale[i] * f); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
  }

  // 花火・火花の粒子
  const pPos = new Float32Array(POOL * 3).fill(-9999), pVel = new Float32Array(POOL * 3), pCol = new Float32Array(POOL * 3), pOut = new Float32Array(POOL * 3);
  const pLife = new Float32Array(POOL), pMax = new Float32Array(POOL), pDrag = new Float32Array(POOL), pGrav = new Float32Array(POOL);
  const particleGeo = track(new THREE.BufferGeometry());
  particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); particleGeo.setAttribute('color', new THREE.BufferAttribute(pOut, 3));
  const particleMat = track(new THREE.PointsMaterial({size: 4.6, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: true, fog: false}));
  // 近づいた粒子が画面いっぱいに膨らんで白飛びしないよう、点の大きさに上限を付ける。
  particleMat.onBeforeCompile = shader => { shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, 30.0);\n#include <fog_vertex>'); };
  const particles = new THREE.Points(particleGeo, particleMat); particles.frustumCulled = false; scene.add(particles);
  let cursor = 0;
  function spawn(x, y, z, vx, vy, vz, color, life, drag, grav, boost = 1) {
    const i = cursor; cursor = (cursor + 1) % POOL;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pCol[i * 3] = color[0] * boost; pCol[i * 3 + 1] = color[1] * boost; pCol[i * 3 + 2] = color[2] * boost;
    pLife[i] = pMax[i] = life; pDrag[i] = drag; pGrav[i] = grav;
  }
  const shells = [], fountains = [], bursts = [];
  let burstId = 0, nextShell = .4, nextFountain = 1.2, sideToggle = 1;

  // 機体の状態（外観は描かず、コックピットの視点だけ）
  const st = {x: 0, z: 0, y: terrain(0, 0) + FLY_ABOVE, h: rnd(0, TAU), roll: 0, ctrl: 0, pitch: 0, speed: CRUISE, throttle: .5, vy: 0,
    autoTarget: 0, autoTimer: 1, idle: 3, barrel: 0, barrelDir: 1, nextBarrel: rnd(18, 32), shake: 0, spark: 0, g: 1, ground: 0, passCool: 0,
    boot: false, hp: 100, fuel: FUEL_START, takeoff: 0, takeT: 0, takeShow: 0, impactAt: 0, spin: 3, dive: 0, diveT: 0, diveWait: rnd(10, 16), hit: 0, sinceHit: 9, invuln: 0, crash: 0, down: false, crashDir: 1, fall: 0, crashEnd: 0, flash: 0, fade: 0};
  const input = {keys: new Set(), hover: false, hold: false};
  const fwd = new THREE.Vector3(), viewDir = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const axisA = new THREE.Vector3(), axisB = new THREE.Vector3(), axisC = new THREE.Vector3(), tilt = new THREE.Vector3(0, 1, .2);

  // 今の傾きで曲がり続けたときの、t秒後の位置と向き（傾いている間は、曲がる先へ打つために使う）
  // 速度が0（ダウン中・地上）でも、巡航速度で飛んだ場合の位置を読む（花火の打ち上げ先を決めるため）。
  function predictPath(t, speed = Math.max(st.speed, CRUISE)) {
    const rate = Math.sin(st.roll) * TURN_RATE * (CRUISE / Math.max(60, speed)), step = .1;
    let x = st.x, z = st.z, heading = st.h;
    for (let elapsed = 0, limit = Math.min(t, 12); elapsed < limit; elapsed += step) { x += Math.sin(heading) * speed * step; z -= Math.cos(heading) * speed * step; heading += rate * step; }
    return {x, z, heading};
  }
  const bankSide = () => { const bank = Math.sin(st.roll); return Math.abs(bank) > .12 ? Math.sign(bank) : 0; };   // 傾き約7°以上なら傾いた側（右なら+1）
  function launchShell() {
    // 炸裂するころには機体が進んでいるので、その先 70〜150 の位置で開くようにする（傾いているときは、曲がり続けた先を読む）。
    const fuse = rnd(1.9, 2.4), travel = fuse + rnd(70, 150) / Math.max(st.speed, CRUISE), path = predictPath(travel), bank = bankSide();
    // 傾いている間は、ほぼ必ず傾いた側（進む先）から打ち、その先の飛行コースへ炸裂させて、逃さない。
    if (bank && Math.random() < .9) sideToggle = bank; else sideToggle = Math.random() < .25 ? sideToggle : -sideToggle;
    const crossing = !runway.on && Math.random() < (bank ? .6 : .42);   // 滑走路が有効な間は、滑走路の上を横切る花火は上げない
    const lateral = runway.on ? sideToggle * rnd(26, 60) : crossing ? rnd(-14, 14) : sideToggle * rnd(bank ? 10 : 24, bank ? 44 : 74);
    const fx = Math.sin(path.heading), fz = -Math.cos(path.heading), rx = Math.cos(path.heading), rz = Math.sin(path.heading);
    const bx = path.x + rx * lateral, bz = path.z + rz * lateral, by = Math.max(st.y, terrain(path.x, path.z) + FLY_ABOVE * .85) + rnd(-8, 26);   // 地上・低空でも、巡航高度ぶんの高さで開く（木に隠れない）
    const offset = sideToggle * rnd(55, 95), lx = bx + rx * offset, lz = bz + rz * offset, ly = terrain(lx, lz);
    if (onRunway(bx, bz, 8) || onRunway(lx, lz, 4)) return;   // 炸裂点も打ち上げ地点も、滑走路の上には置かない
    // 炸裂点へ放物線で届く初速
    const vx = (bx - lx) / fuse, vz = (bz - lz) / fuse, vy = (by - ly + .5 * SHELL_G * fuse * fuse) / fuse;
    shells.push({x: lx, y: ly, z: lz, vx, vy, vz, t: fuse, color: pick(FIREWORK_COLORS), type: pick(['peony', 'peony', 'ring', 'willow', 'double']), trail: 0});
  }
  function burst(shell) {
    const c = shell.color, count = shell.type === 'ring' ? 100 : 130, base = shell.type === 'willow' ? 21 : 31;
    axisA.set(rnd(-1, 1), rnd(-.3, 1), rnd(-1, 1)).normalize(); axisB.crossVectors(axisA, tilt).normalize(); axisC.crossVectors(axisA, axisB);
    const alt = pick(FIREWORK_COLORS);
    for (let i = 0; i < count; i++) {
      let dx, dy, dz;
      if (shell.type === 'ring') { const a = rnd(0, TAU); tmp.copy(axisB).multiplyScalar(Math.cos(a)).addScaledVector(axisC, Math.sin(a)); dx = tmp.x; dy = tmp.y; dz = tmp.z; }
      else { const u = rnd(-1, 1), a = rnd(0, TAU), s = Math.sqrt(1 - u * u); dx = s * Math.cos(a); dy = u; dz = s * Math.sin(a); }
      const speed = base * rnd(.55, 1), color = shell.type === 'double' && i % 2 ? alt : shell.type === 'willow' ? [1, .75, .3] : c;
      spawn(shell.x, shell.y, shell.z, dx * speed, dy * speed, dz * speed, color, shell.type === 'willow' ? rnd(5.2, 7.2) : rnd(3, 4.8), shell.type === 'willow' ? .9 : 1.5, shell.type === 'willow' ? 5.5 : 3.5, 1.15);   // 燃える時間は従来の2倍
    }
    for (let i = 0; i < 24; i++) spawn(shell.x, shell.y, shell.z, rnd(-8, 8), rnd(-8, 8), rnd(-8, 8), [1, 1, .9], rnd(.5, 1.1), 2.5, 0, 1.6);
    bursts.push({x: shell.x, y: shell.y, z: shell.z, age: 0, id: ++burstId});
    if (bursts.length > 12) bursts.shift();
    const light = flashLights[flashIndex++ % flashLights.length]; light.light.color.setRGB(c[0], c[1], c[2]); light.light.position.set(shell.x, shell.y, shell.z); light.power = 1; light.base = 7000;
  }
  function launchFountain() {
    const bank = bankSide(), side = bank && Math.random() < .75 ? bank : (Math.random() < .5 ? -1 : 1), lateral = side * rnd(16, 46), path = predictPath(rnd(1.6, 2.6));
    const x = path.x + Math.cos(path.heading) * lateral, z = path.z + Math.sin(path.heading) * lateral;
    if (onRunway(x, z, 4)) return;   // 滑走路の上には噴水の花火を置かない
    fountains.push({x, y: terrain(x, z) + .5, z, life: rnd(2.6, 4.2), carry: 0, lean: -Math.sign(lateral) * rnd(.15, .5), color: pick([[1, .72, .25], [1, .5, .2], [.6, .9, 1]])});
  }

  // 機体より後ろ（進行方向に対して margin 以上後方）か。後方に回った花火・火花は即消去して描画を軽くする。
  const behind = (x, z, margin) => (x - st.x) * fwd.x + (z - st.z) * fwd.z < -margin;
  function stepFireworks(dt) {
    if (runway.on) {   // 滑走路の上の花火を消火する
      for (let i = shells.length - 1; i >= 0; i--) if (onRunway(shells[i].x, shells[i].z, 4)) shells.splice(i, 1);
      for (let i = fountains.length - 1; i >= 0; i--) if (onRunway(fountains[i].x, fountains[i].z, 4)) fountains.splice(i, 1);
      for (let i = bursts.length - 1; i >= 0; i--) if (onRunway(bursts[i].x, bursts[i].z, 8)) bursts.splice(i, 1);
    }
    nextShell -= dt; nextFountain -= dt;
    const banking = bankSide() !== 0;   // 傾いている間は、傾いた先へ打つ数を増やす
    if (nextShell <= 0) { launchShell(); if (Math.random() < (banking ? .9 : .6)) launchShell(); if (banking && Math.random() < .5) launchShell(); nextShell = rnd(.14, .4) * (banking ? .6 : 1); }
    if (nextFountain <= 0) { launchFountain(); nextFountain = rnd(.5, 1.1); }
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]; s.vy -= SHELL_G * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.t -= dt; s.trail += dt;
      while (s.trail > .016) { s.trail -= .016; spawn(s.x, s.y, s.z, rnd(-2, 2), rnd(-3, 1), rnd(-2, 2), [1, .7, .35], rnd(.7, 1.2), 1.2, 2, .85); }
      if (s.t <= 0) { burst(s); shells.splice(i, 1); }
      else if (behind(s.x, s.z, 10)) shells.splice(i, 1);
    }
    for (let i = fountains.length - 1; i >= 0; i--) {
      const f = fountains[i]; f.life -= dt; f.carry += dt * 110;
      while (f.carry >= 1) { f.carry -= 1; const a = rnd(0, TAU), spread = rnd(0, .38); spawn(f.x, f.y, f.z, Math.cos(a) * spread * 22 + f.lean * 30 * Math.cos(st.h), rnd(26, 46), Math.sin(a) * spread * 22 + f.lean * 30 * Math.sin(st.h), f.color, rnd(1.8, 3.4), .25, SPARK_G, 1.1); }
      if (f.life <= 0 || behind(f.x, f.z, 12)) fountains.splice(i, 1);
    }
    for (const b of bursts) b.age += dt;
    for (let i = bursts.length - 1; i >= 0; i--) if (bursts[i].age > 6 || behind(bursts[i].x, bursts[i].z, 10)) bursts.splice(i, 1);
    for (const f of flashLights) { f.power = Math.max(0, f.power - dt * 1.7); f.light.intensity = f.base * f.power * f.power; }
  }
  function stepParticles(dt, jx, jy, jz, nowSec) {
    let near = 0;
    for (let i = 0; i < POOL; i++) {
      const i3 = i * 3;
      if (pLife[i] <= 0) { pOut[i3] = pOut[i3 + 1] = pOut[i3 + 2] = 0; continue; }
      if (runway.on && pPos[i3 + 1] < jy + 25 && onRunway(pPos[i3], pPos[i3 + 2], 2)) { pLife[i] = 0; pOut[i3] = pOut[i3 + 1] = pOut[i3 + 2] = 0; continue; }   // 滑走路の上の火の粉は消火する
      if ((pPos[i3] - jx) * fwd.x + (pPos[i3 + 2] - jz) * fwd.z < -6) { pLife[i] = 0; pOut[i3] = pOut[i3 + 1] = pOut[i3 + 2] = 0; continue; }
      pLife[i] -= dt;
      const drag = Math.exp(-pDrag[i] * dt);
      pVel[i3] *= drag; pVel[i3 + 1] = pVel[i3 + 1] * drag - pGrav[i] * dt; pVel[i3 + 2] *= drag;
      pPos[i3] += pVel[i3] * dt; pPos[i3 + 1] += pVel[i3 + 1] * dt; pPos[i3 + 2] += pVel[i3 + 2] * dt;
      const f = Math.max(0, pLife[i] / pMax[i]), twinkle = .75 + .25 * Math.sin(nowSec * 38 + i), fade = Math.pow(f, .7) * twinkle;
      const dx = pPos[i3] - jx, dy = pPos[i3 + 1] - jy, dz = pPos[i3 + 2] - jz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 49) near++;
      const gain = .85 * clamp(Math.sqrt(d2) / 70, .06, 1);
      pOut[i3] = pCol[i3] * fade * gain; pOut[i3 + 1] = pCol[i3 + 1] * fade * gain; pOut[i3 + 2] = pCol[i3 + 2] * fade * gain;
    }
    st.passCool = Math.max(0, st.passCool - dt);
    if (near > 8 && !st.passCool) {
      st.passCool = .3;   // 自分で出した火花に反応し続けないよう、間隔を空ける
      st.spark = 1; st.shake = Math.max(st.shake, reduced ? 0 : .3);
      // 花火に当たるとダメージ。ダメージが一定を超えると墜落する（墜落中・復帰直後の数秒は当たらない）。
      // テイクオフ中（規定高度＝巡航の高さに着くまで）は当たり判定なし。ダメージは従来の3倍。
      if (!st.crash && !st.takeoff && st.invuln <= 0) { st.hp = Math.max(0, st.hp - (1.65 + Math.min(near, 80) * .03)); st.hit = 1; st.sinceHit = 0; }
      // 火花の中を突っ切ると、後方へ流れる明るい火花が機首の前に走る。
      for (let n = 0; n < 5; n++) spawn(jx + fwd.x * 3 + rnd(-1, 1), jy + rnd(-1, 1), jz + fwd.z * 3 + rnd(-1, 1), -fwd.x * st.speed * rnd(.3, .9) + rnd(-12, 12), rnd(-8, 12), -fwd.z * st.speed * rnd(.3, .9) + rnd(-12, 12), [1, .95, .7], rnd(.3, .7), 1.4, 3, 1.6);
    }
    particleGeo.attributes.position.needsUpdate = true; particleGeo.attributes.color.needsUpdate = true;
  }

  const keyHeld = (...names) => names.some(name => input.keys.has(name));
  function startBarrel() { if (!st.barrel) { st.barrel = 1; st.barrelDir = st.ctrl >= 0 ? 1 : -1; st.nextBarrel = rnd(20, 36); } }
  function steer(dt) {
    if (st.takeoff) st.idle = 3;   // テイクオフ中は、自動で傾けず、まっすぐ滑走路の上を進む
    const dir = (keyHeld('ArrowRight', 'd', 'D') ? 1 : 0) - (keyHeld('ArrowLeft', 'a', 'A') ? 1 : 0);
    if (dir) { st.idle = 2.5; st.ctrl = clamp(st.ctrl + dir * dt * 2.4, -1, 1); }
    else {
      st.idle = Math.max(0, st.idle - dt);
      if (!st.idle) {
        st.autoTimer -= dt;
        if (st.autoTimer <= 0) { st.autoTarget = Math.random() < .22 ? 0 : rnd(-1, 1); st.autoTimer = rnd(1.4, 3.6); }
      } else st.autoTarget = 0;
      st.ctrl += (st.autoTarget - st.ctrl) * (1 - Math.exp(-dt * (st.idle ? 1.4 : .9)));
    }
    const boost = keyHeld('ArrowUp', 'w', 'W') || input.hold, brake = keyHeld('ArrowDown', 's', 'S');
    if (st.takeoff !== 1) st.speed += ((boost ? BOOST : brake ? BRAKE : CRUISE) - st.speed) * (1 - Math.exp(-dt * 1.6));   // 滑走中は別に加速する
    st.throttle += ((boost ? 1 : brake ? .15 : .5) - st.throttle) * (1 - Math.exp(-dt * 2));
    // 横転（バレルロール）：実行中は進路を保つ。操作がない間だけ、ときどき自動で行う。
    st.nextBarrel -= dt;
    if (!st.barrel && st.nextBarrel <= 0 && !st.idle) startBarrel();
    if (st.barrel) {
      st.barrel -= dt / 1.5; st.roll += st.barrelDir * TAU / 1.5 * dt;
      if (st.barrel <= 0) { st.barrel = 0; st.roll = wrapAngle(st.roll); }
    } else {
      st.roll += (st.ctrl * MAX_ROLL - st.roll) * (1 - Math.exp(-dt * 3.4));
      st.h += Math.sin(st.roll) * TURN_RATE * dt * (CRUISE / Math.max(60, st.speed));
    }
    st.g = 1 + Math.abs(Math.sin(st.roll)) * 1.4 * (st.speed / CRUISE);
    return boost;
  }

  // 墜落：制御を失って回転しながら降下 → 地面に激突（閃光・爆発）→ 暗転して数秒後に復帰する。
  function startCrash() { st.takeoff = 0; st.spin = 3; st.crash = .001; st.down = false; st.crashDir = Math.random() < .5 ? -1 : 1; st.fall = 0; st.shake = Math.max(st.shake, .6); input.keys.clear(); input.hold = false; }
  function impact() {
    st.down = true; st.impactAt = st.crash; st.crashEnd = st.crash + RECOVERY.takeoff; st.flash = 1; st.shake = 1; st.speed *= .35; st.pitch = -.12; st.roll = wrapAngle(st.roll);
    const ex = st.x + fwd.x * 22, ez = st.z + fwd.z * 22, ey = terrain(ex, ez) + 3;
    for (let i = 0; i < 320; i++) {
      const u = rnd(-.2, 1), a = rnd(0, TAU), q = Math.sqrt(1 - u * u), speed = rnd(6, 48), hot = Math.random();
      spawn(ex, ey, ez, q * Math.cos(a) * speed, u * speed, q * Math.sin(a) * speed, hot > .7 ? [1, .95, .8] : hot > .3 ? [1, .6, .2] : [1, .3, .15], rnd(1.6, 3.4), 1.2, 3.5, 1.5);
    }
    const light = flashLights[0]; light.light.color.setRGB(1, .55, .2); light.light.position.set(ex, ey + 4, ez); light.power = 1; light.base = 24000;
  }
  function crashStep(dt) {
    st.crash += dt;
    if (!st.down) {
      // 制御を失ってきりもみ：回転がだんだん速くなり、機首も揺れながら下を向き、進路も螺旋を描いてそれる。
      st.spin = Math.min(9, st.spin + dt * 4.5);
      st.roll += st.crashDir * st.spin * dt; st.h += st.crashDir * (.3 + st.crash * .5) * dt;
      st.pitch += (-.8 + Math.sin(st.crash * 5) * .25 - st.pitch) * (1 - Math.exp(-dt * 2.5));
      st.fall += 34 * dt; st.y -= st.fall * dt; st.vy = -st.fall;
      st.speed += (75 - st.speed) * (1 - Math.exp(-dt * .8));
      const floor = terrain(st.x, st.z) + 1.6;
      if (st.y <= floor) { st.y = floor; impact(); }
    } else {
      // 真っ黒のダウン状態から、機体を正しく（姿勢を水平へ）、世界の見え方を順に戻す。
      const rec = st.crash - st.impactAt, k = 1 - Math.exp(-dt * 3);
      st.speed *= Math.exp(-dt * 3.2);
      if (rec >= RECOVERY.level[0]) { st.roll += (0 - st.roll) * (1 - Math.exp(-dt * 2.6)); st.pitch += (0 - st.pitch) * (1 - Math.exp(-dt * 2.6)); }
      st.fade += (0 - st.fade) * k;   // 景色は暗転させない（衝突の閃光が収まれば、いつも見える）
      if (st.crash >= st.crashEnd) respawn();
    }
  }
  function respawn() {
    // テイクオフ：その場（地面すぐ上）から滑り出して加速し、一定の速度で機首を上げて上昇し、巡航へ移る。
    st.crash = 0; st.down = false; st.boot = false; st.hp = 100; st.fuel = FUEL_START; st.hit = 0; st.sinceHit = 9; st.invuln = 1; st.takeT = 6; st.takeShow = 2;
    st.roll = 0; st.ctrl = 0; st.pitch = 0; st.vy = 0; st.speed = 4; st.takeoff = 1; st.idle = 3; st.autoTimer = 1; st.barrel = 0;
    st.dive = 0; st.diveT = 0; st.diveWait = rnd(12, 18); st.fade = 0; st.flash = 0;
  }

  // 起動直後：墜落後と同じ、真っ黒のダウン状態（機体は傾いたまま地面の上）から始め、システムリカバリー → テイクオフへ進む。
  function boot() {
    // 機体は正位置（水平）のまま。暗転した画面で、すぐシステムリカバリー（2秒の明滅のあと、順に復旧）が始まる。
    st.boot = true; st.crash = .001; st.down = true; st.impactAt = 0; st.crashEnd = RECOVERY.takeoff;
    st.speed = 0; st.roll = 0; st.pitch = 0; st.fade = 0; st.y = terrain(st.x, st.z) + 1.6;
  }
  boot();

  let last = 0, raf = 0, frameOwner, disposed = false, w = 0, hgt = 0, time = 0, hudTime = 0;
  const S = {x: 0, y: 0, z: 0, h: 0, roll: 0, pitch: 0, speed: CRUISE, throttle: .5, boost: false, ground: 0, sparkFlash: 0, g: 1, bursts, targets: [],
    hp: 100, fuel: FUEL_START, rec: 0, takeShow: 0, takeoff: 0, rattle: 0, hudStep: 0, boot: false, hit: 0, flash: 0, fade: 0, crashState: 0, respawnIn: 0};
  function frame(nowMs) {
    if (disposed) return;
    const dt = last ? Math.min(.05, (nowMs - last) / 1000) : 0; last = nowMs;
    const doc = el.ownerDocument, owner = doc.defaultView, rect = el.getBoundingClientRect();
    if (!doc.hidden && rect.width > 0 && rect.height > 0) {
      const step = dt * (reduced ? .6 : 1); time += step; hudTime += dt;
      const nw = Math.floor(rect.width), nh = Math.floor(rect.height), dpr = Math.min(owner.devicePixelRatio || 1, 2);
      if (nw !== w || nh !== hgt || hudCanvas.width !== Math.round(nw * dpr)) {
        w = nw; hgt = nh; renderer.setPixelRatio(dpr); renderer.setSize(w, hgt, false); camera.aspect = w / hgt; camera.updateProjectionMatrix();
        hudCanvas.width = Math.round(w * dpr); hudCanvas.height = Math.round(hgt * dpr);
      }
      const boost = st.crash ? false : steer(step);
      fwd.set(Math.sin(st.h), 0, -Math.cos(st.h));
      st.x += fwd.x * st.speed * step; st.z += fwd.z * st.speed * step;
      // 高度：前方の地形に合わせて滑らかに上下する
      if (st.crash) crashStep(step);
      else if (st.takeoff === 1) {
        // 滑走：地面すぐ上を、速度を上げながら走る。ROTATE_SPEEDに達したら機首を上げて上昇へ移る。
        st.speed += TAKEOFF_ACCEL * step;
        st.y += (terrain(st.x, st.z) + 1.6 - st.y) * (1 - Math.exp(-step * 14)); st.vy = 0; st.pitch += (0 - st.pitch) * (1 - Math.exp(-step * 6));
        if (st.speed >= ROTATE_SPEED) { st.takeoff = 2; st.vy = 6; }
      } else {
        const ahead = Math.max(terrain(st.x, st.z), terrain(st.x + fwd.x * 45, st.z + fwd.z * 45), terrain(st.x + fwd.x * 100, st.z + fwd.z * 100));
        // ときどき（20〜35秒おきに約9秒）低空へ降り、機首を下げて、地面（森）がよく見える場面を作る。
        st.diveWait -= step;
        if (!st.diveT && st.diveWait <= 0) st.diveT = .001;
        if (st.diveT) { st.diveT += step; const x = st.diveT / 9; if (x >= 1) { st.diveT = 0; st.dive = 0; st.diveWait = rnd(18, 34); } else st.dive = Math.sin(Math.PI * x) ** 2; }
        const wantY = ahead + FLY_ABOVE * (1 - .5 * st.dive) + Math.sin(time * .31) * 3.5, prevY = st.y;
        if (st.takeoff === 2) st.y += clamp((wantY - st.y) * .8, 0, CLIMB_RATE) * step;   // 上昇は毎秒9まで。急には上がらない
        else st.y += (wantY - st.y) * (1 - Math.exp(-step * 1.3));
        if (st.takeoff === 2 && st.y > wantY - 4) st.takeoff = 0;   // 巡航の高さに着いたら通常の飛行へ
        if (step > 0) { st.vy += ((st.y - prevY) / step - st.vy) * .15; const climbing = st.takeoff === 2; st.pitch += (clamp(Math.atan2(st.vy, st.speed) * (climbing ? 1 : 1.6) + (climbing ? .1 : 0) - st.dive * .28, -.7, .5) - st.pitch) * (1 - Math.exp(-step * 3)); }   // 上昇中は、進む向きより少し機首を上げ、視点も上を向く
      }
      st.ground = terrain(st.x, st.z);
            // 機体を立て直すタイミング（計器類が点灯し、HUDが点く直前）で、滑走路上の木を消去する。規定高度に着いたら再び生やす。
      if (st.down && !runway.on && st.crash - st.impactAt >= RECOVERY.level[0]) Object.assign(runway, {on: true, x: st.x, z: st.z, fx: Math.sin(st.h), fz: -Math.cos(st.h), rx: Math.cos(st.h), rz: Math.sin(st.h)});
      else if (runway.on && !st.down && !st.takeoff) runway.on = false;
      updateGround(st.x, st.z); updateTrees(st.x, st.z, step);
      stepFireworks(step); stepParticles(step, st.x, st.y, st.z, time);
      st.spark = Math.max(0, st.spark - step * 1.3); st.shake = Math.max(0, st.shake - step);
      st.hit = Math.max(0, st.hit - step * .9); st.sinceHit += step; st.invuln = Math.max(0, st.invuln - step); st.flash = Math.max(0, st.flash - step * 1.4);
      if (!st.crash) {
        // ダメージは自動回復しない。燃料は巡航で約5分で尽き（加速で速く、減速で遅く減る）、尽きたら墜落する。
        st.fuel = Math.max(0, st.fuel - step * (FUEL_START / FUEL_SECONDS) * (st.throttle >= .9 ? 1.8 : st.throttle < .3 ? .6 : 1));
        st.fade = Math.max(0, st.fade - step * .8); st.takeT = Math.max(0, st.takeT - step); st.takeShow = Math.max(0, st.takeShow - step);
        if (st.hp <= 0 || st.fuel <= 0) startCrash();
      }

      // カメラ（コックピットの目の位置）。傾きに合わせて画面も傾く。
      // 離陸中のがたがた：滑走中は速度とともに強まり、浮いて地面から離れるにつれて弱まり、完全に浮いたらなくなる。
      const lifted = clamp((st.y - st.ground - 1.6) / 2.5, 0, 1), rattle = reduced || !st.takeoff ? 0 : (1 - lifted) * (st.takeoff === 1 ? .35 + .65 * clamp(st.speed / ROTATE_SPEED, 0, 1) : 1);
      const shakeAmp = reduced ? 0 : st.shake * .55 + (boost ? .06 : 0), cp = Math.cos(st.pitch);
      camera.position.set(st.x + rnd(-1, 1) * shakeAmp * .3 + rnd(-1, 1) * .05 * rattle, st.y + rnd(-1, 1) * shakeAmp * .3 + (rnd(-1, 1) * .1 + Math.sin(time * 33) * .07 + Math.sin(time * 11.3) * .05) * rattle, st.z);
      viewDir.set(fwd.x * cp, Math.sin(st.pitch), fwd.z * cp);
      camera.up.set(0, 1, 0).applyAxisAngle(viewDir, st.roll + rnd(-1, 1) * .012 * rattle);   // 機体の傾きに合わせて画面（世界）も傾く。がたがたの間は画面も細かく傾く
      camera.lookAt(camera.position.x + viewDir.x * 50, camera.position.y + viewDir.y * 50, camera.position.z + viewDir.z * 50);
      const fov = 68 + (st.speed - CRUISE) * .12; if (Math.abs(camera.fov - fov) > .05) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sky.position.copy(camera.position); stars.position.copy(camera.position); moon.position.set(camera.position.x - 420, 300, camera.position.z - 640);
      camera.updateMatrixWorld(); renderer.render(scene, camera);

      // HUD
      S.x = st.x; S.y = st.y; S.z = st.z; S.h = st.h; S.roll = st.roll; S.pitch = st.pitch; S.speed = st.speed; S.throttle = st.throttle; S.boost = boost; S.ground = st.ground; S.sparkFlash = st.spark; S.g = st.g;
      S.hp = st.hp; S.fuel = st.fuel; S.hit = st.hit; S.flash = st.flash; S.fade = st.fade; S.crashState = !st.crash ? 0 : st.down ? 2 : 1; S.respawnIn = st.down ? Math.max(0, st.crashEnd - st.crash) : 0;
      S.rec = st.down ? st.crash - st.impactAt : 0; S.takeShow = st.takeShow; S.takeoff = st.takeoff; S.rattle = rattle; S.boot = st.boot; S.hudStep = RECOVERY.hud.filter(at => S.rec >= at).length;
      S.targets.length = 0;
      for (const b of bursts) {
        if (b.age > 3) continue;
        tmp2.set(b.x, b.y, b.z); const dist = tmp2.distanceTo(camera.position); tmp2.project(camera);
        S.targets.push({id: b.id, age: b.age, dist, screen: {x: tmp2.x, y: tmp2.y, z: tmp2.z}});
      }
      S.targets.sort((a, b) => a.dist - b.dist);
      hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0); drawHud(hudCtx, w, hgt, hudTime, S);
    }
    schedule();
  }
  function schedule() { frameOwner = el.ownerDocument.defaultView; raf = frameOwner.requestAnimationFrame(frame); }

  const onDown = e => { if (e.button === 0) input.hold = true; try { el.setPointerCapture(e.pointerId); } catch { /* 取得できなくても操縦は続く */ } };
  const onUp = () => { input.hold = false; };
  const onEnter = () => { input.hover = true; }, onLeave = () => { input.hover = false; };
  const active = e => navigationKeyActive(e, el, input.hover);
  const onKeyDown = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !active(e)) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || (e.key.length === 1 && 'awsdAWSD'.includes(e.key))) { input.keys.add(e.key); e.preventDefault(); }
    else if (!e.repeat && e.code === 'Space') { startBarrel(); e.preventDefault(); }
  };
  const onKeyUp = e => { input.keys.delete(e.key); };
  const onBlur = () => { input.keys.clear(); input.hold = false; input.hover = false; };
  el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave);
  const unbindKeys = bindNavigationKeys(el, {keydown: onKeyDown, keyup: onKeyUp, blur: onBlur, moved: () => {
    // 別ウィンドウへ移された直後も、移動先のフレームで描画を続ける。
    if (raf) { frameOwner?.cancelAnimationFrame(raf); last = 0; schedule(); }
  }});
  schedule();

  cleanup = () => {
    disposed = true; frameOwner?.cancelAnimationFrame(raf); unbindKeys();
    el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave);
    trees.dispose(); for (const item of disposables) item.dispose();
    renderer.dispose(); renderer.forceContextLoss();
  };
});
onBeforeUnmount(() => cleanup());
</script>
<template>
  <div ref="stage" class="navigation-fighter" :class="{ready}" tabindex="0" role="img" aria-label="ナビ調査中の遊び場。戦闘機のコックピットから、夜の森林の上を左右から上がる花火と火花の中を突っ切って飛び続けます。左右キーで傾けて旋回、上下キーで加減速、Spaceで横転します。">
    <canvas ref="canvas" class="navigation-fighter-world"></canvas>
    <canvas ref="hud" class="navigation-fighter-hud" aria-hidden="true"></canvas>
    <small v-if="ready" class="navigation-fighter-hint" aria-hidden="true">←→で傾けて旋回 / ↑↓で加減速 / Spaceで横転</small>
  </div>
</template>
<style>
.navigation-fighter{position:absolute;inset:0;overflow:hidden;background:#000;outline:none;touch-action:none;cursor:crosshair}
.navigation-fighter canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
.navigation-fighter-hud{pointer-events:none}
.navigation-fighter:focus-visible{box-shadow:inset 0 0 0 2px #8de8e0}
.navigation-fighter-hint{position:absolute;left:0;right:0;bottom:3px;text-align:center;color:#6f95a8;font-size:10px;pointer-events:none;text-shadow:0 0 4px #000;opacity:.8}
</style>
