(() => {
  "use strict";

  const REVEAL_ZONE_PX = 132;
  const HIDE_DELAY_MS = 1100;

  function install() {
    const controls = document.querySelector("footer.controls");
    const controlsCenter = controls?.querySelector(".controls-center");
    const controlsRight = controls?.querySelector(".controls-right");
    if (!controls || !controlsCenter || !controlsRight || document.querySelector(".video-progress-indicator")) return;

    const style = document.createElement("style");
    style.textContent = `
      html, body {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }
      footer.controls.video-controls-auto-hide {
        height: 40px;
        align-self: end;
        transform: translateY(calc(100% + 2px));
        transition: transform 300ms cubic-bezier(.2,.8,.2,1), opacity 220ms ease;
        will-change: transform;
      }
      html.video-controls-revealed footer.controls.video-controls-auto-hide {
        transform: translateY(-8px);
      }
      .subtitle {
        bottom: 20px !important;
      }
      footer.controls.video-controls-auto-hide button {
        height: 32px;
        min-width: 32px;
      }
      .video-progress-indicator {
        position: fixed;
        inset: auto 0 0;
        z-index: 22;
        width: 100%;
        height: 8px;
        background: transparent;
        pointer-events: none;
      }
      .video-progress-indicator .controls-center {
        display: block;
        width: 100%;
      }
      .video-progress-indicator .progress {
        width: 100%;
        height: 8px;
        border: 0;
        border-radius: 0;
        background: transparent;
      }
      #avatar-container,
      #avatar-left,
      #avatar-right {
        bottom: -2px !important;
      }
      @media (max-width: 980px) {
        #avatar-container,
        #avatar-left,
        #avatar-right {
          bottom: -6px !important;
        }
      }
      @media (max-width: 920px) and (min-width: 641px) and (orientation: portrait) {
        .subtitle {
          bottom: 52px !important;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        footer.controls.video-controls-auto-hide {
          transition: none;
        }
      }
    `;
    document.head.appendChild(style);

    const indicator = document.createElement("div");
    indicator.className = "video-progress-indicator";
    indicator.setAttribute("aria-label", "再生インジケータ");
    controlsCenter.parentElement?.removeChild(controlsCenter);
    indicator.appendChild(controlsCenter);
    document.body.appendChild(indicator);

    // 上部の音声切替を、再生操作と同じ欄の右端へ移す。
    const speakerButton = document.getElementById("speakerBtn");
    if (speakerButton) controlsRight.appendChild(speakerButton);

    controls.classList.add("video-controls-auto-hide");
    let hideTimer = null;
    // ポインタが欄の上にあるかどうか。非表示タイマーの発火時に参照する。
    let pointerInRevealZone = false;

    function inRevealZone(clientY) {
      return clientY >= window.innerHeight - REVEAL_ZONE_PX;
    }

    function reveal() {
      clearTimeout(hideTimer);
      hideTimer = null;
      document.documentElement.classList.add("video-controls-revealed");
    }

    function hideSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        // 欄の上にポインタが留まっている間だけ出したままにする。
        if (pointerInRevealZone) return;
        document.documentElement.classList.remove("video-controls-revealed");
      }, HIDE_DELAY_MS);
    }

    // 表示したうえで、必ず自動非表示を予約する。
    // キー操作やタッチのように後続の pointermove が来ない経路で使う。
    function revealTemporarily() {
      reveal();
      hideSoon();
    }

    function updateForPointer(event) {
      pointerInRevealZone = inRevealZone(event.clientY);
      if (pointerInRevealZone) reveal();
      else hideSoon();
    }

    function releasePointer(event) {
      // タッチは指を離した時点で「欄の上」ではなくなる。
      // マウスは離しても位置が変わらないので pointermove の判定を残す。
      if (event && event.pointerType === "mouse") return;
      pointerInRevealZone = false;
      hideSoon();
    }

    // 連続再生ページ等の埋め込み用。?kiosk=1 ではポインタ位置で再生バーを出さない
    // (放置したマウスが下端にあっても出しっぱなしにならない)。キー操作では従来どおり一時表示する。
    const kiosk = new URLSearchParams(window.location.search).get("kiosk") === "1";
    if (kiosk) {
      document.querySelectorAll(".controls-reveal-zone").forEach((zone) => {
        zone.style.pointerEvents = "none";
      });
      controls.style.pointerEvents = "none";
    } else {
      window.addEventListener("pointermove", updateForPointer, { passive: true });
      window.addEventListener("pointerup", releasePointer, { passive: true });
      window.addEventListener("pointercancel", releasePointer, { passive: true });
      window.addEventListener("focusin", revealTemporarily);
      window.addEventListener("focusout", hideSoon);
      controls.addEventListener("pointerenter", () => {
        pointerInRevealZone = true;
        reveal();
      });
      controls.addEventListener("pointerleave", () => {
        pointerInRevealZone = false;
        hideSoon();
      });
      controls.addEventListener("pointerdown", revealTemporarily);
    }

    // iframe が画面下端まで広がるページでは、検知領域を離れた後の
    // pointermove が親 window へ届かない。専用レイヤーの出入りを直接監視し、
    // 「下端にいる」状態が残り続けないようにする。
    document.querySelectorAll(".controls-reveal-zone").forEach((zone) => {
      zone.addEventListener("pointerenter", () => {
        pointerInRevealZone = true;
        reveal();
      });
      zone.addEventListener("pointerleave", (event) => {
        if (event.relatedTarget instanceof Node && controls.contains(event.relatedTarget)) return;
        pointerInRevealZone = false;
        hideSoon();
      });
    });

    window.addEventListener("keydown", revealTemporarily);
    window.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (touch && inRevealZone(touch.clientY)) revealTemporarily();
    }, { passive: true });

    hideSoon();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
