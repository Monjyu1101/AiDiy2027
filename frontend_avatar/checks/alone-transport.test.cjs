// Synthetic transport fixtures only; never reads credentials from the application installation.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const ts = require('../node_modules/typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../electron/alone-transport.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject, require, URL, Date, Set, Map })
const { allowedCoreRequest, installAloneTransport, readInternalAuthorization } = exportsObject
const base = 'http://127.0.0.1:18091', rest = base + '/core/AIコア/モデル情報/取得'
test('internal transport restricts exact origin, routes, resource and credentials', () => {
  assert.equal(allowedCoreRequest(base, rest, 'POST', 'xhr'), true)
  for (const route of ['内容取得', '内容更新']) {
    assert.equal(allowedCoreRequest(base, base + '/core/files/' + route, 'POST', 'xhr'), true)
    assert.equal(allowedCoreRequest(base, base + '/core/files/' + route, 'GET', 'xhr'), false)
  }
  assert.equal(allowedCoreRequest(base, base + '/core/files/削除', 'POST', 'xhr'), false)
  assert.equal(allowedCoreRequest(base, base.replace('http:', 'ws:') + '/core/ws/AIコア', 'GET', 'webSocket'), true)
  for (const url of [rest + '?token=x', rest.replace('127.0.0.1', 'localhost'), rest.replace('18091', '18092'), base + '/core/auth/ログイン', base + '/core/AIコア/初期化', base + '/core/AIコア/フォルダ参照', 'https://example.com/core/AIコア/モデル情報/取得']) {
    assert.equal(allowedCoreRequest(base, url, 'POST', 'xhr'), false)
  }
  assert.equal(allowedCoreRequest(base, rest, 'POST', 'subFrame'), false)
})
test('fresh header only for trusted main frame; redirects blocked; CORS isolated', () => {
  const hooks = {}, session = { webRequest: Object.fromEntries(['onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred'].map(name => [name, fn => hooks[name] = fn])) }
  let generation = 0
  installAloneTransport(session, base, details => details.trusted, () => `Bearer fixture-${++generation}`)
  const request = (id, trusted = true, url = rest) => {
    let result
    hooks.onBeforeSendHeaders({ id, url, method: 'POST', resourceType: 'xhr', trusted, requestHeaders: { Authorization: 'old' }, frame: { url: 'http://127.0.0.1:19876/?role=core' } }, value => result = value)
    return result
  }
  assert.equal(request(1).requestHeaders.Authorization, 'Bearer fixture-1')
  assert.equal(request(2).requestHeaders.Authorization, 'Bearer fixture-2')
  assert.equal(request(3, false).requestHeaders.Authorization, undefined)
  assert.equal(request(4, true, 'http://example.com/').requestHeaders.Authorization, undefined)
  assert.equal(request(1, true, 'http://example.com/').cancel, true)
  let result
  hooks.onHeadersReceived({ id: 2, statusCode: 302 }, value => result = value)
  assert.equal(result.cancel, true)
  hooks.onHeadersReceived({ id: 2, statusCode: 200, responseHeaders: {} }, value => result = value)
  assert.equal(result.responseHeaders['Access-Control-Allow-Origin'][0], 'http://127.0.0.1:19876')
  hooks.onHeadersReceived({ id: 2, statusCode: 400, method: 'OPTIONS', responseHeaders: {} }, value => result = value)
  assert.equal(result.statusLine, 'HTTP/1.1 204 No Content')
  hooks.onHeadersReceived({ id: 3, statusCode: 200 }, value => result = value)
  assert.deepEqual(Object.keys(result), [])
})
test('credential rotation, expiry, config mismatch and symlink reject using temporary fixtures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-auth-fixture-'))
  try {
    fs.mkdirSync(path.join(root, '_config'))
    fs.writeFileSync(path.join(root, '_config/AiDiy_key.json'), JSON.stringify({ PORT_CORE: 18091 }))
    fs.mkdirSync(path.join(root, '_AIDIY/backend_core'), { recursive: true })
    const file = path.join(root, '_AIDIY/backend_core/internal_auth.json')
    const write = (token, expired = false) => fs.writeFileSync(file, JSON.stringify({ token_type: 'bearer', access_token: token, expires_at: new Date(Date.now() + (expired ? -60000 : 60000)).toISOString() }))
    write('synthetic-fixture-token-one')
    assert.equal(readInternalAuthorization(base, root), 'Bearer synthetic-fixture-token-one')
    write('synthetic-fixture-token-two')
    assert.equal(readInternalAuthorization(base, root), 'Bearer synthetic-fixture-token-two')
    assert.throws(() => readInternalAuthorization('http://127.0.0.1:9999', root))
    write('synthetic-fixture-token-two', true)
    assert.throws(() => readInternalAuthorization(base, root))
    fs.unlinkSync(file); fs.symlinkSync(path.join(root, '_config/AiDiy_key.json'), file)
    assert.throws(() => readInternalAuthorization(base, root))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
