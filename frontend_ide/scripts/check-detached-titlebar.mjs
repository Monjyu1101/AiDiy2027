// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Detached-title renderer regression. Real mountPanelTitle, SFC scoped styles and production CSS.
// Native owner IPC is mocked; this checks DOM geometry, NOT operating-system window bounds.
// Generate: node scripts/check-detached-titlebar.mjs
// Run: ELECTRON --headless --no-sandbox --disable-gpu scripts/check-detached-titlebar-render.cjs
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=join(root,'temp/detached-titlebar-check');
const bundle=await build({
stdin:{resolveDir:root,contents:`
import {mountPanelTitle} from './src/components/ファイル閲覧/別窓タイトル.js';
const root=document.querySelector('#app'); root.style.width='1000px';
const foldListeners=new Set(); window.emitLayoutState=(collapsed)=>{for(const name of ['explorer','panel-viewer','panel-navigation']){document.getElementById(name).style.height=collapsed?'31px':'360px';for(const listener of foldListeners)listener({name,collapsed,hidden:collapsed,busy:false});}};
window.aidiyWindow={onPanelCollapseState:listener=>{foldListeners.add(listener);return()=>foldListeners.delete(listener);},panelAction:async()=>({pinned:false,locked:false}),collapsePanel:async(value,name)=>{document.getElementById(name).style.height=value?'31px':'360px';return {ok:true}},beginWindowMove:()=>({ok:true}),moveWindow(){},endWindowMove(){},close(){},minimize(){},maximize(){},togglePin(){}};
for(const kind of ['explorer','panel-viewer','panel-navigation']){
const host=document.createElement('section');host.id=kind;
host.className='development-app native-panel-window '+(kind==='explorer'?'explorer-window':kind==='panel-viewer'?'viewer-window':'navigation-window');
host.style.cssText='width:1000px;height:360px';
host.innerHTML='<div class="audit-content">保持される本文<input value="保持" /></div>';root.append(host);
mountPanelTitle(host,{document,name:kind,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),clearInterval:window.clearInterval.bind(window)},window,kind,kind);
}`},
  bundle: true, write: false, format: 'iife', plugins: [{ name: 'vue-label-check', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor, errors } = parse(readFileSync(args.path, 'utf8'), { filename: args.path });
      assert.deepEqual(errors, []);
      const id='data-v-'+createHash('sha256').update(args.path).digest('hex').slice(0,8);
      const script = compileScript(descriptor, { id, inlineTemplate: true });
      const styles=descriptor.styles.map(style=>compileStyle({source:style.content,filename:args.path,id,scoped:style.scoped}).code).join('\n');
      const component=script.content.replace('export default','const component =')+`\ncomponent.__scopeId=${JSON.stringify(id)};export default component;`;
      return { loader: descriptor.scriptSetup?.lang === 'ts' ? 'ts' : 'js', contents: component + `\n{const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);}`, resolveDir: dirname(args.path) };
    });
  } }],
});
mkdirSync(output,{recursive:true});
const css=readFileSync(join(root,'src/style.css'),'utf8')+'\n'+readFileSync(join(root,'src/components/共通表示/会話表示.css'),'utf8');
writeFileSync(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`);
console.log(join(output,'index.html'));
