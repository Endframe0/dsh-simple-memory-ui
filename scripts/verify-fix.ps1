# Verify the fixed save path never emits "workspace/undefined" into AGENTS.md.
# Creates a throwaway pending item, edits it (forcing a full index re-render),
# checks the index after each write, then archives it away.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$base = 'http://127.0.0.1:3080/dswm/api'
$json = 'application/json; charset=utf-8'
$agents = Join-Path $env:DSH_HOME 'AGENTS.md'

function Post($route, $payload) {
    $body = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6))
    Invoke-RestMethod -Uri "$base/$route" -Method Post -Body $body -ContentType $json -TimeoutSec 20
}
function IndexHasUndefined {
    (Get-Content $agents -Raw -Encoding UTF8) -match 'workspace/undefined'
}
function IndexRowCount {
    # count only the index rows (lines starting with "- [")
    ([regex]::Matches((Get-Content $agents -Raw -Encoding UTF8), '(?m)^- \[')).Count
}

Write-Output ("baseline: rows={0} hasUndefined={1}" -f (IndexRowCount), (IndexHasUndefined))

Write-Output '=== create ==='
$c = Post 'create' @{
    kind    = 'pending'
    title   = '修复验证-临时'
    summary = '验证 undefined 修复'
    content = "# 修复验证-临时`n`n临时内容。`n"
}
Write-Output ("create file={0}" -f $c.file)
Write-Output ("  after create: rows={0} hasUndefined={1}" -f (IndexRowCount), (IndexHasUndefined))

Write-Output '=== save (forces full index re-render) ==='
$s = Post 'save' @{
    kind    = 'pending'
    file    = $c.file
    title   = '修复验证-临时改名'
    summary = '改名后摘要'
    date    = '2026-09-10'
    content = "# 修复验证-临时改名`n`n正文已更新。`n"
}
Write-Output ("save file={0} renamed={1}" -f $s.file, $s.renamed)
$after = IndexHasUndefined
Write-Output ("  after save: rows={0} hasUndefined={1}" -f (IndexRowCount), $after)
if ($after) { Write-Output '  !!! REGRESSION: undefined is still being written' } else { Write-Output '  OK: no undefined written' }

Write-Output '=== index rows right now ==='
Select-String -Path $agents -Pattern '^- \[' -Encoding UTF8 | ForEach-Object { Write-Output ("  " + $_.Line) }

Write-Output '=== cleanup: archive the test item ==='
$a = Post 'archive' @{ kind = 'pending'; file = $s.file }
Write-Output ("archive archived={0}" -f $a.archived)
Write-Output ("final: rows={0} hasUndefined={1}" -f (IndexRowCount), (IndexHasUndefined))
