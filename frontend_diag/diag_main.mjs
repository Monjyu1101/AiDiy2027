// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 公開起動入口は維持し、実装は diag/ に委譲する。
import {pathToFileURL} from 'node:url';
import {main,startupMessage} from './diag/diag_main.mjs';
export * from './diag/diag_main.mjs';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(startupMessage(error));process.exitCode=1;if(process.env.AIDIY_DIAG_LAUNCHER_CHILD==='1' && process.connected)process.send({type:'diag-launch-error',code:error.diagCode || error.code},()=>process.disconnect());});
