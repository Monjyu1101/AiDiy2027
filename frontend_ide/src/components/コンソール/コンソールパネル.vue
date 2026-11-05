<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import StatusBar from '../共通表示/状態バー.vue';
import TerminalWelcome from '../コンソール/開始表示.vue';
import { cliTitleName } from './CLIタイトル.js';
import { consoleKeyHandler } from './キー入力.js';
import { consoleCompletion, cliCompletions } from '../コンソール/コマンド補完.js';
const props = defineProps({ base: String, icon: String, desktop: Boolean, linked: Boolean, visible: { type: Boolean, default: true } });
const windowTitle = ref('');
const container = ref(null), connected = ref(false), status = ref('起動中'), project = ref(''), shell = ref(''), error = ref('');
const completion = ref(''), toolsOnline = ref(false), cli = ref(null);
const title = computed(() => (windowTitle.value || (props.linked ? 'AiDiy IDE / Console' : 'AiDiy Console')) + (cliTitleName(cli.value) ? ' / ' + cliTitleName(cli.value) : ''));
const toolsEnabled = ref(true), toolsChanging = ref(false), socketReady = ref(false);
const ghostRows = ref([]);
const inputStarted = ref(false);
const completionDescription = computed(() => cliCompletions[completion.value.split(' ')[0]]?.description || '');
const projectName = computed(() => project.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || project.value);
let terminal, fit, socket, observer, input, key, resize, cursor, scroll, render, completionEnabled = false, disposed = false;
function startInput() {
  if (!connected.value || inputStarted.value) return;
  inputStarted.value = true;
  nextTick(() => { if (!disposed) { fitTerminal(); updateCompletion(); } });
}
async function clearDisplay() {
  terminal.clear();
  inputStarted.value = !!cli.value;
  await nextTick();
  if (disposed) return;
  fitTerminal(); updateCompletion(); terminal.focus();
}
function updateCompletion() {
  completion.value = connected.value && completionEnabled ? consoleCompletion(terminal.buffer.active) : '';
  ghostRows.value = [];
  if (!completion.value || !props.visible) return;
  const buffer = terminal.buffer.active, screen = container.value.querySelector('.xterm-screen');
  if (!screen) return;
  const bounds = screen.getBoundingClientRect(), outer = container.value.getBoundingClientRect();
  const width = bounds.width / terminal.cols, height = bounds.height / terminal.rows;
  let x = buffer.cursorX, y = buffer.baseY + buffer.cursorY - buffer.viewportY;
  const previous = x > 0 ? buffer.getLine(buffer.baseY + buffer.cursorY)?.getCell(x - 1)?.getChars() : '';
  let suffix = (previous === ' ' ? '' : ' ') + cliCompletions[completion.value.split(' ')[0]].options;
  // コマンド直後の空白は透過のままにして、端末自身のカーソルを隠さない。
  if (suffix.startsWith(' ')) { x++; suffix = suffix.slice(1); }
  const rows = [];
  while (suffix && y < terminal.rows) {
    if (x >= terminal.cols) { x = 0; y++; continue; }
    const text = suffix.slice(0, terminal.cols - x);
    if (y >= 0) rows.push({ text, style: { left: `${bounds.left - outer.left + x * width}px`, top: `${bounds.top - outer.top + y * height}px`, width: `${(terminal.cols - x) * width}px`, height: `${height}px`, lineHeight: `${height}px` } });
    suffix = suffix.slice(text.length); x = 0; y++;
  }
  ghostRows.value = rows;
}
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function sendInput(data) {
  if (!connected.value) return;
  for (let i = 0; i < data.length; i += 16000) send({ type: 'input', data: data.slice(i, i + 16000) });
}
function interrupt() {
  if (!connected.value) return;
  startInput(); sendInput('\x03'); terminal.focus();
}
function toggleTools() {
  if (!socketReady.value || toolsChanging.value) return;
  toolsChanging.value = true;
  send({ type: 'tools-check', enabled: !toolsEnabled.value });
}
function fitTerminal() {
  if (!props.visible || !container.value?.clientWidth || !container.value?.clientHeight) return;
  fit?.fit();
}
function connect() {
  if (disposed) return;
  inputStarted.value = false;
  socketReady.value = false; toolsChanging.value = false;
  socket?.close(); completion.value = ''; completionEnabled = false; terminal.reset(); connected.value = false; error.value = ''; status.value = '起動中';
  const url = new URL(props.base + 'socket', location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = socket = new WebSocket(url);
  current.onopen = () => { if (current !== socket || disposed) return current.close(); fitTerminal(); send({ type: 'start', cols: terminal.cols, rows: terminal.rows }); };
  current.onmessage = event => {
    if (current !== socket || disposed) return;
    const message = JSON.parse(event.data);
    if (message.type === 'ready') { cli.value = message.cli || null; connected.value = !cli.value || message.state === 'running'; if (cli.value) { inputStarted.value = true; nextTick(fitTerminal); } socketReady.value = true; toolsOnline.value = !!message.toolsOnline; toolsEnabled.value = !!message.toolsEnabled; completionEnabled = !!message.completion; status.value = connected.value ? '実行中' : message.state === 'error' ? 'エラー' : '終了'; project.value = message.project; shell.value = message.shell; terminal.focus(); }
    if (message.type === 'tools') { toolsOnline.value = !!message.online; toolsEnabled.value = !!message.enabled; toolsChanging.value = false; }
    if (message.type === 'data') terminal.write(message.data, () => { if (current === socket && current.readyState === WebSocket.OPEN) { current.send(JSON.stringify({ type: 'ack', length: message.data.length })); updateCompletion(); } });
    if (message.type === 'exit') { connected.value = false; completion.value = ''; status.value = `終了 (${message.exitCode})`; terminal.writeln(`\r\n[${cli.value?.name || 'シェル'}が終了しました: ${message.exitCode}]`); }
    if (message.type === 'error') { if (cli.value) connected.value = false; error.value = message.message; status.value = 'エラー'; }
  };
  current.onclose = () => { if (current !== socket || disposed) return; socketReady.value = false; toolsChanging.value = false; connected.value = false; toolsOnline.value = false; completion.value = ''; if (status.value === '実行中' || status.value === '起動中') status.value = '切断'; };
  current.onerror = () => { if (current === socket && !disposed) error.value = '端末に接続できません。接続し直してください。'; };
}
watch(() => props.visible, async visible => { if (visible) { await nextTick(); fitTerminal(); terminal?.focus(); } });
onMounted(() => {
  if (props.desktop && props.linked) void window.aidiyWindow?.title?.().then(title => { if (!disposed && typeof title === 'string') windowTitle.value = title; }).catch(() => {});
  terminal = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Consolas, "Noto Sans Mono", monospace', scrollback: 5000,
    theme: { background: '#000', foreground: '#dce6f2', cursor: '#ffffff', selectionBackground: '#365b78' } });
  fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container.value); fitTerminal();
  terminal.attachCustomKeyEventHandler(consoleKeyHandler(data => { startInput(); sendInput(data); }));
  input = terminal.onData(sendInput);
  key = terminal.onKey(startInput);
  container.value.addEventListener('input', startInput, true);
  container.value.addEventListener('paste', startInput, true);
  resize = terminal.onResize(({ cols, rows }) => { if (connected.value) send({ type: 'resize', cols, rows }); });
  cursor = terminal.onCursorMove(updateCompletion);
  scroll = terminal.onScroll(updateCompletion);
  render = terminal.onRender(updateCompletion);
  observer = new ResizeObserver(fitTerminal); observer.observe(container.value);
  connect();
});
onBeforeUnmount(() => { disposed = true; socket?.close(); observer?.disconnect(); input?.dispose(); key?.dispose(); container.value?.removeEventListener('input', startInput, true); container.value?.removeEventListener('paste', startInput, true); resize?.dispose(); cursor?.dispose(); scroll?.dispose(); render?.dispose(); terminal?.dispose(); });
</script>
<template>
  <section class="console-component" :class="{ 'desktop-window': desktop, 'console-waiting': !inputStarted }">
    <StatusBar :title="title" :mode="toolsEnabled ? 'online' : 'offline'" :status="toolsEnabled ? '' : '確認OFF'" :connected="toolsOnline" :desktop="desktop" clock-pulse />
    <div class="component-toolbar"><span :title="project">プロジェクト: {{ projectName }}</span><nav><button class="auto-connect" role="switch" :aria-checked="toolsEnabled" :title="`Tools接続確認 ${toolsEnabled ? 'ON' : 'OFF'}`" :disabled="!socketReady || toolsChanging" @click="toggleTools"><span>Tools接続確認</span><span class="auto-connect-track" aria-hidden="true"><span class="auto-connect-thumb"></span></span></button><button :disabled="!connected" title="実行中の処理へ割り込みを送信（キーボードのCtrl+Cはコピー専用）" @click="interrupt">Ctrl+C送信</button><button @click="clearDisplay">表示クリア</button><button v-if="!connected" @click="connect">{{ cli ? '再接続' : '再起動' }}</button></nav></div>
    <div v-if="!inputStarted" class="console-welcome"><TerminalWelcome kind="console" :icon="icon || '/development/AiDiy.png'" /></div>
    <div class="console-screen" aria-label="ターミナル"><div ref="container" class="console-viewport"><div v-if="completion" class="console-completion" role="status" :aria-label="`${completion}（Tabで補完）`"><span v-for="(row, i) in ghostRows" :key="i" class="console-ghost-row" :style="row.style" aria-hidden="true">{{ row.text }}</span></div></div></div>
    <div class="console-meta"><span :title="cli ? `${cli.name} · ${cli.mode} · モデル指定なし` : completionDescription">{{ completion ? 'Tabで補完 · Enterで実行' : `${shell}${cli ? ` · ${cli.mode} · モデル指定なし` : ''} · ${status}` }}</span><span :title="'Toolsサーバーの稼働状態'">Tools {{ !toolsEnabled ? '確認OFF' : toolsOnline ? 'オンライン' : 'オフライン' }}</span></div>
    <p v-if="error" class="console-error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.console-component{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:#000;color:var(--foreground);font:var(--vscode-font-size,13px)/1.65 var(--vscode-font-family,"Segoe UI","Yu Gothic UI",sans-serif);container:console-panel / size}
.component-toolbar button{padding:2px 7px;border-color:var(--border);font-size:11px;line-height:1.4;background:transparent}
.console-welcome{flex:1;min-height:0;overflow:auto;background:var(--surface);container-type:size}
.console-waiting .console-screen{flex:none;height:84px;max-height:30%;border-top:1px solid var(--border)}
.console-meta{display:flex;justify-content:space-between;gap:8px;flex:none;padding:2px 8px;color:var(--muted);font-size:10px;border-top:1px solid var(--border)}
.console-meta>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.console-meta>span:last-child{flex:none;white-space:nowrap}
.console-screen{position:relative;flex:1;min-height:0;min-width:0;padding:8px;overflow:hidden}.console-error{color:#ffbac3;margin:6px 10px;font-size:12px}
/* FitAddonには余白を除いた領域を渡し、小さな画面でも最後の入力行を切らない。 */
.console-viewport{position:relative;width:100%;height:100%;min-width:0;min-height:0}
.console-completion{pointer-events:none}.console-ghost-row{position:absolute;z-index:4;white-space:pre;overflow:hidden;font:14px Consolas,"Noto Sans Mono",monospace;color:#77818f;background:#000}
/* 単独窓・IDE内タブとも、低い時は起動案内より端末の数行を優先する。 */
@container console-panel (max-height:240px){
 .console-welcome{display:none}
 .console-waiting .console-screen{flex:1;height:auto;max-height:none;border-top:0}
 .console-error{flex:none;max-height:1.65em;overflow:auto;margin:2px 8px;overflow-wrap:anywhere}
}
@container (max-height:240px){
 .console-welcome :deep(.terminal-welcome){padding:4px 0}
 .console-welcome :deep(.welcome-mark){width:36px;height:36px;margin-bottom:6px}
 .console-welcome :deep(.welcome-mark img){width:28px;height:28px}
 .console-welcome :deep(.welcome-eyebrow){font-size:9px;margin-bottom:4px}
 .console-welcome :deep(h1){font-size:16px;margin-bottom:4px}
 .console-welcome :deep(.welcome-caption){font-size:9px;line-height:1.4}
}
</style>

