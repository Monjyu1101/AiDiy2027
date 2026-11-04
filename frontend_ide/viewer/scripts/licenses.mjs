// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// ブラウザへ配信する依存の原文ライセンスを保存する。依存更新後は npm run licenses。
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { catppuccinNotice } from '../../scripts/icon-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const check = process.argv.includes('--check');
const ownNotice = `COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027`;
// リポジトリ全体ではルートを正本とし、単独配布では同梱 LICENSE を使用する。
const ownLicense = await readFile(join(root, '..', 'LICENSE'), 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return readFile(join(root, 'LICENSE'), 'utf8');
});
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const intro = `AiDiy IDE — 著作権・第三者ライセンス

ブラウザ用ライブラリ・アイコン素材とその依存に含まれる著作権表示・ライセンス原文を掲載します。
各ライブラリ・素材の権利は、それぞれの著作者・権利者に帰属します。
AiDiy独自の非商用条件は、同梱した第三者素材のMIT等の許諾を制限しません。
JSZip は MIT、DOMPurify は Apache-2.0 を選択して使用します。配布元の選択肢を含む原文も保存しています。
Node.js 専用の任意依存 @napi-rs/canvas はブラウザへ配信しないため、この一覧の対象外です。
配布時はこのファイルとライブラリ内の著作権表示・LICENSE・NOTICE を保持してください。

参考にした拡張: Office Viewer — cweijan
https://github.com/cweijan/vscode-office
同拡張で紹介された表示ライブラリを採用しています。拡張本体のコードは組み込んでいません。
`;

async function legalFiles(dir, prefix = '') {
  const result = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = prefix + entry.name;
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      result.push(...await legalFiles(join(dir, entry.name), name + '/'));
    } else if (entry.isFile() && /^(licen[cs]e|notice|thirdpartynotices|copying|copyright)([._-]|$)/i.test(entry.name)) {
      result.push({ name, text: await readFile(join(dir, entry.name), 'utf8') });
    }
  }
  return result;
}

const packages = [];
for (const path of Object.keys(lock.packages).sort()) {
  if (!path || lock.packages[path].dev || path.startsWith('node_modules/@napi-rs/')) continue;
  const dir = join(root, path);
  const metadata = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (metadata.version !== lock.packages[path].version) throw new Error(`${path}: lock と導入済みバージョンが一致しません`);
  const files = await legalFiles(dir);
  // isarray 1.0.0 は README に MIT の全文を収録している。
  if (metadata.name === 'isarray' && files.length === 0) {
    files.push({ name: 'README.md', text: await readFile(join(dir, 'README.md'), 'utf8') });
  }
  if (!files.length) throw new Error(`${path}: ライセンス原文がありません。配布元を確認してください`);
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
  const source = String(repository || metadata.homepage || '').replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  packages.push({ name: metadata.name, version: metadata.version, license: metadata.license || lock.packages[path].license, source, files });
}

packages.push(await catppuccinNotice());

const text = intro + packages.map(p => `\n${'='.repeat(78)}\n${p.name} ${p.version} — ${p.license}\n${p.source}\n` + p.files.map(f => `\n--- ${p.name}/${f.name} ---\n${f.text}\n`).join('')).join('');
const html = `<!doctype html>
<!--
${ownNotice}
-->
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>著作権・ライセンス | AiDiy IDE</title><link rel="stylesheet" href="/licenses.css"></head>
<body><main>
<p class="brand">✦ AiDiy IDE</p><h1>著作権・ライセンス</h1>
<h2>AiDiy IDE の独自実装</h2>
<pre>${escape(ownNotice)}</pre>
<details><summary><strong>AiDiy 公開利用ライセンス v1.1</strong> <span>全文を読む</span></summary><pre lang="ja">${escape(ownLicense)}</pre></details>
<p><a href="/LICENSE.txt" download="LICENSE">AiDiy のライセンス全文を保存</a></p>
<h2>第三者ライブラリ・素材</h2>
<p>Electron 版は Electron（MIT）と Chromium を使用します。<a href="/electron-license.txt" target="_blank" rel="noopener">Electron のライセンス原文</a>・<a href="/chromium-licenses.html" target="_blank" rel="noopener">Chromium 等の第三者ライセンス原文</a>は Electron 導入済み環境で参照できます。配布時は electron/LICENSE、dist/LICENSE、dist/LICENSES.chromium.html と依存パッケージの原文を保持してください。</p>
<p>AiDiy独自の非商用条件は、同梱した第三者素材のMIT等の許諾を制限しません。</p>
<p>利用ライブラリ・素材の著作権は、それぞれの著作者・権利者に帰属します。項目を開くと、同梱されたライセンスと第三者表記の原文を確認できます。</p>
<p>JSZip は MIT、DOMPurify は Apache-2.0 を選択して使用します。PDF用フォント・変換部品やMonacoの第三者表記も収録しています。</p>
<p>参考にした拡張：<a href="https://github.com/cweijan/vscode-office" target="_blank" rel="noopener noreferrer">Office Viewer（cweijan）</a>。同拡張で紹介された表示ライブラリを採用しています。拡張本体のコードは組み込んでいません。</p>
<p><a href="/THIRD_PARTY_NOTICES.txt" download>原文一覧を保存（テキスト）</a> · ブラウザ用ライブラリ・素材 ${packages.length} 件</p>
${packages.map(p => `<details><summary><strong>${escape(p.name)}</strong> <span>${escape(p.version)} · ${escape(p.license)}</span></summary>
${/^https:\/\//.test(p.source) ? `<p><a href="${escape(p.source)}" target="_blank" rel="noopener noreferrer">配布元・ソースコード</a></p>` : ''}
${p.files.map(f => `<h2>${escape(f.name)}</h2><pre lang="en">${escape(f.text)}</pre>`).join('\n')}</details>`).join('\n')}
<footer>配布時は原文一覧とライブラリ内の LICENSE・NOTICE・著作権表示を保持してください。Node.js 専用の任意依存 @napi-rs/canvas はブラウザへ配信せず、この一覧には含めていません。</footer>
</main></body></html>
`;
for (const [name, content] of [['web/THIRD_PARTY_NOTICES.txt', text], ['web/licenses.html', html], ['LICENSE', ownLicense], ['web/LICENSE.txt', ownLicense]]) {
  const target = join(root, name);
  if (check) {
    // npm配布物とGit checkoutのCRLF/LFの違いだけでは、表記の更新漏れと判定しない。
    if ((await readFile(target, 'utf8')).replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n')) throw new Error(`${name} が古くなっています。npm run licenses を実行してください`);
  } else await writeFile(target, content.replaceAll('\r\n', '\n'), 'utf8');
}
console.log(`著作権・ライセンス: ${packages.length} パッケージ、${packages.reduce((n, p) => n + p.files.length, 0)} 原文ファイルを${check ? '確認' : '保存'}しました。`);
