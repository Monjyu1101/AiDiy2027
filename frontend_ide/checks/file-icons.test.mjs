// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { fileIcon, catppuccinAsset, ICON_NAMES, CATPPUCCIN_ROOT } from '../src/components/ファイル閲覧/ファイルアイコン.js';
import { startDevelopment } from '../server.mjs';
const require = createRequire(import.meta.url), vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc'), { transformSync } = require('esbuild');
const root = new URL('../', import.meta.url), source = new URL('public/' + CATPPUCCIN_ROOT, root);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));

test('アイコン: 特定名→複合拡張子→拡張子→汎用。大小文字・Windowsパス・未知名も安全', () => {
  for (const [name, expected] of [
    ['README.MD', 'readme'], ['sub/License.txt', 'license'], ['package-lock.json', 'lock'],
    ['NOTICE', 'license'], ['.dockerignore', 'config'], ['.vscodeignore', 'config'],
    ['requirements.txt', 'config'], ['Dockerfile', 'config'], ['.gitignore', 'config'],
    ['.env', 'env'], ['.env.local', 'env'], ['.env.custom.json', 'env'],
    ['src/types.d.ts', 'xml'], ['archive.tar.gz', 'zip'], ['AiDiy_key.json.template', 'json'],
    ['Windows\\src\\MAIN.PY', 'xml'], ['foo.vue', 'xml'], ['style.css', 'xml'],
    ['index.html', 'xml'], ['readme.custom', '_file'], ['photo.SVG', 'image'],
    ['data.sqlite3', 'database'], ['mesh.vrma', '3d'], ['slides.pptx', 'text'],
    ['report.pdf', 'text'], ['sheet.xlsx', 'csv'], ['foo.unknown', '_file'],
    ['extensionless', '_file'], ['', '_file'], [undefined, '_file'],
    ['__proto__', '_file'], ['constructor', '_file'], ['<svg onload=alert(1)>', '_file'],
    ['javascript:alert(1)', '_file'], ['../../secret.key', '_file'], ['foo.svg?evil=.exe', 'binary'],
  ]) assert.equal(fileIcon(name), expected, name);
  assert.equal(fileIcon('main.py', { directory: true }), '_folder');
  assert.equal(fileIcon('main.py', { directory: true, open: true }), '_folder_open');
  assert.equal(fileIcon('main.py', { open: true }), 'xml');
});

test('アイコン: AiDiyの現在の拡張子と一般的な将来形式を22種類へ集約する', () => {
  const current = 'py md html png json vue yaml ts mjs js cjs vrma txt css sh mp3 bat ps1 sty tex vrm ico cmd toml bib bst gif pdf svg lock tmpl jpg wav h fixture cts pptx example c ini service cnf onnx tflite yml conf sql mts';
  const common = 'jsx tsx pyw pyi java kt go rs rb php swift cpp hpp cs dart svelte jsonc csv tsv xml xlsx docx odt odp webp avif mp4 webm mov flac ogg zip 7z tar gz sqlite db woff2 ttf glb gltf exe dll wasm';
  for (const ext of (current + ' ' + common).split(' ')) assert.notEqual(fileIcon('sample.' + ext), '_file', ext);
  assert.equal(ICON_NAMES.length, 22);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
});

test('アイコン原文: 固定コミットのSHA-256・16px・無改変・危険なSVG要素なし', async () => {
  assert.equal(manifest.repository, 'https://github.com/catppuccin/vscode-icons');
  assert.equal(manifest.commit, 'b6915da9f6889b683a110aa747de96c2820a537d');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ICON_NAMES.map(name => `mocha/${name}.svg`).sort());
  assert.deepEqual((await readdir(new URL('mocha/', source))).sort(), ICON_NAMES.map(name => name + '.svg').sort());
  let bytes = 0;
  for (const file of manifest.files) {
    const content = await readFile(new URL(file.path, source)); bytes += content.length;
    assert.equal(sha256(content), file.sha256, file.path);
    assert.equal(file.upstream, 'icons/' + file.path);
    const svg = content.toString('utf8');
    assert.match(svg, /width="16" height="16" viewBox="0 0 16 16"/);
    assert.doesNotMatch(svg, /<!|<\?|\b(?:href|src|on[a-z]+)\s*=|url\s*\(/i);
    for (const tag of svg.matchAll(/<\/?([\w:-]+)/g)) assert.ok(['svg', 'g', 'path'].includes(tag[1]), tag[1]);
  }
  assert.ok(bytes < 12000, '少数のSVGだけを同梱する');
  const license = await readFile(new URL('LICENSE', source));
  assert.equal(sha256(license), 'dab37945e3097e43c74c08437196152a50f8d5d5e1d0335f469b203e183e21b8');
});

test('アイコン配布: 共通・Code・Liveへ原文と帰属を同梱し、既存ライセンス集にも記載する', async () => {
  const legal = ['LICENSE', 'SOURCE.md', 'MARKDOWN_LICENSE', 'manifest.json'];
  const license = await readFile(new URL('LICENSE', source), 'utf8');
  for (const target of ['dist/', 'host/dist/development/', 'host/aidiy_live/dist/development/']) {
    const base = new URL(target, root);
    for (const path of [...manifest.files.map(file => file.path), ...legal]) {
      assert.deepEqual(await readFile(new URL(CATPPUCCIN_ROOT + path, base)), await readFile(new URL(path, source)), target + path);
    }
    const notices = await readFile(new URL('THIRD_PARTY_NOTICES.txt', base), 'utf8');
    assert.ok(notices.includes(license)); assert.ok(notices.includes(manifest.repository)); assert.ok(notices.includes(manifest.commit));
    assert.match(notices, /MITの許諾を制限/);
  }
  for (const path of ['viewer/web/THIRD_PARTY_NOTICES.txt', 'viewer/web/licenses.html']) {
    const text = await readFile(new URL(path, root), 'utf8');
    assert.ok(text.includes(manifest.repository)); assert.ok(text.includes(manifest.commit));
    assert.match(text, /Copyright \(c\) 2023 Catppuccin/); assert.match(text, /Copyright \(c\) 2023 thang-nm/);
    assert.match(text, /Permission is hereby granted/); assert.match(text, /非商用条件/);
  }
});

test('アイコン配信: 許可されたSVGと原文だけ。Traversal・プロトタイプ名・外部形式は拒否', () => {
  for (const icon of ICON_NAMES) assert.deepEqual(catppuccinAsset(`${CATPPUCCIN_ROOT}mocha/${icon}.svg`), [`${CATPPUCCIN_ROOT}mocha/${icon}.svg`, 'image/svg+xml']);
  for (const path of ['__proto__', 'constructor', 'assets/catppuccin_icons/../LICENSE', 'assets/catppuccin_icons/mocha/unknown.svg', 'assets/catppuccin_icons/latte/_file.svg', 'assets/catppuccin_icons/mocha/%2e%2e/LICENSE', 'assets/catppuccin_icons/mocha/_file.svg/../../secret', 'https://evil.test/_file.svg']) assert.equal(catppuccinAsset(path), undefined, path);
});

for (const kind of ['ide', 'code', 'live']) test(`アイコンHTTP: ${kind}共通画面はオフラインでローカルSVGを配信する`, async () => {
  const app = await startDevelopment(fileURLToPath(root), { kind, offline: true });
  try {
    const path = 'development/' + CATPPUCCIN_ROOT + 'mocha/_file.svg';
    const response = await fetch(new URL(path, app.url));
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), await readFile(new URL('mocha/_file.svg', source), 'utf8'));
    assert.equal((await fetch(new URL(path, app.url), { method: 'POST' })).status, 405);
    assert.equal((await fetch(new URL(path, app.url), { headers: { origin: 'https://foreign.invalid' } })).status, 403);
    for (const bad of ['mocha/missing.svg', 'mocha/%00.svg', 'mocha/%2e%2e%2fLICENSE', '../secret.txt']) assert.equal((await fetch(new URL('development/' + CATPPUCCIN_ROOT + bad, app.url))).status, 404, bad);
    const notices = await fetch(new URL('development/THIRD_PARTY_NOTICES.txt', app.url)).then(r => r.text());
    assert.ok(notices.includes(manifest.repository));
  } finally { await app.close(); }
});

test('Live拡張の単独画面: token配下の相対URLでも同じSVGを配信する', async () => {
  const { ライブ起動 } = require('../host/dist/aidiy_live/server.cjs');
  const app = await ライブ起動(fileURLToPath(new URL('host/aidiy_live/', root)), 'http://127.0.0.1:1', true);
  try {
    const html = await fetch(app.url).then(r => r.text());
    const config = JSON.parse(html.match(/id="development-config"[^>]*>([^<]+)/)[1]);
    assert.equal(config.iconAssets, 'development/' + CATPPUCCIN_ROOT);
    const icon = await fetch(new URL(config.iconAssets + 'mocha/_folder_open.svg', app.url));
    assert.equal(icon.status, 200); assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
    assert.match(icon.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
    assert.equal(await icon.text(), await readFile(new URL('mocha/_folder_open.svg', source), 'utf8'));
    assert.equal((await fetch(new URL(config.iconAssets + 'mocha/missing.svg', app.url))).status, 404);
    assert.equal((await fetch(new URL(config.iconAssets + 'mocha/_file.svg', app.url), { headers: { origin: 'https://foreign.invalid' } })).status, 403);
  } finally { await app.close(); }
});

test('VS Code: webview URIを起動設定へ渡し、img-srcだけ安全な添付data画像を許可する', () => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(readFileSync(new URL('host/src/vscode-html.ts', root), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module });
  const html = module.exports.developmentHtml(path => 'https://resource.test/' + path, 'https://resource.test', 'nonce', { kind: 'code' });
  const config = JSON.parse(html.match(/id="development-config"[^>]*>([^<]+)/)[1]);
  assert.equal(config.iconAssets, 'https://resource.test/dist/development/' + CATPPUCCIN_ROOT);
  assert.match(html, /img-src https:\/\/resource.test data:;/);
  assert.doesNotMatch(html, /img-src[^;]*(?:https:;|\*)/);
  assert.doesNotMatch(html, /(?:script-src|connect-src|frame-src)[^;]*data:/);
  assert.match(html, /frame-src 'none';/);
});

test('実Vue部品: 名前の変更・フォルダ開閉だけで安全な16px imgを再利用する', async () => {
  const filename = fileURLToPath(new URL('src/components/ファイル閲覧/ファイル種別アイコン.vue', root));
  const { descriptor } = parse(readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'file-icon', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, id: 'file-icon', filename, compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { format: 'cjs' }).code, {
    module, require: id => id === 'vue' ? vue : { fileIcon },
  });
  const renderer = vue.createRenderer({
    createElement: tag => ({ tag, props: {}, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
    insert: (el, parent) => parent.children.push(el), remove() {}, parentNode: () => null, nextSibling: () => null,
    setText: (el, text) => { el.text = text; }, setElementText: (el, text) => { el.text = text; },
    patchProp: (el, key, _old, value) => { el.props[key] = value; },
  });
  const props = vue.reactive({ name: 'source.py', directory: false, open: false });
  const app = renderer.createApp({ setup: () => () => vue.h(module.exports, props) });
  app.provide('catppuccinIconBase', 'https://resource.test/dist/development/' + CATPPUCCIN_ROOT);
  const host = { children: [] }; app.mount(host);
  try {
    const img = host.children[0]; assert.equal(img.tag, 'img'); assert.equal(img.props.width, '16'); assert.equal(img.props.height, '16');
    assert.equal(img.props.alt, ''); assert.equal(img.props['aria-hidden'], 'true'); assert.equal(img.props.draggable, 'false');
    assert.match(img.props.src, /mocha\/xml.svg$/);
    props.name = 'file.unknown'; await vue.nextTick(); assert.match(img.props.src, /mocha\/_file.svg$/);
    props.directory = true; await vue.nextTick(); assert.match(img.props.src, /mocha\/_folder.svg$/);
    props.open = true; await vue.nextTick(); assert.match(img.props.src, /mocha\/_folder_open.svg$/);
    props.open = false; await vue.nextTick(); assert.match(img.props.src, /mocha\/_folder.svg$/);
    props.directory = false; props.name = '<svg onload=alert(1)>'; await vue.nextTick(); assert.match(img.props.src, /mocha\/_file.svg$/);
    assert.equal(host.children.length, 1); assert.equal(img.props.innerHTML, undefined);
  } finally { app.unmount(); }
});
