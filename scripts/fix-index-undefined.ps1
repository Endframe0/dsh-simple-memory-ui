# Repair AGENTS.md index rows whose kind got rendered as "undefined".
# Root cause: readIndex() produced rows without a `kind`, so writeIndex() re-rendered
# every row as ~/.dsh/workspace/undefined/<file>.md. The kind is recoverable from the
# row's LEFT-TO-RIGHT position and from which directory actually holds the file.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$dshHome = $env:DSH_HOME
$agents  = Join-Path $dshHome 'AGENTS.md'
$ws      = Join-Path $dshHome 'workspace'

# 1. Back up the damaged index.
$backup = "$agents.dswm-corrupt-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $agents $backup -Force
Write-Output "backup -> $backup"

# 2. Which of the two kinds actually holds each file on disk?
function Resolve-Kind([string]$file) {
    if (Test-Path (Join-Path $ws "reference\$file")) { return 'reference' }
    if (Test-Path (Join-Path $ws "pending\$file"))   { return 'pending' }
    return $null
}

# 3. Rewrite only the "undefined" occurrences, per row, using the filename on that row.
$lines = Get-Content $agents -Encoding UTF8
$fixed = 0
$unresolved = @()
$out = foreach ($line in $lines) {
    if ($line -notmatch '~/.dsh/workspace/undefined/(.+?)\.md') { $line; continue }
    $file = "$($Matches[1]).md"
    $kind = Resolve-Kind $file
    if ($null -eq $kind) { $unresolved += $file; $line; continue }
    $fixed++
    $line -replace [regex]::Escape('~/.dsh/workspace/undefined/'), "~/.dsh/workspace/$kind/"
}
[System.IO.File]::WriteAllLines($agents, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "repaired rows = $fixed"
if ($unresolved.Count -gt 0) { Write-Output "UNRESOLVED (no file on disk): $($unresolved -join ', ')" }

# 4. Verify.
$raw = Get-Content $agents -Raw -Encoding UTF8
Write-Output ("remaining 'undefined' occurrences = {0}" -f ([regex]::Matches($raw, 'workspace/undefined/')).Count)
Write-Output "=== index rows now ==="
Select-String -Path $agents -Pattern '^- \[' -Encoding UTF8 | ForEach-Object { Write-Output "  $($_.Line)" }
