// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {readRoutes, webPort} from './vue-preview.mjs';
import {MEDIA_PATTERN} from './media-types.mjs';

// 任意のソースを実行せず、AiDiyが使う静的な登録形式だけを読む。
// 文字列内の // は維持し、コメントアウトされた登録を対象にしない。
const withoutComments=text=>text.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,(match,string)=>string||' ');
const localPath=value=>typeof value==='string'&&!/[:\\]/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..');

/** public内のHTMLに対応する、登録済みのAiDiyルートだけを返す。未登録はnull。 */
export async function registeredHTMLRoute(root,rel){
 const prefix='frontend_web/public/';
 if(!rel.startsWith(prefix)||!localPath(rel)||! /\.html?$/i.test(rel))return null;
 const target=rel.slice(prefix.length);
 let entries;
 try{entries=await readdir(join(root,'frontend_web/src/router'),{withFileTypes:true});}catch{return null;}
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  if(!entry.isFile()||! /\.[jt]s$/.test(entry.name))continue;
  const file='frontend_web/src/router/'+entry.name;
  const text=withoutComments(await readFile(join(root,file),'utf8'));
  // createStaticAliasRoute('/公開ルート', 'public内のHTML', 'タイトル')
  for(const match of text.matchAll(/\bcreateStaticAliasRoute\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,/g)){
   if(match[2]===target&&match[1].startsWith('/')&&!match[1].startsWith('//')&&localPath(match[1]))return match[1];
  }
  // 登録Vue画面のiframeから参照されるHTML（Xテトリス等）。
  for(const route of readRoutes(file,text)){
   if(!route.component.startsWith('frontend_web/src/')||!localPath(route.component))continue;
   let component;
   try{component=withoutComments(await readFile(join(root,route.component),'utf8'));}catch{continue;}
   const frame=/\bconst\s+frameSrc\s*=\s*`\$\{baseUrl\}([^`$]+)`/.exec(component);
   if(frame?.[1]===target&&/<iframe\b[^>]*:src\s*=\s*["']frameSrc["']/s.test(component))return route.path;
  }
 }
 return null;
}

export async function registeredHTMLURL(root,rel){
 const route=await registeredHTMLRoute(root,rel);
 if(!route)return null;
 const port=await webPort(root),origin=`http://127.0.0.1:${port}`;
 const alive=await fetch(origin+'/@vite/client',{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);
 if(!alive)throw Error(`このHTMLはAiDiyの登録画面です。frontend_web（ポート ${port}）を起動してから開いてください。`);
 return origin+route.split('/').map(encodeURIComponent).join('/');
}

/** AiDiy 保守中（frontend_web/public 内）の音声・動画は、起動中の frontend_web の正式なリンクを返す。対象外・未起動は null（呼び出し側が file:// 等で開く）。 */
export async function publicMediaURL(root,rel){
 const prefix='frontend_web/public/';
 if(!rel.startsWith(prefix)||!localPath(rel)||!MEDIA_PATTERN.test(rel))return null;
 // 他プロジェクトの同名フォルダを AiDiy と取り違えないよう、frontend_web の Vite 設定があるときだけ対象にする。
 if(!await stat(join(root,'frontend_web/vite.config.ts')).then(info=>info.isFile(),()=>false))return null;
 const port=await webPort(root),origin=`http://127.0.0.1:${port}`;
 const alive=await fetch(origin+'/@vite/client',{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);
 return alive?origin+'/'+rel.slice(prefix.length).split('/').map(encodeURIComponent).join('/'):null;
}
