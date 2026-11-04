(() => {
  "use strict";

  const subtitle = document.getElementById("subtitle");
  const sceneFrame = document.getElementById("sceneFrame");
  const modeButton = document.getElementById("modeBtn");
  const audio = window.audioPlayer;
  const scenes = window.SCENARIO?.scenes;
  if (!subtitle || !sceneFrame || !modeButton || !audio || !Array.isArray(scenes)) return;

  const scenesById = new Map(scenes.map(scene => [scene.id, scene]));
  const telopCache = new WeakMap();
  let playbackKey = "";
  let audioHasStarted = false;

  function hide() {
    subtitle.classList.remove("telop-active");
    if (subtitle.textContent) subtitle.textContent = "";
  }

  function currentScene() {
    const file = (sceneFrame.getAttribute("src") || "").split("?")[0];
    return scenesById.get(file.replace(/\.html$/, ""));
  }

  function currentMode() {
    return modeButton.textContent.includes("ロング") ? "long" : "short";
  }

  function getTelops(scene, mode) {
    let byMode = telopCache.get(scene);
    if (!byMode) {
      byMode = new Map();
      telopCache.set(scene, byMode);
    }
    const key = mode;
    if (byMode.has(key)) return byMode.get(key);

    const grouped = window.NovelTelopTiming.groups(scene[`${mode}_narration`]);
    byMode.set(key, grouped);
    return grouped;
  }

  function update() {
    const scene = currentScene();
    const mode = currentMode();
    const key = scene ? `${scene.id}:${mode}` : "";
    if (key !== playbackKey) {
      playbackKey = key;
      audioHasStarted = false;
      hide();
    }
    if (!scene || !audioHasStarted || audio.paused || audio.ended) {
      hide();
      return;
    }

    const telops = getTelops(scene, mode);
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : Number(scene[`${mode}_duration_sec`]) || 0;
    const elapsed = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    const selected = window.NovelTelopTiming.select(scene, mode, audio, telops, elapsed, duration);
    if (!selected) { hide(); return; }
    if (subtitle.textContent !== selected) subtitle.textContent = selected;
    subtitle.classList.add("telop-active");
  }

  audio.addEventListener("playing", () => {
    const scene = currentScene();
    playbackKey = scene ? `${scene.id}:${currentMode()}` : "";
    audioHasStarted = true;
    update();
  });
  for (const eventName of ["pause", "ended", "error", "emptied"]) {
    audio.addEventListener(eventName, () => {
      audioHasStarted = false;
      hide();
    });
  }
  modeButton.addEventListener("click", () => {
    audioHasStarted = false;
    hide();
  });
  if (window.MutationObserver) {
    new window.MutationObserver(() => {
      audioHasStarted = false;
      hide();
    }).observe(sceneFrame, { attributes: true, attributeFilter: ["src"] });
  }

  hide();
  audio.addEventListener("timeupdate", update);
})();
