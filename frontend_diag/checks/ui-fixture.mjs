// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {createServer} from '../diag/diag_main.mjs';
import {catalog} from '../diag/診断/probes.mjs';
const entries=await catalog();
const publicCache={snapshot:()=>({状態:'取得済',件数:1,世代:2,説明:'公開モデル取得済（synthetic）'}),input:()=>({公開モデル:{'fixture/model':{model_id:'fixture/model'}},公開状態:'取得済',確認日時:new Date().toISOString()}),refresh:async()=>publicCache.snapshot()};
// 書込は実ファイルへ保存せず、件数だけ返す。
const server=createServer({modelsWriteFn:async(_providers,results)=>Object.keys(results).map(id=>id+'_models_info.json'),installWriteFn:async(_entries,results)=>({件数:results.length,集計:{OK:results.length}}),integrationWriteFn:async(_rows,results)=>({件数:3,集計:{OK:Object.keys(results).length}}),toolsStatusFn:async()=>({online:true}),publicCache,token:'synthetic-ui-test',prefix:'/proxy/8097/',entries,coverage:{complete:true,sourceTargetFiles:3333,scannedSourceFiles:3333},scanFn:async()=>{await new Promise(r=>setTimeout(r,100));return entries.map(e=>({id:e.id,状態:'OK',説明:'synthetic'}));},keyStatusFn:async()=>({設定状態:'読込済み',項目:[{id:'openai',名前:'OpenAI API',キー名:'openai_key_id',設定済み:true,説明:'設定有無のみ。',テスト可能:true},{id:'claude',名前:'Claude',キー名:'claude_key_id',設定済み:false,テスト可能:false,理由:'キーが未設定です。'},{id:'azure',名前:'Azure OpenAI',キー名:'azure_key_id',設定済み:false,テスト可能:false,理由:'キーが未設定です。'},{id:'huggingface_read',名前:'Hugging Face 読取',キー名:'huggingface_key_read',設定済み:false,テスト可能:false,理由:'キーが未設定です。'},{id:'huggingface_write',名前:'Hugging Face 書込',キー名:'huggingface_key_write',設定済み:false,テスト可能:false,理由:'キーが未設定です。'},{id:'discord',名前:'Discord Bot',キー名:'discord_bot_token',設定済み:true,テスト可能:true},{id:'openrt_chat',名前:'OpenRouter',キー名:'openrt_key_id',設定済み:true,キー不要:true,説明:'公開一覧取得、キーの有効性は未確認。',テスト可能:true}]}),keyTestFn:async id=>{await new Promise(r=>setTimeout(r,100));return {id,状態:'OK',説明:'synthetic API success',モデル:['gpt-synthetic','<script>alert(1)</script>'],モデル詳細:[{model_id:'gpt-synthetic',作成日:'2026/10/01',トークン数:'128000',モダリティ:'text->text'}],確認日時:new Date().toISOString()};}});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
process.on('SIGTERM',()=>{server.close();server.closeAllConnections();});
