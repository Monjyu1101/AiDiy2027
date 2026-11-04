// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const web = fileURLToPath(new URL('../', import.meta.url));
const source = (name) => readFile(path.join(web, name), 'utf8');

test('WebのTask/Teamルート・メニュー・単体表示分岐を持たない', async () => {
  for (const name of ['src/router/coreRouter.ts', 'src/components/_TopMenu.vue', 'src/App.vue']) {
    assert.doesNotMatch(await source(name), /AIタスク|AIチーム/);
  }
  const routes = await source('src/router/coreRouter.ts');
  assert.match(routes, /path: '\/AiDiy'/);
  assert.match(routes, /path: '\/C管理'/);
  assert.match(await source('src/components/_TopMenu.vue'), /to="\/メニュー"/);
});

test('Web実装・専用proxy・専用依存を残さない', async () => {
  const dirs = await readdir(path.join(web, 'src/components'));
  assert.ok(!dirs.includes('AIタスク') && !dirs.includes('AIチーム'));
  const vite = await source('vite.config.ts');
  assert.doesNotMatch(vite, /PORT_TASKTEAM|['"]\/(?:task|team)['"]/);
  assert.match(vite, /'\/core'/);
  assert.match(vite, /'\/apps'/);
  const pkg = JSON.parse(await source('package.json'));
  const lock = JSON.parse(await source('package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const name of ['three', 'mermaid', '@types/three']) {
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined);
    assert.equal(lock.packages[`node_modules/${name}`], undefined);
  }
});

test('Webの既存ルートimportは存在し、独立版・共通バックエンド・Avatar本体は残る', async () => {
  for (const name of ['index.ts', 'coreRouter.ts', 'appsRouter.ts']) {
    const route = await source(`src/router/${name}`);
    for (const match of route.matchAll(/(?:import\(|from\s+)["']([^"']+\.vue)["']/g)) {
      await access(path.resolve(web, 'src/router', match[1]));
    }
  }
  for (const app of ['frontend_ide/src/components/タスクチーム', 'frontend_avatar/src/AiDiy.vue', 'frontend_avatar/src/components/AIコア.vue', 'backend_taskteam/taskteam_main.py']) {
    await access(path.resolve(web, '..', app));
  }
});
