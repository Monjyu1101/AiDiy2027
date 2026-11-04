// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { join } from 'node:path';
import { terminalEnvironment } from '../aidiy_console/terminal-environment.mjs';
import { spawnTerminal } from '../aidiy_console/terminal-process.mjs';

test('Console UTF-8: WindowsのPTY子環境だけにPython既定値を追加する', () => {
  const env = Object.freeze({ PATH: 'C:\\Python', TERM: 'xterm-256color' });
  assert.deepEqual(terminalEnvironment(env, 'win32'), { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(terminalEnvironment(env, platform), env);
    assert.notEqual(terminalEnvironment(env, platform), env);
  }
  assert.deepEqual(env, { PATH: 'C:\\Python', TERM: 'xterm-256color' });
});

test('Console UTF-8: 明示値・大小文字違い・空値を上書きせず、未指定分だけ補完する', () => {
  for (const explicit of [
    { PYTHONUTF8: '0', PYTHONIOENCODING: 'cp932:replace' },
    { pythonutf8: '', PythonIoEncoding: 'latin-1' },
  ]) assert.deepEqual(terminalEnvironment(Object.freeze(explicit), 'win32'), explicit);
  assert.deepEqual(terminalEnvironment({ PythonUtf8: '0' }, 'win32'), { PythonUtf8: '0', PYTHONIOENCODING: 'utf-8' });
  assert.deepEqual(terminalEnvironment({ pythonioencoding: '' }, 'win32'), { pythonioencoding: '', PYTHONUTF8: '1' });
});

test('Console共通PTY起動: shell/直接Pythonの両方へ渡し、親環境・起動フラグ・Unicodeを保持する', () => {
  // 実worker/ConPTYの代わりにIPC境界だけを模擬する。Windows実機検証ではない。
  const source = readFileSync(new URL('../aidiy_console/terminal-process.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function spawnTerminal', 'function spawnTerminal');
  for (const executable of ['powershell.exe', 'python.exe']) {
    const child = new EventEmitter(), messages = [];
    child.stderr = new EventEmitter(); child.connected = true; child.send = value => messages.push(value);
    const parentEnv = Object.freeze({ PATH: 'parent' });
    let forkOptions;
    const context = { EventEmitter, fileURLToPath, URL, process: { platform: 'win32', env: parentEnv },
      terminalEnvironment: env => terminalEnvironment(env, 'win32'),
      fork: (_file, _args, options) => { forkOptions = options; return child; },
      setTimeout, clearTimeout };
    vm.createContext(context);
    vm.runInContext(source.replaceAll('import.meta.url', JSON.stringify(new URL('../aidiy_console/terminal-process.mjs', import.meta.url).href)), context);
    const env = Object.freeze({ PATH: 'child', PYTHONUTF8: '0' });
    const options = Object.freeze({ cwd: 'C:\\日本語', cols: 80, rows: 24, env });
    const terminal = context.spawnTerminal(executable, ['arg'], options);
    const start = JSON.parse(JSON.stringify(messages[0]));
    assert.deepEqual(start, { type: 'start', shell: executable, args: ['arg'], options: { ...options, env: { ...env, PYTHONIOENCODING: 'utf-8' } } });
    assert.equal(forkOptions.windowsHide, true);
    assert.equal(forkOptions.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(forkOptions.env.PYTHONUTF8, undefined, 'worker親環境は変更しない');
    assert.equal(env.PYTHONIOENCODING, undefined);
    child.emit('message', { type: 'ready' });
    const text = 'A•B A・B A·B 日本語\r';
    terminal.write(text);
    assert.equal(messages.at(-1).data, text);
    let received; terminal.onData(data => { received = data; });
    child.emit('message', { type: 'data', data: text });
    assert.equal(received, text);
    child.emit('exit', 0);
  }
});

test('PowerShell初期化: BOMなしUTF-8の入出力と外部コマンド用Encodingを補完設定より先に指定', () => {
  const script = readFileSync(new URL('../aidiy_console/powershell-init.ps1', import.meta.url), 'utf8');
  assert.match(script, /New-Object System\.Text\.UTF8Encoding\(\$false\)/);
  for (const setting of ['[Console]::InputEncoding = $AiDiyUtf8', '[Console]::OutputEncoding = $AiDiyUtf8', '$global:OutputEncoding = $AiDiyUtf8']) {
    assert.ok(script.includes(setting));
    assert.ok(script.indexOf(setting) < script.indexOf('Import-Module PSReadLine'));
  }
  assert.doesNotMatch(script, /SetEnvironmentVariable|Set-Content|Out-File|Set-ItemProperty/);
});

for (const direct of [false, true]) test(`Windows実PTY: ${direct ? '直接Python（CLI経路）' : 'PowerShell経由Python'}のUnicode入出力`, { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const text = 'A•B A・B A·B 日本語';
  const python = "import sys; print('PY_READY',flush=True); s=input(); print('ROUNDTRIP_'+s,flush=True); print('PY_UTF8_'+str(sys.flags.utf8_mode),flush=True); print('STDOUT_'+sys.stdout.encoding,flush=True)";
  const init = fileURLToPath(new URL('../aidiy_console/powershell-init.ps1', import.meta.url)).replaceAll("'", "''");
  const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args = direct ? ['-u', '-c', python] : ['-NoLogo', '-NoProfile', '-NoExit', '-Command',
    `. '${init}' -CliOptionsJson '{}'; Write-Output ('CP_' + [Console]::InputEncoding.CodePage + '_' + [Console]::OutputEncoding.CodePage + '_' + $OutputEncoding.CodePage); '${text}' | python -c "import sys; print('PIPE_'+sys.stdin.read().strip())"; python -u -c "${python}"`];
  // 独立した試験用子環境。利用者の環境設定は書き換えない。
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['PYTHONUTF8', 'PYTHONIOENCODING'].includes(name.toUpperCase())));
  const terminal = spawnTerminal(direct ? 'python.exe' : shell, args, { cols: 120, rows: 30, cwd: process.cwd(), env });
  let output = '', sent = false, timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`Unicode roundtrip timeout: ${output}`)), 20000);
      terminal.onError(message => reject(Error(message)));
      terminal.onExit(({ exitCode }) => { if (!output.includes('ROUNDTRIP_' + text)) reject(Error(`Early exit ${exitCode}: ${output}`)); });
      terminal.onData(data => {
        output += data;
        if (!sent && output.includes('PY_READY')) { sent = true; terminal.write(text + '\r'); }
        if (output.includes('ROUNDTRIP_' + text) && output.includes('PY_UTF8_1') && output.includes('STDOUT_utf-8')) resolve();
      });
    });
    if (!direct) {
      assert.ok(output.includes('CP_65001_65001_65001'), output);
      assert.ok(output.includes('PIPE_' + text), output);
    }
  } finally { clearTimeout(timer); await terminal.kill(); }
});
