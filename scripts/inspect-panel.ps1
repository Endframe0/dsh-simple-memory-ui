# Open Settings -> 记忆管理 in the agent window and report each row's state.
# Leaves the session OPEN (id is printed) so the caller can keep inspecting.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$sessionFile = "$env:TEMP\bsk-session.txt"
$s = if (Test-Path $sessionFile) { (Get-Content $sessionFile -Raw).Trim() } else { $null }
if (-not $s) {
    $s = (bsk session start --no-focus 2>&1 | Select-Object -First 1).Trim()
    $s | Set-Content $sessionFile
}
Write-Output "session = $s"

function Ev($js) { bsk evaluate $js --session $s 2>&1 | Select-Object -First 1 }

# Fresh load.
bsk navigate "http://127.0.0.1:3080" --session $s 2>&1 | Select-Object -First 1
Start-Sleep -Milliseconds 3000

# 1. open the sidebar (the settings entry lives in it)
$r = Ev "(()=>{const b=document.querySelector('button[aria-label=\"打开侧边栏\"]')||[...document.querySelectorAll('button')].find(x=>/打开侧边栏/.test(x.getAttribute('aria-label')||''));if(!b)return 'no-sidebar-btn';b.click();return 'sidebar-clicked'})()"
Write-Output "sidebar: $r"
Start-Sleep -Milliseconds 1500

# 2. open settings dialog
$r = Ev "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^设置/.test((x.textContent||'').trim())&&x.getAttribute('aria-haspopup')==='dialog');if(!b)return 'no-settings-btn(hidden?)';b.click();return 'settings-clicked'})()"
Write-Output "settings: $r"
Start-Sleep -Milliseconds 2000

# 3. memory tab
$r = Ev "(()=>{const d=document.querySelector('[role=dialog]');if(!d)return 'no-dialog';const b=[...d.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='记忆管理');if(!b)return 'no-memory-tab';b.click();return 'tab-clicked'})()"
Write-Output "memory tab: $r"
Start-Sleep -Milliseconds 2500

# 4. report rows
Write-Output '=== rows ==='
Ev "JSON.stringify((()=>{const rows=[...document.querySelectorAll('.dswm-item')].map(it=>({t:(it.querySelector('.t')?.textContent||'').trim().slice(0,24),unindexedDot:!!it.querySelector('.dswm-dot')}));const g=[...document.querySelectorAll('.dswm-group')].map(x=>x.textContent);return {groups:g,rows:rows}})())"
Write-Output '=== panel text (trimmed) ==='
Ev "(document.querySelector('.dswm-root')?.innerText||'(not mounted)').replace(/\n{2,}/g,'\n').slice(0,400)"
