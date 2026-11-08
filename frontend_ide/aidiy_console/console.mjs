// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { cliCompletions } from '../src/components/コンソール/コマンド補完.js';
import { toolsTarget } from '../ファイル機能/ai-search.mjs';
import { resolveCliLaunch, validateCliOptions } from './cli-launch.mjs';
import { createCliSession } from './cli-session.mjs';
import { shellHistory } from './shell-history.mjs';

// IDEのパネル中継だけが接続する、ランダムパス付きのローカル端末。
// シェル・開始フォルダはサーバー側で決め、ブラウザから指定させない。
export async function startConsole(project, { spawnConsole, env = process.env, cli, cliAutoApprove = false, cliReconnectGrace = 30000, onCliStarted, onCliAbandoned, checkTools, toolsPollInterval = 10000 } = {}) {
  validateCliOptions('console', { cli, cliAutoApprove });
  if (!Number.isFinite(cliReconnectGrace) || cliReconnectGrace < 0) throw Error('CLI再接続の猶予時間が不正です。');
  const cliLaunch = cli ? await resolveCliLaunch(cli, { autoApprove: cliAutoApprove, env }) : undefined;
  checkTools ??= async () => {
    const response = await fetch((await toolsTarget(project)) + 'ping', { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const result = await response.json();
    return result.status === 'ok' && result.name === 'aidiy_code_agents';
  };
  spawnConsole ??= (await import('./console-process.mjs')).spawnConsole;
  const cliSession = cliLaunch ? createCliSession(cliLaunch, project, spawnConsole) : undefined;
  const cliInfo = cliLaunch ? { id: cliLaunch.id, name: cliLaunch.name, mode: cliLaunch.mode, autoApprove: cliLaunch.autoApprove } : undefined;
  const history = cliLaunch ? undefined : await shellHistory(project, env);
  const shell = history?.shell || cliLaunch.executable;
  if (history) project = history.project;
  const completionScript = fileURLToPath(new URL('./powershell-init.ps1', import.meta.url)).replaceAll("'", "''");
  const cliOptionsJson = JSON.stringify(Object.fromEntries(Object.entries(cliCompletions).map(([name, item]) => [name, item.options]))).replaceAll("'", "''");
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', `. '${completionScript}' -CliOptionsJson '${cliOptionsJson}'`] : history?.args || [];
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  const sessions = new Set(), stopping = new Set(), cliClients = new Set();
  let cliDisconnectTimer, cliActivated = false, cliAbandoned = false;
  let origin, closed = false, toolsOnline = false, checkingTools = false, toolsEnabled = true, toolsRevision = 0;
  const allowed = req => req.headers.host === new URL(origin).host
    && (!req.headers.origin || req.headers.origin === origin)
    && req.headers['sec-fetch-site'] !== 'cross-site';
  const server = createServer((req, res) => {
    if (!allowed(req)) return res.writeHead(403).end();
    if (req.url !== prefix + 'config') return res.writeHead(404).end();
    if (req.method !== 'GET') return res.writeHead(405).end();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ project, shell: cliLaunch?.name || basename(shell), cli: cliInfo }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024, perMessageDeflate: false });
  function sendTools() {
    if (!closed) for (const ws of sockets.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'tools', online: toolsOnline, enabled: toolsEnabled }));
    }
  }
  async function updateTools() {
    if (closed || checkingTools || !toolsEnabled) return;
    const revision = toolsRevision;
    checkingTools = true;
    let online = false;
    try { online = !!(await checkTools()); } catch {}
    finally { checkingTools = false; }
    if (closed) return;
    if (revision !== toolsRevision) { if (toolsEnabled) void updateTools(); return; }
    toolsOnline = online; sendTools();
  }
  const toolsTimer = setInterval(updateTools, toolsPollInterval); toolsTimer.unref(); void updateTools();
  server.on('upgrade', (req, socket, head) => {
    if (closed || !allowed(req) || req.headers.origin !== origin || req.url !== prefix + 'socket' || sessions.size >= 8) {
      socket.destroy(); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    let terminal, output, exit, failure, cliOutput, started = false, unacknowledged = 0, dead = false;
    const send = value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
    const stop = () => {
      if (dead) return; dead = true;
      clearTimeout(initializing); clearInterval(heartbeat);
      output?.dispose(); exit?.dispose(); failure?.dispose(); cliOutput?.dispose();
      if (terminal) {
        const pending = Promise.resolve(terminal.kill());
        stopping.add(pending); void pending.finally(() => stopping.delete(pending));
      }
      sessions.delete(stop); ws.terminate();
      if (cliSession && started) {
        cliClients.delete(ws);
        if (!closed && !cliAbandoned && !cliClients.size && !cliDisconnectTimer) {
          cliDisconnectTimer = setTimeout(() => {
            cliDisconnectTimer = undefined;
            if (closed || cliClients.size) return;
            cliAbandoned = true;
            const pending = cliSession.terminate('再接続の猶予時間を過ぎたためCLIを終了しました。再実行するには新しいConsole窓を開いてください。');
            stopping.add(pending);
            const abandoned = () => { stopping.delete(pending); void Promise.resolve().then(() => onCliAbandoned?.()).catch(() => {}); };
            void pending.then(abandoned, abandoned);
          }, cliReconnectGrace);
          cliDisconnectTimer.unref();
        }
      }
    };
    sessions.add(stop);
    // 消えたブラウザのシェルを残さない。表示中のタブ切替では接続を維持する。
    let alive = true;
    const heartbeat = setInterval(() => { if (!alive) return stop(); alive = false; ws.ping(); }, 15000);
    heartbeat.unref(); ws.on('pong', () => { alive = true; });
    const initializing = setTimeout(stop, 10000); initializing.unref();
    ws.on('close', stop); ws.on('error', stop);
    ws.on('message', (raw, binary) => {
      try {
        if (binary) throw Error('テキスト通信が必要です。');
        const message = JSON.parse(raw.toString());
        const size = () => {
          if (!Number.isInteger(message.cols) || message.cols < 2 || message.cols > 500
            || !Number.isInteger(message.rows) || message.rows < 1 || message.rows > 300) throw Error('端末サイズが不正です。');
        };
        if (message.type === 'start' && cliSession) {
          size(); clearTimeout(initializing);
          if (started) return;
          started = true;
          cliClients.add(ws); clearTimeout(cliDisconnectTimer); cliDisconnectTimer = undefined;
          cliSession.start(message.cols, message.rows);
          if (!cliActivated) { cliActivated = true; onCliStarted?.(); }
          const snapshot = cliSession.snapshot();
          const sendCli = value => {
            if (value.type === 'data') {
              unacknowledged += value.data.length;
              // 切断した画面がCLIを止めない。遅い接続だけ切り、再接続時は保持した末尾を表示。
              if (unacknowledged > 2 * 1024 * 1024 || ws.bufferedAmount > 2 * 1024 * 1024) return stop();
            }
            send(value);
          };
          send({ type: 'ready', shell: cliLaunch.name, project, cli: cliInfo, completion: false, toolsOnline, toolsEnabled, state: snapshot.state });
          if (snapshot.output) sendCli({ type: 'data', data: snapshot.output });
          send({ type: 'keyboard-mode', win32InputMode: snapshot.win32InputMode });
          if (snapshot.error) send({ type: 'error', message: snapshot.error });
          if (snapshot.exitCode !== undefined) send({ type: 'exit', exitCode: snapshot.exitCode });
          cliOutput = cliSession.subscribe(sendCli);
          cliSession.resize(message.cols, message.rows);
        } else if (message.type === 'start' && !terminal) {
          size(); clearTimeout(initializing);
          terminal = spawnConsole(shell, args, { name: 'xterm-256color', cols: message.cols, rows: message.rows,
            cwd: project, env: { ...history.env, TERM: 'xterm-256color' } });
          output = terminal.onData(data => {
            unacknowledged += data.length;
            if (unacknowledged > 128 * 1024) terminal.pause();
            if (unacknowledged > 2 * 1024 * 1024 || ws.bufferedAmount > 2 * 1024 * 1024) return stop();
            send({ type: 'data', data });
          });
          exit = terminal.onExit(({ exitCode }) => {
            terminal = undefined; send({ type: 'exit', exitCode });
            output?.dispose(); exit?.dispose(); failure?.dispose();
            // シェル終了後もtoolsの状態表示は維持する。窓終了時に通信を破棄する。
          });
          failure = terminal.onError?.(message => { send({ type: 'error', message }); });
          send({ type: 'ready', shell: basename(shell), project, completion: process.platform === 'win32', toolsOnline, toolsEnabled });
        } else if (message.type === 'tools-check' && typeof message.enabled === 'boolean') {
          toolsEnabled = message.enabled; toolsRevision++; toolsOnline = false;
          sendTools(); if (toolsEnabled) void updateTools();
        } else if (message.type === 'input' && cliSession && started && typeof message.data === 'string' && message.data.length <= 32768) {
          cliSession.write(message.data);
        } else if (message.type === 'resize' && cliSession && started) {
          size(); cliSession.resize(message.cols, message.rows);
        } else if (message.type === 'input' && terminal && typeof message.data === 'string' && message.data.length <= 32768) {
          terminal.write(message.data);
        } else if (message.type === 'resize' && terminal) {
          size(); terminal.resize(message.cols, message.rows);
        } else if (message.type === 'ack' && Number.isInteger(message.length) && message.length > 0 && message.length <= unacknowledged) {
          unacknowledged -= message.length;
          if (unacknowledged < 64 * 1024) terminal?.resume();
        } else throw Error('端末への要求が不正です。');
      } catch (error) { send({ type: 'error', message: error.message }); ws.close(1008); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + prefix, async close() {
    if (closed) return; closed = true;
    clearInterval(toolsTimer); clearTimeout(cliDisconnectTimer);
    for (const stop of [...sessions]) stop();
    await Promise.allSettled([...stopping, ...(cliSession ? [cliSession.close()] : [])]);
    sockets.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}
