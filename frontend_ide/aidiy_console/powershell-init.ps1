# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
param([Parameter(Mandatory=$true)][string]$CliOptionsJson)

# Only this terminal session is changed; the user's profile is not written.
# Align the console and native-command pipeline with the ConPTY UTF-8 stream.
# Initialize before PSReadLine so completion errors do not leave the old encoding.
$AiDiyUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $AiDiyUtf8
[Console]::OutputEncoding = $AiDiyUtf8
$global:OutputEncoding = $AiDiyUtf8
Import-Module PSReadLine -ErrorAction Stop
$global:AiDiyCliOptions = @{}
($CliOptionsJson | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $global:AiDiyCliOptions[$_.Name] = $_.Value }
$global:AiDiyOriginalTabHandler = Get-PSReadLineKeyHandler -Bound | Where-Object { $_.Key -eq 'Tab' } | Select-Object -First 1
Set-PSReadLineKeyHandler -Key Tab -BriefDescription AiDiyCliCompletion -ScriptBlock {
    param($key, $arg)
    $line = ''
    $cursor = 0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
    if ($cursor -eq $line.Length -and $line -cmatch '^([a-z_]+) *$' -and $global:AiDiyCliOptions.ContainsKey($Matches[1])) {
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
