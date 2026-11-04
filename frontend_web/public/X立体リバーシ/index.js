// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -*- coding: utf-8 -*-

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.179.1/build/three.module.js';

const SIZE = 4;
const PLAYERS = {
  black: { label: '青', next: 'white' },
  white: { label: '赤', next: 'black' },
};
const FACES = [
  { id: 'top', label: '上面', short: 'TOP', className: 'face-top' },
  { id: 'left', label: '左面', short: 'LEFT', className: 'face-left' },
  { id: 'front', label: '前面', short: 'FRONT', className: 'face-front' },
  { id: 'right', label: '右面', short: 'RIGHT', className: 'face-right' },
  { id: 'back', label: '後面', short: 'BACK', className: 'face-back' },
  { id: 'bottom', label: '下面', short: 'BOTTOM', className: 'face-bottom' },
];
const FACE_BY_ID = Object.fromEntries(FACES.map((face) => [face.id, face]));
const DIAGONAL_DIRS = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 1 },
];
const ORTHOGONAL_DIRS = ['N', 'S', 'E', 'W'];
const INNER_CELLS = [
  [1, 1], [1, 2],
  [2, 1], [2, 2],
];
const CHALLENGE_CLEAR_FACE_ORDER = ['front', 'right', 'back', 'left', 'top', 'bottom'];
const FACE_TRANSFORMS = {
  front:  { position: [0, 0, 2.02], rotation: [0, 0, 0] },
  back:   { position: [0, 0, -2.02], rotation: [0, Math.PI, 0] },
  right:  { position: [2.02, 0, 0], rotation: [0, Math.PI / 2, 0] },
  left:   { position: [-2.02, 0, 0], rotation: [0, -Math.PI / 2, 0] },
  top:    { position: [0, 2.02, 0], rotation: [-Math.PI / 2, 0, 0] },
  bottom: { position: [0, -2.02, 0], rotation: [Math.PI / 2, 0, 0] },
};
const FACE_CAMERA_TARGETS = {
  front:  { x: -0.36, y: 0.38 },
  back:   { x: -0.28, y: Math.PI + 0.36 },
  right:  { x: -0.32, y: -Math.PI / 2 + 0.34 },
  left:   { x: -0.32, y: Math.PI / 2 - 0.34 },
  top:    { x: 1.08, y: 0.38 },
  bottom: { x: -1.08, y: 0.38 },
};
const FACE_NORMALS = {
  front:  [0, 0, 1],
  back:   [0, 0, -1],
  right:  [1, 0, 0],
  left:   [-1, 0, 0],
  top:    [0, 1, 0],
  bottom: [0, -1, 0],
};
const FACE_VISIBLE_THRESHOLD = 0.18;

// 青石・赤石のマテリアル定義（先手青 vs 後手赤 サイバーパンク配色）
const PIECE_DEFS = {
  black: {
    color: 0x00051a,        // 深青（先手）
    emissive: 0x0055dd,     // 青発光
    emissiveIntensity: 1.2,
    roughness: 0.28,
    metalness: 0.70,
  },
  white: {
    color: 0x1a0003,        // 深紅（後手CPU）
    emissive: 0xcc1100,     // 赤熱発光
    emissiveIntensity: 1.2,
    roughness: 0.28,
    metalness: 0.70,
  },
};

// WebAudio による効果音（音源ファイル不要のシンセ音）
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  _ctx() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone({ freq = 440, freqEnd = null, dur = 0.12, type = 'sine', gain = 0.12, delay = 0 }) {
    const ctx = this._ctx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  place() { this.tone({ freq: 520, freqEnd: 780, dur: 0.14, type: 'triangle', gain: 0.16 }); }
  flip(index = 0) { this.tone({ freq: 620 + Math.min(index, 10) * 60, dur: 0.09, type: 'square', gain: 0.06 }); }
  clearPop(index = 0) { this.tone({ freq: 940 - Math.min(index, 20) * 16, freqEnd: 280, dur: 0.11, type: 'sine', gain: 0.08 }); }
  pass() { this.tone({ freq: 300, freqEnd: 210, dur: 0.22, type: 'sine', gain: 0.10 }); }
  challenge() {
    [440, 554, 659, 880].forEach((f, i) => this.tone({ freq: f, dur: 0.24, type: 'sawtooth', gain: 0.09, delay: i * 0.13 }));
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.14, delay: i * 0.15 }));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.11, delay: i * 0.16 }));
  }
  draw() {
    [440, 440].forEach((f, i) => this.tone({ freq: f, dur: 0.26, type: 'sine', gain: 0.10, delay: i * 0.22 }));
  }
}

class CubeReversi {
  constructor() {
    this.board = {};
    this.currentPlayer = 'black';
    this.mode = 'normal';
    this.gameOver = false;
    this.blackCpuEnabled = false;
    this.cpuEnabled = true;
    this.cpuThinking = false;
    this.challengeTransitioning = false;
    this.challengeTimer = null;
    this.postMoveTimer = null;
    this.cpuTimer = null;
    this.history = [];
    this.sfx = new SoundFX();
    this.lastMove = null;
    this.lastChangedKeys = new Set();
    this.alwaysShowMoves = true;
    this.logItems = [];
    this.three = null;
    this.cellMeshes = new Map();
    this.ringMeshes = new Map();
    this.pieceMeshes = new Map();
    this.flipAnimations = [];
    this.cameraMotion = null;
    this.cameraQueue = [];
    this._tmpColor = null;   // THREE.Color 再利用バッファ（GC 軽減）
    this.isDragging3d = false;
    this.dragMoved3d = false;
    this.dragStart = { x: 0, y: 0 };
    this.rotationStart = { x: 0, y: 0 };
    this.cubeRotation = { x: -0.36, y: 0.42 };

    this.cacheElements();
    this.bindEvents();
    this.init3d();
    this.reset();
  }

  cacheElements() {
    this.cubeNet = document.getElementById('cube-net');
    this.modeLabel = document.getElementById('mode-label');
    this.turnLabel = document.getElementById('turn-label');
    this.blackScore = document.getElementById('black-score');
    this.whiteScore = document.getElementById('white-score');
    this.emptyScore = document.getElementById('empty-score');
    this.message = document.getElementById('message');
    this.battleLog = document.getElementById('battle-log');
    this.blackCpuToggle = document.getElementById('black-cpu-toggle');
    this.cpuToggle = document.getElementById('cpu-toggle');
    this.soundToggle = document.getElementById('sound-toggle');
    this.canvas3d = document.getElementById('cube-3d-canvas');
    this.cubePanel = document.querySelector('.cube-3d-panel');
    this.challengeBanner = document.createElement('div');
    this.challengeBanner.className = 'challenge-banner';
    this.challengeBanner.innerHTML = `
      <div class="challenge-banner__text">
        <span>CHALLENGE MODE</span>
        <strong>チャレンジモード突入</strong>
      </div>
    `;
    this.cubePanel?.appendChild(this.challengeBanner);
    this.resultBanner = document.createElement('div');
    this.resultBanner.className = 'result-banner';
    this.cubePanel?.appendChild(this.resultBanner);
  }

  bindEvents() {
    document.getElementById('reset-btn').addEventListener('click', () => this.reset());
    document.getElementById('undo-btn').addEventListener('click', () => this.undo());
    document.getElementById('hint-btn').addEventListener('click', () => {
      this.alwaysShowMoves = !this.alwaysShowMoves;
      this.render();
      this.setMessage(this.alwaysShowMoves ? '置ける場所を常時表示します。' : '置ける場所の常時表示を止めます。');
    });
    this.cpuToggle.addEventListener('change', () => {
      this.cpuEnabled = this.cpuToggle.checked;
      this.addLog(this.cpuEnabled ? '赤CPUを有効にしました。' : '赤CPUを無効にしました。');
      this.maybeCpuTurn();
    });
    this.blackCpuToggle.addEventListener('change', () => {
      this.blackCpuEnabled = this.blackCpuToggle.checked;
      this.addLog(this.blackCpuEnabled ? '青CPUを有効にしました。' : '青CPUを無効にしました。');
      this.maybeCpuTurn();
    });
    if (this.soundToggle) {
      this.sfx.enabled = this.soundToggle.checked;
      this.soundToggle.addEventListener('change', () => {
        this.sfx.enabled = this.soundToggle.checked;
        if (this.sfx.enabled) this.sfx.place();
      });
    }
    // 自動再生制限対策: 最初のユーザー操作で AudioContext を起こす
    window.addEventListener('pointerdown', () => this.sfx._ctx(), { once: true });
  }

  reset() {
    this.board = {};
    FACES.forEach((face) => {
      this.board[face.id] = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      this.board[face.id][1][1] = 'white';
      this.board[face.id][1][2] = 'black';
      this.board[face.id][2][1] = 'black';
      this.board[face.id][2][2] = 'white';
    });
    this.currentPlayer = 'black';
    this.mode = 'normal';
    this.gameOver = false;
    this.cpuThinking = false;
    this.challengeTransitioning = false;
    if (this.challengeTimer) {
      window.clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
    if (this.postMoveTimer) {
      window.clearTimeout(this.postMoveTimer);
      this.postMoveTimer = null;
    }
    if (this.cpuTimer) {
      window.clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    this.lastMove = null;
    this.lastChangedKeys = new Set();
    this.logItems = [];
    this.history = [];
    this.flipAnimations = [];
    this.cameraQueue = [];
    this.cameraMotion = null;
    this.blackCpuEnabled = this.blackCpuToggle.checked;
    this.cpuEnabled = this.cpuToggle.checked;
    this.showChallengeBanner(false);
    this.hideResultBanner();
    // アニメーション途中のコマの姿勢が残らないよう全コマ作り直し
    [...this.pieceMeshes.keys()].forEach((key) => this.remove3dPiece(key));
    this.addLog('新しい 6 面対局を開始しました。');
    this.setMessage('青の手番です。光る〇のマスに置けます。');
    this.render();
    this.sync3dBoard();
    this.maybeCpuTurn(700);
  }

  pushHistory() {
    this.history.push({
      board: this.cloneBoard(),
      currentPlayer: this.currentPlayer,
      mode: this.mode,
      lastMove: this.lastMove,
    });
    if (this.history.length > 300) this.history.shift();
  }

  undo() {
    if (this.challengeTransitioning) return;
    if (this.history.length === 0) {
      this.setMessage('戻せる手がありません。');
      return;
    }
    let snap = this.history.pop();
    // CPU の手番の局面はスキップして、人間が指せる局面まで戻す
    const anyHuman = !this.blackCpuEnabled || !this.cpuEnabled;
    while (anyHuman && this.history.length > 0 && this.isCpuControlled(snap.currentPlayer)) {
      snap = this.history.pop();
    }
    if (this.postMoveTimer) {
      window.clearTimeout(this.postMoveTimer);
      this.postMoveTimer = null;
    }
    if (this.cpuTimer) {
      window.clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    this.flipAnimations = [];
    this.cameraQueue = [];
    this.cameraMotion = null;
    this.cpuThinking = false;
    this.gameOver = false;
    this.board = snap.board;
    this.currentPlayer = snap.currentPlayer;
    this.mode = snap.mode;
    this.lastMove = snap.lastMove;
    this.lastChangedKeys = new Set();
    this.showChallengeBanner(false);
    this.hideResultBanner();
    [...this.pieceMeshes.keys()].forEach((key) => this.remove3dPiece(key));
    this.addLog('待った! 局面を1手戻しました。');
    this.setMessage(`${PLAYERS[this.currentPlayer].label}の手番です。`);
    this.render();
    this.maybeCpuTurn(700);
  }

  render() {
    const legalKeys = new Set(this.getLegalMoves(this.currentPlayer).map((move) => this.key(move)));
    if (this.cubeNet) {
      this.cubeNet.innerHTML = '';
      FACES.forEach((face) => {
        const faceEl = document.createElement('section');
        faceEl.className = `face ${face.className}`;
        faceEl.innerHTML = `
          <div class="face-title">
            <span>${face.label}</span>
            <small>${face.short}</small>
          </div>
        `;
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (let row = 0; row < SIZE; row += 1) {
          for (let col = 0; col < SIZE; col += 1) {
            const cell = document.createElement('button');
            const move = { face: face.id, row, col };
            const key = this.key(move);
            const piece = this.board[face.id][row][col];
            cell.type = 'button';
            cell.className = 'cell';
            cell.setAttribute('aria-label', `${face.label} ${row + 1}-${col + 1}`);
            if (this.alwaysShowMoves && legalKeys.has(key)) {
              cell.classList.add(this.mode === 'challenge' ? 'challenge' : 'legal');
            }
            if (this.lastMove && this.key(this.lastMove) === key) {
              cell.classList.add('last');
            }
            if (piece) {
              const pieceEl = document.createElement('span');
              pieceEl.className = `piece ${piece}`;
              cell.appendChild(pieceEl);
            }
            cell.addEventListener('click', () => this.handleCellClick(face.id, row, col));
            grid.appendChild(cell);
          }
        }
        faceEl.appendChild(grid);
        this.cubeNet.appendChild(faceEl);
      });
    }
    this.updateStatus();
    this.renderLog();
    this.sync3dBoard();
  }

  updateStatus() {
    const score = this.countPieces();
    this.bumpScore(this.blackScore, score.black);
    this.bumpScore(this.whiteScore, score.white);
    this.emptyScore.textContent = String(score.empty);
    this.modeLabel.textContent = this.mode === 'challenge' ? 'チャレンジモード' : '通常モード';
    if (this.gameOver) {
      const result = score.black === score.white ? '引き分け' : `${score.black > score.white ? '青' : '赤'}の勝ち`;
      this.turnLabel.textContent = result;
    } else if (this.challengeTransitioning) {
      this.modeLabel.textContent = 'チャレンジモード';
      this.turnLabel.textContent = '突入中';
    } else if (this.cpuThinking) {
      this.turnLabel.textContent = 'CPU思考中';
    } else {
      this.turnLabel.textContent = `${PLAYERS[this.currentPlayer].label}の手番`;
    }
  }

  bumpScore(el, value) {
    const text = String(value);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('bump');
    void el.offsetWidth; // アニメーション再トリガー
    el.classList.add('bump');
  }

  showFlipPopup(count, player) {
    if (!this.cubePanel || count <= 0) return;
    const el = document.createElement('div');
    el.className = `flip-popup ${player}${count >= 6 ? ' big' : ''}`;
    el.textContent = count >= 6 ? `+${count} 大量反転!!` : `+${count} 反転!`;
    this.cubePanel.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  showResultBanner(winner, score) {
    if (!this.resultBanner) return;
    const label = winner === null ? '引き分け' : `${PLAYERS[winner].label}の勝ち!`;
    this.resultBanner.className = `result-banner ${winner ?? 'draw'}`;
    this.resultBanner.innerHTML = `
      <div class="result-banner__text">
        <span>GAME OVER</span>
        <strong>${label}</strong>
        <small>青 ${score.black} - 赤 ${score.white}</small>
      </div>
    `;
    window.requestAnimationFrame(() => this.resultBanner.classList.add('visible'));
  }

  hideResultBanner() {
    this.resultBanner?.classList.remove('visible');
  }

  renderLog() {
    this.battleLog.innerHTML = '';
    this.logItems.slice(-12).reverse().forEach((item) => {
      const p = document.createElement('p');
      p.textContent = item;
      this.battleLog.appendChild(p);
    });
  }

  handleCellClick(face, row, col) {
    if (this.gameOver || this.cpuThinking || this.challengeTransitioning) return;
    if (this.isCpuControlled(this.currentPlayer)) return;
    this.playMove({ face, row, col }, 'human');
  }

  playMove(move, actor) {
    const legalMoves = this.getLegalMoves(this.currentPlayer);
    const selected = legalMoves.find((item) => this.sameMove(item, move));
    if (!selected) {
      this.setMessage(this.mode === 'challenge' ? '中央24マスの空いている場所を選んでください。' : 'そこには置けません。光る〇のマスを選んでください。');
      return false;
    }

    this.pushHistory();
    const flips = selected.flips ?? [];
    const player = this.currentPlayer;
    this.sfx.place();
    this.showFlipPopup(flips.length, player);
    this.board[move.face][move.row][move.col] = player;
    flips.forEach((cell) => {
      this.board[cell.face][cell.row][cell.col] = player;
    });
    this.lastMove = move;
    this.lastChangedKeys = new Set([this.key(move), ...flips.map((cell) => this.key(cell))]);
    this.addLog(`${actor === 'cpu' ? 'CPU' : PLAYERS[player].label} が ${FACE_BY_ID[move.face].label} ${move.row + 1}-${move.col + 1} に置きました。反転 ${flips.length} 枚。`);

    this.currentPlayer = PLAYERS[player].next;

    const cpuThinkDelay = 1500;
    // モーション完了後に合法手/チャレンジ突入を判定し、その後にCPU思考を始める
    const motionDelay = this.start3dFlipAnimation([move, ...flips], player);
    this.afterMove(motionDelay, cpuThinkDelay);
    return true;
  }

  afterMove(motionDelay = 0, cpuThinkDelay = 500) {
    if (this.postMoveTimer) {
      window.clearTimeout(this.postMoveTimer);
      this.postMoveTimer = null;
    }

    const finalizeMove = () => {
      this.postMoveTimer = null;
      if (this.gameOver || this.challengeTransitioning) return;

      if (this.mode === 'normal') {
        const currentLegal = this.getLegalMoves(this.currentPlayer);
        const otherLegal = this.getLegalMoves(PLAYERS[this.currentPlayer].next);
        if (currentLegal.length === 0 && otherLegal.length === 0) {
          this.enterChallengeMode();
          return;
        }
        if (currentLegal.length === 0) {
          this.addLog(`${PLAYERS[this.currentPlayer].label} は置けないためパスしました。`);
          this.sfx.pass();
          this.currentPlayer = PLAYERS[this.currentPlayer].next;
        }
      } else if (this.countPieces().empty === 0 || this.getLegalMoves(this.currentPlayer).length === 0) {
        // チャレンジモードは中央24マスが埋まると打てる場所がなくなるので終局
        this.finishGame();
        return;
      }

      this.render();
      this.setMessage(`${PLAYERS[this.currentPlayer].label}の手番です。`);
      this.maybeCpuTurn(cpuThinkDelay);
    };

    if (motionDelay > 0) {
      this.postMoveTimer = window.setTimeout(finalizeMove, motionDelay);
    } else {
      finalizeMove();
    }
  }

  enterChallengeMode(delay = 0) {
    if (this.challengeTransitioning) return;
    this.challengeTransitioning = true;
    this.cpuThinking = false;
    this.addLog('両者とも通常手がなくなりました。チャレンジモード突入。中央24枚をクリア。');
    this.setMessage('チャレンジモード突入準備中。中央24枚を消去します。');
    this.updateStatus();
    this.showChallengeBanner(true);
    this.sfx.challenge();

    if (!this.three) {
      this.completeChallengeModeEntry();
      return;
    }

    this.cameraQueue = [];
    this.challengeTimer = window.setTimeout(() => {
      this.challengeTimer = null;
      this.focus3dCamera('front');
      this.startChallengeClearAnimation();
    }, Math.max(0, delay));
  }

  getChallengeClearCells() {
    return CHALLENGE_CLEAR_FACE_ORDER.flatMap((faceId) => (
      INNER_CELLS.map(([row, col]) => ({ face: faceId, row, col }))
    ));
  }

  showChallengeBanner(visible) {
    if (!this.challengeBanner) return;
    this.challengeBanner.classList.toggle('visible', visible);
  }

  startChallengeClearAnimation() {
    if (!this.three) {
      this.completeChallengeModeEntry();
      return;
    }

    const cells = this.getChallengeClearCells();
    const now = performance.now();
    const camDur = 500;
    const clearDur = 340;
    const gap = 70;
    let stepTime = now + 900;
    let plannedRotation = this.getCameraTargetRotation('front');

    this.cameraQueue.push({ time: now, face: 'front' });

    cells.forEach((cell, index) => {
      const key = this.key(cell);
      const piece = this.pieceMeshes.get(key);
      const needsCamera = !this.isFaceVisible(cell.face, plannedRotation);
      if (needsCamera) {
        this.cameraQueue.push({ time: stepTime, face: cell.face });
        plannedRotation = this.getCameraTargetRotation(cell.face, plannedRotation);
        stepTime += camDur;
      }
      if (piece) {
        this.flipAnimations = this.flipAnimations.filter((anim) => anim.mesh !== piece);
        this.flipAnimations.push({
          mesh: piece,
          key,
          start: stepTime,
          duration: clearDur,
          type: 'clear',
          player: piece.userData.player,
          soundIndex: index,
        });
      }
      stepTime += clearDur + gap;
    });

    this.cameraQueue.sort((a, b) => a.time - b.time);
    this.challengeTimer = window.setTimeout(() => {
      this.challengeTimer = null;
      this.completeChallengeModeEntry();
    }, Math.max(0, stepTime - now + 240));
  }

  completeChallengeModeEntry() {
    this.mode = 'challenge';
    this.challengeTransitioning = false;
    this.getChallengeClearCells().forEach((cell) => {
      this.board[cell.face][cell.row][cell.col] = null;
    });
    this.lastChangedKeys = new Set(FACES.flatMap((face) => INNER_CELLS.map(([row, col]) => this.key({ face: face.id, row, col }))));
    this.showChallengeBanner(false);
    this.setMessage('チャレンジモード: 中央24マスに置けます。反転ルールは通常モードと同じです。');
    this.render();
    this.maybeCpuTurn();
  }

  finishGame() {
    this.gameOver = true;
    const score = this.countPieces();
    const winner = score.black === score.white ? null : (score.black > score.white ? 'black' : 'white');
    const result = winner === null ? '引き分けです。' : `${PLAYERS[winner].label}の勝ちです。`;
    this.addLog(`終局: 青 ${score.black} / 赤 ${score.white}。${result}`);
    this.setMessage(`終局: ${result}`);
    this.showResultBanner(winner, score);
    if (winner === null) {
      this.sfx.draw();
    } else if (this.isCpuControlled(winner) && !this.isCpuControlled(PLAYERS[winner].next)) {
      this.sfx.lose(); // 人間側が CPU に負けたときだけ敗北音
    } else {
      this.sfx.win();
    }
    this.render();
  }

  maybeCpuTurn(delay = 500) {
    if (this.cpuTimer) {
      window.clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    if (!this.isCpuControlled(this.currentPlayer) || this.gameOver || this.challengeTransitioning) return;
    const player = this.currentPlayer;
    this.cpuThinking = true;
    this.updateStatus();
    this.cpuTimer = window.setTimeout(() => {
      this.cpuTimer = null;
      if (!this.isCpuControlled(player) || this.gameOver || this.challengeTransitioning || this.currentPlayer !== player) {
        this.cpuThinking = false;
        this.render();
        return;
      }
      const move = this.chooseCpuMove(player);
      this.cpuThinking = false;
      if (move) {
        this.playMove(move, 'cpu');
      } else {
        this.render();
      }
    }, delay);
  }

  isCpuControlled(player) {
    return player === 'black' ? this.blackCpuEnabled : this.cpuEnabled;
  }

  chooseCpuMove(player) {
    const moves = this.getLegalMoves(player);
    if (moves.length === 0) return null;
    const scored = moves.map((move) => ({ move, score: this.evaluateMove(move, player) }));
    scored.sort((a, b) => b.score - a.score);
    const bestScore = scored[0].score;
    const bestMoves = scored.filter((item) => item.score === bestScore);
    return bestMoves[Math.floor(Math.random() * bestMoves.length)].move;
  }

  evaluateMove(move, player) {
    const flips = move.flips?.length ?? 0;
    const edge = move.row === 0 || move.row === SIZE - 1 || move.col === 0 || move.col === SIZE - 1;
    const corner = (move.row === 0 || move.row === SIZE - 1) && (move.col === 0 || move.col === SIZE - 1);
    const challengeCenter = this.mode === 'challenge' && this.isChallengeCell(move);
    const boardCopy = this.cloneBoard();
    boardCopy[move.face][move.row][move.col] = player;
    (move.flips ?? []).forEach((cell) => { boardCopy[cell.face][cell.row][cell.col] = player; });
    const mobility = this.getLegalMoves(PLAYERS[player].next, boardCopy).length;
    return flips * 10 + (corner ? 30 : 0) + (edge ? 7 : 0) + (challengeCenter ? 5 : 0) - mobility * 2;
  }

  getLegalMoves(player, board = this.board) {
    const moves = [];
    FACES.forEach((face) => {
      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const move = { face: face.id, row, col };
          if (board[face.id][row][col]) continue;
          if (this.mode === 'challenge' && !this.isChallengeCell(move)) continue;
          if (this.mode === 'challenge') {
            const flips = this.collectAllFlips(move, player, board);
            moves.push({ face: face.id, row, col, flips });
            continue;
          }
          const flips = this.collectAllFlips(move, player, board);
          if (flips.length > 0) moves.push({ face: face.id, row, col, flips });
        }
      }
    });
    return moves;
  }

  collectAllFlips(move, player, board) {
    const result = [];
    DIAGONAL_DIRS.forEach((dir) => {
      result.push(...this.collectDiagonalFlips(move, player, dir, board));
    });
    ORTHOGONAL_DIRS.forEach((dir) => {
      result.push(...this.collectCubeFlips(move, player, dir, board));
    });
    return this.uniqueCells(result);
  }

  isChallengeCell(cell) {
    return cell.row > 0 && cell.row < SIZE - 1 && cell.col > 0 && cell.col < SIZE - 1;
  }

  collectDiagonalFlips(move, player, dir, board) {
    const opponent = PLAYERS[player].next;
    const line = [];
    let row = move.row + dir.dr;
    let col = move.col + dir.dc;
    while (row >= 0 && row < SIZE && col >= 0 && col < SIZE) {
      const piece = board[move.face][row][col];
      if (piece === opponent) {
        line.push({ face: move.face, row, col });
      } else if (piece === player) {
        return line.length > 0 ? line : [];
      } else {
        return [];
      }
      row += dir.dr;
      col += dir.dc;
    }
    return [];
  }

  collectCubeFlips(move, player, dir, board) {
    const opponent = PLAYERS[player].next;
    const line = [];
    let cursor = { ...move, dir };
    const seen = new Set();

    for (let step = 0; step < FACES.length * SIZE + 2; step += 1) {
      cursor = this.stepCube(cursor);
      if (!cursor) return [];
      const cursorKey = `${cursor.face}:${cursor.row}:${cursor.col}:${cursor.dir}`;
      if (seen.has(cursorKey)) return [];
      seen.add(cursorKey);
      const piece = board[cursor.face][cursor.row][cursor.col];
      if (piece === opponent) {
        line.push({ face: cursor.face, row: cursor.row, col: cursor.col });
      } else if (piece === player) {
        return line.length > 0 ? line : [];
      } else {
        return [];
      }
    }
    return [];
  }

  stepCube(cursor) {
    const { face, row, col, dir } = cursor;
    if (dir === 'N' && row > 0) return { face, row: row - 1, col, dir };
    if (dir === 'S' && row < SIZE - 1) return { face, row: row + 1, col, dir };
    if (dir === 'E' && col < SIZE - 1) return { face, row, col: col + 1, dir };
    if (dir === 'W' && col > 0) return { face, row, col: col - 1, dir };

    const last = SIZE - 1;
    const map = {
      front: {
        N: { face: 'top', row: last, col, dir: 'N' },
        S: { face: 'bottom', row: 0, col, dir: 'S' },
        E: { face: 'right', row, col: 0, dir: 'E' },
        W: { face: 'left', row, col: last, dir: 'W' },
      },
      right: {
        N: { face: 'top', row: last - col, col: last, dir: 'W' },
        S: { face: 'bottom', row: col, col: last, dir: 'W' },
        E: { face: 'back', row, col: 0, dir: 'E' },
        W: { face: 'front', row, col: last, dir: 'W' },
      },
      back: {
        N: { face: 'top', row: 0, col: last - col, dir: 'S' },
        S: { face: 'bottom', row: last, col: last - col, dir: 'N' },
        E: { face: 'left', row, col: 0, dir: 'E' },
        W: { face: 'right', row, col: last, dir: 'W' },
      },
      left: {
        N: { face: 'top', row: col, col: 0, dir: 'E' },
        S: { face: 'bottom', row: last - col, col: 0, dir: 'E' },
        E: { face: 'front', row, col: 0, dir: 'E' },
        W: { face: 'back', row, col: last, dir: 'W' },
      },
      top: {
        N: { face: 'back', row: 0, col: last - col, dir: 'S' },
        S: { face: 'front', row: 0, col, dir: 'S' },
        E: { face: 'right', row: 0, col: last - row, dir: 'S' },
        W: { face: 'left', row: 0, col: row, dir: 'S' },
      },
      bottom: {
        N: { face: 'front', row: last, col, dir: 'N' },
        S: { face: 'back', row: last, col: last - col, dir: 'N' },
        E: { face: 'right', row: last, col: row, dir: 'N' },
        W: { face: 'left', row: last, col: last - row, dir: 'N' },
      },
    };
    return map[face][dir] ?? null;
  }

  countPieces() {
    const score = { black: 0, white: 0, empty: 0 };
    FACES.forEach((face) => {
      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const piece = this.board[face.id][row][col];
          if (piece) score[piece] += 1;
          else score.empty += 1;
        }
      }
    });
    return score;
  }

  uniqueCells(cells) {
    const seen = new Set();
    return cells.filter((cell) => {
      const key = this.key(cell);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  cloneBoard() {
    const next = {};
    FACES.forEach((face) => {
      next[face.id] = this.board[face.id].map((row) => [...row]);
    });
    return next;
  }

  sameMove(a, b) {
    return a.face === b.face && a.row === b.row && a.col === b.col;
  }

  key(move) {
    return `${move.face}:${move.row}:${move.col}`;
  }

  setMessage(text) {
    this.message.textContent = text;
  }

  addLog(text) {
    this.logItems.push(text);
  }

  // ─── 3D ───────────────────────────────────────────────────

  init3d() {
    if (!this.canvas3d || !THREE.WebGLRenderer) return;

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas3d, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 8.4);

    const cube = new THREE.Group();
    scene.add(cube);

    // サイバーパンクライティング
    scene.add(new THREE.AmbientLight(0x0a1830, 1.10));
    // シアンキーライト（上前方）
    const keyLight = new THREE.DirectionalLight(0x00c8ff, 1.55);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);
    // マゼンタフィルライト（下後方）
    const fillLight = new THREE.DirectionalLight(0xaa00ff, 0.65);
    fillLight.position.set(-5, -4, 3);
    scene.add(fillLight);
    // リムライト（コマの輪郭強調）
    const rimLight = new THREE.DirectionalLight(0x0066ff, 0.45);
    rimLight.position.set(0, -2, -7);
    scene.add(rimLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    this.three = { renderer, scene, camera, cube, raycaster, pointer };
    this._tmpColor = new THREE.Color();
    this.build3dCube();
    this.bind3dControls();
    this.resize3d();
    window.addEventListener('resize', () => this.resize3d());
    this.animate3d();
  }

  build3dCube() {
    const { cube } = this.three;
    cube.clear();
    this.cellMeshes.clear();
    this.ringMeshes.clear();
    this.pieceMeshes.clear();

    // ボード面: サイバーパンク暗黒
    const boardMaterial = new THREE.MeshStandardMaterial({
      color: 0x020810,
      roughness: 0.55,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });
    // グリッド線: ネオンシアン
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.62 });
    const cellSize = 4 / SIZE;
    const gap = 0.035;

    FACES.forEach((face) => {
      const faceGroup = new THREE.Group();
      const transform = FACE_TRANSFORMS[face.id];
      faceGroup.position.set(...transform.position);
      faceGroup.rotation.set(...transform.rotation);
      cube.add(faceGroup);

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), boardMaterial.clone());
      plane.userData = { type: 'face', face: face.id };
      faceGroup.add(plane);

      for (let i = 0; i <= SIZE; i += 1) {
        const p = -2 + i * cellSize;
        const hGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2, p, 0.015), new THREE.Vector3(2, p, 0.015)]);
        const vGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p, -2, 0.015), new THREE.Vector3(p, 2, 0.015)]);
        faceGroup.add(new THREE.Line(hGeo, lineMaterial));
        faceGroup.add(new THREE.Line(vGeo, lineMaterial));
      }

      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const key = this.key({ face: face.id, row, col });
          // クリック判定用の不可視プレーン
          const cell = new THREE.Mesh(
            new THREE.PlaneGeometry(cellSize - gap, cellSize - gap),
            new THREE.MeshBasicMaterial({ color: 0x5effc6, transparent: true, opacity: 0, side: THREE.DoubleSide }),
          );
          cell.position.set(-2 + (col + 0.5) * cellSize, 2 - (row + 0.5) * cellSize, 0.025);
          cell.userData = { type: 'cell', face: face.id, row, col, highlightType: null };
          faceGroup.add(cell);
          this.cellMeshes.set(key, cell);
          const cx = -2 + (col + 0.5) * cellSize;
          const cy =  2 - (row + 0.5) * cellSize;
          // 内側ネオンリング（太め・高輝度）
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.32, 0.022, 8, 48),
            new THREE.MeshStandardMaterial({
              color: 0x0088ff,
              emissive: 0x0044ff,
              emissiveIntensity: 3.0,
              transparent: true,
              opacity: 0,
              roughness: 0.10,
              metalness: 0.90,
            }),
          );
          ring.position.set(cx, cy, 0.09);
          ring.userData = { type: 'ring', face: face.id, row, col, highlightType: null };
          faceGroup.add(ring);
          this.ringMeshes.set(key, ring);
        }
      }
    });
  }

  sync3dBoard() {
    if (!this.three) return;
    const legalKeys = new Set(this.getLegalMoves(this.currentPlayer).map((move) => this.key(move)));
    this.cellMeshes.forEach((mesh, key) => {
      const isLast = this.lastMove && this.key(this.lastMove) === key;
      const isLegal = this.alwaysShowMoves && legalKeys.has(key);
      const ht = isLast ? 'last' : isLegal ? (this.mode === 'challenge' ? 'challenge' : 'legal') : null;
      mesh.userData.highlightType = ht;
      // last マスのみ cellMesh で白フラット表示、他は常に非表示（クリック専用）
      if (ht === 'last') {
        mesh.material.color.set(0xffffff);
        mesh.material.opacity = 0.45;
      } else {
        mesh.material.opacity = 0;
      }
      // リングの highlightType も同期
      const htRing = ht === 'last' ? null : ht;
      const ring = this.ringMeshes.get(key);
      if (ring) {
        ring.userData.highlightType = htRing;
        if (!htRing) ring.material.opacity = 0;
      }
    });

    FACES.forEach((face) => {
      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const key = this.key({ face: face.id, row, col });
          const piece = this.board[face.id][row][col];
          if (!piece) {
            this.remove3dPiece(key);
          } else {
            this.ensure3dPiece({ face: face.id, row, col }, piece);
          }
        }
      }
    });
  }

  ensure3dPiece(move, player, animateDrop = true) {
    const key = this.key(move);
    const existing = this.pieceMeshes.get(key);
    const def = PIECE_DEFS[player];
    if (existing) {
      existing.userData.player = player;
      existing.material.color.set(def.color);
      existing.material.emissive.set(def.emissive);
      existing.material.emissiveIntensity = def.emissiveIntensity;
      return existing;
    }

    const cell = this.cellMeshes.get(key);
    if (!cell) return null;
    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.emissive,
      emissiveIntensity: def.emissiveIntensity,
      roughness: def.roughness,
      metalness: def.metalness,
    });
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 40), material);
    piece.position.copy(cell.position);
    piece.position.z = 0.105;
    piece.rotation.x = Math.PI / 2;
    piece.scale.setScalar(0.01);
    piece.userData = { player, scaleTarget: 1 };
    cell.parent.add(piece);
    this.pieceMeshes.set(key, piece);
    if (animateDrop) {
      this.flipAnimations.push({ mesh: piece, start: performance.now(), duration: 380, type: 'drop', player });
    }
    return piece;
  }

  remove3dPiece(key) {
    const piece = this.pieceMeshes.get(key);
    if (!piece) return;
    piece.parent?.remove(piece);
    piece.geometry.dispose();
    piece.material.dispose();
    this.pieceMeshes.delete(key);
  }

  // カメラ到着後にフリップ、1コマずつ直列実行
  start3dFlipAnimation(cells, player) {
    if (!this.three) return 0;
    const now       = performance.now();
    const camDur    = 500;   // カメラモーション時間（この後にフリップ開始）
    const placeDur  = 340;   // 置いたコマの出現時間（消去の逆モーション）
    const flipDur   = 420;   // 1コマのフリップ所要時間
    const opponent  = PLAYERS[player].next;
    let blinkStart = now;
    let stepTime = now;
    let plannedRotation = { ...this.cubeRotation };

    cells.forEach((cell, index) => {
      const key = this.key(cell);
      this.flipAnimations = this.flipAnimations.filter((a) => a.mesh !== this.pieceMeshes.get(key));

      if (index === 0) {
        // ── 置いたコマ: 見えていない面ならカメラを向けてから出現 ──
        const needsCamera = !this.isFaceVisible(cell.face, plannedRotation);
        if (needsCamera) {
          plannedRotation = this.getCameraTargetRotation(cell.face, plannedRotation);
          this.cameraQueue.push({ time: stepTime, face: cell.face });
          stepTime += camDur;
        }
        const piece = this.ensure3dPiece(cell, player, false);
        if (!piece) return;
        this.flipAnimations = this.flipAnimations.filter((a) => a.mesh !== piece);
        piece.scale.setScalar(0.02);
        piece.position.z = 0.105;
        this.flipAnimations.push({ mesh: piece, start: stepTime, duration: placeDur, type: 'place', player, fromPlayer: player });
        stepTime += placeDur;
        blinkStart = stepTime;
      } else {
        // ── 反転コマ: 見えていない面だけカメラを向けてからフリップ ──
        const needsCamera = !this.isFaceVisible(cell.face, plannedRotation);
        const camTime = stepTime;
        if (needsCamera) {
          plannedRotation = this.getCameraTargetRotation(cell.face, plannedRotation);
          this.cameraQueue.push({ time: camTime, face: cell.face });
          stepTime += camDur;
        }
        const flipStart = stepTime;

        const piece = this.pieceMeshes.get(key);
        if (!piece) return;
        const fromDef = PIECE_DEFS[opponent];
        piece.material.color.set(fromDef.color);
        piece.material.emissive.set(fromDef.emissive);
        piece.material.emissiveIntensity = fromDef.emissiveIntensity;

        // ブリンク: 全コマ同時スタート → 各自のフリップ開始まで継続
        const blinkDur = flipStart - blinkStart;
        if (blinkDur > 80) {
          this.flipAnimations.push({
            mesh: piece, start: blinkStart, duration: blinkDur,
            type: 'blink', player, fromPlayer: opponent,
          });
        }

        // フリップ: カメラ到着後
        this.flipAnimations.push({
          mesh: piece, start: flipStart, duration: flipDur,
          type: 'flip', player, fromPlayer: opponent,
          soundIndex: index - 1,
        });

        stepTime += flipDur;
      }
    });

    this.cameraQueue.sort((a, b) => a.time - b.time);
    return Math.max(300, stepTime - now);
  }

  getCameraTargetRotation(face, fromRotation = this.cubeRotation) {
    const target = FACE_CAMERA_TARGETS[face] ?? FACE_CAMERA_TARGETS.front;
    const fromX = fromRotation.x;
    const fromY = fromRotation.y;
    // Y軸は最短回転経路を取る（反対側を経由しないよう正規化）
    let dy = (target.y - fromY) % (2 * Math.PI);
    if (dy > Math.PI)  dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    // X軸は [-1.35, 1.1] のクランプ範囲内なので最短そのまま
    return { x: target.x, y: fromY + dy };
  }

  isFaceVisible(face, rotation = this.cubeRotation) {
    const normal = FACE_NORMALS[face] ?? FACE_NORMALS.front;
    return new THREE.Vector3(...normal)
      .applyEuler(new THREE.Euler(rotation.x, rotation.y, 0, 'XYZ'))
      .z > FACE_VISIBLE_THRESHOLD;
  }

  focus3dCamera(face) {
    const fromX = this.cubeRotation.x;
    const fromY = this.cubeRotation.y;
    const target = this.getCameraTargetRotation(face);
    const toX = target.x;
    const toY = target.y;
    const dy = toY - fromY;
    // すでにほぼ同じ向きなら移動不要
    if (Math.abs(toX - fromX) < 0.05 && Math.abs(dy) < 0.05) return;
    this.cameraMotion = {
      start: performance.now(),
      duration: 500,
      fromX, fromY, toX, toY,
    };
  }

  bind3dControls() {
    const canvas = this.canvas3d;
    canvas.addEventListener('pointerdown', (event) => {
      this.isDragging3d = true;
      this.dragMoved3d = false;
      this.cameraMotion = null;
      this.dragStart = { x: event.clientX, y: event.clientY };
      this.rotationStart = { ...this.cubeRotation };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.isDragging3d) return;
      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 6) this.dragMoved3d = true;
      this.cubeRotation.y = this.rotationStart.y + dx * 0.008;
      this.cubeRotation.x = Math.max(-1.35, Math.min(1.1, this.rotationStart.x + dy * 0.008));
    });
    canvas.addEventListener('pointerup', (event) => {
      this.isDragging3d = false;
      canvas.releasePointerCapture(event.pointerId);
      if (!this.dragMoved3d) {
        this.handle3dPick(event);
      }
    });
    canvas.addEventListener('pointercancel', () => {
      this.isDragging3d = false;
    });
  }

  handle3dPick(event) {
    if (!this.three || this.gameOver || this.cpuThinking || this.challengeTransitioning) return;
    if (this.isCpuControlled(this.currentPlayer)) return;
    const rect = this.canvas3d.getBoundingClientRect();
    this.three.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.three.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.three.raycaster.setFromCamera(this.three.pointer, this.three.camera);
    const hits = this.three.raycaster.intersectObjects([...this.cellMeshes.values()], false);
    const cell = hits.find((hit) => hit.object?.userData?.type === 'cell')?.object;
    if (!cell) return;
    const { face, row, col } = cell.userData;
    this.handleCellClick(face, row, col);
  }

  resize3d() {
    if (!this.three) return;
    const rect = this.canvas3d.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.three.renderer.setSize(width, height, false);
    this.three.camera.aspect = width / height;
    this.three.camera.updateProjectionMatrix();
  }

  animate3d() {
    if (!this.three) return;
    const now = performance.now();

    // ネオンリング脈動: アニメーション中は非表示
    const isAnimating = this.flipAnimations.length > 0;
    const pulse  = 0.5 + 0.5 * Math.sin(now * 0.0038);
    const isBlue = this.currentPlayer === 'black';

    this.ringMeshes.forEach((ring) => {
      const ht = ring.userData.highlightType;
      if (isAnimating || !ht) { ring.material.opacity = 0; return; }
      const phase = (ring.userData.row * SIZE + ring.userData.col) * 0.72;
      ring.position.z = 0.09 + 0.030 * Math.sin(now * 0.0024 + phase);
      ring.rotation.z = now * 0.0012;
      if (ht === 'legal') {
        if (isBlue) {
          ring.material.color.setRGB(0.0, 0.65 + pulse * 0.10, 1.0);
          ring.material.emissive.setRGB(0.0, 0.45 + pulse * 0.10, 1.0);
        } else {
          ring.material.color.setRGB(1.0, 0.02 + pulse * 0.03, 0.0);
          ring.material.emissive.setRGB(1.0, 0.01 + pulse * 0.02, 0.0);
        }
        ring.material.emissiveIntensity = 1.2 + pulse * 0.4;
        ring.material.opacity = 0.50 + pulse * 0.15;
      } else if (ht === 'challenge') {
        ring.material.color.setRGB(1.0, 0.90 + pulse * 0.08, 0.0);
        ring.material.emissive.setRGB(1.0, 0.75 + pulse * 0.08, 0.0);
        ring.material.emissiveIntensity = 1.1 + pulse * 0.35;
        ring.material.opacity = 0.48 + pulse * 0.15;
      }
    });

    // カメラキューを処理（時刻が来たものを1つずつ発火）
    if (this.cameraQueue.length > 0 && now >= this.cameraQueue[0].time) {
      this.focus3dCamera(this.cameraQueue[0].face);
      this.cameraQueue.shift();
    }

    // カメラモーション
    if (this.cameraMotion) {
      const t = Math.min(1, (now - this.cameraMotion.start) / this.cameraMotion.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.cubeRotation.x = this.cameraMotion.fromX + (this.cameraMotion.toX - this.cameraMotion.fromX) * eased;
      this.cubeRotation.y = this.cameraMotion.fromY + (this.cameraMotion.toY - this.cameraMotion.fromY) * eased;
      if (t >= 1) this.cameraMotion = null;
    }

    this.three.cube.rotation.x = this.cubeRotation.x;
    this.three.cube.rotation.y = this.cubeRotation.y;

    // フリップアニメーション
    this.flipAnimations = this.flipAnimations.filter((anim) => {
      const elapsed = now - anim.start;
      if (elapsed < 0) return true; // まだ開始前
      const t = Math.min(1, elapsed / anim.duration);
      const def = PIECE_DEFS[anim.player];
      if (anim.type === 'drop') {
        const eased = 1 - Math.pow(1 - t, 3);
        anim.mesh.scale.setScalar(eased);
      } else if (anim.type === 'place') {
        const blink = 0.5 + 0.5 * Math.sin(elapsed * 0.052);
        const eased = 1 - Math.pow(1 - t, 3);
        anim.mesh.material.color.set(def.color);
        anim.mesh.material.emissive
          .setRGB(1.0, 0.85 + blink * 0.15, 0.05)
          .lerp(this._tmpColor.set(def.emissive), eased);
        anim.mesh.material.emissiveIntensity = 4.8 - eased * (4.8 - def.emissiveIntensity);
        anim.mesh.scale.setScalar(Math.max(0.02, eased * (1 + (1 - eased) * blink * 0.18)));
        anim.mesh.position.z = 0.105 + Math.sin(t * Math.PI) * 0.18;
        if (t >= 1) {
          anim.mesh.position.z = 0.105;
          anim.mesh.scale.setScalar(1);
          anim.mesh.material.color.set(def.color);
          anim.mesh.material.emissive.set(def.emissive);
          anim.mesh.material.emissiveIntensity = def.emissiveIntensity;
        }
      } else if (anim.type === 'blink') {
        const fromDef = PIECE_DEFS[anim.fromPlayer];
        const toDef = PIECE_DEFS[anim.player];
        const blink = 0.5 + 0.5 * Math.sin(elapsed * 0.022);
        anim.mesh.material.color.set(fromDef.color);
        anim.mesh.material.emissive
          .set(fromDef.emissive)
          .lerp(this._tmpColor.set(toDef.emissive), blink);
        anim.mesh.material.emissiveIntensity = fromDef.emissiveIntensity + blink * 1.8;
        anim.mesh.scale.setScalar(0.95 + blink * 0.11);
        if (t >= 1) {
          // flipアニメーションが正しい色から始まるようにfromPlayerの色へリセット
          anim.mesh.material.color.set(fromDef.color);
          anim.mesh.material.emissive.set(fromDef.emissive);
          anim.mesh.material.emissiveIntensity = fromDef.emissiveIntensity;
          anim.mesh.scale.setScalar(1);
        }
      } else if (anim.type === 'clear') {
        if (!anim.sounded) {
          anim.sounded = true;
          this.sfx.clearPop(anim.soundIndex ?? 0);
        }
        const def = PIECE_DEFS[anim.player] ?? PIECE_DEFS.black;
        const blink = 0.5 + 0.5 * Math.sin(elapsed * 0.052);
        const eased = 1 - Math.pow(1 - t, 3);
        anim.mesh.material.color.set(def.color);
        anim.mesh.material.emissive.setRGB(1.0, 0.85 + blink * 0.15, 0.05);
        anim.mesh.material.emissiveIntensity = 1.6 + blink * 3.2;
        anim.mesh.scale.setScalar(Math.max(0.02, 1 + blink * 0.18 - eased));
        anim.mesh.position.z = 0.105 + Math.sin(t * Math.PI) * 0.18;
        if (t >= 1) {
          this.remove3dPiece(anim.key);
        }
      } else {
        // フリップの折り返し（見た目の反転瞬間）でチック音
        if (!anim.sounded && t >= 0.45) {
          anim.sounded = true;
          this.sfx.flip(anim.soundIndex ?? 0);
        }
        const spin = Math.sin(t * Math.PI);
        anim.mesh.rotation.x = Math.PI / 2 + spin * Math.PI;
        anim.mesh.scale.setScalar(1 + spin * 0.28);
        // 折り返し点（t=0.5）前後で反転前→反転後の色に切り替え
        const fromDef = PIECE_DEFS[anim.fromPlayer] ?? def;
        if (t < 0.5) {
          anim.mesh.material.color.set(fromDef.color);
          anim.mesh.material.emissive.set(fromDef.emissive);
          anim.mesh.material.emissiveIntensity = fromDef.emissiveIntensity;
        } else {
          anim.mesh.material.color.set(def.color);
          anim.mesh.material.emissive.set(def.emissive);
          anim.mesh.material.emissiveIntensity = def.emissiveIntensity;
        }
        if (t >= 1) {
          anim.mesh.rotation.x = Math.PI / 2;
          anim.mesh.scale.setScalar(1);
          anim.mesh.material.color.set(def.color);
          anim.mesh.material.emissive.set(def.emissive);
          anim.mesh.material.emissiveIntensity = def.emissiveIntensity;
        }
      }
      return t < 1;
    });

    this.three.renderer.render(this.three.scene, this.three.camera);
    window.requestAnimationFrame(() => this.animate3d());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new CubeReversi();
});
