// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export const アプリアイコン=Object.freeze({chrome:'Chrome.svg',memo:'AiDiy_memo.png',...Object.fromEntries(['avatar','task','team','git','browser','ide','cpu','navi','term','code','live','discord','slack'].map(id=>[id,`AiDiy_${id}.png`])),});

// 通常・ミニ・円形で同じ順序を使う。Avatar・Task・Team・GitをCPUの前、Discord・SlackをCPUの後に並べ、Hermes・PiはClaudeの直前、Chromeは最後にする。
export function 起動項目を整列(items){const ids=['ide','term','browser','navi','code','live','avatar','task','team','git','memo','cpu','discord','slack','aidiy_hermes','aidiy_pi','aidiy_codex','claude','codex','copilot','agy','agy_exe','grok','opencode','vscode','chrome'];return items.map(item=>({...item,名前:item.id==='browser'?'Browser':item.id==='aidiy_hermes'?'Hermes':item.id==='aidiy_pi'?'Pi':item.id==='aidiy_codex'?'Codex':item.名前})).sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}

// 標準表示では別々に並べ、ミニとアイコン表示では実行可能な Antigravity CLI を優先する。
export function コンパクトCLI(items){return items.some(item=>item.id==='agy'&&item.利用可能===true)?items.filter(item=>item.id!=='agy_exe'):items;}
