import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellHistory } from '../aidiy_console/shell-history.mjs';

test('shell history is isolated by project without changing HOME', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-shell-'));
  try {
    for (const [shell, args] of [['/bin/bash', ['--noprofile', '--norc']], ['/bin/zsh', ['-d']], ['/bin/sh', []]]) {
      const env = { HOME: '/unchanged-auth-home', SHELL: shell, HISTFILE: '/forbidden-history' };
      const a = await shellHistory(join(root, 'a'), env, 'linux');
      const b = await shellHistory(join(root, 'b'), env, 'linux');
      assert.notEqual(a.env.HISTFILE, b.env.HISTFILE);
      assert.equal(a.env.HOME, env.HOME);
      assert.equal(env.HISTFILE, '/forbidden-history');
      assert.ok(a.env.HISTFILE.startsWith(join(root, 'a/_AIDIY/aidiy_console/')));
      assert.deepEqual(a.args, args);
      assert.equal(a.env.ENV, '');
    }
    const windows = await shellHistory(root, { USERPROFILE: '/unchanged' }, 'win32');
    assert.equal(windows.env.HISTFILE, join(root, '_AIDIY/aidiy_console/powershell_history'));
    await assert.rejects(shellHistory(root, { SHELL: '/bin/fish' }, 'linux'), /未対応/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash/zsh persist history in the project, never the supplied HOME', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readFile, readdir, mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'aidiy-real-history-'));
  try {
    const home = join(root, 'home'); await mkdir(home);
    for (const shell of ['/bin/bash', '/usr/bin/zsh']) {
      if (spawnSync(shell, ['--version']).error?.code === 'ENOENT') continue;
      const history = await shellHistory(join(root, 'project'), { ...process.env, HOME: home, SHELL: shell }, 'linux');
      const result = spawnSync(shell, [...history.args, '-i'], { env: history.env, input: 'echo HISTORY_MARKER\nexit\n', encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(await readFile(history.env.HISTFILE, 'utf8'), /HISTORY_MARKER/);
      assert.deepEqual(await readdir(home), []);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
