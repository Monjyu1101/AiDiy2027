/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

// 実際の子プロセスとの stdin/stdout/stderr 契約を検証する。
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const mode = process.argv[2];
if (mode === 'wait') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  writeFileSync(process.argv[3], JSON.stringify({ parent: process.pid, child: child.pid }));
  process.stderr.write('waiting\n');
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  process.stderr.write('provider authentication failed\n');
  process.exitCode = 7;
  process.stdin.resume();
} else if (mode === 'missing-session' && process.argv.includes('--resume')) {
  process.stderr.write(`Session not found: ${process.argv[process.argv.indexOf('--resume') + 1]}\n`);
  process.exitCode = 1;
  process.stdin.resume();
} else if (mode === 'pulse' || mode === 'pulse-hang') {
  const output = process.argv[3] === 'stderr' ? process.stderr : process.stdout;
  for (const delay of [0, 400, 800]) setTimeout(() => output.write('tick'), delay);
  if (mode === 'pulse-hang') setInterval(() => {}, 1000);
  else setTimeout(() => {}, 1050);
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    process.stderr.write('\x1b[32m[step] 日本語の進捗\x1b[0m\n');
    const utf8 = Buffer.from(JSON.stringify({ input, args: process.argv.slice(3), cwd: process.cwd(), envCwd: process.env.TERMINAL_CWD }));
    // UTF-8 マルチバイト文字・session_id をチャンクの境界で分ける。
    process.stdout.write(utf8.subarray(0, 13));
    setTimeout(() => {
      process.stdout.write(utf8.subarray(13));
      process.stderr.write('session_');
      setTimeout(() => process.stderr.write('id: test-session-001'), 10);
    }, 10);
  });
}
