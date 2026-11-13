// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 読み取り専用の外部プログラム診断。任意コマンド・設定ファイルは受け付けない。
import { access, readFile, mkdtemp, rm, stat, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {recordProbeFailure} from '../起動/desktop-log.mjs';
import {applySecurityVersionWarning} from './セキュリティバージョン.mjs';

const activeProbes = new Set();
let shuttingDown = false;
export function cancelProbes() { shuttingDown = true; for (const cancel of [...activeProbes]) cancel(); }
export const TIMEOUT = 15000;
export const OUTPUT_LIMIT = 16384;
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CATALOG_PATH = fileURLToPath(new URL('./catalog.json', import.meta.url));
export async function catalog() { return JSON.parse(await readFile(CATALOG_PATH, 'utf8')); }
const versionPattern = /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?)(?![\w.])/;

export function expandPath(value, env = process.env, home = os.homedir(), platform = process.platform) {
  let missing = false;
  const expanded = value.replace(/^~(?=[/\\]|$)/, home).replace(/\$\{([\w()]+)\}|\$(\w+)|%([\w()]+)%/g, (_, a, b, c) => { const key=a || b || c; const found=env[key] || (platform === 'win32' ? Object.entries(env).find(([name]) => name.toUpperCase() === key.toUpperCase())?.[1] : undefined); if (!found) missing=true; return found || ''; });
  return missing ? null : expanded;
}
// python.org の既定配置のみ、一階層・最大256件ずつ確認する。全ドライブ探索はしない。
async function windowsPythonPaths(env) {
  const candidates = [];
  for (const template of ['$LOCALAPPDATA/Programs/Python', '$ProgramFiles', '${ProgramFiles(x86)}']) {
    const root = expandPath(template, env, undefined, 'win32');
    if (!root) continue;
    const names = [];
    try {
      const directory = await opendir(root); let count = 0;
      for await (const item of directory) {
        if (item.isDirectory() && /^Python(?:3\d+| 3\.\d+)(?:-(?:32|64|arm64))?$/i.test(item.name)) names.push(item.name);
        if (++count >= 256) break;
      }
    } catch {}
    names.sort((a,b) => b.localeCompare(a, 'en', {numeric:true}));
    for (const name of names) candidates.push(path.join(root, name, 'python.exe'));
  }
  return candidates;
}

export async function resolveProgram(entry, options = {}) {
  const platform = options.platform || process.platform, env = options.env || process.env;
  // 自分の Node は PATH に無くても、起動済み実行ファイルとして検出する。
  if (entry.id === 'node' && !options.env) return process.execPath;
  const extensions = platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  const pathValue = env.PATH || (platform === 'win32' ? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] : '') || '';
  const directories = pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const candidates = [];
  for (const command of entry.commands) for (const directory of directories) for (const extension of (/\.(exe|com|cmd|bat)$/i.test(command) ? [''] : extensions)) {
    candidates.push(path.join(directory.replace(/^"(.*)"$/, '$1'), command + extension));
  }
  for (const value of entry.paths?.[platform] || []) { const expanded=expandPath(value,env,undefined,platform); if(expanded) candidates.push(expanded); }
  for (const value of entry.project_paths?.[platform] || []) candidates.push(path.resolve(REPO_ROOT, value));
  // Store の実行エイリアスは起動せず、実体・venv・従来の py launcher を探す。
  if (entry.id === 'python' && platform === 'win32') {
    candidates.push(...await windowsPythonPaths(env));
    for (const directory of directories) candidates.push(path.join(directory.replace(/^"(.*)"$/, '$1'), 'py.exe'));
    for (const value of ['$LOCALAPPDATA/Programs/Python/Launcher/py.exe', '$SystemRoot/py.exe']) {
      const expanded = expandPath(value, env, undefined, platform); if (expanded) candidates.push(expanded);
    }
  }
  const usable = [...new Set(candidates)].filter(candidate =>
    !(entry.id === 'python' && platform === 'win32' && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(candidate)) &&
    // Windows 標準 convert.exe はディスク変換ツールで ImageMagick ではない。
    !(entry.id === 'convert' && platform === 'win32' && /[\\/](System32|SysWOW64)[\\/]convert(?:\.exe)?$/i.test(candidate)));
  // 候補（PATH × コマンド × 拡張子で数百件）を並列に確認し、優先順で先頭の実在ファイルを採用する。
  const found = await Promise.all(usable.map(async candidate => {
    try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return (await stat(candidate)).isFile(); } catch { return false; }
  }));
  const index = found.indexOf(true);
  return index < 0 ? null : path.resolve(usable[index]);
}

function childEnvironment(directory) {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL']) {
    const source = Object.keys(process.env).find(name => name.toUpperCase() === key.toUpperCase());
    if (source) env[key] = process.env[source];
  }
  return { ...env, HOME:directory, USERPROFILE:directory, XDG_CONFIG_HOME:directory, XDG_CACHE_HOME:directory,
    TEMP:directory, TMP:directory, TMPDIR:directory, NO_COLOR:'1', CI:'1', DO_NOT_TRACK:'1' };
}

function safeCode(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value) ? value : null; }
function logProbeFailure(id, reason, details = {}) {
  // 外部プログラムの出力・ファイルパス・環境値は秘密を含み得るので記録しない。
  const item = typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id) ? id : 'unknown';
  const record={id:item, reason, ...(reason === 'below_minimum_version' ? {severity:'warning'} : {}), ...details};
  if(process.env.AIDIY_DIAG_LAUNCHER_CHILD==='1')recordProbeFailure(record);
  process.stderr.write(`[aidiy-diag:probe] ${JSON.stringify(record)}\n`);
}

export function runVersion(executable, args, directory, options = {}) {
  if (shuttingDown) return Promise.resolve({状態:'ERR', 説明:'診断を終了しました。'});
  return new Promise(resolve => {
    let child, ended = false, bytes = 0, chunks = [], timer;
    const killGroup = () => {
      if (!child?.pid) return;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    };
    const finish = (result, reason, details = {}) => {
      if (ended) return;
      ended = true; clearTimeout(timer); activeProbes.delete(cancel); killGroup();
      if (reason) logProbeFailure(options.probeId, reason, {
        args:args.filter(arg => ['--version', '-version', '-3'].includes(arg)), ...details
      });
      child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
      resolve(result);
    };
    const cancel = () => finish({状態:'ERR', 説明:'診断を終了しました。'});
    activeProbes.add(cancel);
    try {
      child = spawn(executable, args, { shell:false, cwd:directory, env:childEnvironment(directory),
        stdio:['ignore','pipe','pipe'], detached:process.platform !== 'win32', windowsHide:true });
    } catch (error) { const errorCode = safeCode(error.code); return finish({状態:'ERR', 説明:`ファイルはありますが、起動できませんでした${errorCode ? ` (${errorCode})` : ''}。`}, 'spawn_error', {errorCode}); }
    timer = setTimeout(() => finish({状態:'ERR', 説明:'バージョン確認がタイムアウトしました。'}, 'timeout'), options.timeout ?? TIMEOUT);
    const read = chunk => {
      if (ended) return;
      bytes += chunk.length;
      if (bytes > (options.outputLimit ?? OUTPUT_LIMIT)) return finish({状態:'ERR', 説明:'バージョン出力の上限を超えました。'}, 'output_limit');
      chunks.push(chunk);
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.on('error', error => { const errorCode = safeCode(error.code); finish({状態:'ERR', 説明:`ファイルはありますが、起動できませんでした${errorCode ? ` (${errorCode})` : ''}。`}, 'spawn_error', {errorCode}); });
    // 親が先に終了しても同じ POSIX group の子を停止。pipe close を無期限に待たない。
    child.on('exit', killGroup);
    child.on('close', (code, signal) => {
      if (ended) return;
      if (code !== 0) return finish({状態:code === null ? 'ERR' : 'NG', 説明:`ファイルはありますが正常終了しませんでした (終了コード ${code}${safeCode(signal) ? ` / ${safeCode(signal)}` : ''})。`}, 'nonzero_exit', {exitCode:code, signal:safeCode(signal)});
      const match = Buffer.concat(chunks).toString('utf8').match(versionPattern);
      finish({状態:'OK', バージョン:match?.[1] || null,
        説明:match ? 'バージョンコマンドが正常終了しました。' : '正常終了しましたが、バージョン番号を抽出できませんでした。'});
    });
  });
}

// Windows npm/npx の .cmd / POSIX シムを実行せず、同じ配置の固定 JS CLI を使う。
// シムの内容は解釈しない。任意コマンドや shell:true へのフォールバックは禁止。
export async function versionInvocation(entry, executable, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32' && (entry.id === 'npm' || entry.id === 'npx')) {
    const cli = path.join(path.dirname(executable), 'node_modules', 'npm', 'bin', `${entry.id}-cli.js`);
    try { if ((await stat(cli)).isFile()) return {executable:process.execPath, args:[cli, '--version']}; } catch {}
    return null;
  }
  if (platform === 'win32' && entry.id === 'python' && /(?:^|[\\/])py\.exe$/i.test(executable)) {
    return {executable, args:['-3', '--version']};
  }
  return {executable, args:entry.version_args};
}

export async function probe(entry, options = {}) {
  const result = {id:entry.id, 状態:'未検出', パス:null, バージョン:null, 説明:'PATH / 標準配置先に見つかりません。', 確認日時:new Date().toISOString()};
  if (entry.platforms?.length && !entry.platforms.includes(options.platform || process.platform)) return {...result,状態:'未確認',説明:'対象外: この OS では使用しないため確認していません。'};
  let executable;
  try { executable = await (options.resolve || resolveProgram)(entry, options); }
  catch (error) { logProbeFailure(entry.id, 'resolve_error', {errorCode:safeCode(error.code)}); return {...result,状態:'ERR',説明:'実行ファイルの探索に失敗しました。'}; }
  if (!executable) return result;
  result.パス = executable;
  if (entry.allow_version === false || !entry.version_args) return {...result,状態:'OK',説明:'起動・副作用を避けるため、ファイルの存在のみ確認しました。'};
  if (entry.id === 'python' && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(executable)) return {...result,状態:'未確認',説明:'Windows の実行エイリアスのみ検出しました。Python 本体のバージョンは確認できません。'};
  const invocation = await versionInvocation(entry, executable, options);
  if (!invocation) { logProbeFailure(entry.id, 'npm_cli_missing'); return {...result,状態:'ERR',説明:'npm の JS CLI 本体が同じ配置先に見つからず、バージョンを確認できません。再インストール前に Node.js / npm の配置を確認してください。'}; }
  if (/\.(cmd|bat|ps1)$/i.test(invocation.executable)) return {...result,状態:'OK',説明:'起動・副作用を避けるため、ファイルの存在のみ確認しました。'};
  let directory;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aidiy-diag-'));
    const checked = {...result, ...await runVersion(invocation.executable, invocation.args, directory, {...options, probeId:entry.id})};
    if (checked.状態 === 'OK' && checked.バージョン && entry.minimumVersion) {
      const found = checked.バージョン.split(/[.-]/).slice(0,3).map(Number);
      const required = entry.minimumVersion.split('.').map(Number);
      for (let index=0; index<Math.max(found.length,required.length); index++) {
        const actual=found[index] || 0, minimum=required[index] || 0;
        if (actual < minimum) { logProbeFailure(entry.id, 'below_minimum_version'); return applySecurityVersionWarning({...checked,状態:'注意',説明:`検出したバージョンは要件 ${entry.minimumVersion} 以降を満たしません。別の仮想環境や機能全体の利用可否は未判定です。`}); }
        if (actual > minimum) break;
      }
    }
    return applySecurityVersionWarning(checked);
  } catch (error) { logProbeFailure(entry.id, 'probe_setup_error', {errorCode:safeCode(error.code)}); return {...result,状態:'ERR',説明:'確認用の一時領域を準備できませんでした。'}; }
  finally { if (directory) await rm(directory, {recursive:true,force:true,maxRetries:0}).catch(() => {}); }
}

export async function scan(entries, probeFn = probe, concurrency = 4) {
  const results = new Array(entries.length); let cursor = 0;
  await Promise.all(Array.from({length:Math.min(concurrency, entries.length)}, async () => {
    while (cursor < entries.length) { const index = cursor++; results[index] = await probeFn(entries[index]); }
  }));
  return results;
}
