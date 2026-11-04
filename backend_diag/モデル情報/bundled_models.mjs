// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 公開 OpenRouter 一覧を取得できない場合の同梱キャッシュ。ZIP を一時フォルダへ展開して読む。
// 外部コマンドは使わず、Node 標準の zlib だけで固定の 1 ファイルを取り出す。
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

export const BUNDLED_ZIP = fileURLToPath(new URL('./openrouter_models/openrouter_models.zip', import.meta.url));
export const BUNDLED_ENTRY = 'openrouter_models.txt';
export const EXTRACT_DIRECTORY = path.join(os.tmpdir(), 'aidiy_diag');
const LIMIT = 16 * 1024 * 1024;

const CRC_TABLE = Array.from({length:256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// 中央ディレクトリから指定名の 1 エントリだけを取り出す（無圧縮 / deflate、暗号化なし）。
export function extractEntry(zip, name) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('zip');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip');
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10), crc = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20), size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42), entry = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (entry !== name) continue;
    if (flags & 1 || size > LIMIT || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error('zip');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (start + compressed > zip.length) throw new Error('zip');
    const raw = zip.subarray(start, start + compressed);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw, {maxOutputLength:LIMIT}) : null;
    if (!data || data.length !== size || crc32(data) !== crc) throw new Error('zip');
    return data;
  }
  throw new Error('zip');
}

// 一時フォルダへ展開（一時ファイルから置き換え）し、展開先のパスを返す。
export async function extractBundledModels({zipPath = BUNDLED_ZIP, directory = EXTRACT_DIRECTORY} = {}) {
  const data = extractEntry(await readFile(zipPath), BUNDLED_ENTRY);
  await mkdir(directory, {recursive:true});
  const file = path.join(directory, BUNDLED_ENTRY), temporary = `${file}.${process.pid}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, file); }
  catch (error) { await rm(temporary, {force:true}).catch(() => {}); throw error; }
  return file;
}

// 展開した OpenRouter /api/v1/models の応答本文を返す。
export async function loadBundledModels(options = {}) {
  const file = await extractBundledModels(options);
  const body = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) throw new Error('shape');
  return body;
}
