// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
test('Avatar does not own Task/Team screens, launch menus or API clients', () => {
  for (const category of ['AIタスク', 'AIチーム']) assert.equal(fs.existsSync(path.join(root, 'src/components', category)), false);
  for (const file of ['src/AiDiy.vue', 'src/components/AIコア.vue']) assert.doesNotMatch(read(file), /AIタスク|AIチーム|openTask|openTeam|showTaskButton|showTeamButton/);
  assert.doesNotMatch(read('src/api/client.ts'), /taskClient|teamClient|TASKTEAM/);
  for (const file of ['vite.config.ts', 'vite.config.mts']) assert.doesNotMatch(read(file), /['"]\/(?:task|team)['"]|mermaid/);
});
test('Avatar preserves its 3D core dependencies and standalone screens remain available', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies.three);
  assert.ok(pkg.dependencies['@pixiv/three-vrm']);
  assert.equal(pkg.dependencies.mermaid, undefined);
  for (const kind of ['task', 'team']) assert.ok(fs.existsSync(path.join(root, '../frontend_ide', `aidiy_${kind}`)));
});
