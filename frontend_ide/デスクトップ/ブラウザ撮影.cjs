// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {mkdir,realpath,writeFile}=require('node:fs/promises');
const {join,relative,isAbsolute,sep}=require('node:path');
const {randomUUID}=require('node:crypto');

// 撮影元・保存先はmainが決める。外部ページやrendererから保存パスを受け取らない。
async function saveBrowserCapture(project,png){
 if(!Buffer.isBuffer(png)||png.length<8||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('撮影画像が不正です。');
 const root=await realpath(project);let directory=root;
 for(const part of ['temp','input']){
  directory=join(directory,part);await mkdir(directory).catch(error=>{if(error.code!=='EEXIST')throw error;});
  directory=await realpath(directory);const back=relative(root,directory);
  if(!back||back==='..'||back.startsWith('..'+sep)||isAbsolute(back))throw Error('画像の保存先がプロジェクト外です。');
 }
 const name=`browser-${randomUUID()}.png`;
 await writeFile(join(directory,name),png,{flag:'wx'});
 return{path:`temp/input/${name}`,message:`temp/input/${name} に保存しました。`};
}
module.exports={saveBrowserCapture};
