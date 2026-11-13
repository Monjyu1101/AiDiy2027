// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectOpenCodeNpm } from '../../scripts/opencode-npm.mjs';

// 診断メニューとConsoleが共有する固定許可リスト。モデル・プロンプト・任意コマンドは渡さない。
// 各オプションはCLIのツール承認用。ログイン・信頼確認や組織の禁止設定は解除しない。
export const CLI_LAUNCHERS = Object.freeze([
  ['claude', 'Claude Code', '--dangerously-skip-permissions', '承認省略'],
  ['codex', 'Codex CLI', '--dangerously-bypass-approvals-and-sandbox', '承認・sandbox省略'],
  ['copilot', 'GitHub Copilot CLI', '--yolo', 'YOLO'],
  ['agy', 'Antigravity CLI', '--dangerously-skip-permissions', '承認省略'],
  ['grok', 'Grok Build', '--yolo', 'YOLO'],
  ['opencode', 'OpenCode', '--auto', '自動承認（deny維持）'],
  ['aidiy_hermes', 'AiDiy Hermes', '--yolo', 'YOLO'],
  // Pi は許可確認の仕組みを持たない（常に確認なし）。承認省略フラグは付けない。
  ['aidiy_pi', 'AiDiy Pi', null, 'YOLO（Pi標準）'],
].map(([id, name, flag, mode]) => Object.freeze({ id, name, args: Object.freeze(flag ? [flag] : []), mode, autoApproveSupported: true })));
const byId = Object.freeze(Object.fromEntries(CLI_LAUNCHERS.map(item => [item.id, item])));
const npmPackages = Object.freeze({ claude: '@anthropic-ai/claude-code', codex: '@openai/codex', copilot: '@github/copilot', opencode: '@opencode/cli' });
const validPath = value => typeof value === 'string' && value.length > 0 && !/[\0\r\n]/.test(value);
const envValue = (env, key, platform) => env[key] || (platform === 'win32' ? Object.entries(env).find(([name]) => name.toUpperCase() === key.toUpperCase())?.[1] : undefined);

export function validateCliOptions(kind, { cli, cliAutoApprove, provider, model } = {}) {
  if (cli !== undefined && (typeof cli !== 'string' || !Object.hasOwn(byId, cli))) throw Error('--cli は claude / codex / copilot / agy / grok / opencode / aidiy_hermes / aidiy_pi から指定してください。');
  if (cliAutoApprove !== undefined && typeof cliAutoApprove !== 'boolean') throw Error('--cli-auto-approve は真偽値で指定してください。');
  if (cli !== undefined && kind !== 'console') throw Error('--cli は --app console 専用です。');
  if (cliAutoApprove && !cli) throw Error('--cli-auto-approve には --cli が必要です。');
  if (cli && (provider !== undefined || model !== undefined)) throw Error('--cli と --provider / --model は同時に指定できません。CLI側の既定モデルを使用します。');
}

async function usable(file, platform) {
  try { await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return (await stat(file)).isFile(); } catch { return false; }
}
// .cmdはシェルで解釈しない。許可済みnpmパッケージの宣言済みbinだけをNodeへargvで渡す。
// PATHやプロジェクトに空白、日本語、引用符、&、%、$等が含まれてもコマンド文字列を生成しない。
async function npmInvocation(id, shim) {
  let packageName = npmPackages[id];
  if (!packageName) throw Error(`${byId[id].name}: このコマンド形式には対応していません。`);
  try {
    if (id === 'opencode') {
      const prefix = path.dirname(shim), root = path.join(prefix, 'node_modules');
      // V2 未移行時も、実際の shim が所有する公式 V1 の宣言済み bin を起動する。
      const { owner } = await inspectOpenCodeNpm({ prefix, root }, { platform: 'win32', executable: shim });
      if (!owner) throw Error('shim owner');
      packageName = owner.name;
    }
    const root = path.join(path.dirname(shim), 'node_modules', packageName);
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const declaredBin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin && Object.hasOwn(metadata.bin, id) ? metadata.bin[id] : undefined;
    const bin = typeof declaredBin === 'string' ? declaredBin.replace(/^\.\//, '') : undefined;
    if (metadata.name !== packageName || !validPath(bin) || path.isAbsolute(bin) || /^[A-Za-z]:/.test(bin) || /[\\]/.test(bin)
      || bin.split('/').some(part => !part || part === '.' || part === '..')) throw Error('bin');
    const target = await realpath(path.join(root, bin)), packageRoot = await realpath(root);
    const relative = path.relative(packageRoot, target);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) || !(await stat(target)).isFile()) throw Error('bin');
    if (/\.exe$/i.test(target)) return { executable: target, args: [] };
    if (!/\.(?:c?js|mjs)$/i.test(target)) {
      const header = (await readFile(target, 'utf8')).slice(0, 256).split(/\r?\n/, 1)[0];
      if (!/^#![^\r\n]*\bnode(?:\s|$)/.test(header)) throw Error('node bin');
    }
    return { executable: await realpath(process.execPath), args: [target] };
  } catch { throw Error(`${byId[id].name}: npmの安全な起動先を確認できません。公式CLIの配置を確認してください。`); }
}

// command_hermes/_setup.py のWindowsランチャーだけを読み、cmd.exeは使わない。
// PY / CLI 宣言だけを拾うと別形式や追加命令を見落とすため、生成済み全体の形式を照合する。
async function hermesInvocation(shim, platform) {
  try {
    if ((await stat(shim)).size > 64 * 1024) throw Error('launcher size');
    const script = (await readFile(shim, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const python = script.match(/^set "PY=([^"\r\n]+)"$/m)?.[1];
    const cli = script.match(/^set "CLI=([^"\r\n]+)"$/m)?.[1];
    if (!validPath(python) || !validPath(cli) || !path.isAbsolute(python) || !path.isAbsolute(cli)) throw Error('absolute paths');
    const expected = [
      '@echo off', 'chcp 65001 >nul', 'setlocal', '',
      `set "PY=${python}"`, `set "CLI=${cli}"`, '',
      'if not exist "%PY%" (', '  echo Python virtual environment was not found:',
      '  echo   %PY%', '  pause', '  exit /b 1', ')', '', '"%PY%" "%CLI%" %*', '',
    ].join('\n');
    if (script !== expected) throw Error('launcher format');
    const normalized = value => path.resolve(value).toLowerCase();
    if (path.basename(cli).toLowerCase() !== 'cli_main.py'
      || normalized(python) !== normalized(path.join(path.dirname(cli), '.venv', 'Scripts', 'python.exe'))
      || !await usable(python, platform) || !(await stat(cli)).isFile()) throw Error('Python / CLI');
    const executable = await realpath(python), entry = await realpath(cli);
    if (!validPath(executable) || !validPath(entry)) throw Error('real paths');
    return { executable, args: [entry] };
  } catch { throw Error('AiDiy Hermes: 安全な起動先を確認できません。command_hermes のセットアップで作成したランチャーと仮想環境を確認してください。'); }
}

// command_pi/_setup.py の aidiy_pi と同じ起動（node + source-resolver + AiDiy 入口）。
// PATH上のランチャーは解析せず、この配置先の command_pi だけを起動先にする。
const AIDIY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
async function piInvocation(root = AIDIY_ROOT) {
  try {
    const pi = path.join(root, 'command_pi');
    const resolver = path.join(pi, 'packages', 'coding-agent', 'src', 'experimental', 'source-resolver.ts');
    const entry = path.join(pi, 'aidiy', 'aidiy_pi.ts');
    for (const file of [resolver, entry]) if (!(await stat(file)).isFile()) throw Error('file');
    if (!(await stat(path.join(pi, 'node_modules'))).isDirectory()) throw Error('node_modules');
    const executable = await realpath(process.execPath), realEntry = await realpath(entry), realResolver = await realpath(resolver);
    if (!validPath(executable) || !validPath(realEntry) || !validPath(realResolver)) throw Error('real paths');
    return { executable, args: ['--import', pathToFileURL(realResolver).href, realEntry] };
  } catch { throw Error('AiDiy Pi: 起動先を確認できません。command_pi のセットアップ（python command_pi/_setup.py）を確認してください。'); }
}

// ファイルの存在と形式だけを検査する。--versionを含め、CLIやシェルは一切実行しない。
export async function resolveCliLaunch(id, { autoApprove = false, env = process.env, platform = process.platform } = {}) {
  validateCliOptions('console', { cli: id, cliAutoApprove: autoApprove });
  if (!id) throw Error('CLIを指定してください。');
  const definition = byId[id], windows = platform === 'win32';
  if (id === 'aidiy_pi') {
    const invocation = await piInvocation();
    // Pi は承認の有無で動作が変わらないため、表示モードは常に定義どおり。
    return { ...definition, ...invocation, env: { ...env }, autoApprove, mode: definition.mode };
  }
  const get = key => envValue(env, key, platform);
  const directories = (get('PATH') || '').split(windows ? ';' : ':').map(value => /^"[^"\r\n]+"$/.test(value) ? value.slice(1, -1) : value)
    .filter(value => validPath(value) && path.isAbsolute(value));
  const home = get(windows ? 'USERPROFILE' : 'HOME');
  const extra = id === 'aidiy_hermes' ? [home && path.join(home, '.local', 'bin')]
    : windows ? [get('APPDATA') && path.join(get('APPDATA'), 'npm'), get('LOCALAPPDATA') && path.join(get('LOCALAPPDATA'), 'agy', 'bin'), home && path.join(home, '.local', 'bin'), home && path.join(home, '.grok', 'bin')]
    : [home && path.join(home, '.local', 'bin'), home && path.join(home, '.grok', 'bin'), home && path.join(home, '.opencode', 'bin')];
  directories.push(...extra.filter(value => validPath(value) && path.isAbsolute(value)));
  const extensions = windows ? ['.exe', '.com', '.cmd'] : [''];
  for (const directory of new Set(directories)) for (const extension of extensions) {
    const candidate = path.join(directory, id + extension);
    if (!await usable(candidate, platform)) continue;
    const executable = await realpath(candidate);
    if (!validPath(executable)) throw Error(`${definition.name}: 実行ファイルのパスが不正です。`);
    const invocation = windows && extension === '.cmd'
      ? await (id === 'aidiy_hermes' ? hermesInvocation(executable, platform) : npmInvocation(id, executable))
      : { executable, args: [] };
    return { ...definition, ...invocation, args: [...invocation.args, ...(autoApprove ? definition.args : [])], env: { ...env }, autoApprove, mode: autoApprove ? definition.mode : '通常承認' };
  }
  throw Error(`${definition.name} が見つかりません。PATHまたは公式CLIの標準配置先を確認してください。`);
}
