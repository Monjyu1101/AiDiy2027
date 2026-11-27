# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
param([Parameter(Mandatory=$true)][string]$CliOptionsJson)

# Only this terminal session is changed; the user's profile is not written.
# Align the term and native-command pipeline with the ConPTY UTF-8 stream.
# Initialize before PSReadLine so completion errors do not leave the old encoding.
$AiDiyUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $AiDiyUtf8
[Console]::OutputEncoding = $AiDiyUtf8
$global:OutputEncoding = $AiDiyUtf8
Import-Module PSReadLine -ErrorAction Stop
Set-PSReadLineOption -HistorySavePath $env:HISTFILE
# Command start / exit markers (OSC 133;C and 133;D;<code>) for the folded Term icon.
# Empty lines emit nothing, so an idle prompt never looks like a finished command.
$global:AiDiyOsc = [string][char]27 + ']133;'
$global:AiDiyBell = [string][char]7
$global:AiDiyCommandPending = $false
$global:AiDiyOriginalReadLine = $function:PSConsoleHostReadLine
function global:PSConsoleHostReadLine {
    $line = & $global:AiDiyOriginalReadLine
    if ($line -is [string] -and $line.Trim()) {
        $global:AiDiyCommandPending = $true
        $global:AiDiyExitBefore = $global:LASTEXITCODE
        [Console]::Write($global:AiDiyOsc + 'C' + $global:AiDiyBell)
    }
    $line
}
$global:AiDiyOriginalPrompt = $function:prompt
function global:prompt {
    # $? must be read first; any statement before it would overwrite the result.
    $succeeded = $?
    if ($global:AiDiyCommandPending) {
        $global:AiDiyCommandPending = $false
        $code = 0
        if (-not $succeeded) {
            $code = 1
            if ($global:LASTEXITCODE -is [int] -and $global:LASTEXITCODE -ne 0 -and $global:LASTEXITCODE -ne $global:AiDiyExitBefore) { $code = $global:LASTEXITCODE }
        }
        [Console]::Write($global:AiDiyOsc + 'D;' + $code + $global:AiDiyBell)
    }
    & $global:AiDiyOriginalPrompt
}
$global:AiDiyCliOptions = @{}
($CliOptionsJson | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $global:AiDiyCliOptions[$_.Name] = $_.Value }
$global:AiDiyOriginalTabHandler = Get-PSReadLineKeyHandler -Bound | Where-Object { $_.Key -eq 'Tab' } | Select-Object -First 1
Set-PSReadLineKeyHandler -Key Tab -BriefDescription AiDiyCliCompletion -ScriptBlock {
    param($key, $arg)
    $line = ''
    $cursor = 0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
    if ($cursor -eq $line.Length -and $line -cmatch '^(agy\.exe|[a-z_]+) *$' -and $global:AiDiyCliOptions.ContainsKey($Matches[1])) {
        [Microsoft.PowerShell.PSConsoleReadLine]::Insert((' ' * [int](-not $line.EndsWith(' '))) + $global:AiDiyCliOptions[$Matches[1]])
        return
    }
    # Preserve the profile's existing completion binding for other input.
    if ($global:AiDiyOriginalTabHandler.ScriptBlock) {
        & $global:AiDiyOriginalTabHandler.ScriptBlock $key $arg
    } elseif ($global:AiDiyOriginalTabHandler.Function) {
        $function = $global:AiDiyOriginalTabHandler.Function
        [Microsoft.PowerShell.PSConsoleReadLine]::$function($key, $arg)
    } else {
        [Microsoft.PowerShell.PSConsoleReadLine]::TabCompleteNext($key, $arg)
    }
}
