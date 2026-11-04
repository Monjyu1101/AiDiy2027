# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

param(
    [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$extensionRoot = $PSScriptRoot
$projectRoot = (Resolve-Path -LiteralPath $ProjectPath).Path
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    throw 'ProjectPath must be a folder.'
}
if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot 'dist/extension.js')) -or -not (Test-Path -LiteralPath (Join-Path $extensionRoot 'aidiy_live/dist/extension.js'))) {
    Push-Location -LiteralPath $extensionRoot
    try {
        & npm.cmd run compile
        if ($LASTEXITCODE -ne 0) { throw 'Compile failed. Run npm ci in frontend_ide/host first.' }
    } finally { Pop-Location }
}
Write-Host "Project folder: $projectRoot"
Write-Host 'Open the chat with: AiDiy Code: チャットを開く'
Write-Host 'Open live voice with: AiDiy Live: ライブ会話を開く'
# 通常の VS Code が同じフォルダを開いていても、試用ホストで確実に開く。
$tryProfile = Join-Path $extensionRoot 'out/manual-profile'
& code.cmd --new-window --skip-welcome --skip-release-notes "--user-data-dir=$tryProfile" "--extensionDevelopmentPath=$extensionRoot" "--extensionDevelopmentPath=$extensionRoot/aidiy_live" $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not start VS Code.' }
