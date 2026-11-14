// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// Electronの継続出力を模擬し、IPCとコンソールの分離を検証する。
const timer = setInterval(() => { process.stdout.write('\r\n'); process.stderr.write('\x1b[2B\n'); }, 25);
process.send({ windowShown: true });
process.on('message', message => { if (message === 'close') { clearInterval(timer); process.disconnect(); } });
process.on('disconnect', () => { clearInterval(timer); });
