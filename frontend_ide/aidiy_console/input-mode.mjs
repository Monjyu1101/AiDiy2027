// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027


// 出力履歴の切詰めとは独立して、ConPTYの入力モードだけを保持する。
// ESC/C1 CSIの境界とC0を追跡し、分割されたDECSET/DECRSTとRISに対応する。
export function consoleInputMode() {
 let state = '', parameters = '', enabled = false;
 return {
  write(data) {
   for (const character of data) {
    const code = character.charCodeAt(0);
    if (character === '\x1b') { state = 'escape'; parameters = ''; continue; }
    if (character === '\x9b') { state = 'csi'; parameters = ''; continue; }
    if (code === 0x18 || code === 0x1a || (code >= 0x80 && code < 0xa0)) { state = ''; continue; }
    if (code < 0x20 || code === 0x7f) continue;
    if (state === 'escape') {
     if (character === 'c') enabled = false;
     state = character === '[' ? 'csi' : ''; continue;
    }
    if (state !== 'csi') continue;
    if (code >= 0x40 && code <= 0x7e) {
     if ((character === 'h' || character === 'l') && /^\?[\d;:]*$/.test(parameters)
       && parameters.slice(1).split(';').slice(0, 32).some(value => Number(value.split(':')[0]) === 9001)) enabled = character === 'h';
     state = '';
    } else if (code >= 0x20 && code < 0x40 && parameters.length < 1024) parameters += character;
    else state = '';
   }
  },
  get enabled() { return enabled; },
 };
}
