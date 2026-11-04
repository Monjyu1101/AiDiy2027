// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// index.js - AiDiy 自己紹介ページの動的機能（jQuery 非依存版）

// --------------------------------------------------------------------
// ユーティリティ
// --------------------------------------------------------------------
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmallScreen = () => window.innerWidth <= 720;

// --------------------------------------------------------------------
// 本体クラス
// --------------------------------------------------------------------
class AiDiyIntroduction {
    constructor() {
        this.typewriterTexts = [
            "FastAPI Multi Server → Ready",
            "Vue 3 + Vite + TypeScript → Active",
            "6 Parallel Code Agents → Running",
            "Gemini Live API → Connected",
            "Claude SDK → Integrated",
            "Ollama Chat → Local & Cloud Models",
            "opencode → CLI Integrated",
            "aidiy_hermes → Custom Agent Engine",
            "MCP Hub ×20 (Windows) / ×19 (Linux・macOS) → browser / db / logs / check / backup / media / voice / obs / ffmpeg / agents / chat / task / team / windows",
            "AI Task Runner → Free-Flow DAG × Critical Path",
            "AiDiy Code / Live → VS Code × Standalone × IDE",
            "AiDiy IDE → Development Space Launched",
            "7 Apps → Console / Code / Live / IDE / Task / Team / Browser",
            "Discord → Hermes Chat + Live Voice",
            "Slack → Thread Chat via HTTPS",
            "AiDiy Diag → Check, Test & Launch",
            "Comet Orbit Autopilot → Tracking Latest Change",
            "Context Compression → 20% summary ratio",
            "60+ Tools → Composable Toolsets",
            "Japanese-First Design → Complete",
            "qTubler System → Operational",
            "JWT Authentication → Secured",
            "Welcome to AiDiy"
        ];
        this.currentTextIndex = 0;
        this.typewriterSpeed = 50;
        this.countersAnimated = false;

        this.autoScrollEnabled = false;
        this.scrollTimeout = null;
        this.userInteracted = false;
        this.autoScrollSpeed = 1;
        this.expectedScrollY = 0;

        this._typeTimer = null;
        this._nextTypeTimer = null;

        this.init();
    }

    init() {
        this.setupTitleAnimation();
        this.setupTypewriter();
        this.setupScrollAnimations();
        this.setupAutoScroll();
    }

    // -----------------------------------------------------------------
    // タイトル合体演出 + 衝突パーティクル爆発
    // -----------------------------------------------------------------
    setupTitleAnimation() {
        const leftEl   = document.getElementById('title-left');
        const rightEl  = document.getElementById('title-right');
        const assembly = document.getElementById('hero-title-assembly');
        const flashEl  = document.getElementById('title-flash');
        const finalEl  = document.getElementById('hero-title-final');
        if (!leftEl || !finalEl) return;

        // slideIn: delay 0.2s + duration 0.75s = ~0.95s 完了 → 1.05s で合体開始
        setTimeout(() => {
            leftEl.classList.add('merging');
            rightEl.classList.add('merging');
            if (flashEl) flashEl.classList.add('active');

            // 衝突の瞬間にパーティクル爆発を実発動
            if (!prefersReducedMotion) {
                this._spawnImpactParticles();
            }

            setTimeout(() => {
                if (assembly) assembly.style.visibility = 'hidden';
                finalEl.classList.add('revealed');
            }, 350);
        }, 1050);
    }

    _spawnImpactParticles() {
        const cx = window.innerWidth / 2;
        const cy = (() => {
            const el = document.getElementById('hero-title-assembly');
            if (!el) return window.innerHeight * 0.35;
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
        })();

        const COLORS = ['#00ffff', '#ff00ff', '#ffff00', '#ffffff', '#00ff88'];
        const count  = 40;

        // 一括レイヤーに追加して DOM 負荷を最小化
        const layer = document.createElement('div');
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
        document.body.appendChild(layer);

        const dots = [];
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const speed = 90 + Math.random() * 180;
            const dx    = Math.cos(angle) * speed;
            const dy    = Math.sin(angle) * speed;
            const color = COLORS[(Math.random() * COLORS.length) | 0];
            const sz    = 3 + Math.random() * 4;
            const dur   = 700 + Math.random() * 500;

            const dot = document.createElement('div');
            dot.style.cssText =
                `position:absolute;border-radius:50%;` +
                `width:${sz}px;height:${sz}px;` +
                `background:${color};box-shadow:0 0 10px ${color};` +
                `left:${cx}px;top:${cy}px;` +
                `transform:translate3d(0,0,0);` +
                `will-change:transform,opacity;`;
            layer.appendChild(dot);
            dots.push({ dot, dx, dy, dur, start: 0 });
        }

        const start = performance.now();
        const tick = (now) => {
            let allDone = true;
            for (const d of dots) {
                const p = Math.min(1, (now - start) / d.dur);
                if (p < 1) allDone = false;
                const e = 1 - p * p;
                // translate3d で GPU 合成
                d.dot.style.transform = `translate3d(${d.dx * p}px, ${d.dy * p}px, 0)`;
                d.dot.style.opacity   = String(e);
            }
            if (allDone) {
                layer.remove();
            } else {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    }

    // -----------------------------------------------------------------
    // タイプライター
    // -----------------------------------------------------------------
    setupTypewriter() {
        const el = document.getElementById('typing-text');
        if (!el) return;
        this.typeNextText();
    }

    typeNextText() {
        const el = document.getElementById('typing-text');
        if (!el) return;
        const currentText = this.typewriterTexts[this.currentTextIndex];
        let charIndex = 0;
        el.textContent = '';

        const typeChar = () => {
            if (charIndex < currentText.length) {
                el.textContent += currentText.charAt(charIndex);
                charIndex++;
                this._typeTimer = setTimeout(typeChar, this.typewriterSpeed);
            } else {
                this._nextTypeTimer = setTimeout(() => {
                    this.currentTextIndex = (this.currentTextIndex + 1) % this.typewriterTexts.length;
                    this._nextTypeTimer = setTimeout(() => this.typeNextText(), 1000);
                }, 3000);
            }
        };
        typeChar();
    }

    // -----------------------------------------------------------------
    // スクロール連動出現 + カウントアップ + スキャン
    // -----------------------------------------------------------------
    setupScrollAnimations() {
        // grid コンテナ単位で監視し、中の小パネルを setTimeout で順次発火。
        // カード単体の intersection timing に依存しないので、スクロール速度に関わらず
        // 「左→右→次行」の時間差表示が確実に見える。
        const STAGGER_MS = prefersReducedMotion ? 0 : 110;
        const gridSelector = '.core-features, .architecture-grid, .expansion-grid, .sample-grid, .advanced-grid, .tech-stats';
        const gridNodes = document.querySelectorAll(gridSelector);
        const gridChildren = new Set();
        gridNodes.forEach(grid => {
            grid.querySelectorAll(':scope > .animate-on-scroll').forEach(c => gridChildren.add(c));
        });

        const triggerCard = (el) => {
            el.classList.add('animated');
            if (el.classList.contains('stat-item') && !this.countersAnimated) {
                this.animateCounters();
                this.countersAnimated = true;
            }
        };

        const gridObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const items = entry.target.querySelectorAll(':scope > .animate-on-scroll');
                items.forEach((item, i) => {
                    setTimeout(() => triggerCard(item), i * STAGGER_MS);
                });
                gridObserver.unobserve(entry.target);
            }
        }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
        gridNodes.forEach(grid => gridObserver.observe(grid));

        // grid の外にある animate-on-scroll（h2 / p / ボタン等）は従来通り個別観測。
        const opts = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                triggerCard(entry.target);
                observer.unobserve(entry.target);
            }
        }, opts);

        document.querySelectorAll('.animate-on-scroll').forEach(el => {
            if (!gridChildren.has(el)) observer.observe(el);
        });

        // セクションに scanline を一度だけ付加
        const sectionObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated-scan');
                    sectionObserver.unobserve(entry.target);
                }
            }
        }, { threshold: 0.15 });
        document.querySelectorAll('.section').forEach(el => sectionObserver.observe(el));
    }

    animateCounters() {
        const counters = document.querySelectorAll('.stat-number');
        let remaining = counters.length;
        counters.forEach(counter => {
            const target = parseInt(counter.dataset.count, 10);
            const duration = 1800;
            const startTime = performance.now();

            const update = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easeOut = 1 - Math.pow(1 - progress, 3);
                counter.textContent = Math.floor(target * easeOut);
                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    counter.textContent = target;
                    counter.classList.add('counted');
                    // 全カウント完了で一度だけ紙吹雪を上げる
                    remaining--;
                    if (remaining === 0 && !this.statsCelebrated) {
                        this.statsCelebrated = true;
                        const grid = document.querySelector('.tech-stats');
                        if (grid) {
                            const r = grid.getBoundingClientRect();
                            confettiBurst(r.left + r.width / 2, Math.max(60, r.top + 40), 130, Math.PI * 0.9);
                        }
                    }
                }
            };
            requestAnimationFrame(update);
        });
    }

    // -----------------------------------------------------------------
    // 自動スクロール
    // -----------------------------------------------------------------
    setupAutoScroll() {
        setTimeout(() => {
            if (!this.userInteracted) this.startAutoScroll();
        }, 10000);
        this.setupUserInteractionDetection();
    }

    setupUserInteractionDetection() {
        const events = ['wheel', 'touchstart', 'touchmove', 'keydown', 'click'];
        for (const name of events) {
            window.addEventListener(name, () => {
                if (this.autoScrollEnabled) {
                    this.userInteracted = true;
                    this.stopAutoScroll();
                }
            }, { passive: true });
        }
        window.addEventListener('scroll', () => {
            if (!this.autoScrollEnabled) return;
            const diff = Math.abs(window.scrollY - this.expectedScrollY);
            if (diff > 10) {
                this.userInteracted = true;
                this.stopAutoScroll();
            }
        }, { passive: true });
    }

    startAutoScroll() {
        if (this.scrollTimeout || this.userInteracted) return;
        this.autoScrollEnabled = true;
        this.expectedScrollY = window.scrollY;
        showNotification('自動スクロール開始', 2000);

        const scrollInterval = 21;
        const step = () => {
            if (!this.autoScrollEnabled) { clearTimeout(this.scrollTimeout); return; }
            const prev = window.scrollY;
            window.scrollBy(0, this.autoScrollSpeed);
            const now = window.scrollY;
            this.expectedScrollY = now;
            if (prev === now) {
                showNotification('最下部に到達', 2000);
                this.stopAutoScroll();
                return;
            }
            this.scrollTimeout = setTimeout(step, scrollInterval);
        };
        step();
    }

    stopAutoScroll() {
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
        if (this.autoScrollEnabled && this.userInteracted) {
            showNotification('自動スクロール停止', 1500);
        }
        this.autoScrollEnabled = false;
    }

    destroy() {
        this.stopAutoScroll();
        if (this._typeTimer)     clearTimeout(this._typeTimer);
        if (this._nextTypeTimer) clearTimeout(this._nextTypeTimer);
    }
}

// --------------------------------------------------------------------
// 通知トースト（独立関数・jQuery 不要）
// --------------------------------------------------------------------
function showNotification(message, duration = 2000) {
    const existing = document.querySelector('.auto-scroll-notification');
    if (existing) existing.remove();

    const n = document.createElement('div');
    n.className = 'auto-scroll-notification';
    n.textContent = message;
    document.body.appendChild(n);

    setTimeout(() => { n.classList.add('fade-out'); }, Math.max(0, duration - 300));
    setTimeout(() => { n.remove(); }, duration);
}

// --------------------------------------------------------------------
// 背景パーティクル（canvas 2D）
// --------------------------------------------------------------------
class BackgroundParticles {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true });
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.particles = [];
        this.running = false;
        this.visible = true;
        this.lastT = 0;

        // 密度: 画面面積に応じる（小画面では控えめ）
        this._populate();
        this._bind();
        this.resize();
        this.start();
    }

    _populate() {
        const area = window.innerWidth * window.innerHeight;
        const density = isSmallScreen() ? 9000 : 13000;
        const count   = Math.min(120, Math.max(30, Math.floor(area / density)));
        const W = window.innerWidth;
        const H = window.innerHeight;
        const colors = ['#00ffff', '#ff00ff', '#ffff00', '#88ddff'];
        this.particles = new Array(count).fill(0).map(() => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            r: 0.6 + Math.random() * 1.6,
            c: colors[(Math.random() * colors.length) | 0],
            a: 0.25 + Math.random() * 0.55,
            phase: Math.random() * Math.PI * 2,
        }));
    }

    _bind() {
        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize, { passive: true });

        document.addEventListener('visibilitychange', () => {
            this.visible = !document.hidden;
            if (this.visible) this.start();
            else this.stop();
        });
    }

    resize() {
        const W = window.innerWidth;
        const H = window.innerHeight;
        this.canvas.width  = Math.floor(W * this.dpr);
        this.canvas.height = Math.floor(H * this.dpr);
        this.canvas.style.width  = W + 'px';
        this.canvas.style.height = H + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    start() {
        if (this.running || prefersReducedMotion) return;
        this.running = true;
        this.lastT = performance.now();
        const loop = (t) => {
            if (!this.running) return;
            const dt = Math.min(32, t - this.lastT);
            this.lastT = t;
            this._step(dt);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stop() { this.running = false; }

    _step(dt) {
        const ctx = this.ctx;
        const W = window.innerWidth;
        const H = window.innerHeight;
        ctx.clearRect(0, 0, W, H);

        const k = dt / 16;
        ctx.globalCompositeOperation = 'lighter';

        for (const p of this.particles) {
            p.x += p.vx * k;
            p.y += p.vy * k;
            p.phase += 0.02 * k;

            // 画面外ラップ
            if (p.x < -5) p.x = W + 5;
            else if (p.x > W + 5) p.x = -5;
            if (p.y < -5) p.y = H + 5;
            else if (p.y > H + 5) p.y = -5;

            const twinkle = 0.6 + Math.sin(p.phase) * 0.4;
            const radius  = p.r * (0.85 + twinkle * 0.25);
            const alpha   = p.a * twinkle;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.c;
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }
}

// --------------------------------------------------------------------
// マウス追従グロー（transform のみ, rAF で throttle）
// --------------------------------------------------------------------
function setupMouseGlow() {
    if (prefersReducedMotion || isSmallScreen()) return;
    const glow = document.getElementById('fx-mouse-glow');
    if (!glow) return;

    let tx = -999, ty = -999;
    let x  = -999, y  = -999;
    let raf = 0;

    const loop = () => {
        x += (tx - x) * 0.18;
        y += (ty - y) * 0.18;
        glow.style.transform = `translate3d(${x - 210}px, ${y - 210}px, 0)`;
        raf = requestAnimationFrame(loop);
    };
    loop();

    window.addEventListener('mousemove', (e) => {
        tx = e.clientX; ty = e.clientY;
        glow.style.opacity = '1';
    }, { passive: true });
    window.addEventListener('mouseout', () => { glow.style.opacity = '0'; });
}

// --------------------------------------------------------------------
// スクロール進行度バー
// --------------------------------------------------------------------
function setupScrollProgress() {
    const bar = document.getElementById('fx-progress');
    if (!bar) return;
    let ticking = false;
    const update = () => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const p = h > 0 ? Math.min(100, Math.max(0, (window.scrollY / h) * 100)) : 0;
        bar.style.width = p + '%';
        ticking = false;
    };
    window.addEventListener('scroll', () => {
        if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
}

// --------------------------------------------------------------------
// カード 3D tilt（perspective + transform）
// --------------------------------------------------------------------
function setupCardTilt() {
    if (prefersReducedMotion || isSmallScreen()) return;
    const selector = '.feature-card, .architecture-item, .sample-item';
    const cards = document.querySelectorAll(selector);
    const MAX = 6;

    for (const card of cards) {
        let raf = 0;
        let targetX = 0, targetY = 0;
        let x = 0, y = 0;

        const apply = () => {
            x += (targetX - x) * 0.18;
            y += (targetY - y) * 0.18;
            card.style.transform =
                `perspective(800px) rotateX(${y}deg) rotateY(${x}deg) translateZ(0)`;
            if (Math.abs(targetX - x) > 0.01 || Math.abs(targetY - y) > 0.01) {
                raf = requestAnimationFrame(apply);
            } else {
                raf = 0;
            }
        };

        card.addEventListener('mousemove', (e) => {
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width  - 0.5;
            const py = (e.clientY - r.top)  / r.height - 0.5;
            targetX = px * MAX * 2;
            targetY = -py * MAX * 2;
            card.classList.add('tilt-active');
            if (!raf) raf = requestAnimationFrame(apply);
        }, { passive: true });

        card.addEventListener('mouseleave', () => {
            targetX = 0; targetY = 0;
            card.classList.remove('tilt-active');
            if (!raf) raf = requestAnimationFrame(apply);
        }, { passive: true });
    }
}

// --------------------------------------------------------------------
// クリック時の波紋エフェクト
// --------------------------------------------------------------------
function setupClickRipple() {
    if (prefersReducedMotion) return;
    window.addEventListener('click', (e) => {
        const ripple = document.createElement('div');
        ripple.className = 'fx-ripple';
        ripple.style.left = e.clientX + 'px';
        ripple.style.top  = e.clientY + 'px';
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 720);
    }, { passive: true });
}

// --------------------------------------------------------------------
// 紙吹雪（canvas 1 枚を遅延生成し、粒が無くなったら rAF を止める）
// --------------------------------------------------------------------
const CONFETTI_COLORS = ['#00ffff', '#ff00ff', '#ffff00', '#ffffff', '#ffd700', '#7cf7a0'];
let confettiCanvas = null;
let confettiCtx = null;
let confettiPieces = [];
let confettiRaf = 0;

function confettiBurst(x, y, count = 90, spread = Math.PI) {
    if (prefersReducedMotion) return;
    if (!confettiCanvas) {
        confettiCanvas = document.createElement('canvas');
        confettiCanvas.id = 'fx-confetti';
        document.body.appendChild(confettiCanvas);
        confettiCtx = confettiCanvas.getContext('2d');
    }
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = 4 + Math.random() * 8;
        confettiPieces.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            w: 4 + Math.random() * 5,
            h: 6 + Math.random() * 7,
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 0.3,
            color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
            life: 0,
            ttl: 90 + Math.random() * 50,
        });
    }
    if (!confettiRaf) confettiRaf = requestAnimationFrame(confettiStep);
}

function confettiStep() {
    const ctx = confettiCtx;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiPieces = confettiPieces.filter(p => p.life < p.ttl && p.y < confettiCanvas.height + 24);
    if (confettiPieces.length === 0) {
        confettiRaf = 0;
        return;
    }
    for (const p of confettiPieces) {
        p.life++;
        p.vy += 0.16;      // 重力
        p.vx *= 0.985;     // 空気抵抗
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        const fade = Math.max(0, Math.min(1, (1 - p.life / p.ttl) * 1.4));
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // 高さを揺らして「ひらひら」感を出す
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + Math.abs(Math.sin(p.life * 0.15)) * 0.6));
        ctx.restore();
    }
    confettiRaf = requestAnimationFrame(confettiStep);
}

// CTA ボタンクリックでも小さくお祝い
function setupConfettiTriggers() {
    if (prefersReducedMotion) return;
    document.querySelectorAll('.cyber-button, .cyber-button-ghost').forEach(btn => {
        btn.addEventListener('click', (e) => {
            confettiBurst(e.clientX, e.clientY, 45, Math.PI * 2);
        }, { passive: true });
    });
}

// --------------------------------------------------------------------
// 初期化
// --------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const intro = new AiDiyIntroduction();

    // 背景パーティクル（prefers-reduced-motion 時は停止状態）
    const canvas = document.getElementById('fx-particles');
    let particles = null;
    if (canvas && !prefersReducedMotion) {
        particles = new BackgroundParticles(canvas);
    }

    setupMouseGlow();
    setupScrollProgress();
    setupCardTilt();
    setupClickRipple();
    setupConfettiTriggers();

    window.addEventListener('beforeunload', () => {
        intro.destroy();
        if (particles) particles.stop();
    });
});
