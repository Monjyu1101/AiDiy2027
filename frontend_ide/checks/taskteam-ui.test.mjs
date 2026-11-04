// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const store = new Map();
globalThis.sessionStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
globalThis.window = new EventTarget();
const { default: client, configureClient, token } = await import('../src/components/タスクチーム/api/client.ts');
test('Task / Team authentication uses isolated session keys and never Avatar credentials', async () => {
  store.set('token', 'avatar');
  configureClient('task', '/taskteam-api'); token('task-token');
  configureClient('team', '/taskteam-api'); assert.equal(token(), ''); token('team-token');
  configureClient('task', '/taskteam-api'); assert.equal(token(), 'task-token');
  token(''); assert.equal(store.get('aidiy_team_token'), 'team-token'); assert.equal(store.get('token'), 'avatar');
});

test('IDE linked client does not store or send internal credentials',async()=>{
 configureClient('task','/taskteam-api',true);token('ide-internal');assert.equal(token(),'');
 client.defaults.adapter=async config=>{
  assert.equal(config.headers.Authorization,undefined);
  return {data:{status:'OK'},status:200,statusText:'OK',headers:{},config};
 };
 await client.post('/core/auth/現在利用者',{});
 configureClient('task','/taskteam-api');
});
test('API keeps same-origin proxy and the original long-running request timeout', async () => {
  configureClient('task', '/taskteam-api'); token('request-token');
  assert.equal(client.defaults.timeout, 0);
  client.defaults.adapter = async config => {
    assert.equal(config.baseURL, '/taskteam-api'); assert.equal(config.url, '/task/タスク要求/一覧');
    assert.equal(config.headers.Authorization, 'Bearer request-token');
    return { data: { status: 'OK' }, status: 200, statusText: 'OK', headers: {}, config };
  };
  assert.equal((await client.post('/task/タスク要求/一覧', {})).data.status, 'OK');
  assert.throws(() => configureClient('task', 'https://example.invalid')); assert.throws(() => configureClient('ide', '/taskteam-api'));
});
test('a delayed 401 cannot clear a newly logged-in session', async () => {
  configureClient('task', '/taskteam-api'); token('old-token');
  let expired = 0; const listener = () => expired++; window.addEventListener('taskteam-auth-expired', listener);
  client.defaults.adapter = async config => { token('new-token'); throw { response: { status: 401 }, config }; };
  await assert.rejects(client.post('/task/タスク要求/一覧', {}));
  assert.equal(token(), 'new-token'); assert.equal(expired, 0);
  client.defaults.adapter = async config => { throw { response: { status: 401 }, config }; };
  await assert.rejects(client.post('/task/タスク要求/一覧', {})); assert.equal(token(), ''); assert.equal(expired, 1);
  window.removeEventListener('taskteam-auth-expired', listener);
});
test('dedicated root uses Task / Team health, shared Code header and lifecycle cleanup', async () => {
  const source = await read('src/components/タスクチーム/タスクチームパネル.vue');
  assert.match(source, /共通表示\/状態バー.vue/); assert.match(source, /taskTeamBase \+ '\/status'/);
  assert.match(source, /connected.value = result.connected === true/); assert.match(source, /:clock-pulse="true"/);
  assert.match(source, /clearTimeout\(timer\);.*lifetime.abort\(\)/); assert.doesNotMatch(source, /\/api\/connection|tools.*ping/);
  assert.match(source, /border:1px solid var\(--aidiy-panel-border\)/); assert.match(source, /flex:1;min-height:0/);
});
test('copied Task dialogs use independent IDE windows and keep inline Web dialogs', async () => {
  for (const file of ['AIタスク_要求一覧.vue', 'AIタスク_明細一覧.vue']) {
    const source = await read('src/components/タスクチーム/components/AIタスク/components/' + file);
    assert.doesNotMatch(source, /desktopApi|avatar-task-dialog/);
    assert.match(source, /dialogOpen.value = true/); assert.match(source, /aidiyWindow\?\.taskWindows/); assert.match(source, /taskChannelName\('dialog'\)/);
  }
});
test('Task / Team build is separate and all copied imports stay within IDE', async () => {
  const build = await read('scripts/build.mjs');
  assert.match(build, /taskteam\.html/); assert.match(build, /name:'AiDiyTaskTeam'/); assert.match(build, /includeDependency/);
  async function inspect(dir) {
    for (const entry of await readdir(new URL('../' + dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) await inspect(dir + '/' + entry.name);
      else if (/\.(vue|ts|js)$/.test(entry.name)) {
        const source = await read(dir + '/' + entry.name);
        assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"][^'"]*frontend_avatar/);
        assert.doesNotMatch(source, /['"]@\//);
      }
    }
  }
  await inspect('src/components/タスクチーム');
});

test('Code-style header and toolbar overrides stay inside Task / Team without changing the 3D scene', async () => {
  const source = await read('src/components/タスクチーム/タスクチームパネル.vue');
  assert.match(source, /\.taskteam-shell \.taskteam-content :deep\(\.panel-header\)\{background:#000;border-bottom:1px solid #242424;box-shadow:none\}/);
  assert.match(source, /:deep\(\.scope-toggle\)\{background:#080a10;border:1px solid #343943;border-radius:0/);
  assert.match(source, /:deep\(\.talk-panel:hover\)\{border-color:#56606e;box-shadow:none\}/);
  assert.doesNotMatch(source, /:deep\([^)]*(?:canvas|scene|agent-color)/);
});
