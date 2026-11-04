(() => {
  "use strict";

  // 再生開始とループの周回開始を「5・4・3」で分かりやすく知らせ、
  // 表示後も 2 秒待ってから再生する。シーン・ターン間の通常切替では呼び出さない。
  const START_DELAY_MS = 5000;
  const COUNTDOWN_VISIBLE_MS = 3000;

  let countdownTimerId = null;
  let countdownOverlay = null;

  function getCountdownOverlay() {
    if (countdownOverlay?.isConnected) return countdownOverlay;

    countdownOverlay = document.createElement("div");
    countdownOverlay.setAttribute("aria-hidden", "true");
    Object.assign(countdownOverlay.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2147483647",
      pointerEvents: "none",
      background: "rgba(2, 7, 13, 0.28)",
      backdropFilter: "blur(2px)",
      color: "#fff",
      fontFamily: "Arial, sans-serif",
      fontSize: "min(24vw, 13rem)",
      fontWeight: "800",
      lineHeight: "1",
      textShadow: "0 3px 18px rgba(0, 0, 0, 0.9)",
    });
    document.body.appendChild(countdownOverlay);
    return countdownOverlay;
  }

  function hideCountdown() {
    if (countdownTimerId !== null) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
    if (countdownOverlay) countdownOverlay.style.display = "none";
  }

  function showCountdown() {
    hideCountdown();
    const overlay = getCountdownOverlay();
    const startedAt = performance.now();

    function render() {
      const elapsedMs = performance.now() - startedAt;
      if (elapsedMs >= COUNTDOWN_VISIBLE_MS) {
        hideCountdown();
        return;
      }
      overlay.textContent = String(5 - Math.floor(elapsedMs / 1000));
      overlay.style.display = "flex";
    }

    render();
    countdownTimerId = setInterval(render, 50);
  }

  function createStartGate() {
    let timerId = null;
    let generation = 0;

    function cancel() {
      generation += 1;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      hideCountdown();
    }

    function start(callback) {
      cancel();
      const token = ++generation;
      showCountdown();
      timerId = setTimeout(() => {
        timerId = null;
        hideCountdown();
        if (token === generation) callback();
      }, START_DELAY_MS);
    }

    return {
      start,
      cancel,
      isPending: () => timerId !== null,
    };
  }

  window.AiDiyVideoPlayback = Object.freeze({
    START_DELAY_MS,
    createStartGate,
  });
})();
