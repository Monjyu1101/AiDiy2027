// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
'use strict';

/* -----------------------------------------------------------------------
   X動画再生BGM — 旧版寄りのシンプルな A/B 自動交互再生
   ----------------------------------------------------------------------- */

let PLAY_DURATION_MS = 1 * 60 * 1000;
const FADE_DURATION_MS = 4000;
const FADE_INTERVAL_MS = 50;
const START_JUDGE_DELAY_MS = 10000;
let MAX_VOLUME = 50;

const st = {
  players: { A: null, B: null },
  ready: { A: false, B: false },
  seekDone: { A: false, B: false },
  currentVideo: { A: null, B: null },
  playlistVideos: [],
  activePlayer: 'B',
  isCrossfading: false,
  pendingFade: false,
  fadeToPlayer: null,
  startJudgeTimerId: null,
  startJudgeSide: null,
  pausedRetryTimerId: null,
  pausedRetrySide: null,
  playTimerId: null,
  progressTimerId: null,
  playStartTime: null,
};

const $ = id => document.getElementById(id);
const rand = n => Math.floor(Math.random() * n);

function formatClock(totalSeconds) {
  return Math.floor(totalSeconds / 60) + ':' + String(totalSeconds % 60).padStart(2, '0');
}

function refreshDurationLabels() {
  const totalSeconds = Math.floor(PLAY_DURATION_MS / 1000);
  if ($('time-total')) $('time-total').textContent = formatClock(totalSeconds);
  if (!st.playStartTime) {
    if ($('time-elapsed')) $('time-elapsed').textContent = '0:00';
    if ($('time-remaining')) $('time-remaining').textContent = '残 ' + formatClock(totalSeconds);
  }
}

function reschedulePlayTimer() {
  if (!st.playStartTime) {
    refreshDurationLabels();
    return;
  }

  if (st.playTimerId) {
    clearTimeout(st.playTimerId);
    st.playTimerId = null;
  }

  const elapsed = Date.now() - st.playStartTime;
  const remainingMs = PLAY_DURATION_MS - elapsed;
  if (remainingMs <= 0) {
    triggerCrossfade('時間経過');
    return;
  }

  st.playTimerId = setTimeout(() => triggerCrossfade('時間経過'), remainingMs);
  updateProgress();
}

function shuffleVideos(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function getRandomVideo(excludeId) {
  if (typeof VIDEOS === 'undefined' || VIDEOS.length === 0) {
    return { name: 'Unknown', id: '', dur: 0 };
  }
  const pool = excludeId ? VIDEOS.filter(v => v.id !== excludeId) : VIDEOS;
  const list = pool.length > 0 ? pool : VIDEOS;
  return list[rand(list.length)];
}

function getSeekStartSeconds(side) {
  const video = st.currentVideo[side];
  const playDurSec = PLAY_DURATION_MS / 1000;
  const dur = video?.dur || st.players[side]?.getDuration?.() || 0;
  if (dur <= playDurSec) return 0;
  return Math.floor(Math.random() * (dur - playDurSec));
}

function getRawPlayerState(side) {
  try {
    const player = st.players[side];
    if (!player) return 'null';
    return String(player.getPlayerState());
  } catch (e) {
    return 'err';
  }
}

function requestSinglePlay(side, delay = 250) {
  setTimeout(() => {
    try {
      st.players[side]?.playVideo();
      renderRawPlayerState();
    } catch (e) {
      console.error(e);
    }
  }, delay);
}

function clickPlayerIframeCenter(side) {
  const host = $(`player-${side.toLowerCase()}`);
  const iframe = host?.querySelector('iframe');
  if (!iframe) return false;

  const rect = iframe.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const options = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
  };

  try {
    iframe.focus();
    iframe.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
    iframe.dispatchEvent(new MouseEvent('mousedown', { ...options, button: 0, buttons: 1 }));
    iframe.dispatchEvent(new PointerEvent('pointerup', { ...options, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
    iframe.dispatchEvent(new MouseEvent('mouseup', { ...options, button: 0, buttons: 0 }));
    iframe.dispatchEvent(new MouseEvent('click', { ...options, button: 0, buttons: 0 }));
    renderRawPlayerState();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function showUserPlayToast() {
  const el = $('user-play-toast');
  if (!el) return;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

function clearPausedRetry() {
  if (st.pausedRetryTimerId) {
    clearTimeout(st.pausedRetryTimerId);
    st.pausedRetryTimerId = null;
  }
  st.pausedRetrySide = null;
}

function schedulePausedRetryOnce(side) {
  clearPausedRetry();
  st.pausedRetrySide = side;
  st.pausedRetryTimerId = setTimeout(() => {
    const player = st.players[side];
    const state = player ? player.getPlayerState() : YT.PlayerState.UNSTARTED;
    clearPausedRetry();
    if (state === YT.PlayerState.PAUSED) {
      requestSinglePlay(side, 0);
      showUserPlayToast();
    }
  }, 5000);
}

function getPlayerStateLabel(state) {
  switch (state) {
    case -1: return 'UNSTARTED';
    case 0: return 'ENDED';
    case 1: return 'PLAYING';
    case 2: return 'PAUSED';
    case 3: return 'BUFFERING';
    case 5: return 'CUED';
    case 'null': return 'NULL';
    case 'err': return 'ERROR';
    default: return String(state);
  }
}

function renderRawPlayerState() {
  const el = $('status-text');
  if (!el) return;
  const stateA = getRawPlayerState('A');
  const stateB = getRawPlayerState('B');
  const playing = [];
  if (stateA === '1') playing.push('A');
  if (stateB === '1') playing.push('B');
  const playingText = playing.length > 0 ? playing.join(',') : '-';
  el.textContent = `A:${stateA}(${getPlayerStateLabel(Number(stateA))}) B:${stateB}(${getPlayerStateLabel(Number(stateB))}) active:${st.activePlayer} playing:${playingText}`;
}

function resetPendingSequence(side) {
  if (!st.pendingFade || st.fadeToPlayer !== side) return;

  try {
    st.players[side]?.stopVideo();
    st.players[side]?.setVolume(0);
  } catch (e) {
    console.error(e);
  }

  st.seekDone[side] = false;
  st.currentVideo[side] = null;
  st.pendingFade = false;
  st.fadeToPlayer = null;
  st.isCrossfading = false;
  renderRawPlayerState();
}

function clearStartJudge() {
  if (st.startJudgeTimerId) {
    clearTimeout(st.startJudgeTimerId);
    st.startJudgeTimerId = null;
  }
  st.startJudgeSide = null;
}

function judgeStartSequenceOnce(side) {
  clearStartJudge();
  st.startJudgeSide = side;
  st.startJudgeTimerId = setTimeout(() => {
    const player = st.players[side];
    const state = player ? player.getPlayerState() : YT.PlayerState.UNSTARTED;
    if (state === YT.PlayerState.PLAYING) {
      clearStartJudge();
      return;
    }

    clearStartJudge();
    const failedId = st.currentVideo[side]?.id || st.currentVideo[st.activePlayer]?.id || null;
    resetPendingSequence(side);
    const nextVideo = getRandomVideo(failedId);
    startSelectedVideoSequence(nextVideo);
  }, START_JUDGE_DELAY_MS);
}

window.onYouTubeIframeAPIReady = function () {
  const commonVars = {
    autoplay: 0,
    mute: 1,
    controls: 1,
    rel: 0,
    modestbranding: 1,
    enablejsapi: 1,
    playsinline: 1,
    origin: window.location.origin,
  };

  ['A', 'B'].forEach(side => {
    st.players[side] = new YT.Player('player-' + side.toLowerCase(), {
      height: '100%',
      width: '100%',
      videoId: '',
      playerVars: commonVars,
      events: {
        onReady: () => onPlayerReady(side),
        onStateChange: e => onStateChange(e, side),
        onError: e => onError(e, side),
      },
    });
  });
};

function onPlayerReady(side) {
  st.ready[side] = true;
  st.players[side].setVolume(0);
  renderRawPlayerState();
  if (st.ready.A && st.ready.B && !st.currentVideo.A) {
    startInitialPlayback();
  }
}

function startInitialPlayback() {
  const video = st.playlistVideos[0] || getRandomVideo(null);
  startSelectedVideoSequence(video);
}

function loadVideoOnPlayer(side, video) {
  st.currentVideo[side] = video;
  st.seekDone[side] = false;
  st.players[side].loadVideoById({ videoId: video.id, startSeconds: 0 });
  requestSinglePlay(side, 300);
  schedulePausedRetryOnce(side);
  judgeStartSequenceOnce(side);
  renderRawPlayerState();
}

function activatePlayerWithoutFade(side) {
  const wrapA = $('player-a-wrap');
  const wrapB = $('player-b-wrap');
  const player = st.players[side];

  try {
    if (player.isMuted()) player.unMute();
    player.setVolume(MAX_VOLUME);
    player.playVideo();
  } catch (e) {
    console.error(e);
  }

  if (wrapA) wrapA.className = 'player-box ' + (side === 'A' ? 'active' : 'inactive');
  if (wrapB) wrapB.className = 'player-box ' + (side === 'B' ? 'active' : 'inactive');

  st.activePlayer = side;
  st.pendingFade = false;
  st.fadeToPlayer = null;
  st.isCrossfading = false;
  updateNowPlaying(side, st.currentVideo[side]?.name || '');
  startPlayTimer();
}

function onStateChange(event, side) {
  const PS = YT.PlayerState;
  renderRawPlayerState();

  if (event.data === PS.PLAYING) {
    if (!st.seekDone[side]) {
      st.seekDone[side] = true;
      const startSeconds = getSeekStartSeconds(side);
      if (startSeconds > 0) {
        try {
          st.players[side].seekTo(startSeconds, true);
          requestSinglePlay(side, 200);
          judgeStartSequenceOnce(side);
          renderRawPlayerState();
        } catch (e) {
          console.error(e);
        }
        return;
      }
    }

    if (st.startJudgeSide === side) {
      clearStartJudge();
    }

    if (st.pendingFade && side === st.fadeToPlayer) {
      if (!st.currentVideo[st.activePlayer]?.id) {
        activatePlayerWithoutFade(side);
        return;
      }
      st.pendingFade = false;
      executeFade(st.activePlayer, st.fadeToPlayer);
    } else if (side === st.activePlayer && !st.isCrossfading) {
      try {
        st.players[side].unMute();
        st.players[side].setVolume(MAX_VOLUME);
      } catch (e) {
        console.error(e);
      }
      startPlayTimer();
    }
  }

  if (event.data === PS.ENDED && side === st.activePlayer && !st.isCrossfading) {
    triggerCrossfade('動画終了');
  }
}

function triggerCrossfade(reason, forcedVideo = null) {
  if (st.isCrossfading) return;
  st.isCrossfading = true;
  clearPlayTimer();
  renderRawPlayerState();

  const next = st.activePlayer === 'A' ? 'B' : 'A';
  const prevId = st.currentVideo[st.activePlayer]?.id;
  const video = forcedVideo || getRandomVideo(prevId);

  st.fadeToPlayer = next;
  st.pendingFade = true;
  st.players[next].setVolume(0);
  loadVideoOnPlayer(next, video);
  updatePlaylistMark(video.name, 'next');
}

function startSelectedVideoSequence(video) {
  if (!video) return;
  if (!st.ready.A || !st.ready.B) return;

  if (!st.currentVideo.A && !st.currentVideo.B) {
    triggerCrossfade('選曲', video);
    return;
  }

  if (st.isCrossfading && st.pendingFade && st.fadeToPlayer) {
    updateStatusText('切り替え中... (選曲)');
    st.players[st.fadeToPlayer].setVolume(0);
    loadVideoOnPlayer(st.fadeToPlayer, video);
    updatePlaylistMark(video.name, 'next');
    return;
  }

  triggerCrossfade('選曲', video);
}

function handlePlaylistItemClick(video) {
  startSelectedVideoSequence(video);
}

function executeFade(from, to) {
  const fromP = st.players[from];
  const toP = st.players[to];
  const fromWrap = $('player-' + from.toLowerCase() + '-wrap');
  const toWrap = $('player-' + to.toLowerCase() + '-wrap');
  const steps = Math.ceil(FADE_DURATION_MS / FADE_INTERVAL_MS);
  let step = 0;

  const iv = setInterval(() => {
    step++;
    const t = Math.min(step / steps, 1);
    const tInv = 1 - t;

    try {
      if (toP.isMuted()) toP.unMute();
      if (fromP.isMuted()) fromP.unMute();
    } catch (e) {
      console.error(e);
    }

    toP.setVolume(Math.round(MAX_VOLUME * t));
    fromP.setVolume(Math.round(MAX_VOLUME * tInv));

    if (toWrap) toWrap.style.opacity = String(t);
    if (fromWrap) fromWrap.style.opacity = String(tInv);

    if (t >= 1) {
      clearInterval(iv);
      fromP.stopVideo();
      fromP.setVolume(0);
      if (fromWrap) {
        fromWrap.style.opacity = '1';
        fromWrap.className = 'player-box inactive';
      }
      if (toWrap) {
        toWrap.style.opacity = '1';
        toWrap.className = 'player-box active';
      }

      st.activePlayer = to;
      st.isCrossfading = false;
      updateNowPlaying(to, st.currentVideo[to]?.name || '');
      startPlayTimer();
    }
  }, FADE_INTERVAL_MS);
}

function startPlayTimer() {
  clearPlayTimer();
  st.playStartTime = Date.now();
  st.playTimerId = setTimeout(() => triggerCrossfade('時間経過'), PLAY_DURATION_MS);
  st.progressTimerId = setInterval(updateProgress, 1000);
  if (st.activePlayer) {
    judgeStartSequenceOnce(st.activePlayer);
  }
  renderRawPlayerState();
  updateProgress();
}

function clearPlayTimer() {
  if (st.playTimerId) {
    clearTimeout(st.playTimerId);
    st.playTimerId = null;
  }
  if (st.progressTimerId) {
    clearInterval(st.progressTimerId);
    st.progressTimerId = null;
  }
}

function updateProgress() {
  if (!st.playStartTime) return;
  const elapsed = Date.now() - st.playStartTime;
  const pct = Math.min((elapsed / PLAY_DURATION_MS) * 100, 100);
  if ($('play-progress')) $('play-progress').style.width = pct + '%';
  renderRawPlayerState();

  const es = Math.floor(elapsed / 1000);
  const rs = Math.max(0, Math.floor((PLAY_DURATION_MS - elapsed) / 1000));
  if ($('time-elapsed')) $('time-elapsed').textContent = formatClock(es);
  if ($('time-remaining')) $('time-remaining').textContent = '残 ' + formatClock(rs);
  if ($('time-total')) $('time-total').textContent = formatClock(Math.floor(PLAY_DURATION_MS / 1000));
}

function updateNowPlaying(side, title) {
  if ($('player-indicator')) {
    $('player-indicator').textContent = 'Player ' + side;
    $('player-indicator').className = 'player-badge player-' + side.toLowerCase();
  }
  if ($('current-title')) $('current-title').textContent = title;
  updatePlaylistMark(title, 'active');
}

function updateStatusText(text) {
  renderRawPlayerState();
}

function updatePlaylistMark(name, cls) {
  const items = Array.from(document.querySelectorAll('#playlist-list li'));
  let markedIndex = -1;

  items.forEach((li, index) => {
    li.classList.remove('active', 'next', 'is-before', 'is-after', 'is-far');
    if (li.dataset.name === name) {
      li.classList.add(cls);
      markedIndex = index;
    }
  });

  if (cls !== 'active' || markedIndex < 0) return;

  items.forEach((li, index) => {
    const delta = index - markedIndex;
    if (delta === -1) li.classList.add('is-before');
    else if (delta === 1) li.classList.add('is-after');
    else if (Math.abs(delta) >= 2) li.classList.add('is-far');
  });

  const activeItem = items[markedIndex];
  activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function onError(event, side) {
  console.warn(`[BGM] Error side=${side} code=${event.data}`);
  renderRawPlayerState();
  if (side === st.activePlayer && !st.isCrossfading) {
    setTimeout(() => triggerCrossfade('エラー'), 3000);
  } else if (st.pendingFade && side === st.fadeToPlayer) {
    st.pendingFade = false;
    st.isCrossfading = false;
    setTimeout(() => triggerCrossfade('リトライ'), 3000);
  }
}

function buildPlaylist() {
  const ul = $('playlist-list');
  if (!ul) return;
  ul.innerHTML = '';
  st.playlistVideos = shuffleVideos(VIDEOS);
  st.playlistVideos.forEach((v, i) => {
    const li = document.createElement('li');
    li.dataset.name = v.name;
    li.innerHTML = `<span class="pl-num">${i + 1}</span><span class="pl-name">${v.name}</span>`;
    li.onclick = () => handlePlaylistItemClick(v);
    ul.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  buildPlaylist();
  refreshDurationLabels();
  renderRawPlayerState();

  const volSelect = $('max-volume-select');
  if (volSelect) {
    MAX_VOLUME = parseInt(volSelect.value, 10);
    volSelect.onchange = e => {
      MAX_VOLUME = parseInt(e.target.value, 10);
      if (!st.isCrossfading && st.activePlayer) {
        try {
          const p = st.players[st.activePlayer];
          if (p && p.getPlayerState() === YT.PlayerState.PLAYING) {
            p.setVolume(MAX_VOLUME);
          }
        } catch (err) {
          console.error(err);
        }
      }
    };
  }

  const playDurationSelect = $('play-duration-select');
  if (playDurationSelect) {
    playDurationSelect.value = String(PLAY_DURATION_MS / 60000);
    playDurationSelect.onchange = e => {
      PLAY_DURATION_MS = parseInt(e.target.value, 10) * 60 * 1000;
      refreshDurationLabels();
      reschedulePlayTimer();
    };
  }

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
});
