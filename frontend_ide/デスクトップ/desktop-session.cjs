// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// 状態不明を「終了」として扱わない。通信断・不正応答では呼び出し元が再確認する。
function validateDevelopmentState(value){
 if(!value||Array.isArray(value)||typeof value.active!=='boolean')throw Error('IDEの利用状態が不正です。');
 if(value.active&&(!['online','offline'].includes(value.mode)||!Number.isFinite(value.startedAt)||value.startedAt<=0||typeof value.project?.path!=='string'||!value.project.path||value.project.path.length>4096||value.project.path.includes('\0')))throw Error('IDEの利用状態が不正です。');
 return value;
}
async function readDevelopmentState(record,request=fetch){
 const response=await request(new URL('api/connection',record.url),{cache:'no-store',signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error('IDEの利用状態を取得できません。');
 return validateDevelopmentState(await response.json());
}
module.exports={validateDevelopmentState,readDevelopmentState};
