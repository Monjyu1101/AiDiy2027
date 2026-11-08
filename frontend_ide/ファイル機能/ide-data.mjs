// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import storage from '../host/scripts/project-storage.cjs';
import { join, relative, isAbsolute, sep } from 'node:path';

const within=(root,path)=>{const back=relative(root,path);return back!=='..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};

/**
 * IDE がプロジェクト内に残す記録の保存先 `_AIDIY/aidiy_ide/<name>/` を用意する。
 * 各段階の実パスがプロジェクト内であることを確かめる（リンクで外へ書き出さない）。
 * 旧保存先の読込・移行・フォールバックは行わない。
 */
export async function ideDataFolder(project,name,{program='aidiy_ide',label='記録'}={}) {
  const root=await realpath(storage.projectRoot(project,fileURLToPath(new URL('../../',import.meta.url))));
  storage.programDataDirectory(root,program);let folder=root;
  for(const part of ['_AIDIY',program,name]) {
    folder=join(folder,part);await mkdir(folder,{recursive:true});
    if(!within(root,await realpath(folder)))throw Error(`${label}の保存先がプロジェクト外を参照しています。`);
  }
  return folder;
}
