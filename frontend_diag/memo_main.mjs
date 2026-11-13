// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import {pathToFileURL} from 'node:url';
import {main as diagMain,startupMessage} from './diag/diag_main.mjs';
export function memoArgs(args){
 if(args.some(value=>!['--new','--foreground','--wait','--help','-h'].includes(value)))throw Error('aidiy_memo は配置元のシステムメモだけを扱います。引数は --new / --foreground / --wait / --help です。');
 return ['--memo-only',...args];
}
export async function main(args=process.argv.slice(2)){
 const options=memoArgs(args);
 if(args.includes('--help')||args.includes('-h')){console.log('AiDiy Memo: aidiy_memo [--new] [--foreground | --wait]\n配置元 AiDiy2027 の _AIDIY/aidiy_memo のみを表示します。プロジェクト指定は受け付けません。');return;}
 return diagMain(options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.diagCode?startupMessage(error):'aidiy_memo を起動できません。--help で引数と起動環境を確認してください。');process.exitCode=1;});
