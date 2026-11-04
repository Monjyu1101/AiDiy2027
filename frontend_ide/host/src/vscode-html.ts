// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export function developmentHtml(resource:(path:string)=>string,cspSource:string,nonce:string,config:Record<string,unknown>){
 const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
 const boot=JSON.stringify({...config,host:true,icon:resource('dist/development/AiDiy.png'),iconAssets:resource('dist/development/assets/catppuccin_icons')+'/'}).replaceAll('<','\\u003c');
 const csp=`default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; img-src ${cspSource} data:; connect-src ${cspSource}; worker-src ${cspSource} blob:; base-uri 'none'; frame-src 'none';`;
 return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><link rel="stylesheet" href="${escape(resource('dist/development/app.css'))}"><style>body{padding:0}</style><script id="development-config" type="application/json" nonce="${nonce}">${boot}</script></head><body class="vscode-host"><div id="app"></div><script nonce="${nonce}" src="${escape(resource('dist/development/app.js'))}" defer></script></body></html>`;
}
