// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink, utimes } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {renderMarkdownPdf} from './MarkdownPDF.mjs';
import { createNativeExplorer } from './explorer-native.mjs';
import { isInternalCredentialPath } from './内部認証ファイル.mjs';

const ACTIONS = new Set(['copy', 'rename', 'trash', 'create-file', 'create-folder', 'pdf']);
const MAX_BODY = 20 * 1024 * 1024;
const issue = (status, message, code = 'explorer_error') => Object.assign(new Error(message), { status, code });
const sameEntry = (a, b) => a.dev === b.dev && a.ino === b.ino && a.isDirectory() === b.isDirectory();
const absent = async path => { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const toPath = (directory, name) => directory ? `${directory}/${name}` : name;

/** Windows でも別名・デバイス・ADS にならない、単一のファイル名だけを許可する。 */
export function validateExplorerName(name) {
  if (isInternalCredentialPath(name)) throw issue(403, '内部認証ファイルは操作できません。', 'private_credential');
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || Buffer.byteLength(name, 'utf8') > 255
      || /[\x00-\x1f\x7f<>:"/\\|?*]/u.test(name) || /[.\s]$/u.test(name)
      || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name)) {
    throw issue(400, '名前に空欄、区切り、予約名、末尾の空白・ピリオドは使えません。', 'invalid_name');
  }
  return name;
}
function validatePath(path, allowRoot = false) {
  if (typeof path !== 'string' || path.length > 4096 || (!path && !allowRoot) || isAbsolute(path) || path.includes('\\')) {
    throw issue(400, 'プロジェクト内の相対パスを指定してください。', 'invalid_path');
  }
  if (path) path.split('/').forEach(validateExplorerName);
  return path;
}
function filesystemError(error) {
  if (error.status) return error;
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return issue(404, '対象のファイルまたはフォルダが見つかりません。', 'not_found');
  if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') return issue(409, '同じ名前の項目が既にあります。上書きはしません。', 'already_exists');
  if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS') return issue(403, 'この場所を変更する権限がありません。', 'permission_denied');
  if (error.code === 'ENOSPC' || error.code === 'EDQUOT') return issue(507, '保存先の空き容量が足りません。', 'no_space');
  return issue(500, 'ファイル操作に失敗しました。対象の状態を確認してください。', 'filesystem_error');
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []; let size = 0;
    const finish = (error) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted);
      if (error) reject(error); else resolveBody(Buffer.concat(chunks).toString('utf8'));
    };
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY) return finish(issue(413, '要求が大きすぎます。', 'body_too_large'));
      chunks.push(chunk);
    };
    const end = () => finish(), failed = () => finish(issue(400, '要求を受信できませんでした。', 'invalid_request'));
    const aborted = () => finish(issue(400, '要求が中断されました。', 'invalid_request'));
    const timer = setTimeout(() => finish(issue(408, '要求の受信がタイムアウトしました。', 'body_timeout')), 10000);
    timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted);
  });
}

/** ファイル本文の編集APIではなく、Explorer の明示操作だけを扱う。 */
export function createExplorerFiles(root, { state = () => ({ active: true }), onChange = () => {}, native = createNativeExplorer(),
  limits = {}, pdfRenderer = renderMarkdownPdf } = {}) {
  const caps = { maxEntries: 20000, maxBytes: 512 * 1024 * 1024, maxPending: 16, timeMs: 120000, ...limits };
  let generation = 0, closed = false, pending = 0, tail = Promise.resolve();
  const rootPromise = realpath(root).then(async full => ({ full, info: await lstat(full) }));
  // 失敗した rootPromise が最初の操作前に未処理拒否になることを防ぐ。
  rootPromise.catch(() => {});
  const invalidate = () => { generation++; };

  async function locate(path, { directory = false, allowRoot = false } = {}) {
    validatePath(path, allowRoot);
    const anchor = await rootPromise, base = anchor.full;
    let full = base, info = await lstat(base);
    if (info.isSymbolicLink() || !info.isDirectory() || !sameEntry(anchor.info, info) || await realpath(root) !== base) {
      throw issue(409, 'プロジェクトの場所が変更されています。再起動してください。', 'changed_path');
    }
    for (const part of path ? path.split('/') : []) {
      full = join(full, part); info = await lstat(full);
      if (info.isSymbolicLink()) throw issue(403, 'リンクを含むパスは変更できません。リンク元で操作してください。', 'symbolic_link');
      const canonical = await realpath(full), back = relative(base, canonical);
      if (isInternalCredentialPath(canonical)) throw issue(403, '内部認証ファイルは操作できません。', 'private_credential');
      if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) throw issue(403, 'プロジェクト外は変更できません。', 'outside_project');
      const again = await lstat(full);
      if (again.isSymbolicLink() || !sameEntry(info, again)) throw issue(409, '操作中に対象のパスが変更されました。', 'changed_path');
    }
    if (directory && !info.isDirectory()) throw issue(400, '貼り付け先・作成先にはフォルダを指定してください。', 'not_directory');
    if (!info.isDirectory() && !info.isFile()) throw issue(403, '通常のファイルとフォルダだけを操作できます。', 'special_file');
    return { path, full, info, type: info.isDirectory() ? 'directory' : 'file' };
  }
  async function recheck(entry) {
    const current = await locate(entry.path, { allowRoot: !entry.path });
    if (!sameEntry(entry.info, current.info)) throw issue(409, '操作中に対象が変更されました。一覧を更新してからやり直してください。', 'changed_path');
    return current;
  }
  async function manifest(source, check) {
    const entries = []; let bytes = 0;
    async function visit(entry, suffix = '') {
      check();
      if (entries.length >= caps.maxEntries) throw issue(413, 'コピーする項目が多すぎます。小さいフォルダ単位で操作してください。', 'copy_limit');
      bytes += entry.info.isFile() ? entry.info.size : 0;
      if (bytes > caps.maxBytes) throw issue(413, 'コピー容量が上限（512MB）を超えています。OSのファイル管理で操作してください。', 'copy_limit');
      entries.push({ ...entry, suffix });
      if (entry.type === 'directory') {
        for (const name of await readdir(entry.full)) {
          validateExplorerName(name);
          await visit(await locate(toPath(entry.path, name)), toPath(suffix, name));
        }
      }
    }
    await visit(source);
    return entries;
  }
  async function copyFile(entry, destinationPath, check, markCreated) {
    await recheck(entry); check();
    const input = await open(entry.full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let output;
    try {
      const before = await input.stat();
      if (!sameEntry(entry.info, before) || before.size !== entry.info.size || before.mtimeMs !== entry.info.mtimeMs) throw issue(409, 'コピー元が変更されました。もう一度お試しください。', 'changed_path');
      await locate(dirname(destinationPath) === '.' ? '' : dirname(destinationPath).split(sep).join('/'), { directory: true, allowRoot: true });
      check();
      output = await open(resolve((await rootPromise).full, ...destinationPath.split('/')), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), before.mode & 0o777);
      markCreated();
      const buffer = Buffer.alloc(256 * 1024); let offset = 0;
      while (offset < before.size) {
        check();
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
        if (!bytesRead) throw issue(409, 'コピー中に元ファイルが変更されました。', 'changed_path');
        let written = 0;
        while (written < bytesRead) written += (await output.write(buffer, written, bytesRead - written, offset + written)).bytesWritten;
        offset += bytesRead;
      }
      const after = await input.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw issue(409, 'コピー中に元ファイルが変更されました。', 'changed_path');
      await output.utimes(before.atime, before.mtime);
    } finally { await output?.close(); await input.close(); }
  }
  async function perform(body, options, version) {
    const started = Date.now(); let changed = false, partialPath = '';
    const check = () => {
      if (closed || version !== generation || !state().active || options.cancelled?.()) throw issue(503, '利用が終了したため操作を中止しました。', 'session_ended');
      if (Date.now() - started > caps.timeMs) throw issue(408, '操作の時間上限を超えました。', 'operation_timeout');
    };
    try {
      check();
      if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action)) throw issue(400, 'ファイル操作が正しくありません。', 'invalid_action');
      const { action } = body;
      if (action === 'create-file' || action === 'create-folder') {
        const name = validateExplorerName(body.name), directory = await locate(body.directory ?? body.path ?? '', { directory: true, allowRoot: true });
        const path = toPath(directory.path, name), full = join(directory.full, name);
        await recheck(directory); check();
        if (action === 'create-folder') await mkdir(full);
        else { const handle = await open(full, 'wx'); changed = true; await handle.close(); }
        changed = true;
        return { action, path, name, type: action === 'create-folder' ? 'directory' : 'file' };
      }
      const source = await locate(body.path), name = basename(source.full);
      if (action === 'pdf') {
        if(source.type!=='file'||!/\.md$/i.test(name))throw issue(400,'Markdown（.md）ファイルを選択してください。','not_markdown');
        if(source.info.size>1024*1024)throw issue(413,'MarkdownのPDF化は1MBまでです。','pdf_limit');
        const parentPath=source.path.includes('/')?source.path.slice(0,source.path.lastIndexOf('/')):'';
        const parent=await locate(parentPath,{directory:true,allowRoot:true}),pdfName=name.slice(0,-3)+'.pdf',path=toPath(parentPath,pdfName),full=join(parent.full,pdfName);
        const checkTarget=async()=>{if(!await absent(full)){const target=await locate(path);if(target.type!=='file')throw issue(409,'PDFの保存先に同名のフォルダがあります。','not_file');}};
        await checkTarget();
        const pdf=await pdfRenderer({root:(await rootPromise).full,path:source.path});
        if(!Buffer.isBuffer(pdf)||pdf.subarray(0,5).toString()!=='%PDF-'||pdf.length>50*1024*1024)throw issue(503,'PDFの生成結果を確認できません。','pdf_failed');
        const current=await recheck(source);await recheck(parent);check();
        if(current.info.size!==source.info.size||current.info.mtimeMs!==source.info.mtimeMs)throw issue(409,'PDF化中にMarkdownが変更されました。もう一度お試しください。','changed_path');
        // 完成した一時ファイルとの置換で、生成・書き込み失敗時は既存PDFを残す。
        const temporary=join(parent.full,`.aidiy-pdf-${randomUUID()}.tmp`);
        const output=await open(temporary,'wx');
        try{
          try{await output.writeFile(pdf);}finally{await output.close();}
          await recheck(parent);await checkTarget();check();
          await rename(temporary,full);changed=true;
        }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
        return {action,path,name:pdfName,type:'file',previousPath:source.path};
      }
      if (action === 'trash') {
        if (body.confirmed !== true) throw issue(400, 'ゴミ箱への移動には確認が必要です。', 'confirmation_required');
        await recheck(source); check();
        changed = true; // OSが完了後にエラーを返す場合も、古い一覧を残さない。
        try { await native.trash(source.full, source.type); }
        catch { throw issue(503, 'ゴミ箱へ移動できませんでした。完全削除への切り替えは行いません。元の場所とOSのゴミ箱を確認してください。', 'trash_unavailable'); }
        if (!await absent(source.full)) throw issue(503, 'ゴミ箱への移動を確認できませんでした。元の場所を確認してください。', 'trash_unavailable');
        changed = true;
        return { action, path: source.path, previousPath: source.path, name, type: source.type };
      }
      if (action === 'rename') {
        const newName = validateExplorerName(body.name), parentPath = body.path.includes('/') ? body.path.slice(0, body.path.lastIndexOf('/')) : '';
        const parent = await locate(parentPath, { directory: true, allowRoot: true }), path = toPath(parentPath, newName), full = join(parent.full, newName);
        if (path === source.path) return { action, path, previousPath: source.path, name: newName, type: source.type };
        if (!await absent(full)) throw issue(409, '同じ名前の項目が既にあります。上書きはしません。', 'already_exists');
        await recheck(source); await recheck(parent); check();
        changed = true;
        try { await native.rename(source.full, full, source.type); }
        catch (error) {
          if (!await absent(full)) throw issue(409, '同じ名前の項目が既にあります。上書きはしません。', 'already_exists');
          if (error.code === 'EEXIST') throw error;
          throw issue(503, '安全に名前を変更できませんでした。対象の状態とOSのファイル操作機能を確認してください。', 'rename_unavailable');
        }
        changed = true;
        return { action, path, previousPath: source.path, name: newName, type: source.type };
      }
      const directory = await locate(body.directory ?? '', { directory: true, allowRoot: true });
      if (source.type === 'directory' && (directory.path === source.path || directory.path.startsWith(`${source.path}/`))) throw issue(400, 'フォルダを自分自身やその配下にはコピーできません。', 'recursive_copy');
      const entries = await manifest(source, check), extension = source.type === 'file' ? extname(name) : '', stem = extension ? name.slice(0, -extension.length) : name;
      let destination, candidate;
      for (let index = 0; index < 10000; index++) {
        candidate = index === 0 ? name : `${stem} - コピー${index > 1 ? ` (${index})` : ''}${extension}`;
        validateExplorerName(candidate); destination = toPath(directory.path, candidate);
        await recheck(directory); check();
        try {
          if (source.type === 'directory') { await mkdir(join(directory.full, candidate)); changed = true; }
          else await copyFile(source, destination, check, () => { changed = true; partialPath = destination; });
          partialPath = destination; break;
        } catch (error) { if (error.code === 'EEXIST' && !changed) continue; throw error; }
      }
      if (!changed) throw issue(409, 'コピー先の名前を確保できませんでした。', 'already_exists');
      if (source.type === 'directory') {
        for (const entry of entries.slice(1)) {
          check(); await recheck(entry);
          const path = toPath(destination, entry.suffix);
          await locate(path.slice(0, path.lastIndexOf('/')), { directory: true, allowRoot: true });
          if (entry.type === 'directory') await mkdir(resolve((await rootPromise).full, ...path.split('/')));
          else await copyFile(entry, path, check, () => {});
        }
        // 子の作成後にフォルダの日時を復元する。
        for (const entry of [...entries].reverse().filter(item => item.type === 'directory')) {
          const copied = await locate(toPath(destination, entry.suffix).replace(/\/$/, ''), { directory: true });
          await utimes(copied.full, entry.info.atime, entry.info.mtime);
        }
      }
      return { action, path: destination, previousPath: source.path, name: candidate, type: source.type };
    } catch (error) {
      const failure = filesystemError(error);
      // 他プロセスが作った内容まで消さない。途中コピーは明示して残し、元は変更しない。
      if (partialPath && changed) { failure.message += ` 作成途中の「${partialPath}」が残っています。`; failure.partialPath = partialPath; }
      throw failure;
    } finally { if (changed) onChange(); }
  }
  async function performBatch(body, options, version) {
    const started=Date.now();
    const check=()=>{
      if(closed||version!==generation||!state().active||options.cancelled?.())throw issue(503,'利用が終了したため操作を中止しました。','session_ended');
      if(Date.now()-started>caps.timeMs)throw issue(408,'一括操作の時間上限を超えました。','operation_timeout');
    };
    check();
    if(!['copy','trash','pdf'].includes(body.action)||!Array.isArray(body.paths)||!body.paths.length||body.paths.length>1000)
      throw issue(400,'一括操作の対象は1〜1000件で指定してください。','invalid_batch');
    if(body.action==='trash'&&body.confirmed!==true)throw issue(400,'ゴミ箱への移動には確認が必要です。','confirmation_required');
    const paths=[...new Set(body.paths.map(path=>validatePath(path)))];
    // 階層の混在を親フォルダの操作へまとめない。意図せず配下全体を削除させない。
    if(paths.some(path=>paths.some(parent=>parent!==path&&path.startsWith(parent+'/'))))
      throw issue(400,'フォルダとその配下の項目が重複しています。フォルダ全体か個別ファイルのどちらかにチェックを整理してください。','overlapping_targets');
    const entries=[];for(const path of paths){check();entries.push(await locate(path));}
    const targets=entries;
    if(body.action==='pdf'&&targets.some(entry=>entry.type!=='file'||!/\.md$/i.test(entry.path)))throw issue(400,'PDF化はMarkdownだけをチェックしてください。','not_markdown');
    if(body.action==='copy')for(const source of targets){
      const destination=body.duplicate===true?(source.path.includes('/')?source.path.slice(0,source.path.lastIndexOf('/')):''):body.directory??'';
      await locate(destination,{directory:true,allowRoot:true});
      if(source.type==='directory'&&(destination===source.path||destination.startsWith(source.path+'/')))throw issue(400,'フォルダを自分自身やその配下にはコピーできません。','recursive_copy');
    }
    const results=[];
    for(const source of targets){
      try{
        check();
        await recheck(source);
        const directory=body.duplicate===true?(source.path.includes('/')?source.path.slice(0,source.path.lastIndexOf('/')):''):body.directory;
        results.push(await perform({action:body.action,path:source.path,directory,confirmed:body.confirmed},options,version));
      }catch(error){
        const failure=filesystemError(error);
        failure.message=`${results.length}/${targets.length}件完了。「${source.path}」で停止しました。${failure.message}`;
        failure.completed=results;failure.failedPath=source.path;failure.total=targets.length;throw failure;
      }
    }
    return {action:body.action,results,total:targets.length};
  }
  function apply(body, options = {}) {
    if (pending >= caps.maxPending) return Promise.reject(issue(429, '操作が混み合っています。完了を待ってください。', 'busy'));
    const version = options.version ?? generation; pending++;
    const result = tail.then(() => body&&Object.hasOwn(body,'paths')?performBatch(body,options,version):perform(body, options, version));
    tail = result.catch(() => {});
    return result.finally(() => { pending--; });
  }
  async function handle(req, res, url) {
    if (url.pathname !== '/api/explorer/actions') return false;
    const reply = (status, value) => { if (!res.destroyed && !res.writableEnded) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(value)); };
    try {
      if (req.method !== 'POST') throw issue(405, 'POST required', 'method_not_allowed');
      // Origin が無い form POST / simple request も、非 simple な固定ヘッダーで拒否する。
      if (req.headers['x-aidiy-explorer'] !== '1' || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw issue(403, 'ExplorerからのJSON操作だけを受け付けます。', 'forbidden_request');
      if (!state().active || closed) throw issue(503, 'AiDiy接続利用またはオフライン利用を選択してください。', 'session_ended');
      const contentLength = Number(req.headers['content-length'] || 0);
      if (!Number.isFinite(contentLength) || contentLength > MAX_BODY) throw issue(413, '要求が大きすぎます。', 'body_too_large');
      const version = generation, text = await readBody(req);
      let body;
      try { body = JSON.parse(text); } catch { throw issue(400, 'JSONが正しくありません。', 'invalid_json'); }
      reply(200, await apply(body, { version, cancelled: () => req.aborted || res.destroyed }));
    } catch (error) { const failure = filesystemError(error); req.resume(); reply(failure.status, { error: failure.code, message: failure.message, ...(failure.partialPath ? { partialPath: failure.partialPath } : {}), ...(failure.completed?{completed:failure.completed,failedPath:failure.failedPath,total:failure.total}:{}) }); }
    return true;
  }
  return { apply, handle, invalidate, close() { closed = true; invalidate(); } };
}
