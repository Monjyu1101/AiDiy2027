// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import storage from '../host/scripts/project-storage.cjs';

// HOME は外部 CLI の認証用に維持する。Console 所有の履歴と初期化だけを分離する。
export async function shellHistory(project, env = process.env, platform = process.platform) {
  const root = project ? resolve(project) : fileURLToPath(new URL('../../', import.meta.url));
  const directory = storage.preparePrivateDirectory(storage.programDataDirectory(root, 'aidiy_console'));
  const shell = platform === 'win32'
    ? join(env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    : env.SHELL || '/bin/sh';
  const name = basename(shell);
  if (platform !== 'win32' && !['bash', 'zsh', 'sh', 'dash'].includes(name)) {
    throw Error(`Console の履歴分離に未対応のシェルです: ${name}。SHELL に bash / zsh / sh を指定してください。`);
  }
  const historyFile = join(directory, `${platform === 'win32' ? 'powershell' : name}_history`);
  try {
    const info = await lstat(historyFile);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('履歴保存先が通常ファイルではありません。');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const shellConfig = join(directory, 'shell');
  if (platform !== 'win32' && name === 'zsh') {
    for (const target of [shellConfig, join(shellConfig, '.zshrc')]) {
      try { if ((await lstat(target)).isSymbolicLink()) throw Error('シェル設定の保存先がリンクです。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(shellConfig, { recursive: true });
    // zsh は SAVEHIST を環境変数から初期化しない。専用設定だけを読む。
    await writeFile(join(shellConfig, '.zshrc'), 'HISTSIZE=10000\nSAVEHIST=10000\n', 'utf8');
  }
  return { shell, project: root,
    args: name === 'bash' ? ['--noprofile', '--norc'] : name === 'zsh' ? ['-d'] : [],
    env: { ...env, HISTFILE: historyFile,
      HISTSIZE: '10000', HISTFILESIZE: '10000', SAVEHIST: '10000',
      ZDOTDIR: shellConfig, ENV: '', BASH_ENV: '' } };
}
