// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const uiRequire = createRequire(path.join(__dirname, '../ui/package.json'));
const { parse, compileScript } = uiRequire('@vue/compiler-sfc');
const { transformSync } = uiRequire('esbuild');
const { createSSRApp, h } = uiRequire('vue');
const { renderToString } = uiRequire('@vue/server-renderer');
const source = name => fs.readFileSync(path.join(__dirname, '../diag/ui', name), 'utf8');
const cache = new Map();
function dependency(name) {
 const module = { exports: {} };
 const transformed = transformSync(source(name), { format: 'cjs', loader: 'js' }).code;
 vm.runInNewContext(transformed, { module, exports: module.exports, setTimeout, clearTimeout, AbortController, require: id => (/\.[cm]?js$/.test(id)&&id.startsWith('.')) ? dependency(path.posix.normalize(path.posix.join(path.posix.dirname(name), id))) : uiRequire(id) });
 return module.exports;
}
function component(name) {
  if (cache.has(name)) return cache.get(name);
  const { descriptor, errors } = parse(source(name), { filename: name });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: name, inlineTemplate: true });
  const { code } = transformSync(compiled.content, { format: 'cjs', loader: 'js' });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, window:{addEventListener(){},removeEventListener(){}}, ResizeObserver:class {observe(){}disconnect(){}}, require: id => {
    if (id.endsWith('.css')) return {};
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), id));
    if (id.endsWith('.vue')) return component(relative);
    if (id.endsWith('.json')) return JSON.parse(source(relative));
    if ((/\.[cm]?js$/.test(id)&&id.startsWith('.'))) {
      return dependency(relative);
    }
    return uiRequire(id);
  } });
  cache.set(name, module.exports);
  return module.exports;
}
const render = (name, props) => renderToString(createSSRApp({ render: () => h(component(name).default, props) }));


module.exports = { render, source, component, dependency };
