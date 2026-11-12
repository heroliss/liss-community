<#
.SYNOPSIS
  Download the forum's daily backups from PythonAnywhere to this PC (off-site copy).

.DESCRIPTION
  Uses the PythonAnywhere Files API. Create a token once at
  https://www.pythonanywhere.com/account/#api_token and save it (only the token) in
    $HOME\.config\liss\pythonanywhere-token.txt
  or set $env:PYTHONANYWHERE_TOKEN. The token is never printed.

  Downloads every ~/liss-backups/daily/<date>/ folder that is not yet present locally,
  plus manual *.bundle files in ~/liss-backups. Existing local files are never deleted.

.EXAMPLE
  pwsh -File scripts/pull_forum_backups.ps1 -Destination E:\Backups\liss-forum
#>
param(
    [string]$User = 'liss',
    [string]$Destination = (Join-Path $HOME 'Backups\liss-forum'),
    [string]$ApiHost = 'www.pythonanywhere.com'
)
$ErrorActionPreference = 'Stop'
$tokenFile = Join-Path $HOME '.config\liss\pythonanywhere-token.txt'
$token = $env:PYTHONANYWHERE_TOKEN
if (-not $token -and (Test-Path -LiteralPath $tokenFile)) { $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim() }
if (-not $token) { throw "缺少 PythonAnywhere API token：请保存到 $tokenFile（只放 token 本身）或设置 PYTHONANYWHERE_TOKEN。" }
$headers = @{ Authorization = "Token $token" }
$base = "https://$ApiHost/api/v0/user/$User/files/path"
$remoteRoot = "/home/$User/liss-backups"

function Get-Listing([string]$path) {
    Invoke-RestMethod -Uri ($base + $path + '/') -Headers $headers -Method Get
}
function Save-Remote([string]$path, [string]$target) {
    if (Test-Path -LiteralPath $target) { return $false }
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    $partial = "$target.partial"
    Invoke-WebRequest -Uri ($base + $path) -Headers $headers -OutFile $partial -UseBasicParsing
    Move-Item -LiteralPath $partial -Destination $target
    return $true
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$downloaded = 0
$root = Get-Listing $remoteRoot
foreach ($entry in $root.PSObject.Properties) {
    if ($entry.Value.type -eq 'file' -and $entry.Name -like '*.bundle') {
        if (Save-Remote "$remoteRoot/$($entry.Name)" (Join-Path $Destination $entry.Name)) { $downloaded++; Write-Host "下载 $($entry.Name)" }
    }
}
if ($root.PSObject.Properties.Name -contains 'daily') {
    $days = Get-Listing "$remoteRoot/daily"
    foreach ($day in $days.PSObject.Properties | Where-Object { $_.Value.type -eq 'directory' -and $_.Name -match '^\d{8}$' }) {
        $files = Get-Listing "$remoteRoot/daily/$($day.Name)"
        foreach ($file in $files.PSObject.Properties | Where-Object { $_.Value.type -eq 'file' }) {
            $target = Join-Path (Join-Path $Destination "daily\$($day.Name)") $file.Name
            if (Save-Remote "$remoteRoot/daily/$($day.Name)/$($file.Name)" $target) { $downloaded++; Write-Host "下载 daily/$($day.Name)/$($file.Name)" }
        }
    }
}
Write-Host "完成：新下载 $downloaded 个文件，保存在 $Destination"
