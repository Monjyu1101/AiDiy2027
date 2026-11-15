// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCommandFoldTone} from '../src/components/ターミナル/折畳配色.js';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('実行中に折畳むとシアン脈動、そのまま終了したら終了コード0で緑・0以外で赤、展開で解除',()=>{
 for(const [code,expected] of [['0','success'],['3','failure'],['-1','failure']]){
  const fold=createCommandFoldTone();
  assert.equal(fold.marker('C'),true);
  fold.collapsed(true);assert.equal(fold.tone.value,'online');
  fold.marker('D;'+code);assert.equal(fold.tone.value,expected);
  fold.collapsed(false);assert.equal(fold.tone.value,'');
 }
});
test('未実行で折畳んだ場合は色を付けず、折畳中の開始・終了でも色を付けない',()=>{
 const fold=createCommandFoldTone();
 fold.collapsed(true);assert.equal(fold.tone.value,'');
 fold.marker('C');assert.equal(fold.tone.value,'');
 fold.marker('D;0');assert.equal(fold.tone.value,'');
});
test('展開中に終わったコマンドは色に残らない。次の折畳は実行状態で判定する',()=>{
 const fold=createCommandFoldTone();
 fold.marker('C');fold.marker('D;1');fold.collapsed(true);assert.equal(fold.tone.value,'');
 fold.collapsed(false);fold.marker('C');fold.collapsed(true);assert.equal(fold.tone.value,'online');
});
test('シェル終了・再接続・不正な終了コード',()=>{
 const fold=createCommandFoldTone();
 fold.marker('C');fold.collapsed(true);fold.shellExited(0);assert.equal(fold.tone.value,'success');
 fold.reset();assert.equal(fold.tone.value,'');assert.equal(fold.running,false);
 fold.marker('C');fold.collapsed(true);fold.marker('D;');assert.equal(fold.tone.value,'failure');
 fold.collapsed(false);fold.shellExited(1);assert.equal(fold.tone.value,'');
});
test('Termパネルは OSC 133 を受け取り、折畳ボタンへ tone を渡す',()=>{
 const panel=read('../src/components/ターミナル/ターミナルパネル.vue');
 assert.match(panel,/terminal\.parser\.registerOscHandler\(133, foldTone\.marker\)/);
 assert.match(panel,/watch\(panelCollapsed, collapsed => foldTone\.collapsed\(collapsed\)\)/);
 assert.match(panel,/<PanelToggle :collapsed="panelCollapsed" :tone="foldTone\.tone\.value \|\| undefined"/);
 assert.match(panel,/osc\?\.dispose\(\)/);
 const toggle=read('../src/components/コード/パネル表示切替.vue');
 assert.match(toggle,/\.code-panel-mark\.tone-success\{background:#00a83a\}/);
 assert.match(toggle,/\.code-panel-mark\.tone-failure\{background:#d81f2a\}/);
});
test('PowerShell初期化は実行した行だけ開始・終了コードを出し、空のプロンプトでは出さない',{skip:process.platform!=='win32'},()=>{
 const script=fileURLToPath(new URL('../aidiy_term/powershell-init.ps1',import.meta.url)).replaceAll("'","''");
 // 対話入力（PSConsoleHostReadLine）の代わりに、入力確定時と同じ変数を設定してから prompt を呼ぶ。
 const accept="$global:AiDiyCommandPending=$true; $global:AiDiyExitBefore=$global:LASTEXITCODE;";
 const command=[
  `$env:HISTFILE=Join-Path $env:TEMP 'aidiy_term_fold_tone_history.txt';`,
  `. '${script}' -CliOptionsJson '{}';`,
  `${accept} cmd /c exit 0; prompt | Out-Null; [Console]::Write('|');`,
  `${accept} cmd /c exit 3; prompt | Out-Null; [Console]::Write('|');`,
  `${accept} Get-Item 'C:\\aidiy-missing-path' -ErrorAction SilentlyContinue; prompt | Out-Null; [Console]::Write('|');`,
  `prompt | Out-Null; [Console]::Write('END')`,
 ].join(' ');
 const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stderr);
 const marker=code=>`\x1b]133;D;${code}\x07`;
 assert.equal(result.stdout,`${marker(0)}|${marker(3)}|${marker(1)}|END`);
 const init=read('../aidiy_term/powershell-init.ps1');
 assert.match(init,/function global:PSConsoleHostReadLine/);
 assert.match(init,/\$line -is \[string\] -and \$line\.Trim\(\)/);
});
