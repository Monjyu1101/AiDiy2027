// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

function keepInFront(window){
 // Windowsでは標準のfloating指定だけでは前面状態が成立しない環境がある。
 // 所有関係は維持したまま、明示したレベルでIDEの上へ置く。
 if(!window.isDestroyed()&&!window.isAlwaysOnTop())window.setAlwaysOnTop(true,process.platform==='win32'?'pop-up-menu':'floating');
}
module.exports={keepInFront};
