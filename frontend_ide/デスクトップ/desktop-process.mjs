// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn } from 'node:child_process';

// GUIの表示とコンソール接続は別に扱う。WindowsでもSW_HIDEをGUIへ引き継がせない。
// IPCで表示完了・終了を管理し、背景起動時の出力は起動元端末へ流さない。
export function spawnDesktop(executable, args, { cwd, env, background = false } = {}) {
  const child = spawn(executable, args, {
    cwd, env, windowsHide: false, detached: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', data => { if (!background) target.write(data); });
  }
  return child;
}
