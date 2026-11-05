<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
// AiDiy マーク（welcome-mark）。マウスが近づくほど加速して左右へ逃げ、離れたらホームポジションへ戻る。
// Code / Live / Console / IDE / Navigator / Task・Team ログインで共通利用する（VS Code 拡張も同じバンドル）。
import { ref, onMounted, onBeforeUnmount } from 'vue';
defineProps({ icon: String });
const escapeOffset = ref(0);
const markHolder = ref(null);
const ESCAPE_RADIUS = 72;
let resizeObserver, pointerDocument, pointerPosition, animationFrame, previousTime;
function escapeLimit(holder) {
  return Math.max(0, (holder.parentElement.clientWidth - holder.offsetWidth) / 2 - 20);
}
onMounted(() => {
  if (!globalThis.ResizeObserver) return;
  resizeObserver = new ResizeObserver(() => {
    const limit = escapeLimit(markHolder.value);
    escapeOffset.value = Math.max(-limit, Math.min(limit, escapeOffset.value));
  });
  resizeObserver.observe(markHolder.value.parentElement);
});
function trackPointer(event) {
  if (event.pointerType === 'touch') return;
  pointerPosition = { x: event.clientX, y: event.clientY };
  startMovement();
}
function leaveDocument(event) {
  if (!event.relatedTarget) { pointerPosition = null; startMovement(); }
}
function startMovement() {
  if (!animationFrame) animationFrame = requestAnimationFrame(moveIcon);
}
function moveIcon(time) {
  animationFrame = null;
  const holder = markHolder.value;
  if (!holder) return;
  const elapsed = previousTime == null ? 16 : Math.min(time - previousTime, 50);
  previousTime = time;
  const rect = holder.getBoundingClientRect(), limit = escapeLimit(holder);
  const dx = pointerPosition ? rect.left + rect.width / 2 - pointerPosition.x : 0;
  const dy = pointerPosition ? rect.top + rect.height / 2 - pointerPosition.y : 0;
  const distance = pointerPosition ? Math.hypot(dx, dy) : Infinity;
  let next = escapeOffset.value;
  if (distance < ESCAPE_RADIUS && limit > 0) {
    let direction = dx >= 0 ? 1 : -1;
    if ((direction > 0 && next >= limit - 1) || (direction < 0 && next <= -limit + 1)) direction = -direction;
    // マウスに近づくほど加速して逃げる（反応距離の端でゆっくり約0.04px/ms、中心で最速約2.2px/ms）
    const closeness = 1 - distance / ESCAPE_RADIUS;
    const speed = 0.04 + 2.2 * closeness * closeness;
    next = Math.max(-limit, Math.min(limit, next + direction * elapsed * speed));
  } else {
    // 反応距離を出たらホームポジションへ戻る。ただし戻った先でまた逃げることになるなら戻らず待つ（びくびく防止）
    const step = elapsed * 0.1;
    const candidate = Math.abs(next) <= step ? 0 : next - Math.sign(next) * step;
    const homeX = rect.left + rect.width / 2 - next;
    const candidateDistance = pointerPosition ? Math.hypot(homeX + candidate - pointerPosition.x, dy) : Infinity;
    if (candidateDistance >= ESCAPE_RADIUS) next = candidate;
  }
  const moved = next !== escapeOffset.value;
  escapeOffset.value = next;
  if ((distance < ESCAPE_RADIUS && limit > 0) || moved) startMovement();
  else previousTime = null;
}
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (animationFrame) cancelAnimationFrame(animationFrame);
  pointerDocument?.removeEventListener('pointermove', trackPointer);
  pointerDocument?.removeEventListener('pointerout', leaveDocument);
});
function escapeIcon(event) {
  if (event.pointerType === 'touch') return;
  const doc = event.currentTarget.ownerDocument;
  if (pointerDocument !== doc) {
    pointerDocument?.removeEventListener('pointermove', trackPointer);
    pointerDocument?.removeEventListener('pointerout', leaveDocument);
    pointerDocument = doc;
    doc.addEventListener('pointermove', trackPointer);
    doc.addEventListener('pointerout', leaveDocument);
  }
  trackPointer(event);
}
</script>
<template>
  <div ref="markHolder" class="welcome-mark-holder mark-escape" :style="{ transform: `translateX(${escapeOffset}px)` }" @pointerenter="escapeIcon" aria-hidden="true"><div class="welcome-mark"><img :src="icon" alt=""></div></div>
</template>
<style scoped>
.welcome-mark-holder { display: block; flex: none; }
</style>
