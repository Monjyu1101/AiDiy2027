// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const scene = window.MOTION_SCENES.find(item => item.id === window.MOTION_SCENE_ID);
if (!scene) {
  document.body.textContent = "シーンが見つかりません。";
} else {
  const title = document.createElement("h1");
  title.textContent = scene.title;
  const number = document.createElement("div");
  number.className = "scene-number";
  number.textContent = scene.number;
  const description = document.createElement("p");
  description.className = "scene-description";
  description.textContent = scene.description;
  const note = document.createElement("p");
  note.className = "scene-note";
  note.textContent = scene.file
    ? "再生後は普通の立ち姿で止まります。同じ番号を押すと、もう一度確認できます。"
    : "前へ戻るか、下の一覧から任意のモーションを選べます。";
  const card = document.createElement("main");
  card.className = "scene-card";
  card.append(number, title, description, note);
  document.body.append(card);
}
document.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  window.parent.postMessage({ type: "avatar-motion-page", direction: event.key === "ArrowRight" ? 1 : -1 }, window.location.origin);
});
