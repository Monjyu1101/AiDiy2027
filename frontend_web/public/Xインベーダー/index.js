// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Xインベーダー改 - Retro 640x400 Canvas版（挙動は現行を踏襲）

class RetroInvadersGame {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;

        // 基本解像度（レトロ）
        this.gameWidth = 640;
        this.gameHeight = 400;

        // 状態
        this.gameStarted = false;
        this.gameRunning = false;
        this.gamePaused = false;
        this.animationFrameId = null;
        this.lastFrameTime = 0;

        // プレイヤー
        this.playerWidth = 24;   // 旧実装(60/960)比で縮尺
        this.playerHeight = 16;
        this.playerSpeed = 3;    // 旧5相当を400高へ縮尺
        this.playerX = (this.gameWidth - this.playerWidth) / 2;
        this.playerY = this.gameHeight - 32; // 下からオフセット

        // スコア等
        this.score = 0;
        this.lives = 3;
        this.wave = 1;

        // 弾丸
        this.bullets = [];
        this.enemyBullets = [];
        this.bulletSpeed = 3;        // 旧8→約3
        this.enemyBulletSpeed = 1.2; // 旧3→約1
        this.canShoot = true;
        this.shootCooldown = 150;
        this.shootTimer = null;
        this.rapidFireTimer = null;

        // 敵
        this.invaders = [];
        this.invaderSpeed = 0.6; // 旧1→約0.6
        this.invaderDirection = 1;
        this.invaderDropDistance = 8; // 旧20→8
        this.invaderAnimFrame = 0; // 足の開閉アニメ（2フレーム）
        this.invaderAnimTick = 0;
        this.invaderAnimInterval = 400; // ms
        this.waveTransitioning = false;
        this.nextWaveTimer = null;

        // パワーアップ / UFO / パーティクル
        this.powerups = [];
        this.ufos = [];
        this.particles = [];
        this.floatTexts = [];   // スコアポップアップ
        this.tripleShot = false;
        this.tripleTimer = null;
        this.audioCtx = null;   // 効果音（初回操作時に生成）
        this.ufoSpeed = 1.2;
        this.ufoSpawnTimer = 0;
        this.ufoSpawnInterval = 15000;
        this.playerInvincibleTimer = 0;

        // バンカー（基地）
        this.bunkers = [];

        // 入力
        this.keys = {};

        // 星背景（軽量）
        this.stars = Array.from({ length: 40 }).map(() => ({
            x: Math.random() * this.gameWidth,
            y: Math.random() * this.gameHeight,
            d: Math.random() * 0.5 + 0.2,
        }));

        this.bindEvents();
        this.updateDisplay();
        this.loop = this.loop.bind(this);
    }

    bindEvents() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space' && this.gameRunning && !this.gamePaused) {
                e.preventDefault();
                this.shoot();
            }
            if (e.code === 'KeyP' && this.gameStarted && this.gameRunning) this.togglePause();
        });
        document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

        $('#start-btn').on('click', () => this.startGame());
        $('#restart-btn').on('click', () => this.restartGame());
        $('#menu-btn').on('click', () => this.showMenu());
    }

    startGame() {
        $('#start-overlay').addClass('hidden');
        this.gameStarted = true;
        this.gameRunning = true;
        this.resetGame();
        this.createInvaders();
        this.startLoop();
    }

    restartGame() {
        $('#over-overlay').addClass('hidden');
        this.gameStarted = true;
        this.gameRunning = true;
        this.resetGame();
        this.createInvaders();
        this.startLoop();
    }

    showMenu() {
        $('#over-overlay').addClass('hidden');
        $('#start-overlay').removeClass('hidden');
        this.gameStarted = false;
        this.gameRunning = false;
        this.gamePaused = false;
        this.clearTimers();
        this.keys = {};
        this.stopLoop();
    }

    clearTimers() {
        if (this.nextWaveTimer) {
            clearTimeout(this.nextWaveTimer);
            this.nextWaveTimer = null;
        }
        if (this.shootTimer) {
            clearTimeout(this.shootTimer);
            this.shootTimer = null;
        }
        if (this.rapidFireTimer) {
            clearTimeout(this.rapidFireTimer);
            this.rapidFireTimer = null;
        }
        if (this.tripleTimer) {
            clearTimeout(this.tripleTimer);
            this.tripleTimer = null;
        }
    }

    // レトロ効果音（WebAudio、外部ファイル不要）
    sfx(freq, duration = 0.08, type = 'square', volume = 0.04, slide = 0) {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = this.audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            if (slide) osc.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + duration);
            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) { /* 音が出せない環境では無視 */ }
    }

    addFloatText(x, y, text, color = '#fff') {
        this.floatTexts.push({ x, y, text, color, ttl: 900 });
    }

    resetGame() {
        this.clearTimers();
        this.score = 0;
        this.lives = 3;
        this.wave = 1;
        this.gamePaused = false;
        this.bullets = [];
        this.enemyBullets = [];
        this.invaders = [];
        this.powerups = [];
        this.ufos = [];
        this.particles = [];
        this.floatTexts = [];
        this.tripleShot = false;
        this.playerX = (this.gameWidth - this.playerWidth) / 2;
        this.invaderSpeed = 0.6;
        this.invaderDirection = 1;
        this.waveTransitioning = false;
        this.ufoSpawnTimer = 0;
        this.playerInvincibleTimer = 0;
        this.canShoot = true;
        this.shootCooldown = 150;
        this.keys = {};
        this.createBunkers();
        this.updateDisplay();
    }

    createInvaders() {
        const rows = 7; // もう少し多く
        const cols = 13; // 左右詰めて列数増
        const startX = 8; // 左右マージンを詰める
        const startY = 40;
        const spacingX = 24; // 現在の半分の間隔（横）
        const spacingY = 16; // 現在の半分の間隔（縦）
        this.invaders = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const inv = {
                    x: startX + c * spacingX,
                    y: startY + r * spacingY,
                    w: 16, h: 12, // 8x6ドット（px=2）に整合
                    type: r < 2 ? 1 : (r < 4 ? 2 : 3),
                };
                this.invaders.push(inv);
            }
        }
    }

    startLoop() {
        this.stopLoop();
        this.lastFrameTime = 0;
        this.animationFrameId = requestAnimationFrame(this.loop);
    }

    stopLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    loop(timestamp = 0) {
        if (!this.gameRunning) return;
        const dt = this.lastFrameTime ? Math.min(50, timestamp - this.lastFrameTime) : 16.67;
        this.lastFrameTime = timestamp;
        this.update(dt);
        this.render();
        if (!this.gameRunning) {
            this.animationFrameId = null;
            return;
        }
        this.animationFrameId = requestAnimationFrame(this.loop);
    }

    update(dt = 16.67) {
        if (this.gamePaused) return;
        const step = dt / 16.67;

        // 背景星
        for (const s of this.stars) {
            s.y += s.d * step; if (s.y > this.gameHeight) s.y = 0;
        }

        // 入力
        if (this.keys['ArrowLeft'] || this.keys['KeyA']) this.playerX -= this.playerSpeed * step;
        if (this.keys['ArrowRight'] || this.keys['KeyD']) this.playerX += this.playerSpeed * step;
        this.playerX = Math.max(0, Math.min(this.gameWidth - this.playerWidth, this.playerX));

        // 自弾（トリプルショットは横方向にも移動）
        this.bullets = this.bullets.filter(b => {
            b.y -= this.bulletSpeed * step;
            b.x += (b.vx || 0) * step;
            return b.y > -20 && b.x > -10 && b.x < this.gameWidth + 10;
        });

        // 敵弾
        this.enemyBullets = this.enemyBullets.filter(b => {
            b.y += this.enemyBulletSpeed * step; return b.y < this.gameHeight + 20;
        });

        // 敵移動
        if (this.invaders.length) {
            let hitEdge = false;
            for (const inv of this.invaders) {
                inv.x += this.invaderSpeed * this.invaderDirection * step;
                if (inv.x <= 0 || inv.x + inv.w >= this.gameWidth) hitEdge = true;
            }
            if (hitEdge) {
                this.invaderDirection *= -1;
                for (const inv of this.invaders) {
                    inv.x = Math.max(0, Math.min(this.gameWidth - inv.w, inv.x));
                    inv.y += this.invaderDropDistance;
                }
            }
            // ランダム射撃
            if (Math.random() < Math.min(0.12, 0.002 * this.invaders.length * step)) this.enemyShoot();
        }

        // エイリアンの足アニメ（開閉）
        this.invaderAnimTick += dt;
        if (this.invaderAnimTick >= this.invaderAnimInterval) {
            this.invaderAnimTick = 0;
            this.invaderAnimFrame = (this.invaderAnimFrame + 1) % 2;
        }

        // パワーアップ落下
        this.powerups = this.powerups.filter(p => { p.y += 1.0 * step; return p.y < this.gameHeight + 10; });

        // UFO
        this.ufoSpawnTimer += dt;
        if (this.ufoSpawnTimer >= this.ufoSpawnInterval && this.ufos.length === 0) {
            this.createUfo(); this.ufoSpawnTimer = 0;
        }
        this.ufos = this.ufos.filter(u => {
            u.x += u.dir * this.ufoSpeed * step; return (u.x > -60 && u.x < this.gameWidth + 60);
        });

        // パーティクル
        this.particles = this.particles.filter(p => { p.ttl -= dt; p.x += p.vx * step; p.y += p.vy * step; return p.ttl > 0; });

        // スコアポップアップ
        this.floatTexts = this.floatTexts.filter(t => { t.ttl -= dt; t.y -= 0.4 * step; return t.ttl > 0; });
        if (this.playerInvincibleTimer > 0) this.playerInvincibleTimer = Math.max(0, this.playerInvincibleTimer - dt);

        // 衝突
        this.handleCollisions();
        this.checkGameState();
    }

    shoot() {
        if (!this.gameRunning || this.gamePaused || !this.canShoot) return;
        const cx = this.playerX + Math.floor(this.playerWidth/2);
        this.bullets.push({ x: cx - 1, y: this.playerY - 6, w: 2, h: 6 });
        if (this.tripleShot) {
            // 3方向ショット（左右に開く）
            this.bullets.push({ x: cx - 1, y: this.playerY - 4, w: 2, h: 6, vx: -0.8 });
            this.bullets.push({ x: cx - 1, y: this.playerY - 4, w: 2, h: 6, vx: 0.8 });
        }
        this.canShoot = false;
        this.shootTimer = setTimeout(() => {
            this.shootTimer = null;
            this.canShoot = true;
        }, this.shootCooldown);
        this.sfx(880, 0.06, 'square', 0.03, -400);
        this.muzzle(cx, this.playerY - 6);
    }

    enemyShoot() {
        const shooters = this.invaders.filter((inv) => !this.invaders.some((other) => (
            other !== inv
            && Math.abs(other.x - inv.x) < inv.w
            && other.y > inv.y
        )));
        const pool = shooters.length ? shooters : this.invaders;
        const s = pool[Math.floor(Math.random() * pool.length)];
        this.enemyBullets.push({ x: s.x + Math.floor(s.w/2) - 1, y: s.y + s.h, w: 2, h: 6 });
    }

    createUfo() {
        const fromLeft = Math.random() < 0.5;
        // ドット絵サイズ（12列*2px=24, 6行*2px=12）
        this.ufos.push({ x: fromLeft ? -40 : this.gameWidth + 40, y: 24, w: 24, h: 12, dir: fromLeft ? 1 : -1 });
    }

    createPowerup(x, y) {
        const type = Math.random() < 0.5 ? 'rapid' : 'triple';
        this.powerups.push({ x, y, w: 8, h: 8, type });
    }

    collectPowerup(p) {
        this.addScore(50);
        if (p.type === 'triple') {
            // 3方向ショット（5秒間）
            this.tripleShot = true;
            if (this.tripleTimer) clearTimeout(this.tripleTimer);
            this.tripleTimer = setTimeout(() => {
                this.tripleTimer = null;
                this.tripleShot = false;
            }, 5000);
            this.addFloatText(p.x, p.y - 10, 'TRIPLE SHOT!', '#00ffff');
        } else {
            // 連射（5秒間）
            this.shootCooldown = 50;
            if (this.rapidFireTimer) clearTimeout(this.rapidFireTimer);
            this.rapidFireTimer = setTimeout(() => {
                this.rapidFireTimer = null;
                this.shootCooldown = 150;
            }, 5000);
            this.addFloatText(p.x, p.y - 10, 'RAPID FIRE!', '#ffee00');
        }
        this.sfx(660, 0.18, 'triangle', 0.05, 440);
        this.explode(p.x, p.y, true);
    }

    muzzle(x, y) { this.particles.push({ x, y, vx: 0, vy: -0.3, ttl: 120, c: '#7fffd4', s: 2 }); }

    explode(x, y, big = false) {
        const n = big ? 18 : 10;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2; const sp = Math.random() * (big ? 2.0 : 1.4);
            this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 500, c: big ? '#ff0' : '#ffa500', s: 2 });
        }
    }

    aabb(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    handleCollisions() {
        // 自弾 vs バンカー
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            let hit = false;
            const cx = b.x + b.w/2, cy = b.y + b.h/2;
            for (const bunker of this.bunkers) {
                const bw = bunker.cols * bunker.px, bh = bunker.rows * bunker.px;
                if (cx >= bunker.x && cx < bunker.x + bw && cy >= bunker.y && cy < bunker.y + bh) {
                    // セル占有チェック（ドットが残っている所だけ当たり）
                    const ccol = Math.floor((cx - bunker.x) / bunker.px);
                    const crow = Math.floor((cy - bunker.y) / bunker.px);
                    if (crow >= 0 && crow < bunker.rows && ccol >= 0 && ccol < bunker.cols && bunker.cells[crow][ccol]) {
                        this.erodeBunkerAt(bunker, cx, cy);
                        this.bullets.splice(i, 1);
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) continue;
        }

        // 自弾 vs 敵
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            for (let j = this.invaders.length - 1; j >= 0; j--) {
                const inv = this.invaders[j];
                if (this.aabb(b, inv)) {
                    this.explode(inv.x + inv.w/2, inv.y + inv.h/2);
                    const pts = inv.type * 10; this.addScore(pts);
                    this.addFloatText(inv.x + inv.w/2, inv.y - 2, `+${pts}`, '#ffa500');
                    this.sfx(220, 0.12, 'sawtooth', 0.04, -150);
                    if (Math.random() < 0.10) this.createPowerup(inv.x + inv.w/2, inv.y + inv.h/2);
                    this.bullets.splice(i, 1); this.invaders.splice(j, 1); break;
                }
            }
        }

        // 自弾 vs UFO
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            for (let j = this.ufos.length - 1; j >= 0; j--) {
                const u = this.ufos[j];
                if (this.aabb(b, u)) {
                    const bonus = [50,100,150,200,300][Math.floor(Math.random()*5)];
                    this.addScore(bonus); this.explode(u.x + u.w/2, u.y + u.h/2, true);
                    this.addFloatText(u.x + u.w/2, u.y - 4, `+${bonus}`, '#ff66ff');
                    this.sfx(1200, 0.25, 'sawtooth', 0.05, -900);
                    this.bullets.splice(i, 1); this.ufos.splice(j, 1); break;
                }
            }
        }

        // 敵弾 vs バンカー
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            const b = this.enemyBullets[i];
            let hit = false;
            const cx = b.x + b.w/2, cy = b.y + b.h/2;
            for (const bunker of this.bunkers) {
                const bw = bunker.cols * bunker.px, bh = bunker.rows * bunker.px;
                if (cx >= bunker.x && cx < bunker.x + bw && cy >= bunker.y && cy < bunker.y + bh) {
                    // セル占有チェック（ドットが残っている所だけ当たり）
                    const ccol = Math.floor((cx - bunker.x) / bunker.px);
                    const crow = Math.floor((cy - bunker.y) / bunker.px);
                    if (crow >= 0 && crow < bunker.rows && ccol >= 0 && ccol < bunker.cols && bunker.cells[crow][ccol]) {
                        this.erodeBunkerAt(bunker, cx, cy);
                        this.enemyBullets.splice(i, 1);
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) continue;
        }

        // 敵弾 vs プレイヤー
        const playerBox = { x: this.playerX, y: this.playerY, w: this.playerWidth, h: this.playerHeight };
        for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
            if (this.playerInvincibleTimer <= 0 && this.aabb(this.enemyBullets[i], playerBox)) {
                this.explode(this.playerX + this.playerWidth/2, this.playerY + this.playerHeight/2);
                this.enemyBullets.splice(i, 1); this.loseLife();
                break;
            }
        }

        // プレイヤー vs パワーアップ
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            if (this.aabb(this.powerups[i], playerBox)) { this.collectPowerup(this.powerups[i]); this.powerups.splice(i, 1); }
        }

        // 敵がバンカーに接触したら侵食する（素通り防止）
        for (const bunker of this.bunkers) {
            const box = { x: bunker.x, y: bunker.y, w: bunker.cols * bunker.px, h: bunker.rows * bunker.px };
            for (const inv of this.invaders) {
                if (this.aabb(inv, box)) {
                    const c0 = Math.max(0, Math.floor((inv.x - bunker.x) / bunker.px));
                    const c1 = Math.min(bunker.cols - 1, Math.floor((inv.x + inv.w - bunker.x) / bunker.px));
                    const r0 = Math.max(0, Math.floor((inv.y - bunker.y) / bunker.px));
                    const r1 = Math.min(bunker.rows - 1, Math.floor((inv.y + inv.h - bunker.y) / bunker.px));
                    for (let r = r0; r <= r1; r++) {
                        for (let cc = c0; cc <= c1; cc++) bunker.cells[r][cc] = false;
                    }
                }
            }
        }

        // 敵が下まで到達
        for (const inv of this.invaders) if (inv.y + inv.h > this.gameHeight - 56) { this.gameOver(); break; }
    }

    checkGameState() {
        if (this.invaders.length === 0 && !this.waveTransitioning) this.nextWave();
    }

    nextWave() {
        this.waveTransitioning = true;
        // Wave クリアボーナス
        const bonus = this.wave * 50;
        this.addScore(bonus);
        this.addFloatText(this.gameWidth / 2, this.gameHeight / 2, `WAVE CLEAR! +${bonus}`, '#39ff14');
        this.sfx(523, 0.3, 'triangle', 0.05, 523);
        this.wave++; this.invaderSpeed += 0.3; this.updateDisplay();
        this.bullets = [];
        this.enemyBullets = [];
        // 少し間を空けて再配置
        this.nextWaveTimer = setTimeout(() => {
            this.nextWaveTimer = null;
            if (!this.gameRunning) return;
            this.invaderDirection = 1;
            this.createInvaders();
            this.waveTransitioning = false;
        }, 600);
    }

    addScore(p) { this.score += p; this.updateDisplay(); }
    loseLife() {
        this.lives--;
        this.sfx(150, 0.4, 'sawtooth', 0.06, -100);
        this.playerInvincibleTimer = 1200;
        this.enemyBullets = [];
        this.playerX = (this.gameWidth - this.playerWidth) / 2;
        this.updateDisplay();
        if (this.lives <= 0) this.gameOver();
    }

    gameOver() {
        this.gameRunning = false;
        this.stopLoop();
        this.clearTimers();
        $('#final-score').text(this.score); $('#over-overlay').removeClass('hidden');
    }

    togglePause() {
        this.gamePaused = !this.gamePaused;
    }

    updateDisplay() {
        $('#score').text(this.score); $('#lives').text(this.lives); $('#wave').text(this.wave);
    }

    // 描画
    clear() { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.gameWidth, this.gameHeight); }

    drawStars() {
        const c = this.ctx;
        c.fillStyle = '#88a';
        for (const s of this.stars) c.fillRect(s.x|0, s.y|0, 1, 1);
    }

    drawPlayer() {
        if (this.playerInvincibleTimer > 0 && Math.floor(this.playerInvincibleTimer / 90) % 2 === 0) return;
        const c = this.ctx; const x = this.playerX|0, y = this.playerY|0, w = this.playerWidth, h = this.playerHeight;
        c.fillStyle = '#00ff66';
        // 簡単なドット絵（台形風）
        c.fillRect(x+2, y+4, w-4, h-4);
        c.fillRect(x+4, y+2, w-8, 2);
        c.fillRect(x+Math.floor(w/2)-2, y, 4, 2);
    }

    drawInvader(inv) {
        const c = this.ctx; c.fillStyle = inv.type === 1 ? '#ff66aa' : (inv.type === 2 ? '#ffaa33' : '#9966ff');
        const x = inv.x|0, y = inv.y|0;
        const px = 2; // ドットサイズ
        // 8x6の2フレーム（足開閉）
        const open = [
            0b00111100,
            0b01111110,
            0b11111111,
            0b11011011,
            0b00111100,
            0b01000010,
        ];
        const closed = [
            0b00111100,
            0b01111110,
            0b11111111,
            0b11011011,
            0b01111110,
            0b00100100,
        ];
        const pat = this.invaderAnimFrame === 0 ? open : closed;
        for (let r = 0; r < pat.length; r++) {
            for (let col = 0; col < 8; col++) if (pat[r] & (1 << (7-col))) c.fillRect(x + col*px, y + r*px, px, px);
        }
    }

    drawBullet(b, enemy=false) {
        const c = this.ctx; c.fillStyle = enemy ? '#ff4488' : '#7fffd4';
        c.fillRect(b.x|0, b.y|0, b.w|0, b.h|0);
    }

    drawUfo(u) {
        const c = this.ctx; const x = u.x|0, y = u.y|0; const px = 2;
        // 12x6 対称パターン（左右完全対称）
        const pat = [
            0b000001100000, //   dome tip
            0b000111111000, //  dome
            0b001111111100, // body
            0b011111111110, // widest body
            0b001111111100, // body
            0b000001100000, // small feet/glow
        ];
        for (let r = 0; r < pat.length; r++) {
            for (let col = 0; col < 12; col++) if (pat[r] & (1 << (11-col))) {
                // 色分け（上部はドーム色、中央は本体、最下段はアクセント）
                if (r <= 1) c.fillStyle = '#cc88ff';
                else if (r <= 4) c.fillStyle = '#ff66ff';
                else c.fillStyle = '#ff22aa';
                c.fillRect(x + col*px, y + r*px, px, px);
            }
        }
    }
    drawPowerup(p) {
        const c = this.ctx;
        c.fillStyle = p.type === 'triple' ? '#00ffff' : '#ffee00';
        c.fillRect((p.x-4)|0, (p.y-4)|0, 8, 8);
        // 種別が分かるように中央へ文字を描画
        c.fillStyle = '#000';
        c.font = 'bold 7px monospace';
        c.textAlign = 'center';
        c.fillText(p.type === 'triple' ? '3' : 'R', p.x|0, (p.y+2.5)|0);
        c.textAlign = 'left';
    }
    drawParticles() {
        const c = this.ctx; for (const p of this.particles) { c.fillStyle = p.c || '#fff'; c.fillRect(p.x|0, p.y|0, p.s||1, p.s||1); }
    }
    drawFloatTexts() {
        const c = this.ctx;
        c.font = 'bold 10px monospace';
        c.textAlign = 'center';
        for (const t of this.floatTexts) {
            c.globalAlpha = Math.max(0, Math.min(1, t.ttl / 400));
            c.fillStyle = t.color;
            c.fillText(t.text, t.x|0, t.y|0);
        }
        c.globalAlpha = 1;
        c.textAlign = 'left';
    }

    // バンカー作成・描画・破壊
    createBunkers() {
        const px = 2;
        const cols = 18; // 36px 幅（18列×2px）
        const rows = 8;  // 少し分厚く（16px 高）
        // 上面左右のみ斜め切れ込み、下面は角ばった矩形（やや厚め）
        const pat = [
            0b000001111111000000, // bevel 1
            0b000111111111110000, // bevel 2
            0b001111111111111000, // bevel 3
            0b111111111111111111, // flat bottom section
            0b111111111111111111,
            0b111111111111111111,
            0b111111111111111111,
            0b111111111111111111,
        ];
        const y = this.gameHeight - 96;
        const spacing = this.gameWidth / 5;
        this.bunkers = [];
        for (let i = 1; i <= 4; i++) {
            const x = Math.floor(spacing * i - (cols*px)/2);
            const cells = Array.from({ length: rows }, (_, r) => (
                Array.from({ length: cols }, (_, c) => (pat[r] & (1 << (cols-1-c))) !== 0)
            ));
            this.bunkers.push({ x, y, cols, rows, px, cells });
        }
    }

    drawBunkers() {
        const c = this.ctx; c.fillStyle = '#ffffff';
        for (const b of this.bunkers) {
            for (let r = 0; r < b.rows; r++) {
                for (let col = 0; col < b.cols; col++) {
                    if (b.cells[r][col]) c.fillRect(b.x + col*b.px, b.y + r*b.px, b.px, b.px);
                }
            }
        }
    }

    erodeBunkerAt(bunker, x, y) {
        // 弾の中心座標からセルを削る
        const ccol = Math.floor((x - bunker.x) / bunker.px);
        const crow = Math.floor((y - bunker.y) / bunker.px);
        const rad = 3; // 薄型に合わせ削り半径を少し拡大
        for (let r = -rad; r <= rad; r++) {
            for (let col = -rad; col <= rad; col++) {
                const rr = crow + r, cc = ccol + col;
                if (rr >= 0 && rr < bunker.rows && cc >= 0 && cc < bunker.cols) bunker.cells[rr][cc] = false;
            }
        }
    }

    render() {
        this.clear();
        this.drawStars();
        // エンティティ
        this.drawBunkers();
        for (const inv of this.invaders) this.drawInvader(inv);
        for (const b of this.bullets) this.drawBullet(b, false);
        for (const b of this.enemyBullets) this.drawBullet(b, true);
        for (const u of this.ufos) this.drawUfo(u);
        for (const p of this.powerups) this.drawPowerup(p);
        this.drawParticles();
        this.drawFloatTexts();
        this.drawPlayer();

        // ポーズ中の表示
        if (this.gamePaused) {
            const c = this.ctx;
            c.fillStyle = 'rgba(0, 0, 0, 0.55)';
            c.fillRect(0, 0, this.gameWidth, this.gameHeight);
            c.textAlign = 'center';
            c.fillStyle = '#00d4ff';
            c.font = 'bold 24px monospace';
            c.fillText('PAUSED', this.gameWidth / 2, this.gameHeight / 2);
            c.font = '12px monospace';
            c.fillText('PRESS P TO RESUME', this.gameWidth / 2, this.gameHeight / 2 + 24);
            c.textAlign = 'left';
        }
    }
}

$(function() {
    const game = new RetroInvadersGame(document.getElementById('game-canvas'));
    // グローバルに露出しないが、必要なら window.game = game; でデバッグ可
});
