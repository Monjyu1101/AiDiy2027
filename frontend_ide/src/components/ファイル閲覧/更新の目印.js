// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { nextLocalMidnight } from './ファイル日時.js';

export const UPDATE_FLASH_MS = 1200;

// 入力は表示中フォルダの直下・フィルター適用済みファイルだけ。子フォルダの日時は競わせない。
export function fileRecency(files, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = nextLocalMidnight(now), today = +start;
  let latest = -Infinity;
  for (const file of files) if (typeof file.path === 'string' && Number.isFinite(file.mtime) && file.mtime >= today && file.mtime < end) latest = Math.max(latest, file.mtime);
  const levels = Object.create(null);
  for (const file of files) {
    const time = file.mtime;
    if (typeof file.path !== 'string' || !Number.isFinite(time)) continue;
    if (time >= today && time < end) levels[file.path] = time === latest ? 2 : 1;
  }
  return { levels, latest: Number.isFinite(latest) ? latest : null };
}

// フォルダ・filter・sessionの切替は基準を取り直す。初回と変更なしでは光らせない。
export function createUpdateMarks() {
  let scope, previous, files = [], flashes = Object.create(null), sequence = 0;
  return {
    update(next, key, now = Date.now(), motion = true) {
      const records = new Map(next.map(file => [file.path, { mtime: file.mtime, size: file.size }]));
      if (key !== scope) { previous = null; flashes = Object.create(null); }
      if (previous && motion) for (const [path, value] of records) {
        const old = previous.get(path);
        if (!old || old.mtime !== value.mtime || old.size !== value.size) flashes[path] = { at: now, id: ++sequence };
      }
      for (const path of Object.keys(flashes)) if (!records.has(path)) delete flashes[path];
      scope = key; previous = records; files = next;
      return this.snapshot(now, motion);
    },
    snapshot(now = Date.now(), motion = true) {
      for (const [path, flash] of Object.entries(flashes)) if (!motion || now - flash.at >= UPDATE_FLASH_MS || now < flash.at) delete flashes[path];
      return { ...fileRecency(files, now), flashes: { ...flashes } };
    },
    clear() { scope = previous = undefined; files = []; flashes = Object.create(null); },
  };
}

export function updateFlash(flash, now = Date.now()) {
  if (!flash) return 0;
  const age = now - flash.at;
  return age >= 0 && age < UPDATE_FLASH_MS ? Math.sin(Math.PI * age / UPDATE_FLASH_MS) ** 2 : 0;
}
