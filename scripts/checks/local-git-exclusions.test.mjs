// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewAllowed } from '../../frontend_ide/viewer/preview.mjs';
import { routesFor } from '../../frontend_ide/viewer/vue-preview.mjs';

test('Git管理情報をプレビュー配信しない', () => {
  for (const path of ['.git_local/config', 'nested/.git_local/objects/a', '.git/config']) {
    assert.equal(previewAllowed(path), false);
  }
  assert.equal(previewAllowed('ordinary/file.html'), true);
});

test('Vueルート探索は .git_local 内の参照を読まない', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aidiy-local-git-scan-'));
  try {
    const src = join(root, 'frontend_web/src');
    await mkdir(join(src, 'router/.git_local'), { recursive: true });
    await writeFile(join(src, 'Target.vue'), '<template>target</template>');
    await writeFile(join(src, 'router/index.ts'), "const r = [{path:'/normal', component: () => import('../Target.vue')}];");
    await writeFile(join(src, 'router/.git_local/index.ts'), "const r = [{path:'/metadata', component: () => import('../../Target.vue')}];");
    const routes = await routesFor(root, 'frontend_web/src/Target.vue');
    assert.equal(routes.length, 1);
    assert.equal(routes[0], '/normal');
  } finally { await rm(root, { recursive: true, force: true }); }
});
