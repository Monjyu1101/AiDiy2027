// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// setup / BAT も Diag と同じ所有確認・移行順序・排他を使う。HTTP / UI は起動しない。
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { catalog } from '../../backend_diag/診断/probes.mjs';
import { createInstallManager } from '../../backend_diag/導入管理/導入管理.mjs';

export async function installOpenCode({ manager, write = text => process.stdout.write(text) } = {}) {
  manager ||= createInstallManager({ entries: [(await catalog()).find(entry => entry.id === 'opencode')] });
  const stop = () => { void manager.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const capability = (await manager.snapshot()).項目[0];
    const action = capability.操作.includes('再導入') ? '再導入' : capability.操作.includes('導入') ? '導入' : null;
    if (!action) { write(`OpenCode: ${capability.理由 || '所有元を確認できないため操作しません。'}\n`); return 1; }
    write(`OpenCode: ${action === '再導入' ? capability.再導入説明 : '@opencode/cli を導入します。'}\n`);
    await manager.start('opencode', action);
    while (manager.busy()) await delay(250);
    const job = (await manager.snapshot()).実行;
    write(job.ログ + '\n');
    return job.状態 === '完了' ? 0 : 1;
  } finally {
    await manager.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await installOpenCode(); }
  catch (error) { console.error(`OpenCode: ${error.message}`); process.exitCode = 1; }
}
