# End-to-end test of the DSWM WebUI API surface.
# Uses a throwaway pending item so no real memory entry is touched.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base = 'http://127.0.0.1:3080/dswm/api'
$json = 'application/json; charset=utf-8'

function Post($route, $payload) {
    $body = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6))
    Invoke-RestMethod -Uri "$base/$route" -Method Post -Body $body -ContentType $json -TimeoutSec 20
}

Write-Output '=== 1. create (pending) ==='
$c = Post 'create' @{
    kind    = 'pending'
    title   = 'WebUI 链路测试-临时条目'
    summary = '端到端测试用，稍后归档'
    content = "# WebUI 链路测试-临时条目`n`n这是 UI 面板 create 流程写下的正文。`n"
}
Write-Output ("create ok={0} file={1} git={2}" -f $c.ok, $c.file, $c.git)
$file = $c.file

Write-Output '=== 2. verify on disk ==='
$pendingPath = Join-Path $env:DSH_HOME "workspace\pending\$file"
Write-Output ("pending file exists = {0}" -f (Test-Path $pendingPath))
$agents = Get-Content (Join-Path $env:DSH_HOME 'AGENTS.md') -Raw -Encoding UTF8
Write-Output ("AGENTS.md contains new row = {0}" -f ($agents -match [regex]::Escape($file)))

Write-Output '=== 3. get ==='
$g = Invoke-RestMethod -Uri "$base/get?kind=pending&file=$([uri]::EscapeDataString($file))" -TimeoutSec 20
Write-Output ("get ok={0} indexed={1} date={2} contentChars={3}" -f $g.ok, $g.indexed, $g.date, $g.content.Length)

Write-Output '=== 4. save (edit body + summary + title rename) ==='
$s = Post 'save' @{
    kind    = 'pending'
    file    = $file
    title   = 'WebUI 链路测试-已改名'
    summary = '改名与正文更新后的摘要'
    date    = $g.date
    content = "# WebUI 链路测试-已改名`n`n正文已通过 save 流程更新。`n`n- 第二行`n"
}
Write-Output ("save ok={0} file={1} renamed={2} git={3}" -f $s.ok, $s.file, $s.renamed, $s.git)
$newFile = $s.file

Write-Output '=== 5. verify rename + index rewrite ==='
Write-Output ("old file gone = {0}" -f (-not (Test-Path $pendingPath)))
$newPath = Join-Path $env:DSH_HOME "workspace\pending\$newFile"
Write-Output ("new file exists = {0}" -f (Test-Path $newPath))
if (Test-Path $newPath) { Write-Output ("new file bytes = {0}" -f (Get-Item $newPath).Length) }
$agents2 = Get-Content (Join-Path $env:DSH_HOME 'AGENTS.md') -Raw -Encoding UTF8
Write-Output ("index has new name = {0}" -f ($agents2 -match [regex]::Escape($newFile)))
Write-Output ("index lost old name = {0}" -f (-not ($agents2 -match [regex]::Escape($file))))

Write-Output '=== 6. archive (cleanup) ==='
$a = Post 'archive' @{ kind = 'pending'; file = $newFile }
Write-Output ("archive ok={0} archived={1} git={2}" -f $a.ok, $a.archived, $a.git)
Write-Output ("pending now empty = {0}" -f (-not (Test-Path $newPath)))
$archivePath = Join-Path $env:DSH_HOME "workspace\archive\$($a.archived)"
Write-Output ("archived file exists = {0}" -f (Test-Path $archivePath))
$agents3 = Get-Content (Join-Path $env:DSH_HOME 'AGENTS.md') -Raw -Encoding UTF8
Write-Output ("index row removed = {0}" -f (-not ($agents3 -match [regex]::Escape($newFile))))

Write-Output '=== 7. memory-log tail ==='
Get-Content (Join-Path $env:DSH_HOME 'workspace\memory-log.md') -Tail 4 -Encoding UTF8 | ForEach-Object { Write-Output "  $_" }

Write-Output '=== 8. git log ==='
git -C (Join-Path $env:DSH_HOME 'workspace') --no-pager log --oneline -4
