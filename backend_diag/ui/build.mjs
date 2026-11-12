// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';
import { readFile, writeFile, copyFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { manifest } from './verify.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
// 生成物にも独自実装の著作表示を残す（esbuild は // コメントを結合時に落とすため banner で付ける）。
const copyright=`/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027 */`;
// 配布用TSを既存esbuildで生成。利用者のNodeにTS実行機能は要求しない。
await build({entryPoints:['transport_limit','environment_proxy','model_catalog','model_probe','model_runner'].map(name=>path.join(root,'../runtime',name+'.ts')),outdir:path.join(root,'../runtime'),outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',target:'node18',banner:{js:copyright}});
await build({entryPoints:[path.join(root,'src/main.js')],outfile:path.join(root,'../static/app.js'),bundle:true,minify:true,alias:{vue:path.join(root,'node_modules/vue/dist/vue.runtime.esm-bundler.js')},format:'esm',target:'es2020',legalComments:'eof',banner:{js:copyright,css:copyright},define:{'process.env.NODE_ENV':'"production"',__VUE_OPTIONS_API__:'false',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'vue-sfc',setup(build){build.onLoad({filter:/\.vue$/},async({path:filename})=>{const source=await readFile(filename,'utf8');const {descriptor,errors}=parse(source,{filename});if(errors.length) throw errors[0];const compiled=compileScript(descriptor,{id:path.basename(filename),inlineTemplate:true});return {contents:compiled.content,loader:'js',resolveDir:path.dirname(filename)};});}}]});
await copyFile(path.join(root,'../static/app.css'),path.join(root,'../static/style.css'));
await unlink(path.join(root,'../static/app.css')); 
await copyFile(path.join(root,'src/index.html'),path.join(root,'../static/index.html'));
await copyFile(path.join(root,'src/components/アプリ起動/アプリアイコン/chrome.svg'),path.join(root,'../static/Chrome.svg'));
await copyFile(path.join(root,'src/components/アプリ起動/アイコン/AiDiy.png'),path.join(root,'../static/AiDiy.png'));
// Diag 内の配布コピーだけでビルドする。他 module の画像・CSSを読まない。
await copyFile(path.join(root,'../icons/AiDiy_diag.png'),path.join(root,'src/components/アプリ起動/アイコン/AiDiy_diag.png'));
for(const id of ['avatar','ide','cpu','navi','console','code','live','task','team','browser','discord','slack','diag'])await copyFile(path.join(root,'src/components/アプリ起動/アイコン',`AiDiy_${id}.png`),path.join(root,'../static',`AiDiy_${id}.png`));
for(const id of ['claude','codex','copilot','agy','grok','opencode','aidiy_hermes','vscode'])await copyFile(path.join(root,'src/components/アプリ起動/CLIアイコン',`${id}.png`),path.join(root,'../static',`CLI_${id}.png`));
for(const id of ['claude','codex','copilot','agy','grok','opencode','vscode'])await copyFile(path.join(root,'src/components/アプリ起動/CLIアイコン',`${id}.svg`),path.join(root,'../static',`CLI_${id}.svg`));
await copyFile(path.join(root,'src/components/アプリ起動/CLIアイコン/LICENSE_ICONS.md'),path.join(root,'../static/LICENSE_ICONS.md'));
for(const name of ['LICENSE-Octicons.txt','LICENSE-LobeHub.txt','LICENSE-OpenCode.txt'])await copyFile(path.join(root,'src/components/アプリ起動/CLIアイコン',name),path.join(root,'../static',name));
await writeFile(path.join(root,'../static/build-manifest.json'),JSON.stringify(await manifest(),null,2)+'\n');
console.log('Vue UI を static/ に生成しました。');
