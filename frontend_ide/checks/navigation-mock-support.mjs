// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
// 模擬画面試験の保存先・既定モデル・疎通先を試験専用に固定する。
import {startDevelopment as start} from '../server.mjs';
import {createCoreConnection} from '../viewer/core-connection.mjs';
import {createServer} from 'node:http';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {mkdirSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
export function mockOutput(fallback){const path=resolve(process.env.AIDIY_NAVIGATION_MOCK_OUTPUT||fallback);mkdirSync(path,{recursive:true});return path;}
export function mockStage(label){console.log('STAGE: '+label);}
// Windowsでは作成直後のDevToolsActivePortがロック中・空のことがある。
export function readMockDebugPort(file){try{const port=readFileSync(file,'utf8').split('\n')[0].trim();return /^\d+$/.test(port)?port:null;}catch(error){if(['EBUSY','EACCES','ENOENT'].includes(error.code))return null;throw error;}}
export function removeMockDirectory(folder){const back=relative(resolve(tmpdir()),resolve(folder));if(!back||back.startsWith('..')||isAbsolute(back)||! /^(?:aidiy-connection-check-|aidiy-navi-height-|navi-auto-ui-|navi-picker-|navi-scenery-)/.test(back))throw Error('模擬試験の一時保存先が不正です。');rmSync(resolve(folder),{recursive:true,force:true,maxRetries:5,retryDelay:200});}
function hashes(folder){if(!existsSync(folder))return {};return Object.fromEntries(readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isFile()?[[e.name,createHash('sha256').update(readFileSync(join(folder,e.name))).digest('hex')]]:[]));}
export async function startMockDevelopment(project,options={}){
 const before=hashes(project);let core,connection=options.connection;
 if(!connection&&['navi','ide'].includes(options.kind||'ide')){
  core=createServer((req,res)=>{if(req.url!=='/aidiy_code_agents/ping'||req.method!=='GET')return res.writeHead(403).end();res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({status:'ok',name:'aidiy_code_agents'}));});
  await new Promise(done=>core.listen(0,'127.0.0.1',done));
  connection=createCoreConnection(project,{target:'http://127.0.0.1:'+core.address().port,keepActive:options.kind==='navi'});
 }
 const original=options.navigationOptions;
 if(['navi','ide'].includes(options.kind||'ide')&&(!original?.stateRoot||typeof original.runAgent!=='function'))throw Error('模擬試験は専用stateRootとrunAgentが必要です。');
 let mockCalls=0;
 const navigationOptions=original?{defaultModel:async()=>({provider:'aidiy_hermes',model:'same'}),providerList:async()=>({providers:['aidiy_hermes'],notice:''}),...original,modelFile:join(dirname(original.stateRoot),'aidiy_navi_model.json'),runAgent:async args=>{mockCalls++;return original.runAgent(args);}}:undefined;
 const app=await start(project,{...options,connection,navigationOptions});const close=app.close;
 app.close=async()=>{console.log(JSON.stringify({mockApplication:options.kind||'ide',mockCalls,projectUnchanged:JSON.stringify(before)===JSON.stringify(hashes(project)),stateRoot:original?.stateRoot,modelFile:navigationOptions?.modelFile}));await close();if(core){connection.close();core.closeAllConnections();await new Promise(done=>core.close(done));}};
 return app;
}
