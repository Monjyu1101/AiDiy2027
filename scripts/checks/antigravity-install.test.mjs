import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {catalog,resolveProgram,probe} from '../../backend_diag/診断/probes.mjs';

const bat = name => readFile(new URL(`../cli_bat/${name}`,import.meta.url));
test('BAT entry points use the isolated installer, retain asynchronous launch and CRLF',async()=>{
  for(const name of ['__install_cli.bat','_antigravity_cli.bat','install_antigravity.bat']){
    const bytes=await bat(name);assert.ok([...bytes].every(b=>b<128),'ASCII is CP932 compatible');
    assert.doesNotMatch(bytes.toString().replaceAll('\r\n',''),/\n/);
  }
  const all=(await bat('__install_cli.bat')).toString();
  assert.match(all,/^start "Antigravity CLI installer" cmd \/d \/s \/c ""%~dp0install_antigravity\.bat""$/m);
  assert.doesNotMatch(all,/antigravity\.google|aidiy_agy_install/);
  assert.match((await bat('_antigravity_cli.bat')).toString(),/call "%~dp0install_antigravity\.bat" \/no-pause/);
});
test('official installer invocation has no chained command, cleanup cannot hide its exit code',async()=>{
  const source=(await bat('install_antigravity.bat')).toString();
  const line=source.split(/\r?\n/).find(l=>l.startsWith('cmd.exe '));
  assert.equal(line,'cmd.exe /d /v:off /s /c ""%INSTALLER%""');
  assert.doesNotMatch(line,/[&|;<>^]/);
  assert.match(source,/set "EXIT_CODE=%ERRORLEVEL%"/);
  assert.match(source,/if not exist "%LOCALAPPDATA%\\agy\\bin\\agy.exe"/);
  assert.match(source,/mkdir "%CANDIDATE%"[^\r\n]*\r\nif errorlevel 1 goto CREATE_TEMP/);
  assert.match(source,/%RANDOM%-%RANDOM%/);assert.match(source,/GTR 10 goto FAILED/);
  assert.match(source,/if \/I not "%NO_PAUSE%"=="\/no-pause" pause/);
  assert.match(source,/endlocal & exit \/b %EXIT_CODE%/);
  assert.doesNotMatch(source,/rmdir \/s|agy\.exe" --version/);
});
test('Diag finds standard Windows agy without PATH and never executes it',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'agy path with spaces-'));
  try{
    const entry=(await catalog()).find(e=>e.id==='agy');
    const exe=path.join(root,'agy','bin','agy.exe');await mkdir(path.dirname(exe),{recursive:true});await writeFile(exe,'not an executable');
    assert.equal(await resolveProgram(entry,{platform:'win32',env:{LOCALAPPDATA:root,PATH:''}}),exe);
    assert.equal((await probe(entry,{platform:'win32',resolve:async()=>exe})).状態,'OK');
    await rm(exe);assert.equal(await resolveProgram(entry,{platform:'win32',env:{LOCALAPPDATA:root,PATH:''}}),null);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Windows CMD reproduces official guard and isolated invocation preserves spaces and exit code',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'agy guard with spaces-'));
  try{
    const file=path.join(root,'fixture.cmd');
    // Only the official early guard is simulated. No installer, network or agy executes.
    await writeFile(file,'@echo off\r\nsetlocal enabledelayedexpansion\r\nset "CMD_LINE=!CMDCMDLINE!"\r\necho(!CMD_LINE! | findstr /c:"&" /c:"|" /c:";" /c:"<" /c:">" /c:"^" >nul 2>&1\r\nif !ERRORLEVEL! equ 0 exit /b 1\r\nexit /b 7\r\n');
    const cmd=process.env.ComSpec||'cmd.exe';
    const run=command=>spawnSync(cmd,['/d','/v:off','/s','/c',command],{windowsVerbatimArguments:true,encoding:'utf8'});
    const old=run(`"call "${file}" && echo unexpected"`);assert.equal(old.error,undefined);assert.equal(old.status,1);
    const isolated=run(`""${file}""`);assert.equal(isolated.error,undefined);assert.equal(isolated.status,7);
  }finally{await rm(root,{recursive:true,force:true});}
});
