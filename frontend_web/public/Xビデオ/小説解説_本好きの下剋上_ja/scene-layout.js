(function () {
  const scene = window.SCENARIO?.scenes?.[window._SCENE_INDEX];
  if (scene?.image) {
    const imageUrl = String(scene.image).replace(/(["\\])/g, "\\$1");
    document.documentElement.style.setProperty("--scene-background", `url("${imageUrl}")`);
  }

  document.querySelectorAll(".panel-title").forEach((title) => {
    if (title.textContent.trim() === "確認ポイント") title.textContent = "ポイント";
  });

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "scene-overlay.css";
  document.head.appendChild(stylesheet);
})();
