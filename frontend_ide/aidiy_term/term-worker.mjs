// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { spawn } from 'node-pty';
let terminal, stopping = false;
const send = value => { if (process.connected) process.send(value); };
function stop() {
  if (stopping) return; stopping = true;
  try { terminal?.kill(); } catch {}
  setTimeout(() => process.exit(0), 1500);
}
process.once('disconnect', stop);
process.on('message', message => {
  try {
    if (message.type === 'start' && !terminal) {
      terminal = spawn(message.shell, message.args, message.options);
      terminal.onData(data => send({ type: 'data', data }));
      terminal.onExit(({ exitCode }) => {
        // 先行する出力のIPC送信完了後に終了して、末尾の文字を落とさない。
        if (process.connected) process.send({ type: 'exit' }, () => process.exit(exitCode));
        else process.exit(exitCode);
      });
      send({ type: 'ready' });
    } else if (message.type === 'input') terminal.write(message.data);
    else if (message.type === 'resize') terminal.resize(message.cols, message.rows);
    else if (message.type === 'pause') terminal.pause();
    else if (message.type === 'resume') terminal.resume();
    else if (message.type === 'stop') stop();
  } catch (error) { if (process.connected) process.send({ type: 'error', message: error.message }, () => process.exit(1)); else process.exit(1); }
});
