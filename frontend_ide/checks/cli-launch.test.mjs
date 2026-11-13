// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CLI_LAUNCHERS, resolveCliLaunch, validateCliOptions } from '../aidiy_console/cli-launch.mjs';
import { launch } from '../launch.mjs';
import { startDevelopment } from '../server.mjs';

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aidiy-cli-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function executable(file) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'THIS IS A FIXTURE, NEVER EXECUTE\n'); await chmod(file, 0o755); }
function hermesWindowsLauncher(python, cli) {
  // command_hermes/_setup.py が生成する形式。これは内容確認用で、一切実行しない。
  return [
    '@echo off', 'chcp 65001 >nul', 'setlocal', '',
    `set "PY=${python}"`, `set "CLI=${cli}"`, '',
    'if not exist "%PY%" (', '  echo Python virtual environment was not found:',
    '  echo   %PY%', '  pause', '  exit /b 1', ')', '', '"%PY%" "%CLI%" %*', '',
  ].join('\r\n');
}
async function hermesFixture(directory) {
  const home = path.join(directory, "日本語 空白 & %PATH% ! $() quote'"), bin = path.join(home, '.local', 'bin');
  const root = path.join(home, 'repo', 'command_hermes'), python = path.join(root, '.venv', 'Scripts', 'python.exe');
  const cli = path.join(root, 'cli_main.py'), shim = path.join(bin, 'aidiy_hermes.cmd');
  await executable(python); await writeFile(cli, '# fixture, never execute');
  await mkdir(bin, { recursive: true }); await writeFile(shim, hermesWindowsLauncher(python, cli));
  return { home, bin, root, python, cli, shim };
}

test('CLI許可リスト: 7種類の固定argv、モデル指定なし、通常承認と自動承認', async () => fixture(async directory => {
  assert.ok(Object.isFrozen(CLI_LAUNCHERS));
  assert.deepEqual(CLI_LAUNCHERS.map(item => item.id), ['claude', 'codex', 'copilot', 'agy', 'grok', 'opencode', 'aidiy_hermes', 'aidiy_pi']);
  // aidiy_pi は PATH を探さず、この配置先の command_pi を node で直接起動する（承認フラグなし）。
  const pi = CLI_LAUNCHERS.find(item => item.id === 'aidiy_pi');
  assert.ok(Object.isFrozen(pi) && Object.isFrozen(pi.args)); assert.deepEqual(pi.args, []);
  const flags = ['--dangerously-skip-permissions', '--dangerously-bypass-approvals-and-sandbox', '--yolo', '--dangerously-skip-permissions', '--yolo', '--auto', '--yolo'];
  for (const [index, item] of CLI_LAUNCHERS.filter(item => item.id !== 'aidiy_pi').entries()) {
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.args));
    const file = path.join(directory, item.id + (process.platform === 'win32' ? '.exe' : ''));
    await executable(file);
    const options = { env: { PATH: directory }, platform: process.platform };
    const normal = await resolveCliLaunch(item.id, options), automatic = await resolveCliLaunch(item.id, { ...options, autoApprove: true });
    assert.equal(automatic.executable, file);
    assert.deepEqual(normal.args, []); assert.deepEqual(automatic.args, [flags[index]]);
    assert.ok(!automatic.args.some(value => /model|provider|prompt/.test(value)));
    assert.equal(normal.mode, '通常承認'); assert.equal(automatic.mode, item.mode);
  }
}));

test('Windows Hermes .cmd: セットアップ形式を直接Pythonのargvに解決し、標準配置を検出する', async () => fixture(async directory => {
  const { home, bin, python, cli } = await hermesFixture(directory);
  for (const env of [{ Path: `"${bin}"` }, { PATH: '', USERPROFILE: home }]) {
    const normal = await resolveCliLaunch('aidiy_hermes', { env, platform: 'win32' });
    const automatic = await resolveCliLaunch('aidiy_hermes', { env, platform: 'win32', autoApprove: true });
    assert.equal(automatic.executable, python); assert.deepEqual(automatic.args, [cli, '--yolo']);
    assert.equal(normal.executable, python); assert.deepEqual(normal.args, [cli]);
    assert.deepEqual(automatic.env, env); assert.equal(automatic.mode, 'YOLO');
    assert.ok(!automatic.args.some(value => /^--(?:model|provider|prompt)/.test(value)));
  }
}));

test('Windows Hermes .cmd: 相対・変数展開・別interpreter・別CLI・追加命令・改変形式を拒否', async () => fixture(async directory => {
  const { bin, python, cli, shim, root } = await hermesFixture(directory);
  const original = hermesWindowsLauncher(python, cli);
  await executable(path.join(root, 'cmd.exe')); await writeFile(path.join(root, 'other.py'), '# fixture');
  const malformed = [
    hermesWindowsLauncher('%PYTHON%', cli), hermesWindowsLauncher(python, 'relative.py'),
    hermesWindowsLauncher(path.join(root, 'cmd.exe'), cli), hermesWindowsLauncher(python, path.join(root, 'other.py')),
    original + 'echo additional command\r\n', original.replace('setlocal', 'setlocal\r\nset "PY=other.exe"'),
    original.replace(' %*', ' --model injected %*'), original.replace(' %*', ' %* & echo injected'),
    original.replace('"%PY%" "%CLI%"', 'call "%PY%" "%CLI%"'),
    original.replace('setlocal', 'setlocal\r\necho unexpected'), original.replace('setlocal', 'set\0local'),
    '@echo off\r\n' + 'x'.repeat(65536),
  ];
  for (const script of malformed) {
    await writeFile(shim, script);
    await assert.rejects(resolveCliLaunch('aidiy_hermes', { env: { PATH: bin }, platform: 'win32' }), /安全な起動先/);
  }
}));

test('Windows Hermes .cmd: Python・CLIの欠落やディレクトリを拒否し、代替へ退避しない', async () => fixture(async directory => {
  const { home, bin, python, cli, shim } = await hermesFixture(directory);
  const options = { env: { PATH: bin, USERPROFILE: home }, platform: 'win32' };
  for (const file of [python, cli]) {
    await rm(file); await assert.rejects(resolveCliLaunch('aidiy_hermes', options), /安全な起動先/);
    await mkdir(file); await assert.rejects(resolveCliLaunch('aidiy_hermes', options), /安全な起動先/);
    await rm(file, { recursive: true }); await executable(file);
  }
  await rm(shim);
  await assert.rejects(resolveCliLaunch('aidiy_hermes', options), /見つかりません/);
}));

test('Hermes: 別CLIの標準配置は探索せず、PATHとユーザーの.local/binのみ使用する', async () => fixture(async directory => {
  const platform = process.platform, homeKey = platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const name = 'aidiy_hermes' + (platform === 'win32' ? '.exe' : '');
  for (const folder of ['.grok/bin', '.opencode/bin', 'npm', 'agy/bin']) await executable(path.join(directory, folder, name));
  const env = { PATH: '', [homeKey]: directory, APPDATA: directory, LOCALAPPDATA: directory };
  await assert.rejects(resolveCliLaunch('aidiy_hermes', { env, platform }), /見つかりません/);
  const installed = path.join(directory, '.local', 'bin', name); await executable(installed);
  const result = await resolveCliLaunch('aidiy_hermes', { env, platform, autoApprove: true });
  assert.equal(result.executable, installed); assert.deepEqual(result.args, ['--yolo']);
}));

test('CLI: 空白・日本語・引用符・メタ文字をシェル文字列へ変換しない', async () => fixture(async directory => {
  const folder = path.join(directory, process.platform === 'win32' ? "日本語 空白 & $() % ! quote'" : '日本語 空白 & $() % ! ; \' "');
  const file = path.join(folder, 'copilot' + (process.platform === 'win32' ? '.exe' : ''));
  await executable(file);
  const resolved = await resolveCliLaunch('copilot', { autoApprove: true, env: { PATH: folder }, platform: process.platform });
  assert.equal(resolved.executable, file); assert.deepEqual(resolved.args, ['--yolo']);
}));

test('CLI: 不明ID、任意コマンド、未導入、相対PATHを拒否', async () => {
  for (const id of ['copilot --yolo', 'constructor', '../copilot', '/bin/sh', 'copilot;echo bad', '', undefined]) {
    await assert.rejects(resolveCliLaunch(id, { env: { PATH: '' } }));
  }
  await assert.rejects(resolveCliLaunch('copilot', { env: { PATH: '.:relative' }, platform: 'linux' }), /見つかりません/);
  await assert.rejects(resolveCliLaunch('copilot', { autoApprove: 'yes' }), /真偽値/);
});

test('Windows npm .cmd: ラッパーは実行せず、同一許可パッケージのNode binだけをargvで指定', async () => fixture(async directory => {
  const folder = path.join(directory, '日本語 空白 & % ! quote\''), root = path.join(folder, 'node_modules', '@github', 'copilot');
  await executable(path.join(folder, 'copilot.cmd')); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@github/copilot', bin: { copilot: 'index.js' } }));
  await writeFile(path.join(root, 'index.js'), '// fixture, never execute');
  const resolved = await resolveCliLaunch('copilot', { autoApprove: true, env: { Path: `"${folder}"` }, platform: 'win32' });
  assert.equal(resolved.executable, process.execPath);
  assert.deepEqual(resolved.args, [path.join(root, 'index.js'), '--yolo']);
  assert.ok(!/cmd\.exe$/.test(resolved.executable));
  for (const bin of ['../escape.js', '/tmp/escape.js', 'C:/escape.js', 'bad\r\n.js', 'bin/../../escape.js', 'index.cmd']) {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@github/copilot', bin: { copilot: bin } }));
    await assert.rejects(resolveCliLaunch('copilot', { env: { PATH: folder }, platform: 'win32' }), /安全な起動先/);
  }
}));

test('Windows npm .cmd: 別パッケージ・未宣言bin・外部シンボリックリンクを拒否', async () => fixture(async directory => {
  const root = path.join(directory, 'node_modules', '@openai', 'codex');
  await executable(path.join(directory, 'codex.cmd')); await mkdir(root, { recursive: true });
  const opts = { env: { PATH: directory }, platform: 'win32' };
  for (const metadata of [{ name: 'other', bin: 'index.js' }, { name: '@openai/codex', bin: { other: 'index.js' } }]) {
    await writeFile(path.join(root, 'package.json'), JSON.stringify(metadata));
    await assert.rejects(resolveCliLaunch('codex', opts), /安全な起動先/);
  }
  if (process.platform !== 'win32') {
    await writeFile(path.join(directory, 'escape.js'), '// fixture');
    await symlink(path.join(directory, 'escape.js'), path.join(root, 'index.js'));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@openai/codex', bin: 'index.js' }));
    await assert.rejects(resolveCliLaunch('codex', opts), /安全な起動先/);
  }
}));

test('CLI起動オプション: Console専用、モデル・providerを混在させない', async () => {
  for (const kind of ['ide', 'code', 'live']) assert.throws(() => validateCliOptions(kind, { cli: 'copilot' }), /console/);
  assert.throws(() => validateCliOptions('console', { cliAutoApprove: true }), /必要/);
  for (const option of ['provider', 'model']) {
    assert.throws(() => validateCliOptions('console', { cli: 'copilot', [option]: '' }), /同時/);
    await assert.rejects(launch('console', ['--cli', 'copilot', `--${option}`, 'bad', '--no-open']), /同時/);
    await assert.rejects(startDevelopment(tmpdir(), { kind: 'console', cli: 'copilot', [option]: 'bad' }), /同時/);
  }
  await assert.rejects(launch('ide', ['--cli', 'copilot', '--no-open']), /console/);
  await assert.rejects(launch('console', ['--cli-auto-approve', '--no-open']), /必要/);
});


for (const cli of ['copilot', 'aidiy_hermes']) test(`startDevelopmentからConsoleへ${cli}・承認モード・作業フォルダを転送する（CLI実行なし）`, async () => fixture(async project => {
  await executable(path.join(project, cli + (process.platform === 'win32' ? '.exe' : '')));
  const app = await startDevelopment(project, { kind: 'console', cli, cliAutoApprove: true, env: { PATH: project } });
  try {
    const launchConfig = await fetch(app.url + 'development/config').then(response => response.json());
    assert.equal(launchConfig.cliName, cli === 'aidiy_hermes' ? 'Hermes' : CLI_LAUNCHERS.find(item => item.id === cli).name);
    const response = await fetch(app.url + 'api/panels/console', { method: 'POST' }); assert.equal(response.status, 200);
    const panel = await response.json(), config = await fetch(new URL(panel.url + 'config', app.url)).then(response => response.json());
    assert.equal(config.project, project); assert.equal(config.cli.id, cli); assert.equal(config.cli.autoApprove, true); assert.equal(config.cli.mode, 'YOLO');
    assert.equal(config.cli.name, CLI_LAUNCHERS.find(item => item.id === cli).name);
    assert.equal(config.model, undefined); assert.equal(config.provider, undefined);
  } finally { await app.close(); }
}));


test('ordinary Console config does not publish a CLI title suffix',async()=>fixture(async project=>{
 const app=await startDevelopment(project,{kind:'console'});
 try{const config=await fetch(app.url+'development/config').then(response=>response.json());assert.equal(config.cliName,undefined);}
 finally{await app.close();}
}));
