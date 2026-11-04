# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

param([ValidateSet('Both', 'Code', 'Live')][string]$Scenario = 'Both')
$ErrorActionPreference = 'Stop'
$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = Join-Path $extensionRoot 'out/extension-host'
New-Item -ItemType Directory -Force -Path "$testRoot/user-data/User", "$testRoot/extensions", "$testRoot/workspace" | Out-Null
$settings = '{"security.workspace.trust.enabled":false,"workbench.startupEditor":"none","telemetry.telemetryLevel":"off","update.mode":"none"}'
[IO.File]::WriteAllText("$testRoot/user-data/User/settings.json", $settings, [Text.UTF8Encoding]::new($false))
$codeCmd = (Get-Command code.cmd).Source
$codeExe = Join-Path (Split-Path (Split-Path $codeCmd -Parent) -Parent) 'Code.exe'
$resultPath = Join-Path $testRoot ('result-' + [guid]::NewGuid().ToString('N') + '.txt')
$oldResult = $env:AIDIY_TEST_RESULT
$oldElectron = $env:ELECTRON_RUN_AS_NODE
$oldScenario = $env:AIDIY_TEST_SCENARIO
try {
    $env:AIDIY_TEST_RESULT = $resultPath
    $env:ELECTRON_RUN_AS_NODE = $null
    $env:AIDIY_TEST_SCENARIO = $Scenario
    $arguments = @(
        '--new-window', '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes',
        "--user-data-dir=$testRoot/user-data", "--extensions-dir=$testRoot/extensions",
        "--extensionTestsPath=$extensionRoot/checks/extension-host.cjs",
        "$testRoot/workspace"
    )
    if ($Scenario -ne 'Live') { $arguments += "--extensionDevelopmentPath=$extensionRoot" }
    if ($Scenario -ne 'Code') { $arguments += "--extensionDevelopmentPath=$extensionRoot/aidiy_live" }
    $arguments = $arguments | ForEach-Object { '"' + $_ + '"' }
    $testProcess = Start-Process -FilePath $codeExe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput "$testRoot/stdout.log" -RedirectStandardError "$testRoot/stderr.log"
    if (-not $testProcess.WaitForExit(60000)) {
        & "$env:SystemRoot/System32/taskkill.exe" /PID $testProcess.Id /T /F | Out-Null
        throw 'Extension Host test timed out. See out/extension-host logs.'
    }
    if (-not (Test-Path -LiteralPath $resultPath)) {
        Get-Content -LiteralPath "$testRoot/stdout.log", "$testRoot/stderr.log" -Encoding UTF8 -Tail 20
        throw 'Extension Host test did not complete.'
    }
    Get-Content -LiteralPath $resultPath -Encoding UTF8
} finally {
    $env:AIDIY_TEST_RESULT = $oldResult
    $env:ELECTRON_RUN_AS_NODE = $oldElectron
    $env:AIDIY_TEST_SCENARIO = $oldScenario
}
