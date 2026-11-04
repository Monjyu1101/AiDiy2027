(function () {
  const scene = window.SCENARIO?.scenes?.[window._SCENE_INDEX];
  if (scene?.image) {
    const imageUrl = String(scene.image).replace(/(["\\])/g, "\\$1");
    document.documentElement.style.setProperty("--scene-background", `url("${imageUrl}")`);
  }

  document.querySelectorAll(".panel-title").forEach((title) => {
    if (title.textContent.trim() === "確認ポイント") title.textContent = "ポイント";
  });

  // 締めだけ、本編の既存4画像をそのまま同時表示する。
  if (scene?.id === "scene_999") {
    document.getElementById("stage").classList.add("stage-recap");
    const grid = document.createElement("div");
    grid.className = "recap-grid";
    grid.setAttribute("aria-label", "本編4コマの振り返り");
    ["scene_001", "scene_002", "scene_003", "scene_004"].forEach((id, index) => {
      const panel = window.SCENARIO.scenes.find((item) => item.id === id);
      const figure = document.createElement("figure");
      figure.className = "recap-panel";
      const img = document.createElement("img");
      img.src = panel.image;
      img.alt = panel.title;
      const caption = document.createElement("figcaption");
      caption.textContent = `${index + 1}. ${panel.headline}`;
      img.addEventListener("error", () => {
        caption.textContent = `${index + 1}. 画像を表示できません：${panel.headline}`;
      }, { once: true });
      figure.append(img, caption);
      grid.appendChild(figure);
    });
    document.querySelector(".visual-panel").appendChild(grid);
  }

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "scene-overlay.css";
  document.head.appendChild(stylesheet);
})();
