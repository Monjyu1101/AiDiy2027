// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, chmod, realpath, rm } from 'node:fs/promises';
import { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { CLI_LAUNCHERS } from '../aidiy_console/cli-launch.mjs';
import { startConsole } from '../aidiy_console/console.mjs';
import { startDevelopment } from '../server.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, message) {
  for (let count = 0; count < 200; count++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(message);
}
const request = (url, options = {}) => fetch(url, { signal: AbortSignal.timeout(1500), ...options });
const output = client => client.messages.filter(message => message.type === 'data').map(message => message.data).join('');
const ready = client => client.messages.some(message => message.type === 'ready');

function mockOwner() {
  const terminals = [];
  return {
    terminals,
    spawnConsole(file, args, options) {
      const dataListeners = new Set(), exitListeners = new Set();
      const subscribe = (listeners, listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      };
      const terminal = {
        file, args, options, writes: [], resizes: [], killed: 0,
        emitData: data => { for (const listener of dataListeners) listener(data); },
      };
      terminals.push(terminal);
      return {
        onData: listener => subscribe(dataListeners, listener),
        onExit: listener => subscribe(exitListeners, listener),
        write: data => terminal.writes.push(data),
        resize: (cols, rows) => terminal.resizes.push([cols, rows]),
        kill: () => { terminal.killed++; },
      };
    },
  };
}

async function connect(url, clients) {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + 'socket', {
    origin: new URL(url).origin, handshakeTimeout: 1500,
  });
  const client = {
    ws, messages: [],
    send: message => ws.send(JSON.stringify(message)),
    start: () => ws.send(JSON.stringify({ type: 'start', cols: 80, rows: 24 })),
  };
  clients.push(client);
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    client.messages.push(message);
    if (message.type === 'data' && ws.readyState === WebSocket.OPEN) {
      client.send({ type: 'ack', length: message.data.length });
    }
  });
  await once(ws, 'open');
  return client;
}

async function disconnect(client) {
  const closed = once(client.ws, 'close');
  client.ws.close();
  await closed;
}

async function withParallelTerminals(cli, run, options = () => ({})) {
  const project = await mkdtemp(join(tmpdir(), 'aidiy-parallel-cli 日本語 &-'));
  const executable = join(project, cli + (process.platform === 'win32' ? '.exe' : ''));
  const apps = [], clients = [], owners = [mockOwner(), mockOwner()];
  try {
    // 存在確認だけに使う。PTYは必ず模擬し、実CLI・認証・外部AI通信は実行しない。
    await writeFile(executable, 'TEST FIXTURE, NEVER EXECUTE\n');
    await chmod(executable, 0o755);
    const starts = await Promise.allSettled(owners.map(async (owner, index) => {
      apps[index] = await startConsole(project, {
        cli, cliAutoApprove: true, env: { PATH: project },
        checkTools: async () => false, spawnConsole: owner.spawnConsole,
        ...options(index, apps),
      });
    }));
    for (const start of starts) if (start.status === 'rejected') throw start.reason;
    await run({ project, executable: await realpath(executable), apps, clients, owners });
  } finally {
    for (const client of clients) client.ws.terminate();
    await Promise.all(apps.map(app => app.close()));
    await rm(project, { recursive: true, force: true });
  }
}

for (const cli of CLI_LAUNCHERS) {
  test(`CLI並列起動: ${cli.id}の同一projectでポート・入出力・再接続・個別終了を分離`, { timeout: 10000 }, async () => {
    await withParallelTerminals(cli.id, async ({ project, executable, apps, clients, owners }) => {
      const urls = apps.map(app => new URL(app.url));
      assert.notEqual(urls[0].port, urls[1].port, '同時に起動した所有サーバーは別ポート');
      assert.notEqual(urls[0].pathname, urls[1].pathname, '端末のランダムパスを共有しない');
      for (const url of urls) {
        assert.equal(url.hostname, '127.0.0.1');
        assert.ok(Number(url.port) > 0);
        assert.match(url.pathname, /^\/[a-f0-9]{48}\/$/);
      }
      const configs = await Promise.all(apps.map(async app => {
        const response = await request(app.url + 'config');
        assert.equal(response.status, 200);
        return response.json();
      }));
      for (const config of configs) {
        assert.equal(config.project, project);
        assert.equal(config.cli.id, cli.id);
        assert.equal(config.cli.autoApprove, true);
      }
      // もう一方のパスは、同じproject・CLIでも受け付けない。
      for (const [index, url] of urls.entries()) {
        const response = await request(url.origin + urls[1 - index].pathname + 'config');
        assert.equal(response.status, 404);
      }
      let [first, second] = await Promise.all(apps.map(app => connect(app.url, clients)));
      first.start(); first.start(); second.start(); second.start();
      await until(() => ready(first) && ready(second), '両方のCLIが開始する');
      for (const owner of owners) {
        assert.equal(owner.terminals.length, 1, '重複startでCLIを再起動しない');
        assert.equal(owner.terminals[0].file, executable);
        assert.equal(owner.terminals[0].options.cwd, project);
        assert.deepEqual(owner.terminals[0].args, cli.args);
      }
      const [firstTerminal, secondTerminal] = owners.map(owner => owner.terminals[0]);
      first.send({ type: 'input', data: 'first input\r' });
      second.send({ type: 'input', data: 'second input\r' });
      first.send({ type: 'resize', cols: 100, rows: 30 });
      second.send({ type: 'resize', cols: 120, rows: 40 });
      await until(() => firstTerminal.writes.length && secondTerminal.writes.length
        && firstTerminal.resizes.some(size => size[0] === 100)
        && secondTerminal.resizes.some(size => size[0] === 120), '入出力とサイズ変更が各CLIへ届く');
      assert.deepEqual(firstTerminal.writes, ['first input\r']);
      assert.deepEqual(secondTerminal.writes, ['second input\r']);
      assert.deepEqual(firstTerminal.resizes.at(-1), [100, 30]);
      assert.deepEqual(secondTerminal.resizes.at(-1), [120, 40]);
      firstTerminal.emitData('first output\n'); secondTerminal.emitData('second output\n');
      await until(() => output(first).includes('first output') && output(second).includes('second output'), '各CLIの出力が表示される');
      assert.equal(output(first), 'first output\n');
      assert.equal(output(second), 'second output\n');

      await disconnect(first);
      assert.equal(firstTerminal.killed, 0, '通信切断だけではCLIを終了しない');
      firstTerminal.emitData('first disconnected\n');
      first = await connect(apps[0].url, clients);
      first.start(); first.start();
      await until(() => ready(first) && output(first).includes('first disconnected'), '再接続で同じCLIの出力を復元する');
      assert.equal(owners[0].terminals.length, 1);
      assert.equal(owners[1].terminals.length, 1);
      assert.equal(output(first), 'first output\nfirst disconnected\n');
      assert.equal(output(second), 'second output\n', '別の窓へ出力履歴を混入させない');

      const firstClosed = once(first.ws, 'close');
      await apps[0].close(); await firstClosed;
      assert.equal(firstTerminal.killed, 1);
      assert.equal(secondTerminal.killed, 0, '片方の終了がもう一方のCLIを停止しない');
      await assert.rejects(request(apps[0].url + 'config'), '終了した所有サーバーは接続を受け付けない');
      assert.equal((await request(apps[1].url + 'config')).status, 200);
      second.send({ type: 'input', data: 'second still usable\r' });
      secondTerminal.emitData('second survives\n');
      await until(() => secondTerminal.writes.length === 2 && output(second).includes('second survives'), '残ったCLIの双方向通信を維持する');
      assert.deepEqual(secondTerminal.writes, ['second input\r', 'second still usable\r']);
      assert.ok(!second.messages.some(message => message.type === 'exit' || message.type === 'error'));

      await disconnect(second);
      second = await connect(apps[1].url, clients); second.start();
      await until(() => ready(second) && output(second).includes('second survives'), '片方終了後も残ったCLIへ再接続できる');
      assert.equal(output(second), 'second output\nsecond survives\n');
      assert.equal(owners[1].terminals.length, 1);
      const secondClosed = once(second.ws, 'close');
      await apps[1].close(); await secondClosed;
      assert.equal(secondTerminal.killed, 1);
      await Promise.all(apps.map(app => app.close()));
      assert.deepEqual([firstTerminal.killed, secondTerminal.killed], [1, 1], '所有サーバーの終了は冪等');
    });
  });
}

for (const cli of ['aidiy_hermes', 'copilot']) {
  test(`CLI並列起動: ${cli}の再接続期限切れは該当CLIと所有サーバーだけを終了`, { timeout: 10000 }, async () => {
    const abandoned = [0, 0], closed = [false, false];
    await withParallelTerminals(cli, async ({ apps, clients, owners }) => {
      const [first, second] = await Promise.all(apps.map(app => connect(app.url, clients)));
      first.start(); second.start();
      await until(() => ready(first) && ready(second), '両方のCLIが開始する');
      await disconnect(first);
      await until(() => closed[0], '切断されたCLIの所有サーバーが期限後に終了する');
      const [firstTerminal, secondTerminal] = owners.map(owner => owner.terminals[0]);
      assert.deepEqual(abandoned, [1, 0], '終了通知は期限切れの所有者だけへ送る');
      assert.deepEqual(closed, [true, false]);
      assert.deepEqual([firstTerminal.killed, secondTerminal.killed], [1, 0]);
      await assert.rejects(request(apps[0].url + 'config'));
      assert.equal((await request(apps[1].url + 'config')).status, 200);
      second.send({ type: 'input', data: 'other owner stays active\r' });
      secondTerminal.emitData('other owner output\n');
      await until(() => secondTerminal.writes.length && output(second).includes('other owner output'), '他方の期限切れ後もCLIを操作できる');
      assert.deepEqual(secondTerminal.writes, ['other owner stays active\r']);
      assert.equal(output(second), 'other owner output\n');
      assert.ok(!second.messages.some(message => message.type === 'exit' || message.type === 'error'));
      await apps[1].close();
      assert.deepEqual([firstTerminal.killed, secondTerminal.killed], [1, 1]);
      assert.deepEqual(abandoned, [1, 0], '明示終了時は期限切れ通知を追加しない');
    }, (index, apps) => ({
      cliReconnectGrace: 50,
      onCliAbandoned: async () => {
        abandoned[index]++;
        await apps[index].close();
        closed[index] = true;
      },
    }));
  });
}

for (const cli of ['aidiy_hermes', 'copilot']) {
  test(`CLI並列起動: ${cli}の主サーバー・遅延Consoleパネルと終了を分離（CLI実行なし）`, { timeout: 10000 }, async t => {
    const project = await mkdtemp(join(tmpdir(), 'aidiy-parallel-main 日本語 &-'));
    const executable = join(project, cli + (process.platform === 'win32' ? '.exe' : ''));
    const apps = [], listeners = new Map(), allowedPorts = new Set();
    let toolsChecks = 0, cliStarts = 0;
    const listen = Server.prototype.listen, fetcher = globalThis.fetch;
    // 実サーバーの待受を観測するだけで、起動・中継・終了処理は置き換えない。
    t.mock.method(Server.prototype, 'listen', function (...args) {
      assert.equal(args[0], 0, '主サーバー・ConsoleともOSの自動ポートを使う');
      assert.equal(args[1], '127.0.0.1');
      this.once('listening', () => {
        const address = this.address();
        listeners.set(this, address.port);
        allowedPorts.add(String(address.port));
      });
      return listen.apply(this, args);
    });
    // startDevelopmentはcheckToolsを転送しないため、pingだけを通信前に模擬する。
    // その他のfetchは、このテストで起動したloopbackサーバーだけへ許可する。
    t.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : input);
      assert.equal(url.hostname, '127.0.0.1');
      if (url.pathname === '/aidiy_code_agents/ping') {
        toolsChecks++;
        return Response.json({ status: 'ok', name: 'aidiy_code_agents' });
      }
      assert.ok(allowedPorts.has(url.port), '試験外のサーバーへ接続しない');
      return fetcher(input, options);
    });
    try {
      await writeFile(executable, 'TEST FIXTURE, NEVER EXECUTE\n');
      await chmod(executable, 0o755);
      const starts = await Promise.allSettled([0, 1].map(async index => {
        apps[index] = await startDevelopment(project, {
          kind: 'console', cli, cliAutoApprove: true, env: { PATH: project },
          onCliStarted: () => cliStarts++,
        });
      }));
      for (const start of starts) if (start.status === 'rejected') throw start.reason;
      assert.equal(listeners.size, 2, 'パネル要求前には主サーバーだけが起動する');
      assert.notEqual(new URL(apps[0].url).port, new URL(apps[1].url).port);
      const openPanel = async app => {
        const response = await request(app.url + 'api/panels/console', { method: 'POST' });
        assert.equal(response.status, 200);
        return (await response.json()).url;
      };
      const panels = await Promise.all(apps.map(openPanel));
      assert.equal(listeners.size, 4, '各主サーバーが専用Consoleバックエンドを遅延起動する');
      assert.equal(new Set(listeners.values()).size, 4, '4つの待受ポートを共有しない');
      assert.notEqual(panels[0], panels[1]);
      for (const panel of panels) assert.match(panel, /^\/panels\/console\/[a-f0-9]{48}\/$/);
      assert.deepEqual(await Promise.all(apps.map(openPanel)), panels, '同じ所有者のパネル再要求では再起動しない');
      assert.equal(listeners.size, 4);
      const terminalServers = [...listeners].filter(([server]) => !apps.some(app => app.server === server));
      const backends = [];
      for (const [index, panel] of panels.entries()) {
        const response = await request(new URL(panel + 'config', apps[index].url));
        assert.equal(response.status, 200);
        const config = await response.json();
        assert.equal(config.project, await realpath(project));
        assert.equal(config.cli.id, cli);
        assert.equal(config.cli.autoApprove, true);
        const candidates = await Promise.all(terminalServers.map(async ([server, port]) => {
          const url = `http://127.0.0.1:${port}${panel.slice('/panels/console'.length)}config`;
          return { server, url, response: await request(url) };
        }));
        assert.deepEqual(candidates.map(item => item.response.status).sort(), [200, 404]);
        backends[index] = candidates.find(item => item.response.ok);
        const other = await request(new URL(panel + 'config', apps[1 - index].url));
        assert.equal(other.status, 403, '他方の主サーバーから専用パネルへ中継できない');
      }
      assert.notEqual(backends[0].server, backends[1].server);
      await until(() => toolsChecks === 2, 'Tools pingが両方とも模擬応答で完了する');
      assert.equal(cliStarts, 0, 'config確認だけではCLIを開始しない');
      await apps[0].close();
      assert.equal(apps[0].server.listening, false);
      assert.equal(backends[0].server.listening, false, '主サーバー終了でそのConsoleバックエンドも停止する');
      assert.equal(apps[1].server.listening, true);
      assert.equal(backends[1].server.listening, true, '他方のConsoleバックエンドは停止しない');
      await assert.rejects(request(apps[0].url + 'development/config'));
      await assert.rejects(request(backends[0].url));
      assert.equal((await request(apps[1].url + 'development/config')).status, 200);
      assert.equal((await request(new URL(panels[1] + 'config', apps[1].url))).status, 200);
      assert.equal((await request(backends[1].url)).status, 200);
      assert.equal(await openPanel(apps[1]), panels[1]);
      assert.equal(listeners.size, 4);
      await apps[1].close();
      assert.ok([...listeners.keys()].every(server => !server.listening), '全所有者終了後に待受サーバーを残さない');
      assert.equal(cliStarts, 0, 'WebSocketを接続せず実CLIを実行しない');
    } finally {
      await Promise.all(apps.map(app => app.close()));
      await rm(project, { recursive: true, force: true });
    }
  });
}
