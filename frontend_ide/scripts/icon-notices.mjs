// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { readFile } from 'node:fs/promises';
const folder = new URL('../public/assets/catppuccin_icons/', import.meta.url);
export async function catppuccinNotice() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
  const files = await Promise.all(['LICENSE', 'SOURCE.md', 'MARKDOWN_LICENSE'].map(async name => ({ name, text: await readFile(new URL(name, folder), 'utf8') })));
  return { name: manifest.name, version: `${manifest.version} (${manifest.commit})`, license: manifest.license, source: manifest.repository, files };
}
