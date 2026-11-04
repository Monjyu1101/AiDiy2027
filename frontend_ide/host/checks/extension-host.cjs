/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

const assert = require('node:assert/strict');
const vscode = require('vscode');
const { writeFileSync } = require('node:fs');
exports.run = async () => {
  const scenario = process.env.AIDIY_TEST_SCENARIO || 'Both';
  const code = vscode.extensions.getExtension('aidiy.aidiy-code');
  const live = vscode.extensions.getExtension('aidiy.aidiy-live');
  if (scenario !== 'Live') {
    assert.ok(code, 'Code 拡張が登録されている'); await code.activate(); assert.ok(code.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['open', 'newChat', 'attachSelection', 'settings', 'terminal']) assert.ok(commands.includes(`aidiyHermes.${command}`), command);
    await vscode.commands.executeCommand('aidiyHermes.open');
    await vscode.commands.executeCommand('aidiyHermes.newChat');
  } else assert.equal(code, undefined, 'Code なしで Live が動く');
  if (scenario !== 'Code') {
    assert.ok(live, 'Live 拡張が登録されている'); await live.activate(); assert.ok(live.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['open', 'stop', 'settings', 'standalone']) assert.ok(commands.includes(`aidiyLive.${command}`), command);
    assert.ok(!live.packageJSON.extensionDependencies?.length, 'Code への依存なし');
    await vscode.commands.executeCommand('aidiyLive.open');
    const deadline = Date.now() + 12000;
    while (!live.exports.getState().ready && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(live.exports.getState().ready, 'Live の Webview スクリプトと CSP が動作している');
    await vscode.commands.executeCommand('aidiyLive.stop');
  } else assert.equal(live, undefined, 'Live なしで Code が動く');
  if (scenario === 'Both') {
    assert.notEqual(code.id, live.id);
    assert.notEqual(code.packageJSON.contributes.viewsContainers.secondarySidebar[0].id, live.packageJSON.contributes.viewsContainers.secondarySidebar[0].id);
  }
  if (process.env.AIDIY_TEST_RESULT) writeFileSync(process.env.AIDIY_TEST_RESULT, `extension host (${scenario}): passed\n`);
};
