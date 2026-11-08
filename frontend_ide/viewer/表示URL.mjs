// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// Nodeと画面で共用する。URLの検査だけを行い、通信・到達性確認は行わない。
const controls=/[\u0000-\u001f\u007f-\u009f]/u;
const secretKey=/(?:token|password|passwd|secret|credential|authorization|api[-_]?key|access[-_]?key|signature|^sig$|^key$|^auth$|^code$|session)/i;
function displayUrl(value) {
  if(typeof value!=='string'||value.length>4096||controls.test(value))return null;
  const raw=value.trim();
  if(!/^https?:\/\//i.test(raw)||/[\s\\]/u.test(raw)||/%(?![0-9a-f]{2})/i.test(raw))return null;
  try {
    const url=new URL(raw);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;
    // エスケープした制御文字・動的パラメーター・秘密値も拒否する。
    let decoded=url.pathname+url.search+url.hash;
    for(let i=0;i<4;i++) {
      // %25で表した文字「%」は次の周回でも正当なパスとして残す。
      const next=decodeURIComponent(decoded.replace(/%(?![0-9a-f]{2})/gi,'%25'));
      if(next===decoded)break;
      decoded=next;
    }
    if(controls.test(decoded)||/[\\{}<>\[\]]/u.test(decoded)||/(?:^|[\/#?&=]):[\p{L}\p{N}_]+|\$\{|\*/u.test(decoded))return null;
    if(/(?:^|[\/?#&;])([^\/?#&;=]+)=/u.test(decoded)) {
      const pairs=decoded.matchAll(/(?:^|[\/?#&;])([^\/?#&;=]+)=/gu);
      for(const pair of pairs)if(secretKey.test(pair[1]))return null;
    }
    if(/(?:^|\/)\b(?:token|secret|password|api[-_]?key|session)\b\//i.test(decoded)||/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(decoded))return null;
    const normalized=url.href.replace(/%[0-9a-f]{2}/gi,part=>part.toUpperCase());
    return normalized.length<=4096?normalized:null;
  }catch{return null;}
}

export function normalizeDisplayUrls(value) {
  if(!Array.isArray(value))return [];
  const urls=[],seen=new Set();
  for(const item of value) {
    if(!item||typeof item!=='object')continue;
    const url=displayUrl(item.url);
    if(!url||seen.has(url))continue;
    seen.add(url);
    const label=typeof item.label==='string'?item.label.replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').trim().slice(0,200):'';
    urls.push({url,label});
    if(urls.length===20)break;
  }
  return urls;
}

export function normalizeDisplayUrlReason(value) {
  return typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,'').trim().slice(0,2000):'';
}
