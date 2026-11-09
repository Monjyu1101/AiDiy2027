// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const {createBrowserChildWindows}=require('./ブラウザ補助窓.cjs');

function createBrowserAnalysisWindows(options){
 return createBrowserChildWindows({...options,title:'Browser AI解析',hash:'#browser-analysis'});
}
module.exports={createBrowserAnalysisWindows};
