// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnOwned, stopTree } from '../launch.mjs';
const launchUrl = new URL('../launch.mjs', import.meta.url).href;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const running = pid => {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false;
    return true;
  } catch { return false; }
};
async function stopped(pid) {
  for (let i = 0; i < 100 && running(pid); i++) await sleep(20);
  assert.equal(running(pid), false, `PID ${pid} must stop`);
}
const nodeChild = (code, options = {}) => spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], ...options });

test('POSIX: 自分のグループ内の終了拒否する孫も回収し、別プロセスを残す', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const unrelated = nodeChild('setInterval(() => {}, 1000);');
  const code = `import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); process.send({ready:true}); setInterval(()=>{},1000);"],{stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',()=>process.send({pid:child.pid})); setInterval(()=>{},1000);`;
  const child = spawnOwned(spawn, process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let grandchild;
  try {
    [{ pid: grandchild }] = await once(child, 'message');
    await stopTree(child, 50);
    await stopped(child.pid); await stopped(grandchild);
    assert.equal(running(unrelated.pid), true);
  } finally {
    await stopTree(child, 50);
    unrelated.kill('SIGKILL');
  }
});

for (const reason of ['IDE切断', 'IDE通常停止', 'Avatarメイン終了']) {
  test(`実プロセス: ${reason}でElectronとrendererだけが終了する`, { timeout: 10000 }, async () => {
    const code = `import {runAvatar} from ${JSON.stringify(launchUrl)};
      import {spawn} from 'node:child_process';
      const children=[];
      await runAvatar({owner:process,electron:'fake-electron',vite:'fake-vite',build(){},isOpen:async()=>children.length>1,
        launch(command,args,options){
          const desktop=command==='fake-electron';
          const source=desktop ? "process.send({avatarPrimary:true});process.on('message',m=>{if(m.avatarRendererReady)process.send({avatarShown:true});});setInterval(()=>{},1000);" : 'setInterval(()=>{},1000);';
          const child=spawn(process.execPath,['-e',source],options);children.push(child);return child;
        },ready(){process.send({pids:children.map(c=>c.pid)});}
      });
      if(process.connected)process.disconnect();`;
    const harness = nodeChild(code);
    const unrelated = nodeChild('setInterval(()=>{},1000);');
    let pids = [];
    try {
      [{ pids }] = await once(harness, 'message');
      const exited = once(harness, 'exit');
      if (reason === 'IDE切断') harness.disconnect();
      else if (reason === 'IDE通常停止') harness.kill('SIGTERM');
      else process.kill(pids[0], 'SIGTERM');
      const [exitCode] = await exited;
      assert.equal(exitCode, 0);
      for (const pid of pids) await stopped(pid);
      assert.equal(running(unrelated.pid), true);
    } finally {
      harness.kill('SIGKILL'); unrelated.kill('SIGKILL');
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
  });
}
