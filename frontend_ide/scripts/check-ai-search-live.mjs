// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 明示実行専用: 実際のaidiy_code_agentsを呼ぶ（AI利用料金が発生する場合がある）。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createAISearch, runSearchAgent } from '../ファイル機能/ai-search.mjs';

const root=await mkdtemp(join(tmpdir(),'aidiy-ai-live-'));
let agentTask;
const search=createAISearch(root,{state:()=>({active:true,startedAt:1}),runAgent:args=>(agentTask=runSearchAgent(args))});
try {
  await mkdir(join(root,'src'));
  await writeFile(join(root,'src','login.ts'),'export function authenticated(token: string) { return token === "sample"; }');
  await writeFile(join(root,'main.ts'),'import { authenticated } from "./src/login";\nconsole.log(authenticated("sample"));');
  const job=await search.start('認証に関係するファイルを探してください。main.tsとsrc内だけを調べてください。');
  console.log('AI SEARCH LIVE: 依頼送信、最大5分で結果を確認します。');
  for(;;) {
    const status=await search.check(job.id);
    if(status.status==='complete'){
      if(!status.result.files.some(file=>file.path==='src/login.ts'))throw Error('認証ファイルが結果にありません。');
      console.log('AI SEARCH LIVE PASS:',JSON.stringify(status.result));
      // ファイル保存直後はCLIがまだ作業フォルダを使用しているため、実行応答まで待つ。
      await agentTask;break;
    }
    if(status.status!=='waiting')throw Error(`${status.status}: ${status.message}`);
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
} finally {
  search.close();
  if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('一時パスが不正です');
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:500});
}
