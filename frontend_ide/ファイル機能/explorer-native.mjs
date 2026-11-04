// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
const execute = promisify(execFile);
const windowsHelper = new URL('./explorer-windows.ps1', import.meta.url);
const macHelper = `ObjC.import('Foundation');
function run(args) {
 const fs = $.NSFileManager.defaultManager, error = Ref();
 const ok = args[0] === 'trash'
  ? fs.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(args[1]), null, error)
  : fs.moveItemAtPathToPathError(args[1], args[2], error);
 if (!ok) throw Error(error[0] ? ObjC.unwrap(error[0].localizedDescription) : 'File operation failed');
}`;

/** パスは必ず argv / 環境変数で渡し、シェル文字列へ埋め込まない。 */
export function createNativeExplorer({ platform = process.platform, run = execute, env = process.env } = {}) {
  const options = { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024, env };
  const invoke = async (action, source, destination = '', type = '') => {
    if (platform === 'win32') {
      // 配布した固定コードだけをUTF-16で渡す。実行ポリシー設定は変えず、パスをコードへ混ぜない。
      const script = await readFile(windowsHelper, 'utf8');
      return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        ...options, env: { ...env, AIDIY_EXPLORER_ACTION: action,
          AIDIY_EXPLORER_SOURCE: source, AIDIY_EXPLORER_DESTINATION: destination, AIDIY_EXPLORER_TYPE: type },
      });
    }
    if (platform === 'darwin') return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macHelper, '--', action, source, destination], options);
    if (platform === 'linux') {
      if (action === 'trash') return run('gio', ['trash', '--', source], options);
      // -T は直前に同名フォルダが作られた場合の「その中へ移動」を防ぐ。-n は上書き禁止。
      return run('mv', ['-nT', '--', source, destination], options);
    }
    throw Object.assign(new Error('このOSでは安全なファイル操作を利用できません。'), { code: 'ENOSYS' });
  };
  return {
    async trash(source, type) { await invoke('trash', source, '', type); },
    async rename(source, destination, type) {
      await invoke('rename', source, destination, type);
      // mv -n は衝突時にも成功コードを返すため、元の存在を必ず照合する。
      try { await lstat(source); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      throw Object.assign(new Error('同じ名前の項目があるため変更できません。'), { code: 'EEXIST' });
    },
  };
}
