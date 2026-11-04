// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実VS CodeのWebviewを順番に表示し、外側の観測試験と同期する。
const vscode=require('vscode');
const {writeFileSync,existsSync}=require('node:fs');
const {join}=require('node:path');
exports.run=async()=>{
 const dir=process.env.AIDIY_LAYOUT_TEST_DIR;
 for(const [kind,id,command] of [['code','aidiy.aidiy-code','aidiyHermes.open'],['live','aidiy.aidiy-live','aidiyLive.open']]){
  const extension=vscode.extensions.getExtension(id);if(!extension)throw Error(id+' 未登録');
  await extension.activate();await vscode.commands.executeCommand(command);
  await new Promise(r=>setTimeout(r,1500));
  await vscode.commands.executeCommand('notifications.clearAll');
  writeFileSync(join(dir,'stage'),kind);
  const end=Date.now()+90000;
  while(!existsSync(join(dir,kind+'-done'))){if(Date.now()>end)throw Error(kind+' Webview観測期限');await new Promise(r=>setTimeout(r,100));}
  if(kind==='live')await vscode.commands.executeCommand('aidiyLive.stop');
 }
 writeFileSync(join(dir,'passed'),'ok');
};
