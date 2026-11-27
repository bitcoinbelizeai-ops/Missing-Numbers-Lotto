// Results Admin page script (moved out of admin.html so a strict Content-Security-Policy can block
// inline scripts, Nov 23, 2026). Loaded at the end of admin.html.
(()=>{'use strict';
const OWNER='bitcoinbelizeai-ops',REPO='Missing-Numbers-Lotto',BRANCH='main',PATH='draws.json';
const API=`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
const KEY='bz-admin-token';
const $=id=>document.getElementById(id);
const pad=(n,w)=>String(n).padStart(w,'0');
const LABEL={boledo:'Boledo',lottery:'Sunday Jackpot',fantasy5:'Fantasy 5',pick3:'Pick 3'};
const SCHED={boledo:{days:[1,2,3,4,5],h:21,m:0,text:'Mon–Fri 9:00 pm'},pick3:{days:[1,2,3,4,5],h:20,m:30,text:'Mon–Fri 8:30 pm'},fantasy5:{days:[2,4,6],h:20,m:0,text:'Tue, Thu, Sat 8:00 pm'},lottery:{days:[0],h:10,m:0,text:'Sunday 10:00 am'}};
const PH={boledo:['Winning number','41'],lottery:['1st, 2nd and 3rd prize (12 digits in a row is fine)','165201887876'],fantasy5:['5 numbers and the letter','03 05 11 20 27 Q'],pick3:['3 digits','390']};
let game='boledo',token='',current=null,pending=null;
const getTok=()=>{try{return localStorage.getItem(KEY)||''}catch(e){return ''}};
const setTok=t=>{try{t?localStorage.setItem(KEY,t):localStorage.removeItem(KEY);return true}catch(e){return false}};
function bz(){const d=new Date(Date.now()-6*3600e3);return{iso:d.toISOString().slice(0,10),dow:d.getUTCDay(),min:d.getUTCHours()*60+d.getUTCMinutes()}}
function addDays(iso,n){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function dowOf(iso){return new Date(iso+'T12:00:00Z').getUTCDay()}
function lastDraw(g){const n=bz(),s=SCHED[g];let iso=n.iso;for(let i=0;i<8;i++){if(s.days.includes(dowOf(iso))&&(iso<n.iso||n.min>=s.h*60+s.m))return iso;iso=addDays(iso,-1)}return n.iso}
const fmtDay=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
// Open at the top (27 Nov 2026): the BBN box's background "Loading…" note used to pull the page
// down on first open. Notes only scroll into view after the owner has tapped or typed.
let acted=false;['pointerdown','keydown'].forEach(t=>addEventListener(t,()=>{acted=true},{capture:true,passive:true}));
try{history.scrollRestoration='manual'}catch(e){}
function msg(el,text,kind){el.textContent=text;el.className='msg '+(kind||'info');
  // design pass: make sure the message is seen (open its folded section, bring it into view)
  const fold=el.closest('details');if(fold)fold.open=true;
  const r=el.getBoundingClientRect();if(acted&&text&&(r.top<0||r.bottom>innerHeight))el.scrollIntoView({block:'nearest',behavior:'smooth'})}
const toks=()=>$('nums').value.trim().split(/[\s,;\-\/.]+/).filter(Boolean);
const digits=t=>t.map(x=>x.replace(/\D/g,'')).filter(Boolean);
function make(g,t){
  const n=digits(t);
  if(g==='boledo'){if(!n.length||n[0].length>2)return null;return{nums:[pad(n[0],2)]}}
  if(g==='lottery'){const v=(n.length===1&&n[0].length===12)?n[0].match(/.{4}/g):n.filter(x=>x.length<=4);if(v.length<3)return null;return{nums:v.slice(0,3).map(x=>pad(x,4))}}
  if(g==='fantasy5'){const letter=(t.find(x=>/^[A-Za-z]$/.test(x))||'').toUpperCase();const v=[...new Set(n.map(Number))].filter(x=>x>=1&&x<=39);
    if(v.length!==5||!letter)return null;return{nums:v.sort((a,b)=>a-b).map(x=>pad(x,2)),letter}}
  let v=n;if(v.length===1&&v[0].length===3)v=v[0].split('');if(v.length<3||v.slice(0,3).some(x=>x.length!==1))return null;return{nums:v.slice(0,3)}
}
function ball(v){const b=document.createElement('span');b.className='ball'+(v?'':' blank');b.innerHTML='<i>'+(v||'?')+'</i>';return b}
function preview(){
  const box=$('preview');box.innerHTML='';const t=toks(),n=digits(t);
  if(game==='boledo')box.appendChild(ball(n[0]&&n[0].slice(0,2)));
  else if(game==='pick3'){const d=(n.length===1?n[0]:n.map(x=>x[0]).join('')).slice(0,3).split('');for(let i=0;i<3;i++)box.appendChild(ball(d[i]))}
  else if(game==='fantasy5'){for(let i=0;i<5;i++)box.appendChild(ball(n[i]&&n[i].slice(0,2)));const l=document.createElement('span');l.className='letter';l.textContent=(t.find(x=>/^[A-Za-z]$/.test(x))||'?').toUpperCase();box.appendChild(l)}
  else{const jd=(n.length===1&&n[0].length>4)?(n[0].match(/.{1,4}/g)||[]):n;['1st','2nd','3rd'].forEach((p,i)=>{const r=document.createElement('div');r.className='prize';r.innerHTML='<span>'+p+'</span>';(jd[i]||'').slice(0,4).padEnd(4,' ').split('').forEach(c=>r.appendChild(ball(c.trim())));box.appendChild(r)})}
}
function setGame(g){game=g;document.body.dataset.g=g;
  document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.g===g));
  $('numsLbl').textContent=PH[g][0];$('nums').placeholder=PH[g][1];$('nums').inputMode=g==='fantasy5'?'text':g==='lottery'?'decimal':'numeric';
  $('date').value=lastDraw(g);$('date').max=bz().iso;$('sched').textContent='Drawn '+SCHED[g].text;
  $('nums').value='';$('confirm').classList.remove('show');$('msg').className='msg';preview();showAll();}

async function gh(method,body){
  const r=await fetch(API+(method==='GET'?'?ref='+BRANCH+'&t='+Date.now():''),{method,cache:'no-store',
    headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined});
  noteExpiry(r);
  if(!r.ok){const e=new Error(r.status===401?'The access key was refused. Disconnect and paste a new one.':r.status===403||r.status===404?'The key can\'t open draws.json. Check it has Contents: Read and write for Missing-Numbers-Lotto.':r.status===409?'conflict':'GitHub error '+r.status);e.status=r.status;throw e}
  return r.json();
}
const b64dec=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g,'')),c=>c.charCodeAt(0)));
const b64enc=s=>{const b=new TextEncoder().encode(s);let out='';for(let i=0;i<b.length;i+=0x8000)out+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(out)};
async function load(){const j=await gh('GET');current={sha:j.sha,data:JSON.parse(b64dec(j.content))};showRecent();return current}
async function commit(change,message){
  for(let attempt=0;attempt<3;attempt++){
    const {sha,data}=await load();
    change(data);data.draws.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.game<b.game?-1:1);data.updated=bz().iso;
    try{await gh('PUT',{message,content:b64enc(JSON.stringify(data,null,1)+'\n'),sha,branch:BRANCH});await load();return}
    catch(e){if(e.status!==409||attempt===2)throw e}
  }
}
function showAll(){
  if(!current)return;$('allGame').textContent=LABEL[game];
  const box=$('all');box.innerHTML='';
  const rows=(current.data.draws||[]).filter(d=>d.game===game).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  if(!rows.length){box.innerHTML='<p class="help">No '+LABEL[game]+' results on the site yet.</p>';return}
  rows.forEach(d=>{const it=document.createElement('div');it.className='item'+(d.nodraw?' skip':'');
    const yr=d.date.slice(0,4)!==bz().iso.slice(0,4)?' '+d.date.slice(0,4):'';
    const nums=d.nodraw?'no draw'+(d.holiday?' · '+esc(d.holiday):' (skipped)'):d.nums.join(' ')+(d.letter?' '+d.letter:'');
    it.innerHTML='<span>'+fmtDay(d.date)+yr+' · <b>'+nums+'</b>'+(d.source==='admin'?' <small>(you)</small>':'')+'</span>';
    const b=document.createElement('button');b.textContent='Remove';b.setAttribute('aria-label','Remove '+LABEL[d.game]+' '+d.date);b.onclick=()=>removeEntry(d);it.appendChild(b);
    box.appendChild(it)});
}
function showRecent(){
  showAll();renderAttention();
  const box=$('recent');box.innerHTML='';const from=addDays(bz().iso,-7);
  const rows=(current.data.draws||[]).filter(d=>d.date>=from).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  // results still waiting show here too (red or gold), so this list and the app never disagree
  const waits=waitingDraws().filter(w=>w.date>=from);
  waits.forEach(w=>box.appendChild(waitRow(w,true)));
  if(!rows.length&&!waits.length){box.innerHTML='<p class="help">Nothing in the last 7 days.</p>';return}
  rows.forEach(d=>{const it=document.createElement('div');it.className='item';
    const nums=d.nodraw?'no draw'+(d.holiday?' · '+esc(d.holiday):''):d.nums.join(' ')+(d.letter?' '+d.letter:'');
    it.innerHTML='<span><b>'+LABEL[d.game]+'</b> · '+fmtDay(d.date)+' · '+nums+(d.source==='admin'?' <small>(you)</small>':'')+'</span>';
    if(d.source==='admin'){const b=document.createElement('button');b.textContent='Remove';b.onclick=()=>removeEntry(d);it.appendChild(b)}
    box.appendChild(it)});
}
async function removeEntry(d){
  const ok=await inlineConfirm('Remove '+LABEL[d.game]+' '+fmtDay(d.date)+' from the site?');if(!ok)return;
  try{msg($('msg'),'Removing…');await commit(data=>{data.draws=data.draws.filter(x=>x.id!==d.id)},'Admin: remove '+d.id);msg($('msg'),'Removed '+LABEL[d.game]+' '+fmtDay(d.date)+'.','ok')}
  catch(e){msg($('msg'),e.message,'err')}
}
function inlineConfirm(text){return new Promise(res=>{const c=$('confirm');$('confirmText').textContent=text;$('publish').textContent='Yes, remove';c.classList.add('show');
  const done=v=>{c.classList.remove('show');$('publish').textContent='Publish to everyone';$('publish').onclick=doPublish;$('cancel').onclick=()=>c.classList.remove('show');res(v)};
  $('publish').onclick=()=>done(true);$('cancel').onclick=()=>done(false);c.scrollIntoView({block:'center',behavior:'smooth'})})}

function review(){
  $('msg').className='msg';const date=$('date').value,t=toks();
  if(!date){msg($('msg'),'Pick the draw date.','err');return}
  if(date>bz().iso){msg($('msg'),'That date is in the future.','err');return}
  const o=make(game,t);
  if(!o){msg($('msg'),{boledo:'Type one number from 00 to 99.',lottery:'Type the 1st, 2nd and 3rd prize (4 digits each).',fantasy5:'Type 5 different numbers from 1 to 39 and the letter.',pick3:'Type 3 digits, like 390.'}[game],'err');return}
  const id=game+'-'+date;const exists=current&&current.data.draws.find(d=>d.id===id);
  const notDay=!SCHED[game].days.includes(dowOf(date));
  pending=Object.assign({id,game,date},o,{source:'admin',added:new Date().toISOString().slice(0,19)+'Z'});
  $('confirmText').innerHTML='<b>'+LABEL[game]+'</b> · '+fmtDay(date)+'<br><span style="font-size:22px;font-weight:700;color:#fff">'+o.nums.join(' ')+(o.letter?' '+o.letter:'')+'</span>'+
    (exists&&!exists.nodraw?'<br><small style="color:#ffd27a">This replaces the result already on the site: '+exists.nums.join(' ')+(exists.letter?' '+exists.letter:'')+'</small>':'')+
    (notDay?'<br><small style="color:#ffd27a">'+LABEL[game]+' isn\'t normally drawn on that day.</small>':'')+
    (holidayOn(game,date)?'<br><small style="color:#ffd27a">That day is a public holiday ('+esc(holidayOn(game,date).name)+'): normally no draw.</small>':'');
  $('publish').textContent='Publish to everyone';$('publish').onclick=doPublish;$('cancel').onclick=()=>$('confirm').classList.remove('show');
  $('confirm').classList.add('show');
}
async function doPublish(){
  if(!pending)return;const p=pending;$('publish').disabled=true;msg($('msg'),'Publishing…');
  try{await commit(data=>{data.draws=data.draws.filter(x=>x.id!==p.id);data.draws.push(p)},'Admin: '+LABEL[p.game]+' '+p.date+' '+p.nums.join(' ')+(p.letter?' '+p.letter:''));
    $('confirm').classList.remove('show');$('nums').value='';preview();pending=null;
    msg($('msg'),'Posted! '+LABEL[p.game]+' '+fmtDay(p.date)+': '+p.nums.join(' ')+(p.letter?' '+p.letter:'')+'. Phones get it within about 1 to 10 minutes.','ok')}
  catch(e){msg($('msg'),'Not posted: '+e.message,'err')}
  finally{$('publish').disabled=false}
}

/* ---------- backups & data ---------- */
const GAMES_OK=['boledo','lottery','fantasy5','pick3'];
function saveFile(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
const stamp=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1,2)+'-'+pad(d.getDate(),2)+'-'+pad(d.getHours(),2)+pad(d.getMinutes(),2)};
const backupText=data=>JSON.stringify({app:'belize-missing-numbers',kind:'site-backup',saved:new Date().toISOString(),count:(data.draws||[]).length,draws:data.draws||[],updated:data.updated||null},null,1)+'\n';
$('dlJson').onclick=async()=>{try{msg($('dlMsg'),'Getting the latest data…');const {data}=await load();
  saveFile('missing-numbers-backup-'+stamp()+'.json',backupText(data),'application/json');msg($('dlMsg'),'Backup saved: '+data.draws.length+' results.','ok')}catch(e){msg($('dlMsg'),e.message,'err')}};
$('dlCsv').onclick=async()=>{try{msg($('dlMsg'),'Getting the latest data…');const {data}=await load();
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=[['game','date','numbers','letter','no_draw','source']].concat([...data.draws].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.game<b.game?-1:1)
    .map(d=>[LABEL[d.game]||d.game,d.date,d.nodraw?'':(d.nums||[]).join(' '),d.letter||'',d.nodraw?'yes':'',d.source||'']));
  saveFile('missing-numbers-'+stamp()+'.csv','﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n')+'\r\n','text/csv');msg($('dlMsg'),'Spreadsheet saved: '+data.draws.length+' results.','ok')}catch(e){msg($('dlMsg'),e.message,'err')}};

// every result in a backup is checked before it can reach the site
function checkDraw(d){
  if(!d||typeof d!=='object'||!GAMES_OK.includes(d.game)||!/^\d{4}-\d{2}-\d{2}$/.test(d.date||''))return null;
  if(d.date>bz().iso)return null;
  const out={id:d.game+'-'+d.date,game:d.game,date:d.date};
  if(d.source)out.source=String(d.source).slice(0,20);
  if(typeof d.added==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:]{8}Z$/.test(d.added))out.added=d.added;
  if(d.nodraw)return Object.assign(out,{nodraw:true});
  const n=Array.isArray(d.nums)?d.nums.map(x=>String(x).trim()):[];
  if(d.game==='boledo'){if(n.length<1||!/^\d{1,2}$/.test(n[0]))return null;out.nums=[pad(n[0],2)]}
  else if(d.game==='lottery'){if(n.length<3||n.slice(0,3).some(x=>!/^\d{1,4}$/.test(x)))return null;out.nums=n.slice(0,3).map(x=>pad(x,4))}
  else if(d.game==='fantasy5'){const v=[...new Set(n.map(Number))];if(v.length!==5||v.some(x=>!(x>=1&&x<=39)))return null;out.nums=v.sort((a,b)=>a-b).map(x=>pad(x,2));
    if(d.letter){if(!/^[A-Za-z]$/.test(d.letter))return null;out.letter=d.letter.toUpperCase()}
    if(Number.isInteger(d.jackpot)&&d.jackpot>=10000&&d.jackpot<=10000000)out.jackpot=d.jackpot}  // BBN's "Next Jackpot" (Nov 25, 2026)
  else{if(n.length<3||n.slice(0,3).some(x=>!/^\d$/.test(x)))return null;out.nums=n.slice(0,3)}
  return out;
}
const same=(a,b)=>JSON.stringify([a.nums||null,a.letter||null,!!a.nodraw])===JSON.stringify([b.nums||null,b.letter||null,!!b.nodraw]);
let restoreSet=null,undoData=null;
function plan(site,backup){const byId=new Map(site.map(d=>[d.id,d])),inB=new Set(backup.map(d=>d.id));
  const add=backup.filter(d=>!byId.has(d.id)),diff=backup.filter(d=>byId.has(d.id)&&!same(d,byId.get(d.id))),gone=site.filter(d=>!inB.has(d.id));
  return{add,diff,gone}}
function showPlan(){
  if(!restoreSet||!current)return;const mode=document.querySelector('input[name="rmode"]:checked').value;
  const p=plan(current.data.draws,restoreSet.ok);
  const range=restoreSet.ok.length?restoreSet.ok.map(d=>d.date).sort():[];
  let h='<b>'+esc(restoreSet.name)+'</b><ul><li>'+restoreSet.ok.length+' good results'+(range.length?' ('+fmtDay(range[0])+' to '+fmtDay(range[range.length-1])+')':'')+'</li>'+
    (restoreSet.bad?'<li class="warn">'+restoreSet.bad+' results in the file were damaged or not valid and will be skipped</li>':'')+
    '<li>The site has '+current.data.draws.length+' results now</li></ul>';
  if(mode==='merge')h+='<p><b>This will:</b> add '+p.add.length+' result'+(p.add.length===1?'':'s')+' that the site is missing.'+(p.diff.length?' <span class="warn">'+p.diff.length+' result'+(p.diff.length===1?'':'s')+' differ from the site and will be left as they are on the site.</span>':'')+' Nothing is removed.</p>';
  else h+='<p><b>This will:</b> add '+p.add.length+', change '+p.diff.length+' and <span class="warn">remove '+p.gone.length+'</span> result'+(p.gone.length===1?'':'s')+'.'+(p.gone.length>current.data.draws.length*.2?' <b class="warn">That is a big part of the site\'s results. Check this is the right file.</b>':'')+'</p>';
  $('planText').innerHTML=h;$('replaceWrap').hidden=mode!=='replace';
  const nothing=mode==='merge'?!p.add.length:!(p.add.length||p.diff.length||p.gone.length);
  $('restoreGo').disabled=nothing||!restoreSet.ok.length||(mode==='replace'&&$('replaceWord').value.trim()!=='REPLACE');
  $('restoreGo').textContent=nothing?'Nothing to restore':mode==='merge'?'Add '+p.add.length+' missing':'Replace site data';
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('restoreFile').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;$('restoreMsg').className='msg';$('undoRow').hidden=true;
  try{
    if(f.size>5e6)throw new Error('That file is too big to be a backup from this site.');
    let j;try{j=JSON.parse(await f.text())}catch(_){throw new Error('That file is not a backup (it could not be read).')}
    const list=Array.isArray(j)?j:Array.isArray(j.draws)?j.draws:null;if(!list)throw new Error('That file has no results in it.');
    const seen=new Map();let bad=0;list.forEach(d=>{const c=checkDraw(d);if(!c){bad++;return}seen.set(c.id,c)});
    if(!seen.size)throw new Error('None of the results in that file are valid, so nothing can be restored.');
    msg($('restoreMsg'),'Checking against the site…');await load();$('restoreMsg').className='msg';
    restoreSet={name:f.name,ok:[...seen.values()],bad};
    document.querySelector('input[name="rmode"][value="merge"]').checked=true;$('replaceWord').value='';
    $('restorePlan').hidden=false;showPlan();
  }catch(err){restoreSet=null;$('restorePlan').hidden=true;msg($('restoreMsg'),err.message,'err')}
};
document.querySelectorAll('input[name="rmode"]').forEach(r=>r.onchange=()=>{$('replaceWord').value='';showPlan()});
$('replaceWord').addEventListener('input',showPlan);
$('restoreCancel').onclick=()=>{restoreSet=null;$('restorePlan').hidden=true;msg($('restoreMsg'),'Cancelled. Nothing was changed.','info')};
$('restoreGo').onclick=async()=>{
  if(!restoreSet)return;const mode=document.querySelector('input[name="rmode"]:checked').value;
  if(mode==='replace'&&$('replaceWord').value.trim()!=='REPLACE')return;
  $('restoreGo').disabled=true;
  try{
    msg($('restoreMsg'),'Saving a safety copy of the site first…');
    const {data:before}=await load();
    saveFile('safety-copy-before-restore-'+stamp()+'.json',backupText(before),'application/json');
    let added=0,changed=0,removed=0,prev=null;
    msg($('restoreMsg'),'Restoring…');
    await commit(data=>{prev=JSON.parse(JSON.stringify(data.draws));const p=plan(data.draws,restoreSet.ok);
      if(mode==='merge'){data.draws=data.draws.concat(p.add);added=p.add.length}
      else{data.draws=restoreSet.ok.slice();added=p.add.length;changed=p.diff.length;removed=p.gone.length}},
      'Admin: restore backup ('+mode+') from '+restoreSet.name);
    undoData=prev;restoreSet=null;$('restorePlan').hidden=true;$('undoRow').hidden=false;
    msg($('restoreMsg'),'Restored. Added '+added+(mode==='replace'?', changed '+changed+', removed '+removed:'')+'. A safety copy of the site before the restore was saved to this device. Phones get the change within about 1 to 10 minutes.','ok');
  }catch(e){msg($('restoreMsg'),'Not restored: '+e.message+' Nothing was changed.','err')}
  finally{showPlan()}
};
$('undoRestore').onclick=async()=>{
  if(!undoData)return;
  if($('undoRestore').dataset.sure!=='1'){$('undoRestore').dataset.sure='1';$('undoRestore').textContent='Tap again to put the site back';setTimeout(()=>{$('undoRestore').dataset.sure='';$('undoRestore').textContent='Undo the restore'},5000);return}
  $('undoRestore').disabled=true;
  try{msg($('restoreMsg'),'Putting the site back…');await commit(data=>{data.draws=undoData},'Admin: undo restore');
    undoData=null;$('undoRow').hidden=true;msg($('restoreMsg'),'Done. The site is back to how it was before the restore.','ok')}
  catch(e){msg($('restoreMsg'),'Undo failed: '+e.message+' The safety copy saved on this device can be restored instead.','err')}
  finally{$('undoRestore').disabled=false;$('undoRestore').dataset.sure='';$('undoRestore').textContent='Undo the restore'}
};

/* ---------- BBN test results (read-only unless "Add to site") ---------- */
// when each draw is finished (Belize time, UTC-6, no daylight saving): the same times the magayo job uses
const DRAW_END={boledo:[21,0],pick3:[20,30],fantasy5:[20,0],lottery:[10,30]};
function drawEnd(game,date){const t=DRAW_END[game];if(!t||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;const [y,m,d]=date.split('-').map(Number);return Date.UTC(y,m-1,d,t[0]+6,t[1])}
function minsAfter(game,date,iso){const e=drawEnd(game,date),a=Date.parse(iso||'');if(e==null||isNaN(a))return null;return Math.round((a-e)/60000)}
function dur(m){if(m==null)return'';if(m<0)return'before the draw time?';if(m<60)return m+' min';const h=Math.floor(m/60),r=m%60;return h<48?h+' h'+(r?' '+r+' min':''):Math.round(h/24)+' days'}
const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
const srcName=e=>e&&e.source==='lovefm'?'Love FM':'BBN'; // Love FM = second Facebook source since 25 Nov 2026 (Boledo only)
const STATUS={'match':'Matches the site','differs':'Differs from the site','only-bbn':'Not on the site','unreadable':'Picture unclear','invalid':'Read wrongly','admin':'Posted by you'};
async function loadBbn(){
  const box=$('bbnList');
  try{
    msg($('bbnMsg'),'Loading…');
    const r=await fetch(API.replace(/draws\.json$/,'data/bbn-results.json')+'?ref='+BRANCH+'&t='+Date.now(),{cache:'no-store',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
    if(r.status===404){box.innerHTML='';$('bbnSum').innerHTML='';msg($('bbnMsg'),'No BBN results yet. They appear here once Make.com sends the first one.','info');return}
    if(!r.ok)throw new Error('Could not load the BBN test results ('+r.status+').');
    const j=await r.json(),data=JSON.parse(b64dec(j.content)),list=(data.results||[]).slice().reverse();
    if(!current)await load();
    const site=new Map((current.data.draws||[]).map(d=>[d.id,d]));
    // status is worked out again now, since the site may have been updated since
    const live=list.map(e=>{if(!e.draw)return Object.assign({},e,{now:STATUS[e.status]?e.status:'invalid'});
      const s=site.get(e.draw.id);if(!s||s.nodraw)return Object.assign({},e,{now:'only-bbn',siteNow:null});
      const same=JSON.stringify(s.nums)===JSON.stringify(e.draw.nums)&&(e.draw.game!=='fantasy5'||(s.letter||null)===(e.draw.letter||null));
      return Object.assign({},e,{now:same?'match':'differs',siteNow:s})});
    const count=k=>live.filter(e=>e.now===k).length,checked=count('match')+count('differs');
    // zero counts are left out, except "Differs" (0 there is good news worth seeing)
    $('bbnSum').innerHTML=['match','differs','only-bbn','unreadable','invalid'].filter(k=>k==='differs'||count(k)).map(k=>'<span class="chip '+k+'">'+STATUS[k]+': '+count(k)+'</span>').join('')+
      (checked?'<span class="chip">Accuracy: '+Math.round(count('match')/checked*100)+'%</span>':'');
    $('bbnSpeed').innerHTML=speedLines(live,site);
    // results you posted by hand that BBN never sent: shown in the log too, so the day isn't a gap
    const bbnIds=new Set(list.filter(e=>e.draw).map(e=>e.draw.id));
    const mine=[...site.values()].filter(d=>d.source==='admin'&&!d.nodraw&&d.nums&&!bbnIds.has(d.id)&&d.date>=BBN_TEST_FROM)
      .map(d=>({manual:true,game:d.game,date:d.date,received:d.added||'',now:'admin',siteNow:d}));
    bbnRows=live.concat(mine).map(e=>Object.assign(e,{day:/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?e.date:(e.received||'').slice(0,10)}))
      .sort((a,b)=>a.day!==b.day?(a.day<b.day?1:-1):(SCHED[a.game]&&SCHED[b.game]?(SCHED[b.game].h*60+SCHED[b.game].m)-(SCHED[a.game].h*60+SCHED[a.game].m):0));
    bbnWeeks=1;renderBbnWeeks();
  }catch(err){msg($('bbnMsg'),err.message,'err')}
}
let bbnRows=[],bbnWeeks=1;
const weekStart=n=>addDays(bz().iso,-7*n-6),weekEnd=n=>addDays(bz().iso,-7*n);
const shortDay=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString(undefined,{day:'numeric',month:'short',timeZone:'UTC'});
function renderBbnWeeks(){
  const box=$('bbnList');box.innerHTML='';
  const oldest=weekStart(bbnWeeks-1);let shown=0;
  for(let w=0;w<bbnWeeks;w++){
    const from=weekStart(w),to=weekEnd(w),rows=bbnRows.filter(e=>e.day>=from&&e.day<=to);
    const h=document.createElement('h3');h.className='week';h.textContent=(w===0?'This week · ':'')+shortDay(from)+' – '+shortDay(to);box.appendChild(h);
    if(!rows.length){const p=document.createElement('p');p.className='help';p.textContent='Nothing from BBN this week.';box.appendChild(p)}
    rows.forEach(e=>{box.appendChild(bbnItem(e));shown++})}
  const older=bbnRows.filter(e=>e.day<oldest).length,more=$('bbnMore');
  more.hidden=!older;if(older)more.textContent='Show earlier week ('+shortDay(weekStart(bbnWeeks))+' – '+shortDay(weekEnd(bbnWeeks))+')';
  msg($('bbnMsg'),bbnRows.length?'Showing '+shown+' of '+bbnRows.length+(older?'. '+older+' older below the button.':'.'):'No BBN results yet.','info');
}
$('bbnMore').onclick=()=>{bbnWeeks++;renderBbnWeeks();const hs=$('bbnList').querySelectorAll('h3.week');if(hs.length)hs[hs.length-1].scrollIntoView({behavior:'smooth',block:'start'})};
function bbnItem(e){
    const it=document.createElement('div');it.className='item'+(e.manual?' mine':'');
    const lbl=LABEL[e.game]||e.game,dayTxt=/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')?fmtDay(e.date):esc(e.date||'no date');
    const siteTxt=e.siteNow?e.siteNow.nums.join(' ')+(e.siteNow.letter?' '+e.siteNow.letter:''):'';
    if(e.manual){
      it.innerHTML='<div class="bbnrow"><span class="head"><b>'+esc(lbl)+'</b> · '+dayTxt+'</span>'+
        '<span class="nums">You posted: <b>'+esc(siteTxt)+'</b></span>'+
        '<span><span class="chip admin">'+STATUS.admin+'</span> <small>BBN didn\'t send this draw</small></span>'+
        (e.received&&minsAfter(e.game,e.date,e.received)!=null?'<small>Posted '+esc(dur(minsAfter(e.game,e.date,e.received)))+' after the draw</small>':'')+'</div>';
      return it}
    const bbn=e.draw?e.draw.nums.join(' ')+(e.draw.letter?' '+e.draw.letter:''):(e.read_as&&e.read_as.nums?[].concat(e.read_as.nums).join(' '):'?');
    it.innerHTML='<div class="bbnrow"><span class="head"><b>'+esc(lbl)+'</b> · '+dayTxt+'</span>'+
        '<span class="nums">'+srcName(e)+': <b>'+esc(bbn)+'</b>'+(siteTxt?' · Site: <b>'+esc(siteTxt)+'</b>':'')+(e.draw&&e.draw.jackpot?' · Next jackpot <b>$'+Number(e.draw.jackpot).toLocaleString('en-US')+'</b>'+(e.jackpot_added?' <small>(added to the site)</small>':''):'')+'</span>'+
        '<span><span class="chip '+e.now+'">'+STATUS[e.now]+'</span>'+(e.published?' <small>added automatically</small>':e.siteNow&&e.siteNow.source==='admin'?' <small>you posted it first</small>':'')+(e.detail?' <small>'+esc(e.detail)+'</small>':'')+'</span>'+timingLine(e)+'</div>';
      if(e.now==='only-bbn'&&e.draw){const b=document.createElement('button');b.textContent='Add to site';
        b.onclick=async()=>{
          if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='Tap again to add';setTimeout(()=>{b.dataset.sure='';b.textContent='Add to site'},5000);return}
          b.disabled=true;
          try{await commit(d=>{if(d.draws.some(x=>x.id===e.draw.id))throw new Error('The site already has '+lbl+' '+e.date+'.');d.draws.push(Object.assign({},e.draw,{source:e.source||'bbn',added:new Date().toISOString().slice(0,19)+'Z'}))},'Admin: add '+lbl+' '+e.date+' from BBN test');
            await loadBbn();msg($('bbnMsg'),'Added '+lbl+' '+e.date+' to the site.','ok')}
          catch(err){msg($('bbnMsg'),err.message,'err');b.disabled=false}};
        it.appendChild(b)}
    return it}
$('bbnRefresh').onclick=loadBbn;
// speed: how long after the draw each source delivered (only draws recorded since timing was added)
function timingLine(e){
  if(!e.draw)return'';const g=e.draw.game,dt=e.draw.date,parts=[];
  const b=minsAfter(g,dt,e.received);if(b!=null)parts.push(srcName(e)+' arrived '+dur(b)+' after the draw');
  const p=minsAfter(g,dt,e.post_time);if(p!=null&&p>=0)parts.push('posted on Facebook after '+dur(p));
  if(e.siteNow&&e.siteNow.added){const m=minsAfter(g,dt,e.siteNow.added);if(m!=null)parts.push(({admin:'you posted it',bbn:'on the site',magayo:'magayo'}[e.siteNow.source]||'site')+' after '+dur(m))}
  return parts.length?'<small>'+esc(parts.join(' · '))+'</small>':'';
}
function speedLines(live,site){
  // BBN's speed = when BBN posted it on Facebook (Make picks it up within its 15-minute check); manual tests left out
  const bbnWhen=e=>{const p=minsAfter(e.draw.game,e.draw.date,e.post_time);return p!=null&&p>=0?p:minsAfter(e.draw.game,e.draw.date,e.received)};
  const bbn=live.filter(e=>e.draw&&e.source!=='lovefm'&&!String(e.post_id||'').startsWith('manual-test')).map(bbnWhen).filter(m=>m!=null&&m>=0&&m<72*60);
  const mag=[...site.values()].filter(d=>d.source==='magayo'&&d.added&&!d.nodraw).map(d=>minsAfter(d.game,d.date,d.added)).filter(m=>m!=null&&m>=0&&m<72*60);
  let first=0,both=0;live.forEach(e=>{if(!e.draw||!e.siteNow||e.siteNow.source!=='magayo'||!e.siteNow.added)return;if(e.source==='lovefm'||String(e.post_id||'').startsWith('manual-test'))return;const b=bbnWhen(e),g=minsAfter(e.draw.game,e.draw.date,e.siteNow.added);if(b==null||g==null)return;both++;if(b<g)first++});
  return (bbn.length?'<li>BBN posts on average <b>'+dur(avg(bbn))+'</b> after the draw ('+bbn.length+' draws)</li>':'')+
    (mag.length?'<li>magayo average: <b>'+dur(avg(mag))+'</b> after the draw ('+mag.length+')</li>':'<li>magayo timing: recorded from its next update</li>')+
    (both?'<li>BBN was first <b>'+first+' of '+both+'</b> times</li>':'');
}

/* ---------- Needs attention (Nov 20, 2026) ----------
   Red = needs you now. Gold = heads-up.
   Waiting rule = the app's rule: a scheduled draw in the last 14 days, 30 min after its draw time, with nothing on the site. */
const BASE_TITLE='Results Admin';
const WAIT_DAYS=14,RESULT_LAG=30,LATE_MIN=60;         // red once a result is more than 1 hour late
// magayo is the BACKUP since Nov 20, 2026 (BBN adds results automatically). Same rules as scripts/update_results.py:
const MAGAYO_FIRST=45,MAGAYO_GAP=40,MAGAYO_EVENING=3,MAGAYO_MAX_TRIES=4,MAGAYO_MORNING_H=6,CALLS_LOW=10; // red at 10 calls left or fewer
const BBN_USUAL_MIN=45; // BBN normally posts within minutes; before this, a waiting draw just says "waiting for BBN"
const BBN_LATE_MIN=180,BBN_TEST_FROM='2026-11-17';     // "BBN sent nothing" after 3 hours, only for draws since the BBN feed began (Nov 17, 2026)
const KEY_RED_DAYS=14,KEY_GOLD_DAYS=30;
const OTHER_KEYS=[{name:'Make.com GitHub key "Make BBN test"',exp:'2027-02-15',fix:'make a new one and paste it into Make\'s HTTP module (Authorization header)'}];
// when the magayo job runs (UTC minute, hour, weekdays): copied from .github/workflows/update-results.yml
const EVE=[0,2,3,4,5,6],ALL=[0,1,2,3,4,5,6];
const CRONS=[[45,2,EVE],[15,3,EVE],[45,3,EVE],[15,4,EVE],[45,4,EVE],[15,5,EVE],[45,5,EVE],[15,17,[0]],[15,18,[0]],[45,17,[1]],[23,20,[0,1]],[23,12,ALL]];
const EXP_KEY='bz-admin-key-exp';
let holidays=null,checks=null,usageFailed=false,usage=null,bbnData=null,runs=null,runsAt=0,loadErr='',attnTimer=0,headerExp='',sideErr='';

const HOLIDAY_GAMES=['boledo','pick3','fantasy5'];
const holidayOn=(g,iso)=>(HOLIDAY_GAMES.includes(g)&&holidays&&holidays.days&&holidays.days[iso])||null;
const getExp=()=>{try{return localStorage.getItem(EXP_KEY)||''}catch(e){return ''}};
const setExp=v=>{try{v?localStorage.setItem(EXP_KEY,v):localStorage.removeItem(EXP_KEY)}catch(e){}};
function noteExpiry(r){try{const h=r.headers.get('github-authentication-token-expiration');if(h){const d=new Date(h.replace(' ','T').replace(/ ([+-]\d\d)(\d\d)$/,'$1:$2'));if(!isNaN(d))headerExp=d.toISOString().slice(0,10)}}catch(e){}}
function drawStart(g,iso){const s=SCHED[g],[y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d,s.h+6,s.m)} // Belize = UTC-6
function bzClock(ms){const d=new Date(ms-6*3600e3),h=d.getUTCHours(),m=d.getUTCMinutes();
  const t=(h%12||12)+':'+pad(m,2)+(h<12?' am':' pm'),iso=d.toISOString().slice(0,10),today=bz().iso;
  return iso===today?t:iso===addDays(today,1)?'tomorrow '+t:fmtDay(iso)+' '+t}
function ago(mins){if(mins<60)return mins+' min';const h=Math.floor(mins/60);return h<48?h+' h'+(mins%60?' '+pad(mins%60,2)+' m':''):Math.floor(h/24)+' days'}
function nextCron(after){let best=null;const base=new Date(after);
  for(let i=0;i<9;i++){const day=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate()+i));
    CRONS.forEach(([mi,h,dows])=>{if(!dows.includes(day.getUTCDay()))return;const t=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),h,mi);if(t>after&&(best==null||t<best))best=t})}
  return best}

function waitingDraws(){
  if(!current)return[];const have=new Set((current.data.draws||[]).map(d=>d.id)),now=Date.now(),today=bz().iso,out=[];
  for(let i=0;i<WAIT_DAYS;i++){const iso=addDays(today,-i);
    Object.keys(SCHED).forEach(g=>{if(!SCHED[g].days.includes(dowOf(iso))||holidayOn(g,iso))return;const id=g+'-'+iso;if(have.has(id))return;
      const start=drawStart(g,iso),mins=Math.floor((now-start)/60000);if(mins<RESULT_LAG)return;
      out.push(Object.assign({id,game:g,date:iso,mins},magayoInfo(g,iso,id,start,now),{bbn:bbnFor(id)}))})}
  return out.sort((a,b)=>b.mins-a.mins)}
function magayoInfo(g,iso,id,start,now){
  const tries=(usage&&usage.tries&&usage.tries[id])||0,last=usage&&usage.last_try&&Date.parse(usage.last_try[id]||'');
  const bbnTxt=now-start<BBN_USUAL_MIN*60000?'Waiting for BBN (usually posts within minutes). ':'BBN hasn\'t sent it. ';
  if(!usage)return{tries,mag:bbnTxt+(usageFailed?'magayo status unknown (couldn\'t read data/api-usage.json)':'Checking magayo…')};
  if(iso<addDays(bz().iso,-13))return{tries,mag:'Too old for the automatic job: add it by hand.',gaveUp:true};
  if(tries>=MAGAYO_MAX_TRIES)return{tries,gaveUp:true,mag:bbnTxt+'magayo (backup) asked '+tries+' times with no answer. The job has stopped trying: add it by hand.'};
  let ready=start+MAGAYO_FIRST*60000;
  if(tries>=MAGAYO_EVENING)ready=start+MAGAYO_MORNING_H*3600e3;
  else if(tries&&last)ready=last+MAGAYO_GAP*60000;
  const next=nextCron(Math.max(now,ready)-1);
  const nextTxt=next?'magayo (backup) next try about '+bzClock(next):'no automatic magayo try scheduled';
  return{tries,mag:bbnTxt+(tries?'magayo asked '+tries+' time'+(tries===1?'':'s')+', not posted yet · ':'')+nextTxt};
}
function bbnFor(id){if(!bbnData)return null;const r=(bbnData.results||[]).filter(e=>e.draw&&e.draw.id===id);return r.length?r[r.length-1]:null}
const numTxt=d=>d.nums.join(' ')+(d.letter?' '+d.letter:'');

function waitRow(w,compact){
  const red=w.mins>=LATE_MIN||w.gaveUp,it=document.createElement('div');it.className='item '+(red?'red':'gold');
  const late=w.mins>=LATE_MIN?'<b class="tag">'+ago(w.mins)+' late</b>':'<b class="tag">waiting '+ago(w.mins)+'</b>';
  it.innerHTML='<div class="stack"><span><b>'+LABEL[w.game]+'</b> · '+fmtDay(w.date)+' · '+late+'</span>'+
    (compact?'':'<span class="why">'+esc(w.mag)+'</span>')+
    (w.bbn&&!compact?'<span class="why">'+srcName(w.bbn)+' has it: <b>'+esc(numTxt(w.bbn.draw))+'</b></span>':'')+'</div>';
  const btns=document.createElement('div');btns.className='btns';
  if(w.bbn&&!compact)btns.appendChild(tapTwice('Add '+srcName(w.bbn)+' result','Tap again to add',async()=>{
    await commit(d=>{if(d.draws.some(x=>x.id===w.id))throw new Error('The site already has '+LABEL[w.game]+' '+fmtDay(w.date)+'.');
      d.draws.push(Object.assign({},w.bbn.draw,{source:w.bbn.source||'bbn',added:new Date().toISOString().slice(0,19)+'Z'}))},'Admin: add '+w.id+' from BBN');
    msg($('msg'),'Added '+LABEL[w.game]+' '+fmtDay(w.date)+' from '+srcName(w.bbn)+': '+numTxt(w.bbn.draw)+'.','ok')}));
  const enter=document.createElement('button');enter.className='go';enter.textContent='Enter';enter.setAttribute('aria-label','Enter the '+LABEL[w.game]+' result for '+w.date);
  enter.onclick=()=>enterFor(w.game,w.date);btns.appendChild(enter);
  if(!compact)btns.appendChild(tapTwice('No draw','Tap again: no draw',async()=>{
    await commit(d=>{if(d.draws.some(x=>x.id===w.id))throw new Error('The site already has '+LABEL[w.game]+' '+fmtDay(w.date)+'.');
      d.draws.push({id:w.id,game:w.game,date:w.date,nodraw:true,source:'admin',added:new Date().toISOString().slice(0,19)+'Z'})},'Admin: no draw '+w.id);
    msg($('msg'),'Marked '+LABEL[w.game]+' '+fmtDay(w.date)+' as no draw. Remove it from "All past results" if that was a mistake.','ok')}));
  it.appendChild(btns);return it}
function tapTwice(label,sure,act){const b=document.createElement('button');b.textContent=label;
  b.onclick=async()=>{if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent=sure;setTimeout(()=>{if(!b.disabled){b.dataset.sure='';b.textContent=label}},5000);return}
    b.disabled=true;try{msg($('msg'),'Saving…');await act()}catch(e){msg($('msg'),'Not saved: '+e.message,'err');b.disabled=false;b.dataset.sure='';b.textContent=label}};
  return b}
function enterFor(g,iso){setGame(g);$('date').value=iso;$('entry').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>$('nums').focus({preventScroll:true}),350)}
function warnRow(red,title,text){const it=document.createElement('div');it.className='item '+(red?'red':'gold');
  it.innerHTML='<div class="stack"><span><b>'+esc(title)+'</b></span>'+(text?'<span class="why">'+esc(text)+'</span>':'')+'</div>';return it}

function otherWarnings(){
  const out=[],now=Date.now(),today=bz().iso;
  if(loadErr)out.push([true,'Can\'t load the results file',loadErr]);
  if(sideErr)out.push([false,'Some checks could not load',sideErr]);
  // GitHub jobs: the newest run of each job
  if(runs){const seen={};runs.forEach(r=>{if(seen[r.name]||r.status!=='completed')return;seen[r.name]=1;
    if(['failure','timed_out','startup_failure'].includes(r.conclusion)){
      const nice={'Update Belize results':'magayo backup job','pages build and deployment':'Website update (GitHub Pages)','Receive BBN result (test)':'BBN receiving job','Receive BBN result':'BBN receiving job (main source)','Send alerts after Admin save':'Alerts for results you post'}[r.name]||r.name;
      out.push([true,nice+' failed',bzClock(Date.parse(r.created_at))+'. Open GitHub → Actions to see why'+(r.name==='pages build and deployment'?'. Until it works, phones don\'t get new results.':'.')])}})}
  // magayo calls left this month
  if(usage&&usage.limit){const left=usage.limit-(usage.calls||0);
    if(left<=CALLS_LOW)out.push([true,'magayo calls running low: '+Math.max(0,left)+' of '+usage.limit+' left','The automatic job stops asking when it runs out. Calls reset on day '+(usage.reset_day||'?')+' of the month. Enter results by hand until then.'])}
  // keys
  const keys=[];const mine=headerExp||getExp();if(mine)keys.push({name:'This page\'s GitHub key ("Results admin")',exp:mine,fix:'make a new one on GitHub (same steps as when you connected), then Disconnect and connect with the new key'});
  keys.concat(OTHER_KEYS).forEach(k=>{const days=Math.round((Date.parse(k.exp+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/864e5);
    if(days<=KEY_GOLD_DAYS)out.push([days<=KEY_RED_DAYS,k.name+(days<0?' has EXPIRED':days===0?' expires TODAY':' expires in '+days+' day'+(days===1?'':'s')),'Expiry '+fmtDay(k.exp)+': '+k.fix+'.'])});
  // next year's public holidays (the government publishes them around October/November)
  if(holidays&&holidays.days){const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
    if(m>=10&&!Object.keys(holidays.days).some(k=>k.startsWith((y+1)+'-')))
      out.push([false,'Add the '+(y+1)+' public holidays','No '+(y+1)+' holidays are in the list yet. When the government publishes them (Belize Press Office, usually October or November), add them in the "Public holidays" box, or ask Claude to load them.'])}
  // magayo's overnight double-check of BBN results (never changes the site)
  if(checks&&checks.checks&&current){const site=new Map((current.data.draws||[]).map(d=>[d.id,d])),from=addDays(today,-WAIT_DAYS);
    Object.entries(checks.checks).forEach(([id,c])=>{if(c.status!=='differs')return;const [g,...r]=id.split('-'),iso=r.join('-');if(iso<from)return;
      const s=site.get(id);const m=c.magayo||{};const mt=(m.nums||[]).join(' ')+(m.letter?' '+m.letter:'');
      if(s&&!s.nodraw&&mt&&numTxt(s)===mt)return; // already fixed on the site
      out.push([true,'magayo disagrees with BBN: '+(LABEL[g]||g)+' '+fmtDay(iso),'The site shows '+(s&&!s.nodraw?numTxt(s):'?')+' (from BBN), magayo has '+mt+'. Check which is right; fix it with "Post a result" if the site is wrong.'])})}
  // BBN: disagreements, bad reads, and draws BBN never sent
  if(bbnData&&current){const site=new Map((current.data.draws||[]).map(d=>[d.id,d])),from=addDays(today,-WAIT_DAYS),recent=addDays(today,-3);
    (bbnData.results||[]).forEach(e=>{
      if(e.draw&&e.draw.date>=from){const s=site.get(e.draw.id);if(s&&!s.nodraw&&numTxt(s)!==numTxt(e.draw))
        out.push([true,srcName(e)+' and the site disagree: '+LABEL[e.draw.game]+' '+fmtDay(e.draw.date),srcName(e)+' read '+numTxt(e.draw)+', the site has '+numTxt(s)+'. Check which is right; fix it with "Post a result" if the site is wrong.'])}
      else if(!e.draw&&(e.status==='unreadable'||e.status==='invalid')&&(e.received||'').slice(0,10)>=recent)
        out.push([false,(e.source==='lovefm'?'Love FM post ':'BBN picture ')+(e.status==='unreadable'?'unclear':'read wrongly')+(e.date?': '+(LABEL[e.game]||e.game||'')+' '+e.date:''),'See the BBN & Love FM box below.'])});
    const missing=[];for(let i=0;i<3;i++){const iso=addDays(today,-i);if(iso<BBN_TEST_FROM)continue;
      Object.keys(SCHED).forEach(g=>{if(!SCHED[g].days.includes(dowOf(iso))||holidayOn(g,iso))return;const id=g+'-'+iso;const s=site.get(id);if(s&&(s.nodraw||s.source==='admin'))return; // posted by hand: not a gap
        if(now-drawStart(g,iso)>=BBN_LATE_MIN*60000&&!(bbnData.results||[]).some(e=>e.draw&&e.draw.id===id&&e.source!=='lovefm'))missing.push(LABEL[g]+' '+fmtDay(iso))})}
    if(missing.length)out.push([false,'BBN sent nothing for '+missing.length+' draw'+(missing.length===1?'':'s'),missing.join(', ')+'. Check Make.com → "BBN results (main)" → History (and whether BBN posted them on Facebook).'])}
  return out}

function renderAttention(){
  const box=$('attnBox'),list=$('attnList');if(!box||box.hidden&&!token)return;
  const waits=waitingDraws(),warns=otherWarnings();
  list.innerHTML='';
  const redCount=waits.filter(w=>w.mins>=LATE_MIN||w.gaveUp).length+warns.filter(w=>w[0]).length,total=waits.length+warns.length;
  if(waits.length){const h=document.createElement('p');h.className='sub';h.textContent=waits.length+' result'+(waits.length===1?' is':'s are')+' waiting';list.appendChild(h);
    waits.forEach(w=>list.appendChild(waitRow(w,false)))}
  if(warns.length){const h=document.createElement('p');h.className='sub';h.textContent='Other warnings';list.appendChild(h);
    warns.sort((a,b)=>b[0]-a[0]).forEach(([red,t,x])=>list.appendChild(warnRow(red,t,x)))}
  box.className='panel attn '+(redCount?'':total?'calm':'clear');
  $('attnTitle').innerHTML=total?'Needs attention <span class="count">'+total+'</span>':'✓ All results are in';
  if(!total)list.innerHTML='<p class="help">Nothing is waiting and nothing needs you. This box checks again every 2 minutes.</p>';
  $('attnWhen').textContent='Checked '+bzClock(Date.now())+' Belize time';
  document.title=(total?'('+total+') ':'')+BASE_TITLE;
}
async function ghJson(path){
  const r=await fetch(API.replace(/draws\.json$/,path)+'?ref='+BRANCH+'&t='+Date.now(),{cache:'no-store',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
  noteExpiry(r);if(r.status===404)return null;if(!r.ok)throw new Error(path+' ('+r.status+')');const j=await r.json();return JSON.parse(b64dec(j.content))}
async function loadRuns(){
  const url=`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs?per_page=30`;
  let r=await fetch(url,{cache:'no-store',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
  if(r.status===401||r.status===403||r.status===404)r=await fetch(url,{cache:'no-store',headers:{'Accept':'application/vnd.github+json'}}); // public repo: works without the key
  if(!r.ok)throw new Error('GitHub jobs ('+r.status+')');runs=(await r.json()).workflow_runs||[];runsAt=Date.now()}
async function refreshAttention(first){
  clearTimeout(attnTimer);if(!token)return;
  const errs=[];
  await Promise.all([
    first?null:load().then(()=>{loadErr=''}).catch(e=>{loadErr=e.message}),
    ghJson('data/api-usage.json').then(j=>{usage=j;usageFailed=!j}).catch(e=>{usageFailed=true;errs.push(e.message)}),
    ghJson('data/bbn-results.json').then(j=>{bbnData=j}).catch(e=>errs.push(e.message)),
    ghJson('data/magayo-checks.json').then(j=>{checks=j}).catch(e=>errs.push(e.message)),
    ghJson('data/holidays.json').then(j=>{holidays=j||{days:{}};showHolidays()}).catch(e=>errs.push(e.message)),
    Date.now()-runsAt>10*60000?loadRuns().catch(e=>errs.push(e.message)):null]);
  sideErr=errs.length?'Couldn\'t read: '+errs.join(', ')+'.':'';
  if(first&&current)loadErr='';
  showRecent2();
  attnTimer=setTimeout(()=>refreshAttention(false),120000);
}
function showRecent2(){if(current)showRecent();else renderAttention()}
$('attnRefresh').onclick=()=>{runsAt=0;$('attnWhen').textContent='Checking…';refreshAttention(false)};
$('keyExp').onchange=()=>{setExp($('keyExp').value);renderAttention()};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token)refreshAttention(false)});

/* ---------- Public holidays box: data/holidays.json ---------- */
const HOL_PATH='data/holidays.json';let holEdit=null;
function showHolidays(){
  const box=$('holList');if(!box||!holidays)return;box.innerHTML='';
  const today=bz().iso,from=addDays(today,-30);
  const keys=Object.keys(holidays.days||{}).filter(k=>k>=from).sort();
  if(!keys.length){box.innerHTML='<p class="help">No holidays in the list from the last 30 days on.</p>';return}
  keys.forEach(k=>{const h=holidays.days[k]||{};const it=document.createElement('div');it.className='item hol'+(k<today?' past':'');
    const games=HOLIDAY_GAMES.filter(g=>SCHED[g].days.includes(dowOf(k))).map(g=>LABEL[g]);
    it.innerHTML='<div class="stack"><span><b>'+fmtDay(k)+(k.slice(0,4)!==today.slice(0,4)?' '+k.slice(0,4):'')+'</b> · '+esc(h.name||'')+'</span>'+
      '<span class="why">'+esc(h.greeting||'')+'</span><small>'+(games.length?'No '+games.join(', ')+' draw':'No weekday game is drawn that day anyway')+'</small></div>';
    const btns=document.createElement('div');btns.className='btns';
    const ed=document.createElement('button');ed.textContent='Edit';ed.onclick=()=>{holEdit=k;$('holDate').value=k;$('holName').value=h.name||'';$('holGreet').value=h.greeting||'';
      $('holFormTitle').textContent='Edit holiday';$('holSave').textContent='Save changes';$('holCancel').hidden=false;$('holDate').closest('details').open=true;$('holDate').scrollIntoView({behavior:'smooth',block:'center'})};
    btns.appendChild(ed);
    btns.appendChild(tapTwice('Remove','Tap again to remove',async()=>{await holCommit(d=>{delete d.days[k]},'Admin: remove holiday '+k);msg($('holMsg'),'Removed '+fmtDay(k)+'.','ok')}));
    it.appendChild(btns);box.appendChild(it)});
}
async function holCommit(change,message){
  for(let attempt=0;attempt<3;attempt++){
    const url=API.replace(/draws\.json$/,HOL_PATH);
    const r=await fetch(url+'?ref='+BRANCH+'&t='+Date.now(),{cache:'no-store',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
    let sha,data;
    if(r.status===404){data={note:'Belize public and bank holidays (observed dates). No Boledo, Pick 3 or Fantasy 5 draw on these days.',games:HOLIDAY_GAMES.slice(),days:{}}}
    else if(!r.ok)throw new Error('Could not read '+HOL_PATH+' ('+r.status+')');
    else{const j=await r.json();sha=j.sha;data=JSON.parse(b64dec(j.content));data.days=data.days||{}}
    change(data);const sorted={};Object.keys(data.days).sort().forEach(k=>sorted[k]=data.days[k]);data.days=sorted;data.updated=bz().iso;
    const w=await fetch(url,{method:'PUT',headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({message,content:b64enc(JSON.stringify(data,null,1)+'\n'),branch:BRANCH},sha?{sha}:{}))});
    if(w.ok){holidays=data;showHolidays();renderAttention();return}
    if(w.status!==409&&w.status!==422||attempt===2)throw new Error(w.status===403||w.status===404?'The key can\'t save '+HOL_PATH+'. Check it has Contents: Read and write.':'GitHub error '+w.status);
  }
}
function holReset(){holEdit=null;$('holDate').value='';$('holName').value='';$('holGreet').value='';$('holFormTitle').textContent='Add a holiday';$('holSave').textContent='Add holiday';$('holCancel').hidden=true}
$('holName').addEventListener('input',()=>{if(!holEdit&&!$('holGreet').dataset.touched)$('holGreet').value=$('holName').value.trim()?'Happy '+$('holName').value.trim()+'! 🎉':''});
$('holGreet').addEventListener('input',()=>{$('holGreet').dataset.touched='1'});
$('holCancel').onclick=()=>{holReset();$('holMsg').className='msg'};
$('holSave').onclick=async()=>{
  const k=$('holDate').value,name=$('holName').value.trim(),greet=$('holGreet').value.trim()||('Happy '+name+'!');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(k)){msg($('holMsg'),'Pick the date.','err');return}
  if(!name){msg($('holMsg'),'Type the holiday name.','err');return}
  $('holSave').disabled=true;
  try{msg($('holMsg'),'Saving…');const old=holEdit;
    await holCommit(d=>{if(old&&old!==k)delete d.days[old];d.days[k]={name,greeting:greet}},(old?'Admin: edit holiday ':'Admin: add holiday ')+k+' '+name);
    msg($('holMsg'),(old?'Saved ':'Added ')+fmtDay(k)+': '+name+'. Phones pick it up within about 10 minutes.','ok');holReset();delete $('holGreet').dataset.touched}
  catch(e){msg($('holMsg'),'Not saved: '+e.message,'err')}
  finally{$('holSave').disabled=false}
};

async function start(){
  token=getTok();if(!acted)scrollTo(0,0);
  if(!token){$('attnBox').hidden=true;$('holBox').hidden=true;document.title=BASE_TITLE;$('connect').hidden=false;$('entry').hidden=$('recentBox').hidden=$('allBox').hidden=$('bbnBox').hidden=$('backupBox').hidden=$('deviceBox').hidden=true;return}
  $('connect').hidden=true;$('holBox').hidden=$('attnBox').hidden=$('entry').hidden=$('recentBox').hidden=$('allBox').hidden=$('bbnBox').hidden=$('backupBox').hidden=$('deviceBox').hidden=false;loadBbn();setGame(game);
  $('keyExp').value=getExp();
  try{await load();loadErr=''}catch(e){loadErr=e.message;renderAttention();msg($('msg'),e.message,'err')}
  refreshAttention(true);
}
$('saveToken').onclick=async()=>{const t=$('token').value.trim();if(!/^(github_pat_|ghp_)/.test(t)){msg($('connMsg'),'That doesn\'t look like a GitHub access key.','err');return}
  token=t;msg($('connMsg'),'Checking…');
  try{await load();if(!setTok(t)){msg($('connMsg'),'This browser won\'t save it (private mode?). It will work until you close the page.','info')}$('token').value='';start()}
  catch(e){token='';msg($('connMsg'),e.message,'err')}};
$('forget').onclick=()=>{setTok('');token='';current=null;start()};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setGame(b.dataset.g));
$('nums').addEventListener('input',()=>{$('confirm').classList.remove('show');preview()});
$('nums').addEventListener('keydown',e=>{if(e.key==='Enter')review()});
$('review').onclick=review;
start();
})();
