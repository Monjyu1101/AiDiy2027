// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
'use strict';

// JSON・サーバー・Electron・画面で同じ分単位の UTC 形式を検証する。
function 期限は有効(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(value)||value.startsWith('0000-'))return false;
 const time=Date.parse(value);
 return Number.isFinite(time)&&new Date(time).toISOString()===value;
}
module.exports={期限は有効};
