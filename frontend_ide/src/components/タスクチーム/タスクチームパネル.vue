<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { ref, provide, onMounted, onBeforeUnmount } from 'vue';
import StatusBar from '../共通表示/状態バー.vue';
import PanelToggle from '../コード/パネル表示切替.vue';
import EscapingMark from '../コンソール/逃げるマーク.vue';
import TaskPanel from './components/AIタスク/AIタスク.vue';
import TeamPanel from './components/AIチーム/AIチーム.vue';
import TaskRequest from './components/AIタスク/windows/AIタスク_要求ウィンドウ.vue';
import TaskFlow from './components/AIタスク/windows/AIタスク_フローウィンドウ.vue';
import TaskDetail from './components/AIタスク/windows/AIタスク_明細ウィンドウ.vue';
import TaskEditor from './components/AIタスク/windows/AIタスク_編集ウィンドウ.vue';
import { resolveTaskView, createTaskSession, createTaskSelectionCache } from './task-session';
import apiClient, { token } from './api/client';
const props = defineProps<{ config: { kind: 'task' | 'team'; taskTeamBase: string; project?: string; projectFixed?: boolean; fixedProject?: string } }>();
const desktop = !!window.aidiyWindow;
const panelCollapsed = ref(false), panelHidden = ref(false);
const taskView = resolveTaskView(props.config.kind, window.location.hash, window.aidiyWindow);

const title = `AiDiy ${props.config.projectFixed ? 'IDE / ' : ''}${props.config.kind.toUpperCase()}`;
provide('taskTeamFixedProject', props.config.projectFixed ? props.config.fixedProject || '' : '');
const connected = ref(false), port = ref(8093), checking = ref(true);
// Avatar と同じ初期表示。前回 ID だけをアプリ別に保存し、パスワードは保存しない。
const lastUserKey = `aidiy_${props.config.kind}_last_user`;
function initialUserId() { try { return localStorage.getItem(lastUserKey) || 'admin'; } catch { return 'admin'; } }
const initialPassword = '********';
const user = ref<Record<string, string> | null>(null), userId = ref(initialUserId()), password = ref(initialPassword);
const error = ref(''), busy = ref(false), restoring = ref(!!props.config.projectFixed || taskView !== 'combined' || !!token());
let disposed = false, revision = 0, timer: ReturnType<typeof setTimeout>;
const lifetime = new AbortController();
let sessionSync: ReturnType<typeof createTaskSession> | null = null;
let selectionCache: ReturnType<typeof createTaskSelectionCache> | null = null;
const openViews = ref<string[]>(taskView === 'combined' || taskView === 'dialog' ? [] : [taskView]);
let windowTimer: ReturnType<typeof setTimeout>;
let windowsPolling = false;
async function refreshTaskWindows() {
  if (disposed || windowsPolling) return; windowsPolling = true;
  try { const state = await window.aidiyWindow?.taskWindows('state'); if (!disposed) openViews.value = state?.views || []; } catch {}
  finally { windowsPolling = false; if (!disposed) { clearTimeout(windowTimer); windowTimer = setTimeout(refreshTaskWindows, 2000); } }
}
async function openTaskWindows(view: string) {
  if (!user.value || !['request', 'flow', 'detail'].includes(view)) return;
  error.value = '';
  try {
    const result = await window.aidiyWindow?.taskWindows('open', { view });
    if (result?.ok === false) throw Error(result.error || 'タスクウィンドウを開けません。');
    clearTimeout(windowTimer); await refreshTaskWindows();
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : 'タスクウィンドウを開けません。'; }
}
function clearSession(message = '') { selectionCache?.dispose(); selectionCache = null; revision++; token(''); user.value = null; password.value = initialPassword; error.value = message; busy.value = false; restoring.value = false; }
async function receiveSession(value: string) {
  if (disposed) return;
  // 自分のログイン失敗・失効通知が空セッションとして戻っても、理由を消さない。
  // 別利用者のログインを受け取った時や、ログイン済み窓のログアウト時は初期化する。
  clearSession(!value && !user.value ? error.value : '');
  if (!value) return;
  const run = ++revision; token(value); restoring.value = true;
  try {
    await currentUser(run);
    if (!disposed && run === revision && user.value) { password.value = ''; selectionCache = createTaskSelectionCache(); }
  } catch { if (!disposed && run === revision) logout('認証を確認できませんでした。再ログインしてください。'); }
  finally { if (!disposed && run === revision) restoring.value = false; }
}

async function health() {
  try {
    const response = await fetch(props.config.taskTeamBase + '/status', { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw Error();
    const result = await response.json();
    if (!disposed) { connected.value = result.connected === true; if (Number.isInteger(result.port)) port.value = result.port; }
  } catch { if (!disposed) connected.value = false; }
  finally { if (!disposed) {
      checking.value = false;
      if (props.config.projectFixed && connected.value && !user.value && !restoring.value) {
        restoring.value = true; const run = revision;
        try { await currentUser(run); if (user.value) { error.value = ''; if (taskView !== 'combined' && !selectionCache) selectionCache = createTaskSelectionCache(); } }
        catch { if (!disposed) error.value = '内部認証を確認できません。Coreの復旧後に再確認します。'; }
        finally { if (!disposed) restoring.value = false; }
      }
      timer = setTimeout(health, 5000);
    } }
}
function logout(message = '') {
  clearSession(message);
  if (props.config.projectFixed) return; // 内部資格情報はNode側が再読込し、窓間に配布しない。
  if (sessionSync) void sessionSync.set('').catch(() => { if (!disposed) error.value = '他のタスク画面へのログアウト通知に失敗しました。'; });
}
function expired() { logout('認証の有効期限が切れました。再ログインしてください。'); }
async function currentUser(run: number) {
  const response = await apiClient.post('/core/auth/現在利用者', {});
  if (response.data.status !== 'OK' || !response.data.data?.利用者ID) throw Error(response.data.message || '利用者情報を取得できませんでした。');
  if (!disposed && run === revision) user.value = response.data.data;
}
async function login() {
  if (busy.value) return;
  busy.value = true; error.value = ''; const run = ++revision;
  try {
    const response = await apiClient.post('/core/auth/ログイン', { 利用者ID: userId.value, パスワード: password.value });
    if (disposed || run !== revision) return;
    if (response.data.status !== 'OK' || !response.data.data?.access_token) throw Error(response.data.message || 'ログインに失敗しました。');
    token(response.data.data.access_token);
    // 利用者確認が成功する前に他の Task 窓を開かない。
    await currentUser(run);
    if (disposed || run !== revision || !user.value) return;
    try { localStorage.setItem(lastUserKey, userId.value); } catch {}
    password.value = '';
    if (sessionSync) await sessionSync.set(token());
  } catch (cause) { if (!disposed && run === revision) logout(cause instanceof Error ? cause.message : 'ログインできませんでした。'); }
  finally { if (!disposed && run === revision) busy.value = false; }
}
onMounted(async () => {
  window.addEventListener('taskteam-auth-expired', expired); void health();
  if (taskView !== 'combined') {
    token('');
    sessionSync = createTaskSession({ api: window.aidiyWindow, applyToken: receiveSession });
    if (taskView !== 'dialog') void refreshTaskWindows();
    try { await sessionSync.start(); }
    catch { if (!disposed) clearSession('認証状態を取得できません。画面を開き直してください。'); }
    return;
  }

  if (!token() && !props.config.projectFixed) return;
  const run = revision;
  try { await currentUser(run); }
  catch { if (!disposed && run === revision) logout('認証を確認できませんでした。再ログインしてください。'); }
  finally { if (!disposed) restoring.value = false; }
});
onBeforeUnmount(() => { disposed = true; revision++; clearTimeout(timer); clearTimeout(windowTimer); selectionCache?.dispose(); sessionSync?.dispose(); lifetime.abort(); window.removeEventListener('taskteam-auth-expired', expired); });
</script>
<template>
  <main class="ai-component taskteam-shell" :class="{ 'panel-collapsed': panelHidden }" :data-app="config.kind">
    <StatusBar :hide-connection-bar="panelHidden" mode="online" :title="title" :connected="connected" :busy="checking" :desktop="desktop" :clock-pulse="true" :status="`Task / Team :${port} ${connected ? '接続済' : '未接続'}`"><template #leading><PanelToggle :collapsed="panelCollapsed" :desktop="desktop" @toggle="panelCollapsed = !panelCollapsed" @hidden="panelHidden = $event" /></template></StatusBar>
    <div class="component-toolbar"><span>{{ user ? `${user.利用者名 || user.利用者ID} (${user.利用者ID})` : '利用者認証' }}</span><nav><template v-if="user && taskView !== 'combined' && taskView !== 'dialog'"><button v-for="view in (['request','flow','detail'] as const).filter(view => view !== taskView && !openViews.includes(view))" :key="view" @click="openTaskWindows(view)">{{ {request:'要求',flow:'フロー図',detail:'明細'}[view] }}</button></template><button v-if="user && !config.projectFixed" @click="logout()">ログアウト</button></nav></div>
    <p v-if="config.projectFixed" class="fixed-project">IDE連携・プロジェクト固定: {{ config.fixedProject }}（変更不可）</p>
    <p v-if="restoring" class="taskteam-message" role="status">認証を確認しています…</p>
    <div v-else-if="!user" class="taskteam-login-screen">
      <EscapingMark icon="/development/AiDiy.png" />
    <p v-if="config.projectFixed" class="taskteam-message" role="alert">{{ error || "内部認証を確認しています…" }}</p>
    <form v-else class="taskteam-login" @submit.prevent="login">
      <label>利用者ID<input v-model="userId" autocomplete="username" required :disabled="busy" /></label>
      <label>パスワード<input v-model="password" type="password" autocomplete="current-password" required :disabled="busy" /></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">{{ busy ? 'ログイン中…' : 'ログイン' }}</button>
    </form>
    </div>
    <section v-else class="taskteam-content">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <TaskRequest v-if="taskView === 'request'" :key="user.利用者ID" :利用者ID="user.利用者ID" :権限ID="user.権限ID || ''" />
      <TaskFlow v-else-if="taskView === 'flow'" :key="user.利用者ID" />
      <TaskDetail v-else-if="taskView === 'detail'" :key="user.利用者ID" />
      <TaskEditor v-else-if="taskView === 'dialog'" :key="user.利用者ID" :利用者ID="user.利用者ID" />
      <TaskPanel v-else-if="config.kind === 'task'" :利用者ID="user.利用者ID" :権限ID="user.権限ID || ''" />
      <TeamPanel v-else :利用者ID="user.利用者ID" :利用者名="user.利用者名 || user.利用者ID" />
    </section>
  </main>
</template>
<style scoped>
/* 非表示だけを切り替え、認証・選択・編集中の内容と子部品を保持する。 */
.taskteam-shell.panel-collapsed{border:0}
.taskteam-shell.panel-collapsed > :not(.panel-brand){display:none!important}
.fixed-project{flex:none;margin:0;padding:4px 8px;font-size:11px;overflow-wrap:anywhere}
.taskteam-shell{width:100%;height:100%;box-sizing:border-box;border:1px solid var(--aidiy-panel-border);background:#000;display:flex;flex-direction:column;overflow:hidden;color:#d9e0f2}
.taskteam-content{flex:1;min-height:0;overflow:auto;position:relative}
.taskteam-login{box-sizing:border-box;width:min(408px,calc(100% - 32px));margin:auto;display:grid;gap:16px;background:#000;border:1px solid rgba(143,104,221,.5);border-radius:12px;padding:32px 28px 24px;box-shadow:0 16px 48px #0005,inset 0 1px 0 #c4b5fd14}
.taskteam-login-screen{box-sizing:border-box;flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;justify-content:safe center;padding:36px 0 24px;gap:32px}
.taskteam-login-screen :deep(.welcome-mark){margin:0;flex-shrink:0}
.taskteam-login-screen .taskteam-login{margin:0;flex-shrink:0;padding-top:24px}
.taskteam-login label{display:grid;gap:7px;font-size:12px;color:#c3c5df}
.taskteam-login input{min-width:0;padding:10px 12px;border:1px solid #6972a45c;border-radius:6px;background:#080c1a99;color:#eef0ff;outline:none}
.taskteam-login input:focus-visible{border-color:#ab9bea;box-shadow:0 0 0 2px #9984d526}
.taskteam-login button[type=submit]{padding:10px;border:1px solid #a798e480;border-radius:6px;background:linear-gradient(115deg,#4668cda6,#6c4ec4a6);color:#f0edff;font-weight:600}
.taskteam-login button[type=submit]:hover:not(:disabled){background:linear-gradient(115deg,#4668cdcf,#6c4ec4cf);border-color:#b8a9ef}
.taskteam-login button[type=submit]:focus-visible{outline:2px solid #b8a9ef;outline-offset:3px}
.taskteam-login p{margin:0;font-size:11px;line-height:1.6;color:#a8accb}.taskteam-login .error{color:#ffb7b7}.taskteam-message{padding:12px}
@media(max-height:560px){.taskteam-login-screen{padding:24px 0 16px;gap:24px}.taskteam-login{gap:12px;padding:20px 24px}.taskteam-login-screen :deep(.welcome-mark){width:64px;height:64px}.taskteam-login-screen :deep(.welcome-mark img){width:42px;height:42px}}
/* コピー元の機能は維持し、外側の操作面は Code と同じ黒・細枠へ揃える。 */
.taskteam-content :deep(.ai-task-view){background:#000}.taskteam-content :deep(.task-grid){gap:4px;padding:4px}.taskteam-content :deep(.task-panel){border:1px solid #343943;background:#000;border-radius:0;box-shadow:none}.taskteam-content :deep(.task-panel:hover){border-color:#56606e;box-shadow:none}
.taskteam-shell .taskteam-content :deep(.panel-header){background:#000;border-bottom:1px solid #242424;box-shadow:none}
.taskteam-shell .taskteam-content :deep(.panel-title){color:#d9e0f2;font-size:12px;letter-spacing:normal;font-weight:600}
.taskteam-shell .taskteam-content :deep(.scope-toggle){background:#080a10;border:1px solid #343943;border-radius:0;color:#d9e0f2}
.taskteam-shell .taskteam-content :deep(.scope-toggle:hover:not(:disabled)){background:#202737}
.taskteam-shell .taskteam-content :deep(.team-page){background:#000}
.taskteam-shell .taskteam-content :deep(.agent-panel),.taskteam-shell .taskteam-content :deep(.exp-panel),.taskteam-shell .taskteam-content :deep(.pdca-panel),.taskteam-shell .taskteam-content :deep(.talk-panel){background:#000;border:1px solid #343943;border-radius:0;box-shadow:none}
.taskteam-shell .taskteam-content :deep(.agent-panel:hover),.taskteam-shell .taskteam-content :deep(.exp-panel:hover),.taskteam-shell .taskteam-content :deep(.pdca-panel:hover),.taskteam-shell .taskteam-content :deep(.talk-panel:hover){border-color:#56606e;box-shadow:none}
/* 独立Task窓・表の見出し/空白も黒へ揃える。入力欄、選択行、データ行の配色は維持する。 */
.taskteam-shell .taskteam-content :deep(.task-window-body),.taskteam-shell .taskteam-content :deep(.task-editor-window),.taskteam-shell .taskteam-content :deep(.common-table),.taskteam-shell .taskteam-content :deep(.table-footer){background:#000}
.taskteam-shell .taskteam-content :deep(tbody tr:has(td.empty)){background:#000}
.taskteam-shell .taskteam-content :deep(td.empty){color:#94a3b8}
.taskteam-shell .taskteam-content :deep(th),.taskteam-shell .taskteam-content :deep(thead tr:nth-child(2) th){background:#000}
.taskteam-shell .taskteam-content :deep(.task-editor-window .dialog-content),.taskteam-shell .taskteam-content :deep(.task-editor-window .dialog-header),.taskteam-shell .taskteam-content :deep(.task-editor-window .dialog-body),.taskteam-shell .taskteam-content :deep(.task-editor-window .dialog-footer){background:#000}
</style>
