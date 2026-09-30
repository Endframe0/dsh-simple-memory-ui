# Verify startCreate no longer nags when the open draft has unsaved edits,
# and that the edits are auto-saved instead of being discarded.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

$sessionFile = "$env:TEMP\bsk-session.txt"
$s = (Get-Content $sessionFile -Raw).Trim()
Write-Output "session = $s"

$js = @'
(async()=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const out={};
  const B=(t)=>[...document.querySelectorAll('[role=dialog] button')].find(x=>(x.textContent||'').trim()===t);
  const dirtyMark=()=>[...document.querySelectorAll('.dswm-dirty')].map(x=>x.textContent).join('|');
  const setVal=(el,v)=>{
    const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el,v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  };

  // Panel must be opened through the real UI: sidebar -> settings -> memory tab.
  if(!document.querySelector('.dswm-root')){
    const side=[...document.querySelectorAll('button')].find(x=>/打开侧边栏/.test(x.getAttribute('aria-label')||''));
    if(side){ side.click(); await sleep(1300); }
    let b=[...document.querySelectorAll('button')].find(x=>/^设置/.test((x.textContent||'').trim())&&x.getAttribute('aria-haspopup')==='dialog');
    if(b){b.click();await sleep(1600);}
    const tab=B('记忆管理'); if(tab){tab.click();await sleep(1800);}
  }
  out.mounted=!!document.querySelector('.dswm-root');
  if(!out.mounted) return JSON.stringify(out);

  // open first reference item
  const item=document.querySelector('.dswm-item'); if(item){item.click();await sleep(1600);}
  const inputs=[...document.querySelectorAll('.dswm-detail input')];
  out.openedTitle=inputs[0]?inputs[0].value:null;
  out.dirtyBefore=dirtyMark();

  // make an unsaved edit in the summary field
  if(inputs[1]){ setVal(inputs[1], (inputs[1].value||'')+' '); await sleep(400); }
  out.dirtyAfterEdit=dirtyMark();
  out.editedSummaryValue=inputs[1]?inputs[1].value:null;

  // instrument confirm so we can detect a nag without blocking
  window.__confirmCalls=[];
  const orig=window.confirm;
  window.confirm=(m)=>{window.__confirmCalls.push(m);return false;};

  // click '+ 正式'
  const addRef=[...document.querySelectorAll('.dswm-actions button')].find(x=>(x.textContent||'').trim()==='+ 正式');
  out.addRefFound=!!addRef;
  if(addRef){ addRef.click(); await sleep(2200); }

  window.confirm=orig;
  out.confirmCalls=window.__confirmCalls;
  const title=(document.querySelector('.dswm-detail .dswm-title')||{}).textContent||'';
  out.detailTitle=title;
  out.nowCreating=title.indexOf('新建条目')!==-1;
  out.titleInputValue=(document.querySelector('.dswm-detail input')||{}).value||null;
  out.okMsg=(document.querySelector('.dswm-msg.ok')||{}).textContent||null;
  out.errMsg=(document.querySelector('.dswm-msg.err')||{}).textContent||null;
  return JSON.stringify(out);
})()
'@

bsk evaluate $js --session $s 2>&1 | Select-Object -First 5
