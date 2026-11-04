// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

const MONACO_LANG = {
  py: 'python', vue: 'html', html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', bat: 'bat', cmd: 'bat', ps1: 'powershell',
  sql: 'sql', xml: 'xml', svg: 'xml', ini: 'ini', env: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', dockerfile: 'dockerfile',
};
export function monacoLanguage(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? MONACO_LANG[lower.slice(dot + 1)] ?? 'plaintext' : 'plaintext';
}
let monacoReady = null, failedModules = false;
export function loadMonaco() {
  monacoReady ??= new Promise((resolve, reject) => {
    // 同じ画面の並行読込は共有する。失敗したAMDモジュールと古い配信キャッシュは再利用しない。
    const attempt = Date.now().toString(36);
    function loadEditor() {
      try {
        if (failedModules) window.require.reset();
        failedModules = false;
        window.require.config({ paths: { vs: '/monaco/vs' }, urlArgs: `v=${attempt}` });
        window.require(['vs/editor/editor.main'], () => {
          try {
            const monaco = window.monaco;
            if (!monaco?.editor?.createDiffEditor) throw Error('Monacoのエディターが見つかりません。');
            monaco.editor.defineTheme('aidiy-space', {
              base: 'vs-dark', inherit: true, rules: [],
              colors: { 'editor.background': '#05070f', 'editorGutter.background': '#070a16', 'minimap.background': '#05070f', 'editorLineNumber.foreground': '#48536f' },
            });
            resolve(monaco);
          } catch (error) { reject(error); }
        }, error => {
          failedModules = true;
          const modules = error?.neededBy || error?.requireModules || error?.moduleId;
          reject(Error('Monacoの表示ライブラリを読み込めませんでした。' + (modules ? `（${Array.isArray(modules) ? modules.join(', ') : modules}）` : '') + '「再試行」で読み直せます。繰り返す場合はfrontend_ide/viewerのセットアップを確認してください。'));
        });
      } catch (error) { reject(error); }
    }
    if (typeof window.require?.config === 'function') { loadEditor(); return; }
    const script = document.createElement('script');
    script.src = `/monaco/vs/loader.js?v=${attempt}`;
    script.onload = loadEditor;
    script.onerror = () => { script.remove(); reject(Error('Monacoのローダーを読み込めませんでした。「再試行」で読み直せます。繰り返す場合はfrontend_ide/viewerのセットアップを確認してください。')); };
    document.head.append(script);
  }).catch(error => { monacoReady = null; throw error; });
  return monacoReady;
}
