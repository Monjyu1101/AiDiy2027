// Synthetic login JWTs and sockets only: no credentials, network or application services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const token = (exp = Math.floor(Date.now() / 1000) + 3600, sub = 'fixture') =>
  `e30.${Buffer.from(JSON.stringify({ exp, sub })).toString('base64url')}.fixture`;
function harness(project = 'frontend_avatar', desktop = false) {
  let currentToken = token();
  const sockets = [], timers = new Map(), events = new Map();
  let nextTimer = 0;
  const storage = { getItem: key => key === 'token' ? currentToken : null,
    setItem: (key, value) => { if (key === 'token') currentToken = value; },
    removeItem: key => { if (key === 'token') currentToken = ''; } };
  const window = { desktopApi: desktop ? {} : undefined,
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener: (name, fn) => events.get(name)?.delete(fn),
    dispatchEvent: event => { for (const fn of [...(events.get(event.type) || [])]) fn(event); } };
  const auth = { get token() { return currentToken; }, logout() { currentToken = ''; window.dispatchEvent({ type: 'auth-cleared' }); }, refreshToken: async () => {} };
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url, protocols) { Object.assign(this, { url, protocols }); sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.closed = true; }
    open() { this.readyState = 1; this.onopen(); }
    receive(data) { this.onmessage({ data: JSON.stringify(data) }); }
    init() { this.receive({ メッセージ識別: 'init', セッションID: 'session' }); }
    end(code = 1000) { this.readyState = 3; this.onclose({ code, reason: '' }); }
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../..', project, 'src/api/websocket.ts'), 'utf8');
  const compiled = ts.transpileModule(source.replaceAll('import.meta.env', '({ DEV: true })'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const api = { post: async () => ({ data: {} }) };
  const exports = {};
  vm.runInNewContext(compiled, { exports, WebSocket: Socket, window,
    atob: value => Buffer.from(value, 'base64').toString('binary'), Event: class { constructor(type) { this.type = type; } },
    localStorage: desktop || project === 'frontend_web' ? storage : { getItem() { throw Error('Wrong auth storage'); } },
    sessionStorage: desktop ? { getItem() { throw Error('Wrong auth storage'); } } : storage,
    console: { log() {}, error() {}, warn() {} },
    require: name => {
      if (name === '@/api/config') return { AI_WS_ENDPOINT: 'ws://test' };
      if (name === '@/api/client') return { default: api };
      if (name === '@/stores/auth') return { useAuthStore: () => auth };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return { Client: exports.AIWebSocket, sockets, timers, window, storage, auth, api,
    runTimer(delay) { const entry = [...timers].find(([, value]) => value.delay === delay); if (!entry) throw Error(`Missing timer ${delay}`); timers.delete(entry[0]); entry[1].fn(); },
  };
}
module.exports = { harness, token };
