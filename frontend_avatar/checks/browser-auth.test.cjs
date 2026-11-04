const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, token } = require('./browser-auth-harness.cjs');
for (const [project, desktop] of [['frontend_web', false], ['frontend_avatar', false], ['frontend_avatar', true]]) {
  const label = `${project}/${desktop ? 'Electron' : 'Web'}`;
  test(`${label}: login token is offered only in protocol, refreshed for reconnect`, async () => {
    const h = harness(project, desktop), client = new h.Client('ws://test/core/ws/AIコア');
    const firstToken = h.auth.token;
    const first = client.connect(); h.sockets[0].open(); h.sockets[0].init(); await first;
    assert.deepEqual(Array.from(h.sockets[0].protocols), ['aidiy-auth', `bearer.${firstToken}`]);
    assert.equal(h.sockets[0].url, 'ws://test/core/ws/AIコア');
    assert.ok(!JSON.stringify(h.sockets[0].sent).includes(firstToken));
    h.storage.setItem('token', token(undefined, 'refreshed'));
    h.sockets[0].end(1006); h.runTimer(3000);
    h.sockets[1].open(); h.sockets[1].init();
    assert.equal(h.sockets[1].protocols[1], `bearer.${h.auth.token}`);
    client.disconnect(); assert.equal(h.timers.size, 0);
  });
  test(`${label}: absent, malformed and expired auth create no socket`, async () => {
    for (const invalid of ['', 'invalid', token(1)]) {
      const h = harness(project, desktop); h.storage.setItem('token', invalid);
      await assert.rejects(new h.Client('ws://test').connect(), /再ログイン/);
      assert.equal(h.sockets.length, 0); assert.equal(h.timers.size, 0);
    }
  });
  test(`${label}: logout cancels pending handshake and ignores late open/init`, async () => {
    const h = harness(project, desktop), client = new h.Client('ws://test');
    const pending = client.connect(); h.storage.removeItem('token'); h.window.dispatchEvent({ type: 'auth-cleared' });
    await assert.rejects(pending, /cancelled/);
    h.sockets[0].open(); h.sockets[0].init();
    assert.equal(h.sockets[0].sent.length, 0); assert.equal(client.セッションID取得(), null);
    assert.equal(h.timers.size, 0);
  });
  test(`${label}: cancel removes queued reconnect; late old close cannot replace new socket`, async () => {
    const h = harness(project, desktop), client = new h.Client('ws://test');
    const first = client.connect(); h.sockets[0].open(); h.sockets[0].init(); await first;
    h.sockets[0].end(1006); client.disconnect(); assert.equal(h.timers.size, 0);
    const second = client.connect(); h.sockets[1].open(); h.sockets[1].init(); await second;
    h.sockets[0].end(); assert.equal(client.isConnected(), true); client.disconnect();
  });
  test(`${label}: timeout closes socket, auth rejection never schedules reconnect`, async () => {
    const h = harness(project, desktop), client = new h.Client('ws://test');
    const pending = client.connect(); h.runTimer(30000); await assert.rejects(pending, /timeout/);
    assert.equal(h.sockets[0].closed, true); assert.equal(h.timers.size, 0);
    const second = client.connect(); h.sockets[1].end(4401); await assert.rejects(second, /closed/);
    assert.equal(h.timers.size, 0);
  });
  test(`${label}: expired token cannot send on an existing connection`, async () => {
    const h = harness(project, desktop), client = new h.Client('ws://test');
    const pending = client.connect(); h.sockets[0].open(); h.sockets[0].init(); await pending;
    h.storage.setItem('token', token(1)); client.send({ type: 'input_text' });
    assert.equal(h.sockets[0].sent.length, 1); assert.equal(h.sockets[0].closed, true); assert.equal(h.timers.size, 0);
  });
}
for (const project of ['frontend_web', 'frontend_avatar']) {
  test(`${project}: storage logout and idle expiry close all timers`, async () => {
    for (const mode of ['storage', 'expiry']) {
      const h = harness(project), client = new h.Client('ws://test');
      const pending = client.connect(); h.sockets[0].open(); h.sockets[0].init(); await pending;
      if (mode === 'storage') h.window.dispatchEvent({ type: 'storage', key: 'token', newValue: null });
      else {
        h.storage.setItem('token', token(1));
        const expiry = [...h.timers.values()][0]; expiry.fn();
      }
      assert.equal(h.sockets[0].closed, true); assert.equal(h.timers.size, 0);
    }
  });
}
test('Avatar: late refresh cannot restore token after logout', async () => {
  const h = harness(), client = new h.Client('ws://test');
  let resolve; h.api.post = () => new Promise(done => { resolve = done; });
  const pending = client.connect(); h.sockets[0].open(); h.sockets[0].init(); await pending;
  client.send({ メッセージ識別: 'input_text' }); h.storage.removeItem('token'); client.disconnect();
  resolve({ data: { status: 'OK', data: { access_token: token() } } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.auth.token, '');
});
