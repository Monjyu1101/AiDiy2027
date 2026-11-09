const { test } = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./browser-auth-harness.cjs')
function alone() {
  const h = harness('frontend_avatar', true)
  h.window.desktopApi.avatarAlone = true
  h.storage.removeItem('token')
  h.storage.getItem = () => { throw Error('Alone must not read JWT storage') }
  h.api.post = () => { throw Error('Alone must not refresh JWT') }
  return h
}
test('alone connects and sends without JWT, protocol secrets or refresh and retains project', async () => {
  const h = alone(), client = new h.Client('ws://test', '', '', '/fixture/project')
  const pending = client.connect(), socket = h.sockets[0]
  assert.equal(socket.protocols, undefined)
  socket.open(); socket.init(); await pending
  client.sendInputText('hello', 'live')
  assert.equal(socket.sent[0].CODE_BASE_PATH, '/fixture/project')
  assert.equal(socket.sent[1].プロジェクトパス, '/fixture/project')
  assert.equal(JSON.stringify(socket.sent).includes('Bearer'), false)
  client.disconnect()
})
test('alone retries initial rejection and key rotation, but replacement and cancellation stop', async () => {
  const h = alone(), client = new h.Client('ws://test')
  const pending = client.connect()
  h.sockets[0].end(4401)
  await assert.rejects(pending)
  h.runTimer(3000)
  assert.equal(h.sockets.length, 2)
  h.sockets[1].open(); h.sockets[1].init()
  h.sockets[1].end(4000)
  assert.equal(h.timers.size, 0)
  client.disconnect()
})
test('alone initialization timeout retries and explicit disconnect cancels retry', async () => {
  const h = alone(), client = new h.Client('ws://test')
  const pending = client.connect()
  h.runTimer(30000); await assert.rejects(pending)
  assert.ok([...h.timers.values()].some(timer => timer.delay === 15000))
  client.disconnect(); assert.equal(h.timers.size, 0)
})
