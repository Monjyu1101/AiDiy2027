// -*- coding: utf-8 -*-
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

import { createHash } from 'node:crypto';
import rules from '../../backend_server/core_router/フォルダ除外規則.json' with { type: 'json' };
import { opendir, lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { alwaysExcludedDirectory, hasAlwaysExcludedDirectory } from '../ファイル機能/フォルダ除外規則.mjs';
import { isInternalCredentialPath } from '../ファイル機能/内部認証ファイル.mjs';

const MAX_FILES = 30000;

// AiDiy のバックアップ対象（エクスプローラーのフィルター用）。
// ルールの元は backend_server/AIコア/AIバックアップ.py の _全ファイルスキャン。
// 従来の一覧条件をJSONにまとめ、Pythonの状態APIと共有する（Python自体は呼ばない）。
const BACKUP_EXCLUDED_DIRS = new Set(rules.backupDirectories);
const BACKUP_EXCLUDED_FILES = new Set(rules.backupFiles);
const BACKUP_EXCLUDED_PATHS = new Set(rules.backupPaths);
const backupPathAllowed = path => {
  const parts = resolve(path).split(sep);
  return !parts.some((part, index) => BACKUP_EXCLUDED_PATHS.has(`${part}/${parts[index + 1]}`));
};
const BACKUP_EXCLUDED_EXTENSIONS = rules.backupExtensions;
const WINDOWS_RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'null',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)]);
const MAX_BACKUP_FILES = 100000;   // バックアップがキャンセルする件数と同じ
const backupDirAllowed = name => !BACKUP_EXCLUDED_DIRS.has(name) && !name.startsWith('.');
const backupFileAllowed = name => !BACKUP_EXCLUDED_FILES.has(name)
  && !name.startsWith('~$') // Officeの一時ロック。Pythonの共通バックアップ判定と合わせる。
  && !BACKUP_EXCLUDED_EXTENSIONS.some(ext => name.endsWith(ext))
  && !WINDOWS_RESERVED.has((name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name).toLowerCase());


/** 画面の相対フォルダだけを許可する。リンク・除外ディレクトリへ直接入る要求も拒否する。 */
export async function resolveScanFolder(root, folder = '', filter, fs = { lstat, realpath }) {
  if (typeof folder !== 'string' || folder.length > 4096 || folder.includes('\0') || folder.includes('\\') || isAbsolute(folder)) return null;
  const parts = folder ? folder.split('/') : [];
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return null;
  let target = root;
  for (const part of parts) {
    target = join(target, part);
    if (alwaysExcludedDirectory(part) || (filter === 'backup' && (!backupDirAllowed(part) || !backupPathAllowed(target)))) return null;
    try {
      const info = await fs.lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) return null;
      const full = await fs.realpath(target), back = relative(root, full);
      if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back) || hasAlwaysExcludedDirectory(back, true)) return null;
    } catch { return null; }
  }
  return target;
}

export const SCAN_LIMITS = Object.freeze({ maxFiles: MAX_FILES, maxDirectories: 10000, maxEntries: 200000, maxDepth: 128, timeMs: 10000 });
const abortError = () => Object.assign(new Error('処理は取り消されました。'), { name: 'AbortError' });

/** OSの読み取り自体が遅い場合も応答を打ち切り、遅れて開いたハンドルは閉じる。 */
export function createBudget({ signal, timeMs, now = () => performance.now() }) {
  const controller = new AbortController(), started = now(), deadline = started + timeMs;
  let reason = null;
  const stop = value => { if (!reason) { reason = value; controller.abort(); } };
  const cancel = () => stop('cancelled');
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop('time'), Math.max(0, timeMs));
  const check = () => { if (!reason && now() >= deadline) stop('time'); return reason; };
  const run = (operation, lateCleanup) => {
    if (check()) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => { if (!settled) { settled = true; controller.signal.removeEventListener('abort', abort); reject(abortError()); } };
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { if (check()) throw abortError(); return operation(); }).then(value => {
        if (settled) { if (lateCleanup) Promise.resolve().then(() => lateCleanup(value)).catch(() => {}); return; }
        settled = true; controller.signal.removeEventListener('abort', abort); resolve(value);
      }, error => {
        if (settled) return;
        settled = true; controller.signal.removeEventListener('abort', abort); reject(error);
      });
    });
  };
  return { check, stop, run, signal: controller.signal, get reason() { return reason; },
    get elapsedMs() { return Math.max(0, Math.round(now() - started)); },
    close() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
  };
}

export function scanMetadata(result) {
  const { scannedAt, files, directories, entries, elapsedMs, truncated, truncationReason } = result;
  return { scannedAt, files, directories, entries, elapsedMs, truncated, truncationReason };
}

/** フォルダの形は従来通り {n,d,f}。ファイル・ディレクトリ・列挙数・深さ・時間を制限する。 */
export async function scanTree(root, { filter, scope, folder = '', signal, limits = {}, fs = { opendir, lstat, realpath }, now } = {}) {
  const backup = filter === 'backup';
  const caps = { ...SCAN_LIMITS, maxFiles: backup ? MAX_BACKUP_FILES : MAX_FILES, ...limits };
  const budget = createBudget({ signal, timeMs: caps.timeMs, now });
  const tree = { n: basename(folder || root) || root, d: [], f: [] };
  const records = [], fileList = []; let latest = null, missing = false, unreadable = false;
  let files = 0, directories = 0, entries = 0;
  const below = (base, full) => { const back = relative(base, full); return !back || (back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back)); };
  const closeDir = handle => handle.close().catch(() => {});
  async function walk(dir, node, depth, canonicalRoot) {
    if (budget.check()) return;
    if (backup && !backupPathAllowed(dir)) return;
    if (directories >= caps.maxDirectories) { budget.stop('directories'); return; }
    if (depth > caps.maxDepth) { budget.stop('depth'); return; }
    directories++;
    records.push([relative(root, dir), 'dir']);
    let handle;
    try {
      const full = await budget.run(() => fs.realpath(dir));
      if (!below(canonicalRoot, full) || hasAlwaysExcludedDirectory(relative(canonicalRoot, full), true)) return;
      handle = await budget.run(() => fs.opendir(full), closeDir);
      while (!budget.check()) {
        if (entries >= caps.maxEntries) { budget.stop('entries'); break; }
        const entry = await budget.run(() => handle.read());
        if (!entry) break;
        entries++;
        const path = join(full, entry.name);
        if (entry.isDirectory()) {
          // grep対象外の保存版は走査前に除外し、候補や時間の上限を消費させない。
          if (scope === 'grep' && ['.aidiy_backup', '.backup_local'].includes(entry.name)) continue;
          if (hasAlwaysExcludedDirectory(relative(root,path),true) || (backup && (!backupDirAllowed(entry.name) || !backupPathAllowed(path)))) continue;
          const child = { n: entry.name, d: [], f: [] };
          node.d.push(child);
          await walk(path, child, depth + 1, canonicalRoot);
        } else if (entry.isFile()) {
          if (isInternalCredentialPath(entry.name)) continue;
          if (backup && !backupFileAllowed(entry.name)) continue;
          if (files >= caps.maxFiles) { budget.stop('files'); break; }
          try {
            // 列挙後にリンクへ置換されたファイルは追いかけない。
            const info = await budget.run(() => fs.lstat(path));
            if (info.isFile()) { node.f.push([entry.name, info.size, Math.round(info.mtimeMs)]); files++;
              latest = latest === null ? Math.round(info.mtimeMs) : Math.max(latest, Math.round(info.mtimeMs));
              fileList.push({ path: relative(root, path).split(sep).join('/'), name: entry.name, size: info.size, mtime: Math.round(info.mtimeMs) });
              records.push([relative(root, path), info.size, info.mtimeMs, info.ctimeMs, String(info.ino)]); }
          } catch { unreadable = true; /* 次回の確認まで部分結果で上書きしない */ }
        }
      }
    } catch { unreadable = true; /* 読み取り不可・途中削除・期限切れ */ }
    finally {
      // 中断中のread完了を待ってハンドルを閉じる処理だけが残り、走査は再開しない。
      if (handle) await budget.run(() => closeDir(handle)).catch(() => { void closeDir(handle); });
      node.d.sort((a, b) => a.n.localeCompare(b.n));
      node.f.sort((a, b) => a[0].localeCompare(b[0]));
    }
  }
  try {
    const canonicalRoot = await budget.run(() => fs.realpath(root));
    const target = await budget.run(() => resolveScanFolder(canonicalRoot, folder, filter, fs));
    if (!target) { missing = true; } else await walk(target, tree, 0, canonicalRoot);
    budget.check();
    return { root, scannedAt: Date.now(), files, directories, entries, elapsedMs: budget.elapsedMs,
      missing, latest, fileList: fileList.sort((a,b)=>a.path.localeCompare(b.path,'ja',{numeric:true})), revision: createHash('sha256').update(JSON.stringify(records.sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex'),
      truncated: !!budget.reason || unreadable, truncationReason: budget.reason || (unreadable ? 'unreadable' : null), tree };
  } catch {
    return { root, scannedAt: Date.now(), files, directories, entries, elapsedMs: budget.elapsedMs,
      missing, latest, fileList: fileList.sort((a,b)=>a.path.localeCompare(b.path,'ja',{numeric:true})), revision: createHash('sha256').update(JSON.stringify(records.sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex'),
      truncated: !!budget.reason || unreadable, truncationReason: budget.reason || (unreadable ? 'unreadable' : null), tree };
  } finally { budget.close(); }
}

/** サーバー単位の短期スナップショット。フィルター・対象範囲ごとに共有し、同時走査は1本に抑える。 */
export function createScanPool(root, { ttlMs = 1000, scan = scanTree, limits, now = Date.now } = {}) {
  const cache = new Map(), jobs = new Map(), queue = [];
  let active = null, closed = false;
  function settle(job, error, value) {
    for (const consumer of [...job.consumers]) consumer.finish(error, value);
  }
  function pump() {
    if (active || closed) return;
    let job;
    while ((job = queue.shift())) {
      if (job.consumers.size && !job.controller.signal.aborted) break;
    }
    if (!job) return;
    active = job;
    Promise.resolve().then(() => scan(root, { filter: job.filter, scope: job.scope, folder: job.folder, signal: job.controller.signal, limits })).then(result => {
      if (!closed && !job.controller.signal.aborted && jobs.get(job.key) === job && result.truncationReason !== 'cancelled') {
        cache.set(job.key, { result, at: now() });
        while(cache.size > 32) cache.delete(cache.keys().next().value);
      }
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      settle(job, null, result);
    }, error => {
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      settle(job, error);
    }).finally(() => {
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      active = null;
      pump();
    });
  }
  function invalidate() {
    cache.clear();
    for (const job of new Set([active, ...jobs.values()].filter(Boolean))) {
      job.controller.abort(); settle(job, abortError());
    }
    jobs.clear(); queue.length = 0;
  }
  return {
    invalidate,
    get({ filter, scope, folder = '', signal, fresh = false } = {}) {
      if (closed || signal?.aborted) return Promise.reject(abortError());
      const scanFilter = filter === 'backup' ? 'backup' : '', scanScope = scope === 'grep' ? 'grep' : '';
      const key = JSON.stringify([scanScope, scanFilter, folder]);
      const saved = cache.get(key);
      if (!fresh && saved && now() - saved.at < ttlMs) return Promise.resolve(saved.result);
      if (saved) cache.delete(key);
      let job = jobs.get(key);
      if (!job) {
        job = { key, folder, filter: scanFilter || undefined, scope: scanScope || undefined, consumers: new Set(), controller: new AbortController() };
        jobs.set(key, job); queue.push(job);
      }
      const promise = new Promise((resolve, reject) => {
        const consumer = { finish(error, value) {
          if (!job.consumers.delete(consumer)) return;
          signal?.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(value);
        } };
        const cancel = () => {
          consumer.finish(abortError());
          if (!job.consumers.size) {
            job.controller.abort();
            if (jobs.get(key) === job) jobs.delete(key);
            const queued = queue.indexOf(job);
            if (queued >= 0) queue.splice(queued, 1);
          }
        };
        job.consumers.add(consumer);
        signal?.addEventListener('abort', cancel, { once: true });
      });
      queueMicrotask(pump);
      return promise;
    },
    close() {
      if (closed) return;
      closed = true; invalidate();
    },
  };
}
