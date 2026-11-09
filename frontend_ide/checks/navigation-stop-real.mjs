// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実AIを呼ぶ手動試験。共有サービスは停止せず、試験窓の×で終了する。
// node frontend_ide/checks/navigation-stop-real.mjs <証拠フォルダ>
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {startDevelopment} from '../server.mjs';
import {runNavigationAgent,navigationAvailability} from '../ファイル機能/navigation-agent.mjs';
import {electronExecutable} from '../viewer/launch-options.mjs';
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const base=mkdtempSync(join(tmpdir(),'aidiy-navi-stop-')),project=join(base,'Navi停止試験');mkdirSync(project);
const goal='専用READMEの確認と手動承認待ちの確認';
const prompt='今回の目標は専用READMEの確認です。今回の作業は作業フォルダ直下のREADME.mdだけを読み、その内容を短く報告することです。ファイルの変更・作成はせず、上位フォルダや他のプロジェクトは参照しないでください。手動承認は行わず、この1回の報告で終了してください。';
writeFileSync(join(project,'README.md'),'# Navi停止操作の公開試験資料\nこのフォルダには秘密情報はありません。READMEの確認はCodeの報告で完了です。\n手動承認は未実施です。承認ファイルは存在しません。利用者の別操作まで手動承認の項目は0%にしてください。\nCodeにはREADMEを読み短く報告することだけを依頼し、ファイルを変更しません。\n','utf8');
const before=createHash('sha256').update(readFileSync(join(project,'README.md'))).digest('hex');
const stateRoot=join(base,'navigation-state'),key=createHash('sha256').update(project.toLowerCase()).digest('hex'),dir=join(stateRoot,key,'standalone-navi-1');mkdirSync(dir,{recursive:true});
const id=randomUUID(),at=Date.now(),selection={provider:'codex_cli',model:'gpt-6.1-sol'};
const initial={schemaVersion:3,requestId:id,navigationId:id,goal,inferred:false,items:[{id:'read',name:'READMEの確認',progress:0,weight:50,reason:'試験開始時点では報告前です。',weightReason:'停止操作用の固定試験項目の半分です。'},{id:'approval',name:'利用者による別途の手動承認',progress:0,weight:50,reason:'手動承認は未実施です。承認ファイルがない限り0%です。',weightReason:'100%自動停止を除外する固定の未完了項目です。'}],overall:{progress:0,reason:'試験開始前です。'},nextItemId:'read',nextPrompt:prompt,selection,createdAt:at,updatedAt:at,checkedAt:at};
writeFileSync(join(dir,'latest.json'),JSON.stringify(initial,null,2));
const log=(kind,data)=>appendFileSync(join(output,'agent.jsonl'),JSON.stringify({at:new Date().toISOString(),kind,...data})+'\n');
let count=0;
const server=await startDevelopment(project,{kind:'navi',provider:selection.provider,model:selection.model,navigationOptions:{stateRoot,modelFile:join(base,'navi-model.json'),defaultModel:async()=>selection,availability:navigationAvailability,runAgent:async args=>{
 const call=++count;log('evaluation-start',{call,selection:args.selection});
 const aborted=()=>log('evaluation-abort',{call});args.signal.addEventListener('abort',aborted,{once:true});
 try{const answer=await runNavigationAgent(args);log('evaluation-return',{call,aborted:args.signal.aborted});writeFileSync(join(output,'evaluation-'+call+'.json'),JSON.stringify(answer,null,2));return answer;}catch(e){log('evaluation-error',{call,message:e.message});throw e;}finally{args.signal.removeEventListener('abort',aborted);}
}}});
const meta={project,stateRoot,url:server.url,pid:process.pid,initial,sourceHash:createHash('sha256').update(readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url))).digest('hex'),bundleHash:createHash('sha256').update(readFileSync(new URL('../dist/app.js',import.meta.url))).digest('hex'),before};
writeFileSync(join(output,'environment.json'),JSON.stringify(meta,null,2));
const env={...process.env,AIDIY_DEVELOPMENT_URL:server.url,AIDIY_DEVELOPMENT_KIND:'navi',AIDIY_DEVELOPMENT_PROJECT:project,AIDIY_DEVELOPMENT_NEW_WINDOW:'1',AIDIY_STOP_EVIDENCE:output};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electronExecutable(),[fileURLToPath(new URL('./navigation-stop-electron.cjs',import.meta.url))],{cwd:project,env,windowsHide:false,stdio:['ignore','ignore','ignore','ipc']});
log('launched',{electronPid:child.pid,project,url:server.url});console.log(JSON.stringify({project,url:server.url,electronPid:child.pid,output}));
child.once('exit',async code=>{await server.close();log('closed',{code,readmeUnchanged:before===createHash('sha256').update(readFileSync(join(project,'README.md'))).digest('hex')});process.exitCode=code||0;});
