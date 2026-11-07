// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * Web・Avatar・独立Task/Team総合テスト用の aidiy_chrome_devtools（Tools 8095 の HTTP API）呼び出し補助。
 * Diagの一括起動でToolsが待受中であることが前提。認証情報は画像・ログへ出さない。
 *
 * CLI:   node backend_diag/checks/総合テスト補助/chrome操作.mjs <method> '<json>'
 *        node backend_diag/checks/総合テスト補助/chrome操作.mjs prepare        … 最大化＋1920x945
 * import: RUN_ID / BOOK / TAB を環境変数で指定し、call・js・shot・record を使う。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
export const RUN_ID = process.env.RUN_ID || '';
export const PROJECT = `${ROOT}/temp/総合テスト/${RUN_ID}/project`;
export const VIEWPORT = { width: 1920, height: 945 };
let TAB = process.env.TAB || '';
let BOOK = process.env.BOOK || 'frontend_web-AiDiy';
let SESSION = process.env.SESSION || 'default';
export const setTab = t => { TAB = t; };
export const setBook = b => { BOOK = b; };
export const setSession = s => { SESSION = s; };

export async function call(method, body = {}) {
  const noTab = ['list_tabs', 'list_sessions', 'open_session', 'close_session', 'new_tab', 'get_version'].includes(method);
  const payload = { session: SESSION, ...(noTab || !TAB ? {} : { tab_id: TAB }), ...body };
  const res = await fetch(`http://127.0.0.1:8095/aidiy_chrome_devtools/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if ((res.headers.get('content-type') || '').startsWith('image/')) return { saved: payload.save_path };
  const json = await res.json();
  if (json && json.error) throw new Error(`${method}: ${json.error}`);
  return json;
}

export async function js(expression, awaitPromise = false) {
  const r = await call('eval_js', { expression, await_promise: awaitPromise });
  return r.result !== undefined ? r.result : r;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// 対象タブの窓を最大化し、CSSビューポートを1920x945（倍率1）にそろえる。
// Windowsの表示倍率125%でも、画像は常に1920x945で残る。
export async function prepare(tabId = TAB) {
  const tab = await call('cdp_command', { tab_id: 'browser', cdp_method: 'Browser.getWindowForTarget', params: JSON.stringify({ targetId: tabId }) });
  await call('cdp_command', { tab_id: 'browser', cdp_method: 'Browser.setWindowBounds', params: JSON.stringify({ windowId: tab.windowId, bounds: { windowState: 'maximized' } }) });
  await call('set_viewport', { ...VIEWPORT, tab_id: tabId });
  return js('JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})');
}

const BOOK_DOCUMENTS = Object.freeze({
  'frontend_web-AiDiy': 'セルフテスト,frontend_web,AiDiy編',
  'aidiy_task-操作': 'セルフテスト,aidiy_task,操作編',
  'aidiy_team-操作': 'セルフテスト,aidiy_team,操作編',
  'frontend_web-配車管理': 'セルフテスト,frontend_web,配車管理編',
  'frontend_web-生産・在庫管理': 'セルフテスト,frontend_web,生産・在庫管理編',
  'aidiy_avatar-Electron実行': 'セルフテスト,aidiy_avatar,Electron実行編',
  'aidiy_avatar-Web実行': 'セルフテスト,aidiy_avatar,Web実行編',
});
const evDir = () => {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,100}$/u.test(RUN_ID)) throw new Error('RUN_ID は実施IDを指定してください（パスは不可）');
  const document = BOOK_DOCUMENTS[BOOK];
  if (!document) throw new Error(`対応する冊子がありません: ${BOOK}`);
  return `${ROOT}/docs/セルフテスト、操作ガイド/images/${document}`;
};

const workDir = () => {
  evDir(); // 実施IDと現行冊子を共通検証する。
  const dir = `${ROOT}/docs/セルフテスト、操作ガイド/evidence/.aidiy_cache/selftest/${BOOK_DOCUMENTS[BOOK]}`;
  mkdirSync(dir, { recursive: true });
  return dir;
};

// 正式画像と作業記録を分離し、キャッシュのevidence.json へ日時・寸法・ハッシュ・ケースIDを追記する。既存画像は上書きしない。
export async function shot(no, title, caseId, note = '') {
  if (!RUN_ID) throw new Error('RUN_ID を指定してください');
  mkdirSync(evDir(), { recursive: true });
  const shortBook = {
    'frontend_web-AiDiy': 'AiDiy',
    'aidiy_avatar-Electron実行': 'Avatar-Electron',
    'aidiy_avatar-Web実行': 'Avatar-Web',
    'frontend_web-配車管理': '配車管理',
    'frontend_web-生産・在庫管理': '生産在庫',
    'aidiy_task-操作': 'Task',
    'aidiy_team-操作': 'Team',
  }[BOOK];
  const file = `${shortBook}_${no}_${title}.png`;
  const path = `${evDir()}/${file}`;
  if (existsSync(path)) throw new Error(`既存画像を上書きしません: ${file}`);
  await call('screenshot', { save_path: path });
  const buf = readFileSync(path);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const ledgerPath = `${workDir()}/${RUN_ID}__evidence.json`;
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { run_id: RUN_ID, book: BOOK, method: 'aidiy_chrome_devtools（CDP 9222）による実画面操作', images: [] };
  ledger.images.push({ file, case_id: caseId, captured_at: new Date().toISOString(), width: w, height: h, sha256: createHash('sha256').update(buf).digest('hex'), note });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  return `${file} (${w}x${h})`;
}

// results.json へケース結果を追記する。再試験は別レコードにして retest_of で前の記録を指す。
export function record(rec) {
  if (!RUN_ID) throw new Error('RUN_ID を指定してください');
  const p = `${workDir()}/${RUN_ID}__results.json`;
  const all = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  all.push({ recorded_at: new Date().toISOString(), method: 'aidiy_chrome_devtools 実画面操作', ...rec });
  writeFileSync(p, JSON.stringify(all, null, 2));
}

export async function text(max = 3000) {
  return String(await js('document.body.innerText')).slice(0, max);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [method, json = '{}'] = process.argv.slice(2);
  if (!method) { console.log('使い方: chrome操作.mjs <method> \'<json>\' | prepare'); process.exit(1); }
  const out = method === 'prepare' ? await prepare(JSON.parse(json).tab_id || TAB) : await call(method, JSON.parse(json));
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1).slice(0, 20000));
}
