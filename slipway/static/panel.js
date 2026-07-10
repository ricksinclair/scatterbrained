let busy=false, MODELS=[], picked=null, running=false;
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}
function $(id){return document.getElementById(id)}

// ---- Studio embed + theme bridge (D5) ----
// ?embed=1 → body.embed (CSS: terminals become the page; the control cards hide behind a
// slim status strip). First paint theme comes from ?mode=&accent=&uiscale=; live switches
// arrive over postMessage {type:'scatterbrained:theme', mode, uiScale, vars} — only the
// WHITELISTED token names below are ever set (CSS custom properties only; no other sink).
const EMBED=new URLSearchParams(location.search).get('embed')==='1';
const THEME_VARS=['--bg0','--bg1','--ink','--ink-dim','--ink-faint','--line','--panel','--surface',
                  '--surface-2','--accent','--accent-contrast','--accent-soft','--warn','--ok','--ui-scale'];
function applyThemeVars(vars){
  if(!vars)return;
  for(const k of THEME_VARS){ if(vars[k]!=null) document.documentElement.style.setProperty(k,String(vars[k]).slice(0,64)); }
}
function setMode(m){document.documentElement.setAttribute('data-mode',m==='light'?'light':'dark')}
window.addEventListener('message',e=>{
  const d=e.data;
  if(!d||d.type!=='scatterbrained:theme')return;
  applyThemeVars(d.vars);
  if(d.mode)setMode(d.mode);
  const us=parseFloat(d.uiScale); if(us>=0.5&&us<=2)document.documentElement.style.setProperty('--ui-scale',String(us));
});
(function initEmbed(){
  const q=new URLSearchParams(location.search);
  // first-paint theme (URL params beat the CSS defaults; the live bridge refines them)
  setMode(q.get('mode')||(matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));
  const accent=(q.get('accent')||'').trim();
  if(/^#[0-9a-fA-F]{3,8}$/.test(accent))document.documentElement.style.setProperty('--accent',accent);
  const us=parseFloat(q.get('uiscale')); if(us>=0.5&&us<=2)document.documentElement.style.setProperty('--ui-scale',String(us));
  if(!EMBED)return;
  document.body.classList.add('embed');
  const lc=document.getElementById('logcard'); if(lc)lc.removeAttribute('open');   // Activity starts collapsed in the embed (disclosure)
  const strip=document.createElement('div'); strip.className='embedstrip';
  // Two affordances: the caret button expands the full control cards; the model-name
  // button opens the swap dialog directly (the model was undiscoverable behind the caret).
  strip.innerHTML='<button class="stripbtn" onclick="document.body.classList.toggle(\'strip-open\')">'+
    '<span class="caret">▸</span><b>Slipway</b><span id="stripState">checking…</span></button>'+
    '<button class="stripbtn stripmodel" title="Change model…" onclick="openSwap()">'+
    '<span id="stripModel">…</span></button>';
  document.body.prepend(strip);
})();

async function refresh(){
  try{
    const s=await (await fetch('/api/status')).json();
    const remote = s.state==='remote';
    running = !remote && s.state!=='stopped';
    $('model').textContent=s.model; $('activeModel').textContent=s.model;
    $('activeLauncher').textContent=s.launcher||'Claude Code';
    $('port').textContent=s.port; $('pid').textContent=(s.pid==null?'—':s.pid);  // no ??/?. anywhere — keeps the parse floor at ~ES2018 so older WebKit can't dead-handler the whole file
    $('ram').textContent = s.ram ? (typeof s.ram==='number' ? (s.ram/1024).toFixed(1)+' GB' : s.ram) : '—';
    const bb=$('backendBadge'); bb.textContent=s.backend; bb.className='badge '+s.backend;
    $('dot').className='dot '+(remote?'remote':s.state==='running'?'on':s.state==='starting'?'warn':'off');
    $('state').textContent={running:'Running',starting:'Starting…',stopped:'Stopped',remote:'Remote'}[s.state];
    // failed loads surface their reason instead of an eternal spinner (Bug 2, 2026-07-04)
    if(s.error){$('state').textContent='Failed — '+s.error.slice(0,90);$('state').title=s.error;}
    else{$('state').title='';}
    $('btnStart').disabled=busy||remote||s.state!=='stopped';
    $('btnStop').disabled=busy||remote||s.state==='stopped';
    $('btnRestart').disabled=busy||remote||s.state==='stopped';
    if(EMBED&&$('stripState')){ $('stripState').textContent=$('state').textContent.toLowerCase(); $('stripModel').textContent=s.model||'—'; }
  }catch(e){$('state').textContent='panel offline'; if(EMBED&&$('stripState'))$('stripState').textContent='panel offline'}
  try{const l=await (await fetch('/api/logs')).json();
    const pre=$('log');const bot=pre.scrollHeight-pre.scrollTop-pre.clientHeight<40;
    pre.textContent=l.log; if(bot)pre.scrollTop=pre.scrollHeight;
    const peek=$('logpeek'); if(peek){const lines=(l.log||'').replace(/\s+$/,'').split('\n');peek.textContent=lines[lines.length-1]||'';}   // collapsed-disclosure preview (embed)
    $('logstamp').textContent=new Date().toLocaleTimeString();
  }catch(e){}
}
async function act(a){busy=true;refresh();toast(a+'…');
  try{const r=await (await fetch('/api/'+a,{method:'POST'})).json();toast(r.msg||a)}catch(e){toast('error')}
  busy=false;refresh()}
async function unloadAll(){
  if(!confirm('Free all model RAM?\n\nStops the MLX server and unloads every loaded Ollama model. Running Claude Code sessions will lose their local model.'))return;
  busy=true;refresh();toast('unloading…');
  try{const r=await (await fetch('/api/unload-all',{method:'POST'})).json();toast(r.msg||'done')}catch(e){toast('error')}
  busy=false;refresh()}

async function openSwap(){
  $('swapWarn').style.display = running ? 'block' : 'none';
  $('swapOverlay').classList.add('show'); $('modelList').textContent='loading…';
  picked=null; $('applyBtn').disabled=true;
  const r=await (await fetch('/api/models')).json(); MODELS=r.models;
  const groups={mlx:[],ollama:[],cloud:[]};
  MODELS.forEach((m,i)=>(groups[m.backend]=groups[m.backend]||[]).push({...m,i}));
  let html='';
  const tiers=[
    {key:'local', title:'LOCAL — runs on this Mac, no key, no internet needed',
     sub:[['mlx','MLX (HuggingFace cache)'],['ollama','Ollama']]},
    {key:'cloud', title:'CLOUD — leaves this Mac, needs an API key, uses your quota',
     sub:[['cloud','']]},
  ];
  for(const tier of tiers){
    if(!tier.sub.some(([bk])=>groups[bk].length)) continue;
    html+=`<div class="tier ${tier.key}"><div class="tierhdr">${tier.title}</div>`;
    for(const [bk,label] of tier.sub){
      if(!groups[bk].length) continue;
      if(label) html+=`<div class="subhdr">${label}</div>`;
      for(const m of groups[bk]){
        html+=`<div class="opt${m.current?' sel':''}" data-i="${m.i}" onclick="pick(${m.i})">
          <div><div class="nm">${m.label}</div><div class="sz">${m.id}</div></div>
          <div class="right"><span class="sz">${m.size||''}</span>
          <span class="badge ${m.backend}">${m.backend}</span>
          ${m.current
            ? '<span class="cur">● current</span>'
            : (m.backend==='cloud' ? ''
               : `<button class="mini cancel" title="Delete this model" onclick="event.stopPropagation();delModel('${m.id}','${m.backend}','${m.label}')">🗑</button>`)}
          </div></div>`;
      }
    }
    html+='</div>';
  }
  $('modelList').innerHTML=html||'(no local models found)';
  const cur=MODELS.findIndex(m=>m.current); if(cur>=0)pick(cur);
}
function pick(i){picked=i;
  document.querySelectorAll('.opt').forEach(o=>o.classList.toggle('sel',+o.dataset.i===i));
  const m=MODELS[i]; $('applyBtn').disabled = m.current;
}
function closeSwap(){$('swapOverlay').classList.remove('show')}
async function delModel(id,backend,label){
  if(!confirm('Delete "'+label+'"?\n\nThis removes the local copy and frees disk space. You can re-download it later.'))return;
  toast('deleting '+label+'…');
  const r=await (await fetch('/api/model/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:id,backend})})).json();
  toast(r.msg||r.error||'done');
  openSwap();
}
async function applySwap(){
  if(picked==null)return; const m=MODELS[picked];
  busy=true; closeSwap(); toast('switching to '+m.label+'…');
  try{const r=await (await fetch('/api/switch',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:m.id,backend:m.backend,provider:m.provider})})).json(); toast(r.msg||'switched')}catch(e){toast('error')}
  busy=false; refresh();
}

// ---- Browse HuggingFace ----
let dlTimer=null;
function openBrowse(){$('browseOverlay').classList.add('show');
  if(!$('hfResults').innerHTML)doSearch();
  pollDownloads(); if(!dlTimer)dlTimer=setInterval(pollDownloads,1500);
}
function closeBrowse(){$('browseOverlay').classList.remove('show');
  if(dlTimer){clearInterval(dlTimer);dlTimer=null}}
async function doSearch(){
  const q=$('hfq').value.trim(), mlx=$('mlxOnly').checked?1:0;
  $('hfResults').innerHTML='<p class="hint">searching…</p>';
  try{
    const r=await (await fetch('/api/hf/search?q='+encodeURIComponent(q)+'&mlx_only='+mlx)).json();
    if(r.error){$('hfResults').innerHTML='<p class="hint">error: '+r.error+'</p>';return}
    if(!r.results.length){$('hfResults').innerHTML='<p class="hint">no results</p>';return}
    $('hfResults').innerHTML=r.results.map(m=>`<div class="hfrow" id="row_${cssId(m.id)}">
      <div><div class="nm">${m.id}</div><div class="st">▼ ${fmt(m.downloads)} · ♥ ${fmt(m.likes)}</div></div>
      <div class="right">${m.installed
        ? '<span class="st" style="color:var(--green)">✓ installed</span>'
        : `<button class="mini" onclick="askSize('${m.id}')">Download</button>`}</div>
    </div>`).join('');
  }catch(e){$('hfResults').innerHTML='<p class="hint">search failed</p>'}
}
function fmt(n){return n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':n}
function cssId(s){return s.replace(/[^a-zA-Z0-9]/g,'_')}
async function askSize(repo){
  const row=$('row_'+cssId(repo)); if(!row)return;
  const btn=row.querySelector('.mini'); if(btn){btn.disabled=true;btn.textContent='checking…'}
  const c=await (await fetch('/api/hf/size',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo})})).json();
  if(c.error){toast(c.error);if(btn){btn.disabled=false;btn.textContent='Download'}return}
  const warn = !c.fits;
  const box=document.createElement('div'); box.className='confirmbox';
  box.innerHTML=`<div><b>${c.total_gb} GB</b> download · <b>${c.free_gb} GB</b> free on disk
    ${warn?'<div style="color:var(--red);margin-top:5px">✗ Not enough space (need a 10 GB buffer). Free up disk first.</div>':''}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:9px">
      <button class="mini cancel" onclick="this.closest('.confirmbox').remove();var b=document.querySelector('#row_${cssId(repo)} .mini');if(b){b.disabled=false;b.textContent='Download'}">Cancel</button>
      <button class="mini" ${warn?'disabled':''} onclick="startDl('${repo}',this)">Confirm download</button>
    </div>`;
  row.after(box);
}
async function startDl(repo,el){
  el.disabled=true; el.textContent='starting…';
  const r=await (await fetch('/api/hf/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo})})).json();
  toast(r.msg||r.error||'started');
  const box=el.closest('.confirmbox'); if(box)box.remove();
  pollDownloads();
}
async function pollDownloads(){
  if(!$('browseOverlay').classList.contains('show'))return;
  try{
    const r=await (await fetch('/api/hf/downloads')).json();
    if(!r.downloads.length){$('dlActive').innerHTML='';return}
    $('dlActive').innerHTML=r.downloads.map(d=>`<div class="dlcard ${d.state}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:13px;word-break:break-all">${d.repo}</b>
        ${d.state==='downloading'
          ? `<button class="mini cancel" onclick="cancelDl('${d.repo}')">Cancel</button>`
          : `<button class="mini" onclick="dismissDl('${d.repo}')">Dismiss</button>`}
      </div>
      <div class="bar"><i style="width:${d.pct}%"></i></div>
      <div class="st" style="color:var(--mut);font-size:12px">${
        d.state==='downloading' ? d.done_gb+' / '+d.total_gb+' GB ('+d.pct+'%)'
        : d.state==='done' ? '✓ done — now in “Change model”'
        : d.state==='canceled' ? 'canceled' : '✗ error — see '+'hf-*.log'}</div>
    </div>`).join('');
  }catch(e){}
}
async function cancelDl(repo){await fetch('/api/hf/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo})});pollDownloads()}
async function dismissDl(repo){await fetch('/api/hf/dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repo})});pollDownloads()}

// ---- Cloud providers ----
// ---- Launcher ----
let launcherInstallTimer=null;
async function openLauncher(){
  $('launcherOverlay').classList.add('show');
  await renderLaunchers();
}
function closeLauncher(){
  $('launcherOverlay').classList.remove('show');
  if(launcherInstallTimer){clearInterval(launcherInstallTimer);launcherInstallTimer=null}
}
async function renderLaunchers(){
  const r=await (await fetch('/api/launchers')).json();
  $('launcherList').innerHTML=r.launchers.map(l=>`<div class="pcard">
    <div class="ph"><b>${l.label}</b>
      ${l.installed?'<span class="badge mlx">installed</span>':'<span class="badge cloud">not installed</span>'}
      ${!l.cloud_ok?'<span class="st" style="margin-left:6px;color:var(--mut);font-size:11px">local models only</span>':''}
      <span style="margin-left:auto">
        ${l.current
          ? '<span class="cur">● active</span>'
          : (l.installed
             ? `<button class="mini" onclick="selectLauncher('${l.id}')">Use this</button>`
             : (l.id==='hermes'
                ? `<button class="mini" onclick="installHermes()">Install</button>`
                : ''))}
      </span></div>
    ${!l.installed && l.install_cmd ? `<div class="st" style="color:var(--mut);font-size:11.5px">install: <code>${l.install_cmd}</code></div>` : ''}
  </div>`).join('') + '<div id="hermesInstallBox"></div>';
}
async function selectLauncher(id){
  const r=await (await fetch('/api/launcher/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({launcher:id})})).json();
  toast(r.msg||r.error||'selected'); refresh(); renderLaunchers();
}
async function installHermes(){
  await fetch('/api/launcher/install',{method:'POST'});
  toast('installing Hermes Agent — this can take a few minutes…');
  if(!launcherInstallTimer)launcherInstallTimer=setInterval(pollHermesInstall,2000);
  pollHermesInstall();
}
async function pollHermesInstall(){
  const s=await (await fetch('/api/launcher/install/status')).json();
  const box=$('hermesInstallBox'); if(!box)return;
  if(s.state==='idle')return;
  box.innerHTML=`<div class="dlcard ${s.state==='done'?'done':s.state==='error'?'error':''}">
    <b style="font-size:13px">Hermes Agent install</b>
    <div class="st" style="color:var(--mut);font-size:11.5px;margin:4px 0">${
      s.state==='installing'?'installing…':s.state==='done'?'✓ installed':'✗ error — see log below'}</div>
    <pre style="max-height:160px;font-size:11px">${(s.log||'').slice(-2000)}</pre></div>`;
  if(s.state==='done'||s.state==='error'){
    clearInterval(launcherInstallTimer); launcherInstallTimer=null;
    if(s.state==='done'){toast('Hermes Agent installed'); renderLaunchers();}
  }
}

async function openCloud(){
  $('cloudOverlay').classList.add('show'); $('cloudList').textContent='loading…';
  const r=await (await fetch('/api/cloud')).json();
  $('cloudList').innerHTML=r.providers.map(p=>`<div class="pcard">
    <div class="ph"><b>${p.label}</b><span class="badge cloud">${p.route==='ccr'?'via router':'native'}</span>
      <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mut);cursor:pointer">
        <input type="checkbox" id="en_${p.id}" ${p.enabled?'checked':''}> enabled</label></div>
    <label class="lbl">API key ${p.has_key?'(saved: '+p.key_hint+' — leave blank to keep)':''}</label>
    <input type="password" id="key_${p.id}" placeholder="${p.has_key?'•••• keep existing':'paste API key'}" autocomplete="off">
    <label class="lbl">Models (one per line)</label>
    <textarea id="mdl_${p.id}">${(p.models||[]).join('\n')}</textarea>
    <div class="pf"><span class="st" style="color:var(--mut);font-size:11.5px">${cloudHint(p.id)}</span>
      <button class="mini" onclick="saveCloud('${p.id}')">Save</button></div>
  </div>`).join('');
}
function cloudHint(id){return {
  openrouter:'model ids: openrouter.ai/models (e.g. anthropic/claude-sonnet-4)',
  anthropic:'native — uses Claude Code directly with your Anthropic key',
  deepseek:'deepseek-chat · deepseek-reasoner',
  nous:'⚠ unverified IDs — check portal.nousresearch.com/info. Hermes via OpenRouter is confirmed instead.'}[id]||''}
function closeCloud(){$('cloudOverlay').classList.remove('show')}
async function saveCloud(id){
  const key=$('key_'+id).value.trim();
  const models=$('mdl_'+id).value.split('\n').map(s=>s.trim()).filter(Boolean);
  const enabled=$('en_'+id).checked;
  const r=await (await fetch('/api/cloud/save',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({provider:id,key,models,enabled})})).json();
  toast(r.msg||r.error||'saved'); $('key_'+id).value='';
}

// ---- Terminals ----
const TERMS = {};        // sid -> {term, fit, ws, pane, tab}
let activeSid = null;
const TERM_DARK = {background:'#070b0f',foreground:'#e6edf3',cursor:'#34d399',selectionBackground:'#2b3a4a'};
// Light theme must also override the 16 ANSI colors: xterm.js's defaults are tuned for a dark
// background — default yellow is ~2.5:1 on this background and brightYellow/brightWhite are
// near-invisible (a shell prompt's yellow path simply vanished). Ramp = GitHub-Light ANSI,
// AA-checked against #f7f9fb.
const TERM_LIGHT = {background:'#f7f9fb',foreground:'#1a2230',cursor:'#1f6f4e',selectionBackground:'#cfe0d8',
  black:'#1a2230',red:'#b42318',green:'#1a7f37',yellow:'#805b00',blue:'#0969da',magenta:'#8250df',cyan:'#1b7c83',white:'#6e7781',
  brightBlack:'#57606a',brightRed:'#a40e26',brightGreen:'#116329',brightYellow:'#6f4e00',brightBlue:'#0550ae',brightMagenta:'#6639ba',brightCyan:'#155e63',brightWhite:'#57606a'};
const TPREFS = Object.assign({fontSize:13,scrollback:5000,theme:'dark'},
  JSON.parse(localStorage.getItem('term-prefs')||'{}'));
function saveTPrefs(){localStorage.setItem('term-prefs',JSON.stringify(TPREFS))}
function themeObj(){return TPREFS.theme==='light'?TERM_LIGHT:TERM_DARK}

async function openTerms(){
  $('termOverlay').classList.add('show');
  $('termScroll').value=String(TPREFS.scrollback);
  $('termHistory').hidden=true; $('termHistBtn').style.color='';   // reset history view
  populateTermLaunchers();
  // re-attach any live sessions not currently shown (e.g. modal reopened)
  try{
    const r=await (await fetch('/api/term/list')).json();
    for(const t of r.terminals){
      if(t.alive && !TERMS[t.id]){
        const a=await (await fetch('/api/term/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:t.id})})).json();
        if(a.ok) openTermTab(t.id,a.token,a.label);
      }
    }
  }catch(e){}
  updateTermEmpty();
  if(activeSid&&TERMS[activeSid]) setTimeout(()=>fitTerm(activeSid),50);
}
function closeTerms(){if(EMBED)return;$('termOverlay').classList.remove('show')}  // sessions keep running; embedded, terminals ARE the page
function updateTermEmpty(){
  const any=Object.keys(TERMS).length>0;
  $('termEmpty').style.display=any?'none':'flex';
  $('termPanes').style.display=any?'block':'none';
}

function launchTerminal(){ openTerms(); termLaunch('launcher'); }   // top-level ▶ Launch

async function termLaunch(kind,launcher,cwdArg){
  const body={kind}; if(launcher)body.launcher=launcher;
  const cwd=(cwdArg!==undefined?cwdArg:($('termCwd').value||'')).trim(); if(cwd)body.cwd=cwd;   // launch in a project → picks up its .slipway.json
  const r=await (await fetch('/api/term/launch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  if(r.error){toast(r.error);return}
  if(!$('termOverlay').classList.contains('show'))$('termOverlay').classList.add('show');
  if(!$('termHistory').hidden) toggleHistory();   // leave history view on launch
  openTermTab(r.id,r.token,r.label);
}

// ---- session history (past transcripts: replay + relaunch) ----
function relTime(ts){ const s=Math.max(0,Date.now()/1000-ts);
  if(s<60)return 'just now'; if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
async function toggleHistory(){
  const h=$('termHistory'), show=h.hidden;
  h.hidden=!show; $('termPanes').style.display=show?'none':'';
  $('termHistBtn').style.color=show?'var(--accent)':'';
  if(show){ $('termEmpty').style.display='none'; await renderHistory(); } else { updateTermEmpty(); }
}
async function renderHistory(){
  const h=$('termHistory'); h.innerHTML='<div class="thist-empty">loading…</div>';
  let sessions=[];
  try{ sessions=(await (await fetch('/api/term/history')).json()).sessions||[]; }catch(e){}
  if(!sessions.length){ h.innerHTML='<div class="thist-empty">No past sessions yet. Launch a terminal and it’ll show up here.</div>'; return; }
  h.innerHTML=sessions.map(s=>{
    const sub=[s.model||s.kind, s.cwd||'', relTime(s.created||0)].filter(Boolean).join(' · ');
    const hasT=s.transcript_bytes>0;
    return `<div class="thist-item">
      <div><div class="nm">${s.label||s.kind}${s.alive?' <span class="thist-live">● live</span>':''}</div>
        <div class="sub">${sub}</div></div>
      <div class="right">
        ${hasT?`<button class="mini" onclick="replaySession('${s.id}','${(s.label||'session').replace(/'/g,'')}')">Replay</button>`:''}
        <button class="mini" onclick='relaunchSession(${JSON.stringify(s)})'>Relaunch</button>
      </div></div>`;
  }).join('');
}
async function replaySession(sid,label){
  const r=await (await fetch('/api/term/transcript?id='+encodeURIComponent(sid))).json();
  if(r.error){toast(r.error);return}
  if(!$('termHistory').hidden) toggleHistory();
  const rid='replay_'+sid;
  if(TERMS[rid]){activate(rid);return}
  const term=new Terminal({fontSize:TPREFS.fontSize,scrollback:200000,theme:themeObj(),
    minimumContrastRatio:4.5,   // 256-color/truecolor output (fancy prompts) bypasses the 16-color theme — let xterm enforce AA against the bg
    disableStdin:true,fontFamily:'ui-monospace,Menlo,monospace',allowProposedApi:true});
  const fit=new FitAddon.FitAddon(); term.loadAddon(fit);
  const pane=document.createElement('div'); pane.className='termpane'; pane.id='pane_'+rid;
  $('termPanes').appendChild(pane); term.open(pane);
  term.write(r.text + (r.truncated?'\r\n\x1b[90m[transcript truncated to last 256 KB]\x1b[0m\r\n':'\r\n\x1b[90m[end of transcript · read-only replay]\x1b[0m\r\n'));
  const tab=document.createElement('div'); tab.className='termtab'; tab.id='tab_'+rid;
  tab.innerHTML=`<span>▷ ${label}</span><span class="x" title="Close">✕</span>`;
  tab.onclick=ev=>{ if(ev.target.classList.contains('x')){closeReplay(rid)} else {activate(rid)} };
  $('termTabs').appendChild(tab);
  TERMS[rid]={term,fit,ws:null,pane,tab,readonly:true};
  activate(rid); updateTermEmpty(); setTimeout(()=>fitTerm(rid),20);
}
function closeReplay(rid){ const t=TERMS[rid]; if(!t)return;
  try{t.term.dispose()}catch(e){} t.pane.remove(); t.tab.remove(); delete TERMS[rid];
  const rest=Object.keys(TERMS); activeSid=null; if(rest.length)activate(rest[rest.length-1]); updateTermEmpty(); }
function relaunchSession(s){
  const cwd=s.cwd||'';
  if(s.kind==='hosted') termLaunch('hosted',undefined,cwd);
  else if(s.kind==='launcher') termLaunch('launcher', s.launcher||undefined, cwd);
  else termLaunch('shell',undefined,cwd);
}
function launchSelected(){
  const v=$('termLauncherSel').value;
  if(v==='__hosted__') termLaunch('hosted');
  else termLaunch('launcher', v||undefined);
}
async function populateTermLaunchers(){
  try{
    const r=await (await fetch('/api/launchers')).json();
    const installed=r.launchers.filter(l=>l.installed);
    let opts='<option value="__hosted__">Claude Code · hosted</option>';
    opts+=installed.map(l=>`<option value="${l.id}">${l.label} · local</option>`).join('');
    $('termLauncherSel').innerHTML=opts;
  }catch(e){}
}

function openTermTab(sid,token,label){
  if(TERMS[sid]){activate(sid);return}
  const term=new Terminal({fontSize:TPREFS.fontSize,scrollback:TPREFS.scrollback,
    minimumContrastRatio:4.5,   // same AA floor as the replay terminal (256-color prompts on a light bg)
    theme:themeObj(),cursorBlink:true,fontFamily:'ui-monospace,Menlo,monospace',allowProposedApi:true});
  const fit=new FitAddon.FitAddon(); term.loadAddon(fit);
  const pane=document.createElement('div'); pane.className='termpane'; pane.id='pane_'+sid;
  $('termPanes').appendChild(pane); term.open(pane);
  const ws=new WebSocket(`ws://${location.host}/api/term/ws?id=${sid}&token=${token}`);
  ws.binaryType='arraybuffer';
  ws.onopen=()=>{ fitTerm(sid); sendResize(sid); };
  ws.onmessage=e=>{ if(typeof e.data==='string'){term.write(e.data)} else {term.write(new Uint8Array(e.data))} };
  ws.onclose=()=>{ term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n'); if(TERMS[sid])TERMS[sid].tab.classList.add('dead'); };
  term.onData(d=>{ if(ws.readyState===1) ws.send(new TextEncoder().encode(d)); });   // binary keystrokes
  term.onResize(()=>sendResize(sid));
  const tab=document.createElement('div'); tab.className='termtab'; tab.id='tab_'+sid;
  tab.innerHTML=`<span>${label}</span><span class="x" title="Kill">✕</span>`;
  tab.onclick=ev=>{ if(ev.target.classList.contains('x')){termKill(sid)} else {activate(sid)} };
  $('termTabs').appendChild(tab);
  TERMS[sid]={term,fit,ws,pane,tab};
  activate(sid); updateTermEmpty();
}
function activate(sid){
  activeSid=sid;
  for(const id in TERMS){
    const on=id===sid;
    TERMS[id].pane.classList.toggle('active',on);
    TERMS[id].tab.classList.toggle('active',on);
  }
  const t=TERMS[sid]; if(t){ setTimeout(()=>{fitTerm(sid);t.term.focus()},20); }
}
function fitTerm(sid){ const t=TERMS[sid]; if(!t)return; try{t.fit.fit()}catch(e){} }
function sendResize(sid){
  const t=TERMS[sid]; if(!t)return; try{t.fit.fit()}catch(e){}
  const {cols,rows}=t.term;
  if(t.ws.readyState===1) t.ws.send(JSON.stringify({t:'resize',cols,rows}));
}
async function termKill(sid){
  const t=TERMS[sid]; if(!t)return;
  try{ await fetch('/api/term/kill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sid})}) }catch(e){}
  try{t.ws.close()}catch(e){} try{t.term.dispose()}catch(e){}
  t.pane.remove(); t.tab.remove(); delete TERMS[sid];
  const rest=Object.keys(TERMS); activeSid=null;
  if(rest.length)activate(rest[rest.length-1]);
  updateTermEmpty();
}
function termFont(d){ TPREFS.fontSize=Math.max(9,Math.min(24,TPREFS.fontSize+d)); saveTPrefs();
  for(const id in TERMS){TERMS[id].term.options.fontSize=TPREFS.fontSize; fitTerm(id);} }
function termSetScroll(){ TPREFS.scrollback=parseInt($('termScroll').value); saveTPrefs();
  for(const id in TERMS){TERMS[id].term.options.scrollback=TPREFS.scrollback;} }
function termToggleTheme(){ TPREFS.theme=TPREFS.theme==='dark'?'light':'dark'; saveTPrefs();
  for(const id in TERMS){TERMS[id].term.options.theme=themeObj();} }
window.addEventListener('resize',()=>{ if(activeSid)fitTerm(activeSid); });

function openDocs(){$('docsOverlay').classList.add('show')}
function closeDocs(){$('docsOverlay').classList.remove('show')}
function openQuit(){$('quitOverlay').classList.add('show')}
function closeQuit(){$('quitOverlay').classList.remove('show')}
async function doQuit(stopServer){
  try{await fetch('/api/quit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stop_server:stopServer})})}catch(e){}
  document.body.innerHTML='<div style="display:flex;height:80vh;align-items:center;justify-content:center;color:#8b97a6;font:16px -apple-system,sans-serif">Panel closed'+(stopServer?' · model server stopped':'')+'. You can close this tab.</div>';
}
['swapOverlay','quitOverlay','docsOverlay','browseOverlay','cloudOverlay','launcherOverlay','termOverlay'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target.id===id&&!(EMBED&&id==='termOverlay'))$(id).classList.remove('show')}));

// ---- deep-links: #terminals opens the Terminals overlay; #term:<sid>[:nonce] surfaces one
// session (attach if live, else read-only transcript replay). Used by Scatterbrained's Agents
// embed to focus a just-launched session; the nonce only defeats same-hash no-ops — ignored.
async function handleHash(){
  const h=location.hash||'';
  if(h==='#terminals'){openTerms();return}
  const m=h.match(/^#term:([0-9a-f]{1,32})(?::\d+)?$/);
  if(!m)return;
  const sid=m[1];
  await openTerms();                                   // re-attaches every live session
  if(TERMS[sid]){activate(sid);return}
  try{
    const a=await(await fetch('/api/term/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sid})})).json();
    if(a.ok){openTermTab(sid,a.token,a.label);return}
  }catch(e){}
  replaySession(sid,'session');                        // ended session → replay (toasts if no transcript)
}
window.addEventListener('hashchange',handleHash);
if(EMBED)openTerms();   // embedded: the terminals are the page — open before any deep-link lands
handleHash();

refresh(); setInterval(()=>{if(!$('swapOverlay').classList.contains('show'))refresh()},2000);
