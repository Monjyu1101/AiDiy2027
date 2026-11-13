// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import {cp} from 'node:fs/promises';
import path from 'node:path';
// Production Diag imports these shared modules at startup, even in headless mode.
// Keep fixture dependencies real; only individual tests replace network transport.
export async function copySharedFixture(workspace){
 for(const relative of ['scripts','frontend_ide/デスクトップ','frontend_ide/host/scripts']){
  await cp(new URL('../../'+relative,import.meta.url),path.join(workspace,relative),{recursive:true,filter:source=>!/(?:^|[/\\])(?:node_modules|checks|__pycache__)(?:[/\\]|$)/.test(source)});
 }
 for(const name of ['コード/パネル表示切替.vue','コード/パネル切替ドラッグ.js','共通表示/パネル折り畳み.js']){
  await cp(new URL('../../frontend_ide/src/components/'+name,import.meta.url),path.join(workspace,'frontend_ide/src/components',name));
 }
}
