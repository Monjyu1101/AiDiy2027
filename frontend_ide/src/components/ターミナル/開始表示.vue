<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
const props = defineProps({ icon: String, kind: { default: 'code' }, started: Boolean, routing: Boolean });
const inputStarted = ref(false);
const escapeOffset = ref(0);
const markHolder = ref(null);
let resizeObserver, pointerDocument, pointerPosition, animationFrame, previousTime;
function escapeLimit(holder) {
  return Math.max(0, (holder.parentElement.clientWidth - holder.offsetWidth) / 2 - 20);
}
onMounted(() => {
  if (props.kind !== 'navi' || !globalThis.ResizeObserver) return;
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
  if (distance < 100 && limit > 0) {
    let direction = dx >= 0 ? 1 : -1;
    if ((direction > 0 && next >= limit - 1) || (direction < 0 && next <= -limit + 1)) direction = -direction;
    next = Math.max(-limit, Math.min(limit, next + direction * elapsed * 0.07));
  } else if (distance > 175) {
    const step = elapsed * 0.035;
    next = Math.abs(next) <= step ? 0 : next - Math.sign(next) * step;
  }
  escapeOffset.value = next;
  if ((distance < 100 && limit > 0) || (distance > 175 && next !== 0)) startMovement();
  else previousTime = null;
}
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (animationFrame) cancelAnimationFrame(animationFrame);
  pointerDocument?.removeEventListener('pointermove', trackPointer);
  pointerDocument?.removeEventListener('pointerout', leaveDocument);
});
function escapeIcon(event) {
  if (props.kind !== 'navi' || event.pointerType === 'touch') return;
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
watch(() => props.started, value => { if (value) inputStarted.value = true; }, { immediate: true });
const lines = {
  console: ['WELCOME TO YOUR REMOTE TERMINAL', 'WHAT WOULD YOU LIKE TO RUN?', 'ENTER A COMMAND TO GET STARTED.'],
  navi: ['SET YOUR GOAL.', "I’LL EVALUATE YOUR PROGRESS", 'AND GUIDE YOU FORWARD.'],
  route: ['DESTINATION SET.', 'FINDING YOUR ROUTE', 'PLEASE WAIT WHILE I EXPLORE.'],
  code: ['LET’S BUILD SOMETHING', 'WHAT WILL YOU BUILD?', 'IT STARTS HERE.'],
  live: ['LET’S START A CONVERSATION', 'CONNECT, THEN TURN YOUR MIC ON.', 'YOU CAN ALSO TYPE TO CHAT.'],
  ide: ['FROM WORKSPACE TO OUTER SPACE.', 'MAKE SPACE FOR YOUR IDEAS.', 'CONNECT TO AIDIY OR EXPLORE OFFLINE.'],
};
</script>
<template>
  <div class="terminal-welcome" :class="[kind, { 'welcome-input-started': inputStarted }]" :role="routing ? 'status' : undefined" :aria-live="routing ? 'polite' : undefined" lang="en">
    <div ref="markHolder" class="welcome-mark-holder" :class="{ 'navi-escape': kind === 'navi' }" :style="kind === 'navi' ? { transform: `translateX(${escapeOffset}px)` } : undefined" @pointerenter="escapeIcon" aria-hidden="true"><div class="welcome-mark"><img :src="icon" alt=""></div></div>
    <p class="welcome-eyebrow"><span class="welcome-type"><span class="welcome-text">{{ lines[routing && kind === 'navi' ? 'route' : kind][0] }}</span></span></p>
    <h1><span class="welcome-type"><span class="welcome-text">{{ lines[routing && kind === 'navi' ? 'route' : kind][1] }}</span></span></h1>
    <p class="welcome-caption"><span class="welcome-type"><span class="welcome-text">{{ lines[routing && kind === 'navi' ? 'route' : kind][2] }}</span></span></p>
  </div>
</template>
<style scoped>
.welcome-mark-holder { display: contents; }
.welcome-mark-holder.navi-escape { display: block; flex: none; }
@media (prefers-reduced-motion: reduce) { .welcome-mark-holder.navi-escape { transition: none; } }
</style>
