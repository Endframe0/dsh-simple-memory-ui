# Verify the DSWM memory panel in the real GUI: open Settings -> 记忆管理,
# measure the layout, screenshot, then close the session.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Obs($s) { bsk observe --session $s 2>&1 }
function RefOf($s, $pattern) {
    $o = Obs $s
    $m = $o | Select-String -Pattern $pattern | Select-Object -First 1
    if ($m) { return ($m.Line -replace '.*?(@e\d+).*', '$1') }
    return $null
}
function HasDialog($s) { [bool]((Obs $s) | Select-String -Pattern 'dialog "设置"' -Quiet) }

$s = (bsk session start --no-focus 2>&1 | Select-Object -First 1).Trim()
Write-Output "session = $s"
bsk navigate "http://127.0.0.1:3080" --session $s 2>&1 | Select-Object -First 1
Start-Sleep -Milliseconds 3000

# 1. sidebar
$r = RefOf $s '打开侧边栏'
if ($r) { bsk click --ref $r --session $s 2>&1 | Out-Null; Start-Sleep -Milliseconds 1200 }
Write-Output "sidebar ref = $r"

# 2. settings (retry once: the rail may need a beat to render)
$opened = $false
for ($i = 1; $i -le 3 -and -not $opened; $i++) {
    $r = RefOf $s 'button "设置'
    if (-not $r) { Start-Sleep -Milliseconds 800; continue }
    bsk click --ref $r --session $s 2>&1 | Out-Null
    Start-Sleep -Milliseconds 1500
    $opened = HasDialog $s
    Write-Output "settings attempt $i ref=$r dialogOpen=$opened"
}
if (-not $opened) { Write-Output 'FAILED to open settings dialog'; bsk session stop $s 2>&1 | Out-Null; exit 1 }

# 3. memory tab
$r = RefOf $s '记忆管理'
Write-Output "memory tab ref = $r"
if ($r) { bsk click --ref $r --session $s 2>&1 | Out-Null; Start-Sleep -Milliseconds 2000 }

# 4. layout + content
Write-Output '=== layout ==='
bsk evaluate "(()=>{const r=document.querySelector('.dswm-root');if(!r)return JSON.stringify({error:'panel root not mounted'});const cs=getComputedStyle(r);const l=document.querySelector('.dswm-list').getBoundingClientRect();const d=document.querySelector('.dswm-detail').getBoundingClientRect();return JSON.stringify({flex:cs.flexDirection,rootW:Math.round(r.getBoundingClientRect().width),listW:Math.round(l.width),listH:Math.round(l.height),detailW:Math.round(d.width),items:document.querySelectorAll('.dswm-item').length,groups:[...document.querySelectorAll('.dswm-group')].map(g=>g.textContent)})})()" --session $s 2>&1 | Select-Object -First 3

# 5. screenshot
Write-Output '=== screenshot ==='
bsk screenshot --out "D:\deepseekwork\dswm-final.png" --session $s 2>&1 | Select-Object -First 2

# 6. cleanup
bsk session stop $s 2>&1 | Select-Object -First 2
Write-Output 'done'
