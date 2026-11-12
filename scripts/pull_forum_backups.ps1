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
$script:downloaded = 0
function Pull-Tree([string]$remote, [string]$local) {
    $listing = Get-Listing $remote
    foreach ($entry in $listing.PSObject.Properties) {
        if ($entry.Name.StartsWith('.') -or $entry.Name.EndsWith('.partial') -or $entry.Name -like '*.log') { continue }
        $childRemote = "$remote/$($entry.Name)"; $childLocal = Join-Path $local $entry.Name
        if ($entry.Value.type -eq 'directory') { Pull-Tree $childRemote $childLocal }
        elseif (Save-Remote $childRemote $childLocal) { $script:downloaded++; Write-Host "下载 $($childRemote.Substring($remoteRoot.Length + 1))" }
    }
}
# Manual *.bundle backups and the daily/<date>/ folders (bundles are folders too).
$root = Get-Listing $remoteRoot
foreach ($entry in $root.PSObject.Properties) {
    if ($entry.Name -like '*.bundle' -or $entry.Name -eq 'daily') {
        if ($entry.Value.type -eq 'directory') { Pull-Tree "$remoteRoot/$($entry.Name)" (Join-Path $Destination $entry.Name) }
        elseif (Save-Remote "$remoteRoot/$($entry.Name)" (Join-Path $Destination $entry.Name)) { $script:downloaded++ }
    }
}
Write-Host "完成：新下载 $script:downloaded 个文件，保存在 $Destination"
