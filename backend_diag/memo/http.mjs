// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createMemoStore} from './保存.mjs';

// Diag の共通認証を通過したリクエストだけを受け取る。
// 保存先選択・メモ操作の状態は、この起動単位のハンドラーが所有する。
export function createMemoHandler({appLauncher,launchRoot,memoStore}) {
  let memoProject;
  memoStore ??= createMemoStore({launchRoot,getProjectRoot:async()=>memoProject===undefined?(await appLauncher.catalog()).起動フォルダ:memoProject});
  return async (req,route,send) => {
    const reply=(...args)=>{send(...args);return true;};
      if(route==='api/メモ'&&req.method==='GET'){
        try{return reply(200,await memoStore.list());}catch(error){return reply(error.status||500,{エラー:error.status?error.message:'メモを読み込めませんでした。'});}
      }
      if(route?.startsWith('api/メモ/')){
        if(!['api/メモ/作成','api/メモ/保存','api/メモ/プロジェクト'].includes(route))return reply(404,{エラー:'操作が見つかりません。'});
        if(req.method!=='POST')return reply(405,{エラー:'POST を使用してください。'});
        if(req.headers['sec-fetch-site']==='cross-site')return reply(403,{エラー:'同じ画面から操作してください。'});
        if(req.headers.origin){try{if(new URL(req.headers.origin).origin!==`http://${req.headers.host}`)return reply(403,{エラー:'同じ画面から操作してください。'});}catch{return reply(403,{エラー:'送信元が不正です。'});}}
        if(String(req.headers['content-type']).split(';')[0]!=='application/json')return reply(400,{エラー:'JSON形式の入力が必要です。'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return reply(413,{エラー:'入力が大きすぎます。'});chunks.push(chunk);}
        let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return reply(400,{エラー:'入力JSONが不正です。'});}
        try{
          if(route.endsWith('/プロジェクト')){
            if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='フォルダ')||typeof body.フォルダ!=='string')return reply(400,{エラー:'フォルダを指定してください。'});
            memoProject=body.フォルダ?(await appLauncher.folders(body.フォルダ)).フォルダ:'';
            return reply(200,{更新:true});
          }
          return reply(200,await (route.endsWith('/作成')?memoStore.create(body):memoStore.save(body)));
        }catch(error){return reply(error.status||500,{エラー:error.status?error.message:'メモを保存できませんでした。編集内容を保持して再試行してください。'});}
      }
    return false;
  };
}
