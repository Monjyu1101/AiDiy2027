// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {electronExecutable} from '../viewer/launch-options.mjs';
const env={...process.env,AIDIY_BROWSER_SELFTEST:'1'};delete env.ELECTRON_RUN_AS_NODE;
const ping=await fetch('http://127.0.0.1:8095/aidiy_code_agents/ping',{signal:AbortSignal.timeout(3000)});if(!ping.ok)throw Error('撮影用のToolsを起動してください。');
const child=spawn(electronExecutable(),[fileURLToPath(new URL('../checks/browser-window-probe.cjs',import.meta.url))],{env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
let result;child.on('message',value=>{if(value.testPassed)result=value;});
const [code]=await once(child,'exit');if(code!==0||!result)throw Error(`Browser窓試験失敗: ${code}`);console.log(JSON.stringify(result));
