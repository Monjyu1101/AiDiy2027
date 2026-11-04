// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { mkdir, readdir, realpath, rename, rmdir, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';

const within=(root,path)=>{const back=relative(root,path);return back!=='..'&&!back.startsWith(`..${sep}`)&&!isAbsolute(back);};

/**
 * IDE がプロジェクト内に残す記録の保存先 `_AIDIY/aidiy_ide/<name>/` を用意する。
 * 各段階の実パスがプロジェクト内であることを確かめる（リンクで外へ書き出さない）。
 * 旧版の保存先 `.aidiy/<legacy>/` があれば、同名の記録がない分だけ移し、空になった旧フォルダを消す。
 */
export async function ideDataFolder(project,name,{legacy,label='記録'}={}) {
  const root=await realpath(project);let folder=root;
  for(const part of ['_AIDIY','aidiy_ide',name]) {
    folder=join(folder,part);await mkdir(folder,{recursive:true});
    if(!within(root,await realpath(folder)))throw Error(`${label}の保存先がプロジェクト外を参照しています。`);
  }
  if(legacy)await moveLegacy(root,folder,legacy).catch(()=>{});
  return folder;
}

async function moveLegacy(root,folder,legacy) {
  const parent=join(root,'.aidiy'),old=join(parent,legacy);
  const info=await stat(old).catch(()=>null);
  if(!info?.isDirectory()||!within(root,await realpath(old)))return;
  for(const entry of await readdir(old,{withFileTypes:true})) {
    if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
    if(await stat(join(folder,entry.name)).catch(()=>null))continue;
    await rename(join(old,entry.name),join(folder,entry.name)).catch(()=>{});
  }
  // 中身が残っていれば消さない（rmdir は空のフォルダだけを消す）
  await rmdir(old).catch(()=>{});
  await rmdir(parent).catch(()=>{});
}
