// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027


import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnConsole } from '../aidiy_console/console-process.mjs';
import { consoleKeyHandler } from '../src/components/コンソール/キー入力.js';

const modifiers = Array.from({ length: 7 }, (_, index) => ({
 shiftKey: !!((index + 1) & 1), altKey: !!((index + 1) & 2), ctrlKey: !!((index + 1) & 4),
}));
function enter(handle, extra) {
 for (const type of ['keydown', 'keypress', 'keyup']) handle({ key: 'Enter', code: 'Enter', type, ...extra, preventDefault() {}, stopPropagation() {} });
}
async function probe(executable, args, onReady, expected) {
 const terminal = spawnConsole(executable, args, { name: 'xterm-256color', cols: 160, rows: 30, cwd: tmpdir(), env: process.env });
 let output = '', sent = false, timer;
 try {
  await new Promise((resolve, reject) => {
   timer = setTimeout(() => reject(Error(`PTY input timeout: ${output}`)), 15000);
   terminal.onError(message => reject(Error(message)));
   terminal.onExit(({ exitCode }) => { if (!expected(output)) reject(Error(`PTY early exit ${exitCode}: ${output}`)); });
   terminal.onData(data => {
    output += data;
    if (!sent && output.includes('INPUT_READY')) {
     sent = true;
     try { onReady(terminal, output); } catch (error) { reject(error); }
    }
    if (expected(output)) resolve();
   });
  });
  return output;
 } finally { clearTimeout(timer); await terminal.kill(); }
}

test('Console Unix実PTY: 既存のCSI-u/Alt+Enterを改変せずCLIまで送る', { skip: process.platform === 'win32', timeout: 20000 }, async () => {
 const expected = ['\x1b[13;2u', '\x1b\r', '\x1b[13;4u', '\x1b[13;5u', '\x1b[13;6u', '\x1b[13;7u', '\x1b[13;8u'].join('');
 const script = `process.stdin.setRawMode(true);process.stdin.resume();let input=Buffer.alloc(0);process.stdin.on('data',data=>{input=Buffer.concat([input,data]);if(input.length>=${expected.length}){process.stdout.write('INPUT_HEX_'+input.toString('hex')+'\\n');process.exit(0);}});process.stdout.write('INPUT_READY\\n');`;
 const output = await probe(process.execPath, ['-e', script], terminal => {
  const handle = consoleKeyHandler(data => terminal.write(data));
  for (const extra of modifiers) enter(handle, extra);
  handle.dispose();
 }, output => output.includes('INPUT_HEX_' + Buffer.from(expected).toString('hex')));
 assert.ok(output.includes('INPUT_HEX_' + Buffer.from(expected).toString('hex')));
});

test('Console Windows実ConPTY: 修飾EnterのKeyCharと全7組のModifiersを保持する', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
 // 実Codexやユーザープロファイルは起動しない。Windowsのネイティブ入力APIで確認する。
 const shell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
 const command = `[Console]::WriteLine('INPUT_READY'); for ($i=0; $i -lt 7; $i++) { $k=[Console]::ReadKey($true); [Console]::WriteLine('INPUT_KEY_'+[int]$k.Key+'_'+[int]$k.Modifiers+'_'+[int]$k.KeyChar) }`;
 const expected = modifiers.map(extra => 'INPUT_KEY_13_' + ((extra.shiftKey ? 2 : 0) | (extra.altKey ? 1 : 0) | (extra.ctrlKey ? 4 : 0)) + '_' + (extra.ctrlKey ? 10 : 13));
 const output = await probe(shell, ['-NoLogo', '-NoProfile', '-Command', command], (terminal, output) => {
  assert.match(output, /\x1b\[\?9001h/, 'ConPTYがwin32-input-modeを要求すること');
  let enable;
  const handle = consoleKeyHandler(data => terminal.write(data), { terminal: { parser: {
   registerCsiHandler(id, callback) { if (id.final === 'h') enable = callback; return { dispose() {} }; },
   registerEscHandler() { return { dispose() {} }; },
  } } });
  enable([9001]);
  for (const extra of modifiers) enter(handle, extra);
  handle.dispose();
 }, output => expected.every(line => output.includes(line)));
 assert.deepEqual([...output.matchAll(/INPUT_KEY_13_\d+_\d+/g)].map(match => match[0]), expected);
});
