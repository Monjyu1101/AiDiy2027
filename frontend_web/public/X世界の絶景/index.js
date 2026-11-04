// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -*- coding: utf-8 -*-

const AUTO_INTERVAL_MS = 24000;
const COUNTRY_HOLD_MS = 3500;  // 国レベル表示の保持時間
const LOCAL_REVEAL_MS = 5000;  // 地区レベル開始後に photo を許可するまでの時間

const places = window.sceneryPlaces || [];

class WorldScenery {
  constructor() {
    this.mapSlots = [];
    this.activeMapIndex = 0;
    this.currentIndex = -1;
    this.history = [];
    this.randomQueue = [];
    this.autoEnabled = true;
    this.autoTimer = null;
    this.progressTimer = null;
    this.mapReadyPromise = Promise.resolve();
    this.mapRequestId = 0;
    this.progressStartedAt = 0;
    this.photoRequestId = 0;
    this.photoCache = new Map();

    this.titleEl = document.getElementById('place-title');
    this.locationEl = document.getElementById('place-location');
    this.noteEl = document.getElementById('place-note');
    this.categoryEl = document.getElementById('place-category');
    this.coordsEl = document.getElementById('place-coords');
    this.historyEl = document.getElementById('history-list');
    this.progressEl = document.getElementById('auto-progress');
    this.nextBtn = document.getElementById('next-btn');
    this.prevBtn = document.getElementById('prev-btn');
    this.autoBtn = document.getElementById('auto-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    this.photoLayer = document.getElementById('photo-layer');
    this.photoCredit = document.getElementById('photo-credit');
    this.appShell = document.querySelector('.app-shell');

    this.initMap();
    this.bindEvents();
    this.goRandom(true);
    this.setAuto(true);
  }

  initMap() {
    this.mapSlots = ['map-a', 'map-b'].map((id) => ({
      element: document.getElementById(id),
    }));
    // 初期状態：両方非表示
    this.mapSlots.forEach((s) => {
      s.element.style.opacity = '0';
      s.element.style.zIndex = '1';
    });
  }

  buildMapUrl(place, zoom) {
    return `https://maps.google.com/maps?q=${place.lat},${place.lng}&z=${zoom}&t=h&output=embed`;
  }

  countryZoom(place) {
    // 目的地の国レベルズーム（上位概観）
    return Math.min(5, Math.max(2, place.zoom - 4));
  }

  bindEvents() {
    this.nextBtn.addEventListener('click', () => {
      this.goRandom(false);
      this.restartAutoIfNeeded();
    });
    this.prevBtn.addEventListener('click', () => {
      this.goPrevious();
      this.restartAutoIfNeeded();
    });
    this.autoBtn.addEventListener('click', () => this.setAuto(!this.autoEnabled));
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
        this.goRandom(false);
        this.restartAutoIfNeeded();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.goPrevious();
        this.restartAutoIfNeeded();
      }
    });
  }

  goRandom(initial = false) {
    const nextIndex = this.takeRandomIndex(initial);
    this.showPlace(nextIndex, true);
  }

  takeRandomIndex(initial = false) {
    if (places.length <= 1) return 0;
    if (this.randomQueue.length === 0) this.refillRandomQueue(initial);
    return this.randomQueue.pop();
  }

  refillRandomQueue(initial = false) {
    this.randomQueue = places
      .map((_, index) => index)
      .filter((index) => initial || index !== this.currentIndex);

    for (let i = this.randomQueue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.randomQueue[i], this.randomQueue[j]] = [this.randomQueue[j], this.randomQueue[i]];
    }
  }

  goPrevious() {
    if (this.history.length < 2) return;
    this.history.pop();
    const previousIndex = this.history.pop();
    this.showPlace(previousIndex, false);
  }

  showPlace(index, addToHistory) {
    const place = places[index];
    if (!place) return;
    this.currentIndex = index;
    if (addToHistory) this.history.push(index);
    if (this.history.length > 12) this.history = this.history.slice(-12);

    this.titleEl.textContent = `${place.title} / ${place.country}`;
    this.locationEl.textContent = `${place.country}`;
    this.noteEl.textContent = place.note;
    this.categoryEl.textContent = place.category;
    this.coordsEl.textContent = `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`;

    this.appShell.classList.add('is-traveling');
    this.mapReadyPromise = this.revealLoadedMap(place);
    this.loadPhoto(place);
    this.renderHistory();
  }

  async loadPhoto(place) {
    const requestId = ++this.photoRequestId;
    this.photoLayer.classList.remove('visible');
    this.appShell.classList.remove('photo-active');
    this.photoCredit.textContent = 'Photo: loading...';

    const cached = this.photoCache.get(place.wikiTitle);
    if (cached) {
      this.applyPhoto(cached, requestId, place);
      return;
    }

    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place.wikiTitle)}`;
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`photo fetch failed: ${response.status}`);
      const data = await response.json();
      const source = data?.originalimage?.source || data?.thumbnail?.source;
      if (!source) throw new Error('photo not found');
      const photo = {
        url: source,
        credit: `Photo: Wikipedia / Wikimedia Commons - ${data.title || place.title}`,
      };
      this.photoCache.set(place.wikiTitle, photo);
      this.applyPhoto(photo, requestId, place);
    } catch (error) {
      if (requestId !== this.photoRequestId) return;
      this.photoLayer.style.backgroundImage = '';
      this.photoLayer.classList.remove('visible');
      this.appShell.classList.remove('photo-active');
      this.photoCredit.textContent = 'Photo: unavailable';
      console.warn(error);
    }
  }

  applyPhoto(photo, requestId, place) {
    if (requestId !== this.photoRequestId) return;
    const image = new Image();
    image.onload = async () => {
      if (requestId !== this.photoRequestId) return;
      const mapReady = await this.mapReadyPromise;
      if (!mapReady) return;
      if (requestId !== this.photoRequestId) return;
      this.photoLayer.style.backgroundImage = `url("${photo.url}")`;
      this.photoLayer.classList.add('visible');
      this.appShell.classList.add('photo-active');
      this.photoCredit.textContent = photo.credit;
      this.titleEl.textContent = place.title;
    };
    image.onerror = () => {
      if (requestId !== this.photoRequestId) return;
      this.photoCredit.textContent = 'Photo: unavailable';
      this.photoLayer.classList.remove('visible');
      this.appShell.classList.remove('photo-active');
    };
    image.src = photo.url;
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        this.fullscreenBtn.textContent = '全画面';
      } else {
        await document.documentElement.requestFullscreen();
        this.fullscreenBtn.textContent = '全画面解除';
      }
    } catch (error) {
      console.warn(error);
    }
  }

  // エレメントを即座に指定スタイルへスナップしてからトランジション開始
  snapThenAnimate(el, snapStyles, animateStyles, transition) {
    el.style.transition = 'none';
    Object.assign(el.style, snapStyles);
    void el.offsetWidth;
    el.style.transition = transition;
    Object.assign(el.style, animateStyles);
  }

  async revealLoadedMap(place) {
    const requestId = ++this.mapRequestId;
    const activeIdx = this.activeMapIndex;
    const activeEl = this.mapSlots[activeIdx].element;
    const nextIdx = 1 - activeIdx;
    const nextEl = this.mapSlots[nextIdx].element;

    // ── Phase 1: 国レベル表示（nextEl） ──
    nextEl.src = this.buildMapUrl(place, this.countryZoom(place));
    await this.waitForFrameReady(nextEl, 8000);
    if (requestId !== this.mapRequestId) return false;

    // 旧アクティブをフェードアウト
    activeEl.style.transition = 'opacity 0.8s ease';
    activeEl.style.zIndex = '1';
    activeEl.style.opacity = '0';

    // 国レベルフレームをスナップ→フェードイン＋スケールイン
    this.snapThenAnimate(
      nextEl,
      { opacity: '0', transform: 'scale(1.1)', zIndex: '3' },
      { opacity: '1', transform: 'scale(1)' },
      'opacity 1.2s ease, transform 3.5s ease'
    );

    await this.wait(COUNTRY_HOLD_MS);
    if (requestId !== this.mapRequestId) return false;

    // ── Phase 2: 地区レベル表示（activeEl を再利用） ──
    activeEl.src = this.buildMapUrl(place, place.zoom);
    await this.waitForFrameReady(activeEl, 8000);
    if (requestId !== this.mapRequestId) return false;

    // 国レベルフレームをフェードアウト
    nextEl.style.transition = 'opacity 0.8s ease';
    nextEl.style.opacity = '0';

    // 地区レベルフレームをスナップ→フェードイン＋スケールイン
    this.snapThenAnimate(
      activeEl,
      { opacity: '0', transform: 'scale(1.07)', zIndex: '4' },
      { opacity: '1', transform: 'scale(1)' },
      'opacity 1.2s ease, transform 4.5s ease'
    );

    this.appShell.classList.remove('is-traveling');

    // photo 許可まで少し待つ（地区フレームが見え始めてから）
    await this.wait(LOCAL_REVEAL_MS);
    if (requestId !== this.mapRequestId) return false;

    // 落ち着いたら CSS クラスで管理（photo-active 時の opacity 制御に必要）
    const snap = requestId;
    this.wait(3000).then(() => {
      if (snap !== this.mapRequestId) return;
      activeEl.style.transition = 'none';
      Object.assign(activeEl.style, { opacity: '', transform: '', zIndex: '' });
      activeEl.className = 'world-map is-active';
      nextEl.style.transition = '';
      Object.assign(nextEl.style, { opacity: '', transform: '', zIndex: '' });
      nextEl.className = 'world-map';
      void activeEl.offsetWidth;
    });

    return true;
  }

  wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  waitForFrameReady(frame, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        frame.removeEventListener('load', finish);
        window.setTimeout(resolve, 200);
      };
      frame.addEventListener('load', finish, { once: true });
      window.setTimeout(finish, timeoutMs);
    });
  }

  renderHistory() {
    this.historyEl.innerHTML = '';
    this.history.slice(-3).reverse().forEach((index) => {
      const place = places[index];
      const item = document.createElement('li');
      item.textContent = `${place.title} / ${place.country}`;
      this.historyEl.appendChild(item);
    });
  }

  setAuto(enabled) {
    this.autoEnabled = enabled;
    this.autoBtn.classList.toggle('active', enabled);
    this.autoBtn.textContent = enabled ? '自動巡回 ON' : '自動巡回 OFF';
    this.clearAutoTimers();
    if (enabled) this.scheduleAuto();
    else this.progressEl.style.width = '0%';
  }

  restartAutoIfNeeded() {
    if (!this.autoEnabled) return;
    this.clearAutoTimers();
    this.scheduleAuto();
  }

  scheduleAuto() {
    this.progressStartedAt = performance.now();
    this.autoTimer = window.setTimeout(() => {
      this.goRandom(false);
      this.scheduleAuto();
    }, AUTO_INTERVAL_MS);
    this.progressTimer = window.setInterval(() => {
      const elapsed = performance.now() - this.progressStartedAt;
      const percent = Math.min(100, (elapsed / AUTO_INTERVAL_MS) * 100);
      this.progressEl.style.width = `${percent}%`;
    }, 100);
  }

  clearAutoTimers() {
    if (this.autoTimer) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.progressTimer) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    this.progressEl.style.width = '0%';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new WorldScenery();
});
