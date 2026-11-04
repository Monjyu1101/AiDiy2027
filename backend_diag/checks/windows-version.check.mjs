// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, stat, symlink, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {probe, resolveProgram, versionInvocation} from '../診断/probes.mjs';
import {recordProbeFailure} from '../起動/desktop-log.mjs';

async function withTree(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diag-win & spaces-'));
  try { await fn(root); } finally { await rm(root, {recursive:true, force:true}); }
}
const entry = id => ({id, commands:[id], version_args:['--version']});

test('Windows npm/npx prefer cmd over extensionless POSIX shell shims', async () => withTree(async root => {
  for (const id of ['npm','npx']) {
    await writeFile(path.join(root,id), '#!/bin/sh\nexit 99');
    await writeFile(path.join(root,`${id}.cmd`), '@echo off\nexit /b 99');
    assert.equal(await resolveProgram(entry(id), {platform:'win32', env:{Path:`"${root}"`}}), path.join(root,`${id}.cmd`));
  }
}));

test('Windows npm/npx run adjacent fixed JS via Node, never interpret wrappers or path metacharacters', async () => withTree(async root => {
  const bin = path.join(root, 'node_modules', 'npm', 'bin'); await mkdir(bin, {recursive:true});
  for (const id of ['npm','npx']) {
    const wrapper = path.join(root, `${id}.cmd`); await writeFile(wrapper, 'this wrapper must never run');
    const cli = path.join(bin, `${id}-cli.js`);
    await writeFile(cli, `if (JSON.stringify(process.argv.slice(2)) !== '["--version"]') process.exit(90); console.log(process.env.AIDIY_TEST_SECRET || '10.9.2');`);
    const invocation = await versionInvocation(entry(id), wrapper, {platform:'win32'});
    assert.deepEqual(invocation, {executable:process.execPath, args:[cli, '--version']});
    const result = await probe(entry(id), {platform:'win32', resolve:async()=>wrapper});
    assert.equal(result.状態,'OK'); assert.equal(result.バージョン,'10.9.2'); assert.equal(result.パス,wrapper);
  }
}));

test('orphan npm shim is not reported as healthy', async () => withTree(async root => {
  const wrapper = path.join(root,'npm.cmd'); await writeFile(wrapper, 'unused');
  const result = await probe(entry('npm'), {platform:'win32', resolve:async()=>wrapper});
  assert.equal(result.状態,'ERR'); assert.equal(result.バージョン,null); assert.match(result.説明,/JS CLI/);
}));

test('Python skips WindowsApps aliases and finds later Python executable', async () => withTree(async root => {
  const aliases = path.join(root,'Microsoft','WindowsApps'); const real = path.join(root,'Python');
  await mkdir(aliases,{recursive:true}); await mkdir(real);
  await writeFile(path.join(aliases,'python.exe'),'must not run'); await writeFile(path.join(real,'python.exe'),'fixture');
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PATH:`${aliases};${real}`}}),path.join(real,'python.exe'));
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PATH:aliases}}),null);
}));

test('Python launcher is fallback with fixed -3 --version; dotted executable names still resolve', async () => withTree(async root => {
  const py = path.join(root,'py.exe'); await writeFile(py,'fixture');
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PATH:root}}),py);
  assert.deepEqual(await versionInvocation(entry('python'),py,{platform:'win32'}),{executable:py,args:['-3','--version']});
  const python = path.join(root,'python3.13.exe'); await writeFile(python,'fixture');
  assert.equal(await resolveProgram({...entry('python'),commands:['python3.13']}, {platform:'win32', env:{PATH:root}}),python);
}));

test('stderr Python version, BOM and minimum version are supported', async () => withTree(async root => {
  const script = path.join(root,'python-fixture.cjs'); await writeFile(script, 'process.stderr.write("\\uFEFFPython 3.13.7\\r\\n")');
  const result = await probe({id:'python',version_args:[script],minimumVersion:'3.13'}, {resolve:async()=>process.execPath});
  assert.equal(result.状態,'注意'); assert.equal(result.バージョン,'3.13.7'); assert.match(result.説明,/判定対象外/);
}));

// Uses an existing local npm distribution only; never installs or accesses a registry.
test('real installed npm and npx CLIs accept fixed --version under isolated environment', async t => {
  let installed;
  for (const candidate of [path.join(path.dirname(process.execPath),'node_modules','npm'), path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm')]) {
    try { if ((await stat(path.join(candidate,'bin','npm-cli.js'))).isFile()) { installed=candidate; break; } } catch {}
  }
  if (!installed) { t.skip('No adjacent installed npm distribution'); return; }
  await withTree(async root => {
    await mkdir(path.join(root,'node_modules'));
    await symlink(installed,path.join(root,'node_modules','npm'),'junction');
    for (const id of ['npm','npx']) {
      const wrapper = path.join(root,`${id}.cmd`); await writeFile(wrapper,'must not execute');
      const result = await probe(entry(id), {platform:'win32', resolve:async()=>wrapper});
      assert.equal(result.状態,'OK',result.説明); assert.match(result.バージョン,/^\d+\.\d+\.\d+/);
    }
  });
});


test('failure stderr logs contain OS codes and bounded reasons, never child output or sensitive paths', async () => withTree(async root => {
  const original = process.stderr.write; const lines = [];
  process.stderr.write = function (chunk) { lines.push(String(chunk)); return true; };
  try {
    const missing = await probe(entry('python'), {resolve:async()=>path.join(root,'private-path-token','missing.exe')});
    assert.match(missing.説明,/ENOENT/);
    const script = path.join(root,'private-script-token.cjs');
    await writeFile(script, 'console.error("Authorization: Bearer private-token\\nhttps://example.invalid/?key=private-token#secret"); process.exit(7)');
    const failure = await probe({id:'uv',version_args:[script]}, {resolve:async()=>process.execPath});
    assert.equal(failure.状態,'NG');
    await writeFile(script, 'setInterval(()=>{},1000)');
    await probe({id:'python',version_args:[script]}, {resolve:async()=>process.execPath,timeout:40});
    await writeFile(script, 'console.error("private-output".repeat(10000))');
    await probe({id:'python',version_args:[script]}, {resolve:async()=>process.execPath,outputLimit:20});
  } finally { process.stderr.write = original; }
  const logs = lines.map(line => JSON.parse(line.replace(/^\[aidiy-diag:probe\] /,'')));
  assert.equal(logs.length,4);
  assert.deepEqual(logs.map(log=>log.reason),['spawn_error','nonzero_exit','timeout','output_limit']);
  assert.equal(logs[0].errorCode,'ENOENT'); assert.deepEqual(logs[0].args,['--version']);
  assert.equal(logs[1].exitCode,7); assert.equal(logs[1].signal,null);
  assert.ok(lines.every(line=>line.length<300 && line.split('\n').length===2));
  assert.ok(!lines.join('').includes('private')); assert.ok(!lines.join('').includes('Authorization')); assert.ok(!lines.join('').includes('https:'));
}));

test('Python finds python.org per-user install without PATH or launcher and handles environment casing', async () => withTree(async root => {
  const install = path.join(root, 'Programs', 'Python', 'Python313');
  await mkdir(install, {recursive:true}); await writeFile(path.join(install,'python.exe'), 'fixture');
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{localappdata:root}}), path.join(install,'python.exe'));
}));

test('Python finds all-user install, prefers newer standard folders, and never recursively scans other folders', async () => withTree(async root => {
  for (const name of ['Python 3.9','Python 3.13','Other/Python 3.99']) {
    const install = path.join(root, name); await mkdir(install,{recursive:true}); await writeFile(path.join(install,'python.exe'),'fixture');
  }
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PROGRAMFILES:root}}),path.join(root,'Python 3.13','python.exe'));
  await rm(path.join(root,'Python 3.13'),{recursive:true}); await rm(path.join(root,'Python 3.9'),{recursive:true});
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PROGRAMFILES:root}}),null);
}));

test('Python explicit PATH remains preferred over standard installs', async () => withTree(async root => {
  const install = path.join(root,'Programs','Python','Python313'); await mkdir(install,{recursive:true});
  await writeFile(path.join(install,'python.exe'),'fixture'); await writeFile(path.join(root,'python.exe'),'fixture');
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{PATH:root,LOCALAPPDATA:root}}),path.join(root,'python.exe'));
}));

test('Python standard launcher path handles case-insensitive Windows variables', async () => withTree(async root => {
  await writeFile(path.join(root,'py.exe'),'fixture');
  assert.equal(await resolveProgram(entry('python'), {platform:'win32', env:{SYSTEMROOT:root}}),path.join(root,'py.exe'));
}));


test('minimum-version warnings keep safe warning severity and do not expose raw output', async () => withTree(async root => {
  const original = process.stderr.write; const lines = [];
  process.stderr.write = function(chunk) { lines.push(String(chunk)); return true; };
  try {
    const result = await probe({id:'python',version_args:['--version'],minimumVersion:'999.0'}, {resolve:async()=>process.execPath});
    assert.equal(result.状態,'注意'); assert.equal(result.バージョン,process.versions.node);
  } finally { process.stderr.write = original; }
  const record = JSON.parse(lines[0].replace(/^\[aidiy-diag:probe\] /,''));
  assert.equal(record.reason,'below_minimum_version'); assert.equal(record.severity,'warning');
  const file=path.join(root,'warning.log'); assert.equal(recordProbeFailure(record,file),true);
  assert.match(await readFile(file,'utf8'), /"severity":"warning"/);
  assert.ok(!lines.join('').includes(process.execPath));
}));
