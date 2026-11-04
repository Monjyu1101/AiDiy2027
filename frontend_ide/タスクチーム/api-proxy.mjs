// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { coreTarget } from '../viewer/core-connection.mjs';
import { createFixedProject } from './プロジェクト固定.mjs';
import { internalAuthorization } from './内部認証.mjs';

export function taskTeamTarget(...folders) {
  const visited = new Set();
  for (const folder of folders) {
    let current = resolve(folder);
    while (!visited.has(current)) {
      visited.add(current);
      const file = join(current, '_config', 'AiDiy_key.json');
      if (existsSync(file)) {
        const settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        const port = Number(settings.PORT_TASKTEAM ?? 8093);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT_TASKTEAM は1〜65535の整数で指定してください。');
        return `http://127.0.0.1:${port}`;
      }
      const parent = dirname(current); if (parent === current) break; current = parent;
    }
  }
  return 'http://127.0.0.1:8093';
}
const corePaths = new Set(['/core/auth/ログイン', '/core/auth/現在利用者', '/core/AIコア/モデル情報/TASK選択肢', '/core/AIコア/フォルダ参照']);
// ブラウザ指定URLやAPIキーを使わない。接続先は配置先設定のloopbackのみ。
export function createTaskTeamProxy(root, project, { fetcher = fetch, timeout = 390000, healthTimeout = 1500, projectFixed = false } = {}) {
  const fixed = projectFixed ? createFixedProject(project) : null;
  const core = coreTarget(root, project), target = taskTeamTarget(root, project);
  const authorize = projectFixed ? internalAuthorization(core,[root,project]) : null;
  async function request(url,options){
    if(!authorize)return fetcher(url,options);
    const send=()=>fetcher(url,{...options,headers:{...options.headers,...authorize()}});
    let response=await send();
    // 期限の境界で更新された公開トークンを一度だけ再読込。未確定の通信失敗は再送しない。
    if(response.status===401){await response.arrayBuffer();response=await send();}
    return response;
  }
  const controllers = new Set();
  let closed = false;
  const json = (res, status, data) => { if (!res.destroyed) res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data)); };
  return {
    close() { closed = true; for (const controller of controllers) controller.abort(); controllers.clear(); },
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/taskteam-api/')) return false;
      if (closed) { json(res,503,{status:'NG',message:'終了しました。'}); return true; }
      let path;
      try { path = decodeURIComponent(url.pathname.slice('/taskteam-api'.length)); } catch { json(res,400,{status:'NG',message:'不正なパスです。'}); return true; }
      const status = path === '/status';
      if (req.method !== (status ? 'GET' : 'POST')) { json(res,405,{status:'NG',message:'許可されていないメソッドです。'}); return true; }
      if (!status && (!corePaths.has(path) && !/^\/(?:task|team)\/[^\\?#\u0000]+$/.test(path) || path.includes('%') || path.split('/').some(part=>part==='.'||part==='..'))) {
        json(res,404,{status:'NG',message:'許可されていないAPIです。'}); return true;
      }
      if (!status && !(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(res,415,{status:'NG',message:'JSONのみ送信できます。'}); return true; }
      const controller = new AbortController(); controllers.add(controller);
      const abort = () => controller.abort(); req.once('aborted',abort); res.once('close',abort);
      try {
        let body;
        if (!status) {
          const chunks = []; let length = 0;
          for await (const chunk of req) { length += chunk.length; if (length > 20 * 1024 * 1024) { json(res,413,{status:'NG',message:'要求が大きすぎます。'}); return true; } chunks.push(chunk); }
          body = Buffer.concat(chunks); try { JSON.parse(body.toString('utf8')); } catch { json(res,400,{status:'NG',message:'JSONが不正です。'}); return true; }
          if(fixed){
            try{body=Buffer.from(JSON.stringify(fixed.validate(path,JSON.parse(body.toString('utf8')))));}
            catch(error){json(res,409,{status:'NG',message:error.message});return true;}
            // 既存の別プロジェクトの要求を、固定フォルダへ黙って付け替えない。
            const lookup = path === '/task/タスク要求/更新登録' ? '/task/タスク要求/取得' : path === '/team/依頼/変更' ? '/team/依頼/取得' : null;
            if(lookup){
              const data=JSON.parse(body.toString('utf8'));
              const keys=lookup.startsWith('/task/')?{タスクID:data.タスクID}:{要員ID:data.要員ID,依頼ID:data.依頼ID};
              const current=await request(new URL(lookup,target),{method:'POST',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]),headers:{'content-type':'application/json',...(req.headers.authorization?{authorization:req.headers.authorization}:{})},body:JSON.stringify(keys)});
              const result=await current.json();
              if(!current.ok||result.status!=='OK'||!fixed.matches(result.data?.item?.プロジェクト)){
                json(res,409,{status:'NG',message:'IDEのプロジェクトと一致する既存要求だけ変更できます。対象を単独起動で確認してください。'});return true;
              }
            }
          }
        }
        const upstream = status ? new URL('/health', target) : new URL(path, path.startsWith('/core/') ? core : target);
        const response = await (status?fetcher:request)(upstream, {method:status?'GET':'POST',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(status?healthTimeout:timeout)]), ...(status?{}:{body,headers:{'content-type':'application/json',...(req.headers.authorization ? {authorization:req.headers.authorization} : {})}})});
        if (status) {
          const data = await response.json();
          json(res,200,{connected:response.ok && data.status==='OK' && data.service==='backend_taskteam',port:Number(new URL(target).port)});
        } else {
          const data = await response.text();
          if (!res.destroyed) res.writeHead(response.status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(data);
        }
      } catch {
        json(res,status?200:502,status?{connected:false,port:Number(new URL(target).port)}:{status:'NG',message:'接続できません。Core / Task・Team サーバーの起動を確認してください。'});
      } finally { controllers.delete(controller); req.off('aborted',abort); res.off('close',abort); }
      return true;
    }
  };
}
