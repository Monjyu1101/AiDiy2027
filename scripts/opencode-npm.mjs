// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// OpenCode V1 / V2 の npm 所有確認だけを共有する。CLI・シェルは実行しない。
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const OPENCODE_PACKAGE = '@opencode/cli';
export const OPENCODE_LEGACY_PACKAGE = 'opencode-ai';
const packages = [OPENCODE_PACKAGE, OPENCODE_LEGACY_PACKAGE];
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
async function exists(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// npm が作る Windows shim の参照先を照合する。コメント中のパスは所有証拠にしない。
async function launcherOwner(file, installed, prefix, platform) {
  const info = await lstat(file), target = await realpath(file);
  const direct = installed.find(item => item.target === target);
  if (direct) return direct;
  if (platform !== 'win32' || !info.isFile() || info.isSymbolicLink()) return null;
  if (!['', '.cmd', '.ps1'].some(ext => path.resolve(file).toLowerCase() === path.join(prefix, 'opencode' + ext).toLowerCase())) return null;
  const shim = (await readFile(file, 'utf8')).split(/\r?\n/).filter(line => !/^\s*(?:@?rem\b|::|#)/i.test(line)).join('\n').replaceAll('\\', '/').toLowerCase();
  const pattern = file.toLowerCase().endsWith('.cmd') ? /"%(?:~dp0|dp0%)\/([^"\r\n]+)"\s+%\*/g
    : file.toLowerCase().endsWith('.ps1') ? /"\$basedir\/([^"\r\n]+)"\s+\$args/g : /"\$basedir\/([^"\r\n]+)"\s+"\$@"/g;
  const targets = [...shim.matchAll(pattern)].map(match => match[1]);
  return installed.find(item => targets.length && targets.every(value => value === `node_modules/${item.name}/${item.bin}`.toLowerCase())) || null;
}

// PATH の先頭だけでなく、npm が削除・置換し得る全 shim を確認する。
// 別方式・壊れた配置・リンク先不明は推測で削除せず、呼出元で操作を止める。
export async function inspectOpenCodeNpm({ prefix, root }, { platform = process.platform, executable = null } = {}) {
  const installed = [];
  for (const name of packages) {
    const directory = path.join(root, ...name.split('/')), info = await exists(directory);
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('OpenCode の npm link・不明なパッケージ配置は自動操作しません。');
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const bin = metadata.bin?.opencode;
    // 2.x は同じ実体の別名 opencode2 も宣言する。opencode と同じ値の別名だけを許し、別の実体は所有不明とする。
    if (metadata.name !== name || !metadata.bin || typeof metadata.bin !== 'object'
      || Object.entries(metadata.bin).some(([key, value]) => key !== 'opencode' && value !== bin)
      || typeof bin !== 'string' || !bin || /[\\\0\r\n]/.test(bin) || path.isAbsolute(bin) || /^[A-Za-z]:/.test(bin)
      || bin.split('/').includes('..')) throw Error('OpenCode のパッケージ名・bin の所有情報を確認できません。');
    const realRoot = await realpath(root), realDirectory = await realpath(directory);
    const target = await realpath(path.resolve(directory, bin));
    if (realDirectory !== path.join(realRoot, ...name.split('/')) || !inside(realDirectory, target) || !(await stat(target)).isFile()) {
      throw Error('OpenCode のパッケージ外の実体は自動操作しません。');
    }
    installed.push({ name, target, bin: path.posix.normalize(bin) });
  }
  const binRoot = platform === 'win32' ? prefix : path.join(prefix, 'bin');
  const candidates = (platform === 'win32' ? ['', '.cmd', '.ps1', '.exe', '.com', '.bat'] : ['']).map(ext => path.join(binRoot, 'opencode' + ext));
  if (executable) candidates.push(executable);
  let owner = null;
  for (const file of new Set(candidates)) {
    if (!await exists(file)) {
      if (file === executable) throw Error('OpenCode の実行ファイルが変わりました。再確認してください。');
      continue;
    }
    const found = await launcherOwner(file, installed, prefix, platform);
    if (!found) throw Error('OpenCode の実行ファイルに別の導入元または所有不明のファイルがあります。自動操作しません。');
    if (file === executable) owner = found;
  }
  return { installed: installed.map(item => item.name), owner };
}
