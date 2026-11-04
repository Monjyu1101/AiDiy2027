// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実CSSとVueのrenderを検査。実GUI・API・音声は起動しない。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const vue = require('vue'), { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const ts = require('typescript'), postcss = require('postcss');
const source = name => readFileSync(join(__dirname, '../src', name), 'utf8');
const gradient = 'linear-gradient(135deg, rgba(108, 78, 196, 0.94), rgba(143, 104, 221, 0.9))';
function styles(name) {
  const s = source(name).replace(/\r/g, '');
  return postcss.parse(name.endsWith('.vue') ? parse(s).descriptor.styles.map(style => style.content).join('\n') : s);
}
function rule(name, selector) {
  const matches = [];
  styles(name).walkRules(node => { if (node.selector === selector) matches.push(node); });
  assert.ok(matches.length, `${name}: ${selector}`);
  return Object.fromEntries(matches.flatMap(node => node.nodes.filter(child => child.type === 'decl').map(child => [child.prop, child.value])));
}
test('Avatar固有の紫グラデーションと淡色を維持し、他アプリのグレーへ統一しない', () => {
  const root = rule('style.css', ':root');
  assert.equal(root['--avatar-title-background'], gradient);
  assert.equal(root['--avatar-title-edge'], 'rgba(108, 78, 196, 0.94)');
  assert.equal(root['--avatar-light-title-background'], 'rgba(200, 200, 200, 0.92)');
  assert.match(source('main.ts'), /import '.\/style.css'/);
});
test('shellは外寸と1pxを維持し、紫はタイトルの基準色、淡色は同じ背景色を枠に使う', () => {
  const shell = rule('components/_WindowShell.vue', '.window-shell');
  assert.equal(shell.width, '100vw');assert.equal(shell.height, '100vh');
  assert.equal(shell.border, '1px solid transparent');
  const frame = rule('components/_WindowShell.vue', '.window-shell::after');
  assert.equal(frame.border, '1px solid var(--avatar-light-title-background)');
  assert.equal(frame['pointer-events'], 'none');
  assert.equal(frame.inset, '0');
  assert.equal(rule('components/_WindowShell.vue', '.window-shell.theme-purple::after')['border-color'], 'var(--avatar-title-edge)');
  const purple = rule('components/_WindowShell.vue', '.theme-purple');
  assert.equal(purple['border-color'], 'transparent');
  assert.equal(purple['border-image'], 'none');
  assert.equal(purple.background, 'rgba(6, 8, 14, 0.18)');
  assert.equal(rule('components/_WindowShell.vue', '.theme-purple .window-titlebar').background, 'var(--avatar-title-background)');
  assert.equal(rule('components/_WindowShell.vue', '.theme-light .window-titlebar').background, 'var(--avatar-light-title-background)');
  assert.equal(rule('style.css', '*')['box-sizing'], 'border-box');
});
test('キャラクター単体表示では画像枠も消し、透明背景と非操作状態を維持する', () => {
  const hidden = rule('components/_WindowShell.vue', '.window-shell.chrome-hidden');
  assert.equal(hidden['border-color'], 'transparent');assert.equal(hidden['border-image'], 'none');
  assert.equal(hidden.background, 'transparent');assert.equal(hidden['box-shadow'], 'none');
  assert.equal(rule('components/_WindowShell.vue', '.window-shell.chrome-hidden::after').display, 'none');
  assert.equal(rule('components/_WindowShell.vue', '.window-shell.chrome-hidden .resize-handle')['pointer-events'], 'none');
  assert.equal(rule('style.css', 'body').background, 'transparent');
  assert.equal(rule('style.css', '.app-root').background, 'transparent');
  assert.match(source('components/AIコア.vue'), /:chrome-visible="UI表示中"/);
});
test('Web左右ペインは1px枠を所有し、内部shellの画像枠を二重表示しない', () => {
  const outer = rule('AiDiy.vue', '.web-left-pane,\n.web-right-pane');
  assert.equal(outer['box-sizing'], 'border-box');assert.equal(outer.border, '1px solid var(--avatar-title-edge)');
  assert.equal(outer['border-image'], 'none');
  assert.equal(rule('AiDiy.vue', '.web-tab-title').background, 'var(--avatar-title-background)');
  const inner = rule('AiDiy.vue', '.web-right-content :deep(.window-shell)');
  assert.equal(inner['border-color'], 'transparent');assert.equal(inner['border-image'], 'none');
  assert.equal(rule('AiDiy.vue', '.web-right-content :deep(.window-shell::after)').display, 'none');
});
test('loginは既存の1px枠だけをタイトル背景に合わせ、透明な本文・余白を維持', () => {
  const card = rule('components/ログイン.vue', '.login-card');
  assert.equal(card.border, '1px solid transparent');
  const frame = rule('components/ログイン.vue', '.login-card::after');
  assert.equal(frame.border, '1px solid var(--avatar-title-edge)');
  assert.equal(frame['pointer-events'], 'none');
  assert.equal(card['border-image'], 'none');
  assert.equal(rule('components/ログイン.vue', '.title-bar').background, 'var(--avatar-title-background)');
  assert.equal(rule('components/ログイン.vue', '.login-shell').background, 'transparent');
  assert.equal(card.background, 'rgba(2, 2, 4, 0.46)');
  assert.doesNotMatch(card['box-shadow'], /0 0 0 1px rgba\(130, 105, 220/);
});
test('設定ダイアログは独自の淡いタイトル色を保持し、別窓では紫shellが外枠を所有', () => {
  const panel = rule('dialog/AI設定再起動.vue', '.config-panel');
  assert.equal(panel['--config-title-background'], '#f8fafc');
  assert.equal(panel.border, '1px solid var(--config-title-background)');
  assert.equal(rule('dialog/AI設定再起動.vue', '.config-panel-header').background, 'var(--config-title-background)');
  const nested = rule('AiDiy.vue', '.settings-window-root :deep(.config-panel)');
  for (const side of ['left', 'right', 'bottom']) assert.equal(nested[`border-${side}`], 'none');
  assert.equal(rule('AiDiy.vue', '.settings-window-root :deep(.config-panel-header)').display, 'none');
});
test('本体・Chat/File/Image/Code・設定の既存purple指定を変えない', () => {
  const app = parse(source('AiDiy.vue')).descriptor.template.content;
  const openings = [...app.matchAll(/<component\s+:is="WindowShell"[\s\S]*?>/g)].map(match => match[0]);
  assert.equal(openings.length, 5);
  for (const opening of openings) assert.match(opening, /theme="purple"/);
  assert.match(source('components/AIコア.vue'), /:is="WindowShell"[\s\S]*?theme="purple"/);
});
test('実Vueでテーマ切替・chrome表示非表示の反復後も枠クラスと8方向リサイズ操作を維持', () => {
  const filename = 'components/_WindowShell.vue', { descriptor } = parse(source(filename));
  const script = compileScript(descriptor, { id: 'panel-border', genDefaultAs: 'component' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'panel-border', compilerOptions: { bindingMetadata: script.bindings } });
  assert.deepEqual(template.errors, []);
  const compiled = ts.transpileModule(`${script.content}\n${template.code}\ncomponent.render=render;module.exports=component;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, window: { desktopApi: {} }, require: id => id === 'vue' ? { ...vue, onBeforeUnmount() {}, renderSlot: () => vue.createVNode(vue.Fragment, null, []) } : { default: {} } });
  const props = vue.reactive({ title: 'fixture', theme: 'purple', closable: true, resizable: true, closeMode: 'window', chromeVisible: true });
  const component = module.exports, data = component.setup(props, { expose() {}, emit() {} });
  const render = () => component.render({ $slots: {} }, [], props, vue.proxyRefs(data), {}, {});
  const walk = (node, collect = []) => { if (node && typeof node === 'object') { collect.push(node);for (const child of Array.isArray(node.children) ? node.children : []) walk(child, collect); }return collect; };
  for (const theme of ['purple', 'light', 'purple']) for (const visible of [true, false, true, false, true]) {
    props.theme = theme;props.chromeVisible = visible;
    const node = render();assert.ok(node.props.class.includes(`theme-${theme}`));
    assert.equal(node.props.class.includes('chrome-hidden'), !visible);
    const handles = walk(node).filter(child => String(child.props?.class).includes('resize-handle'));
    assert.equal(handles.length, 8);assert.ok(handles.every(handle => typeof handle.props.onPointerdown === 'function'));
  }
});
