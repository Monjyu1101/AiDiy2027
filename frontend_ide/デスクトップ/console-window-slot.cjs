// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {createServer}=require('node:net');
// 別ElectronプロセスとIDE子窓で配置番号を共有する。OSが終了時に解放する。
// データや操作は受け付けず、ループバックの排他だけに使う。
async function reserveConsoleSlot(){
 for(let slot=0;slot<128;slot++){
  const server=createServer(socket=>socket.destroy());
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:18440+slot,exclusive:true},resolve);});
   server.unref();
   return{slot,close(){server.close();}};
  }catch(error){if(error.code!=='EADDRINUSE')throw error;}
 }
 throw Error('Consoleのウィンドウ配置番号を確保できません。');
}
module.exports={reserveConsoleSlot};
