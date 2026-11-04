// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { catppuccinNotice } from './icon-notices.mjs';
// Vite 8.3.4 の端末進捗表示は日本語パスの切り詰めで Rolldown が停止する。
// ビルド中だけ CI の行単位ログを使い、警告・エラーと完了表示は維持する。
async function ビルド実行(options) {
 const 元のCI = process.env.CI;
 process.env.CI = 元のCI || '1';
 try { return await build(options); }
 finally {
  if (元のCI === undefined) delete process.env.CI;
  else process.env.CI = 元のCI;
 }
}
const root=fileURLToPath(new URL('../',import.meta.url));
// 正本は同じ frontend_ide module の各 aidiy_*。他 module の素材は参照しない。
for(const id of ['navi','console','code','live','ide','task','team','browser']){
 await cp(join(root,`aidiy_${id}/AiDiy_${id}.png`),join(root,'public',`AiDiy_${id}.png`));
 await rm(join(root,'dist',`AiDiy_${id}.svg`),{force:true});
}
// Viteがpublicの原文SVGを外部ファイルのままコピーする。旧選択分は残さない。
await rm(join(root,'dist/assets/catppuccin_icons'),{recursive:true,force:true});
await ビルド実行({root,plugins:[vue()],define:{'process.env.NODE_ENV':JSON.stringify('production'),__VUE_OPTIONS_API__:true,__VUE_PROD_DEVTOOLS__:false,__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:false},build:{emptyOutDir:false,lib:{entry:join(root,'src/main.js'),formats:['iife'],name:'AiDiyDevelopment',fileName:()=> 'app.js',cssFileName:'app'},rollupOptions:{output:{banner:'/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors. Licensed under "AiDiy 公開利用ライセンス v1.1". Commercial use requires prior written consent from all copyright holders. See LICENSE for full terms. Thank you for keeping the rules. https://github.com/monjyu1101/AiDiy2027 */'}}}});
// Task / Team は Avatar からコピーした専用画面。重い3D/フロー依存をCode/Liveへ混ぜない。
await ビルド実行({root,plugins:[vue()],resolve:{alias:{'@taskteam':join(root,'src/components/タスクチーム')}},define:{'process.env.NODE_ENV':JSON.stringify('production'),__VUE_OPTIONS_API__:true,__VUE_PROD_DEVTOOLS__:false,__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:false},build:{emptyOutDir:false,lib:{entry:join(root,'src/components/タスクチーム/起動.js'),formats:['iife'],name:'AiDiyTaskTeam',fileName:()=> 'taskteam.js',cssFileName:'taskteam'}}});
const template=await readFile(join(root,'index.html'),'utf8');
await writeFile(join(root,'dist/index.html'),template.replace('<script type="module" src="/src/main.js"></script>','<link rel="stylesheet" href="/development/app.css"><script src="/development/app.js" defer></script>'));
await writeFile(join(root,'dist/taskteam.html'),template.replace('<script type="module" src="/src/main.js"></script>','<link rel="stylesheet" href="/development/taskteam.css"><script src="/development/taskteam.js" defer></script>'));
const notices=[];
// Runtime dependencies of the new Task / Team bundle include Mermaid's parsers and renderers.
// Traverse dependency metadata rather than silently omitting transitive license notices.
const noticeNames=new Set(['@xterm/xterm','@xterm/addon-fit','node-pty','node-addon-api','ws','vue','@vue/shared','@vue/reactivity','@vue/runtime-core','@vue/runtime-dom','markdown-it','entities','linkify-it','mdurl','punycode.js','uc.micro']);
async function includeDependency(name){
 if(noticeNames.has(name))return;noticeNames.add(name);
 let metadata;try{metadata=JSON.parse(await readFile(join(root,'node_modules',name,'package.json'),'utf8'));}catch{return;}
 for(const dependency of Object.keys(metadata.dependencies||{}))await includeDependency(dependency);
}
for(const name of ['axios','mermaid','three'])await includeDependency(name);
for(const name of noticeNames){
 const folder=join(root,'node_modules',name);let metadata;try{metadata=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));}catch{continue;}
 const licenses=(await readdir(folder)).filter(name=>/^licen[sc]e|^notice/i.test(name));
 if(!licenses.length)notices.push(`${name} ${metadata.version} — ${metadata.license||'See package metadata'}`);
 for(const file of licenses){try{notices.push(`${name} ${metadata.version}\n${await readFile(join(folder,file),'utf8')}`);}catch{/* Some packages store license directories. */}}
}
const icons=await catppuccinNotice();
notices.push(`${icons.name} ${icons.version} — ${icons.license}\n${icons.source}\n`+icons.files.map(file=>`\n--- ${file.name} ---\n${file.text}`).join('\n'));
await writeFile(join(root,'dist/THIRD_PARTY_NOTICES.txt'),notices.join('\n\n'));
await cp(join(root,'LICENSE'),join(root,'dist/LICENSE'));
// 拡張には同じVue bundleを収録する。IDE専用の拡張は作らない。
const chatImages = ['sending.png', 'abort.png', 'speaker.png', 'microphone.png'];
for (const file of chatImages) await cp(join(root, ['speaker.png', 'microphone.png'].includes(file) ? 'host/aidiy_live/media' : 'host/media', file), join(root, 'dist', file));
for(const target of ['../host/dist/development','../host/aidiy_live/dist/development']){
 const output=fileURLToPath(new URL(target+'/',import.meta.url));await mkdir(output,{recursive:true});
 await rm(join(output,'assets/catppuccin_icons'),{recursive:true,force:true});
 await cp(join(root,'dist/assets/catppuccin_icons'),join(output,'assets/catppuccin_icons'),{recursive:true});
 for(const file of ['app.js','app.css','AiDiy.png',...chatImages,'THIRD_PARTY_NOTICES.txt','LICENSE'])await cp(join(root,'dist',file),join(output,file));
}
