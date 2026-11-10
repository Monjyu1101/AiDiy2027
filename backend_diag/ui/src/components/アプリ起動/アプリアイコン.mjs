// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export const アプリアイコン=Object.freeze({chrome:'Chrome.svg',...Object.fromEntries(['avatar','task','team','browser','ide','cpu','navi','console','code','live','discord','slack'].map(id=>[id,`AiDiy_${id}.png`])),});

// 通常・円形で同じ順序を使う。Browserの直後をHermes、Chromeは最後にする。
export function 起動項目を整列(items){const ids=['avatar','task','team','ide','cpu','navi','console','code','live','browser','aidiy_hermes','discord','slack','claude','codex','copilot','agy','grok','opencode','vscode','chrome'];return items.map(item=>({...item,名前:item.id==='browser'?'Browser':item.id==='aidiy_hermes'?'Hermes':item.名前})).sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}
