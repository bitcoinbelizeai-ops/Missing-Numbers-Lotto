/* Shared logic for the tracker page and the phone app.
   startApp(adapter): adapter = {subscribe(cb), save(list)->Promise, remove(id)->Promise} */
function startApp(adapter){
'use strict';
const $=id=>document.getElementById(id);
const pad=(n,w)=>String(n).padStart(w,'0');
const fmtDate=s=>{try{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}catch(e){return s}};
const fmtDay=s=>{try{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}catch(e){return s}};
const todayISO=()=>{const t=new Date();return t.getFullYear()+'-'+pad(t.getMonth()+1,2)+'-'+pad(t.getDate(),2)};
const range=(a,b)=>{const r=[];for(let i=a;i<=b;i++)r.push(pad(i,2));return r};
const digitsOf=tokens=>tokens.map(t=>t.replace(/\D/g,'')).filter(Boolean);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- the four games ---------- */
const GAMES={
  boledo:{label:'Boledo',mode:'board',board:range(0,99),wins:['10','20','30','all'],def:'30',
    ph:'41',hint:'Type the winning number, like 41.',
    keys:d=>[pad(d.nums[0],2)],show:d=>pad(d.nums[0],2),
    make(t){const n=digitsOf(t);if(!n.length||n[0].length>2)return null;return{nums:[pad(n[0],2)]}}},
  lottery:{label:'Sunday Lottery',mode:'board',board:range(0,99),wins:['10','20','30','all'],def:'30',
    ph:'1652 0188 7876',hint:'Type the 1st, 2nd and 3rd prize numbers with spaces between, like 1652 0188 7876.',
    note:'For the Sunday Lottery, we count the last two digits of the 1st, 2nd and 3rd prize.',
    keys:d=>d.nums.map(n=>pad(n,4).slice(-2)),show:d=>d.nums.map(n=>pad(n,4)).join(' · '),
    make(t){const n=digitsOf(t).filter(x=>x.length<=4);if(!n.length)return null;return{nums:n.slice(0,3).map(x=>pad(x,4))}}},
  fantasy5:{label:'Fantasy 5',mode:'board',board:range(1,39),wins:['5','10','15','all'],def:'10',
    ph:'12 18 25 27 33 Y',hint:'Type the five numbers with spaces between, then the letter if you have it, like 12 18 25 27 33 Y.',
    keys:d=>d.nums.map(n=>pad(n,2)),show:d=>d.nums.map(n=>pad(n,2)).join(' ')+(d.letter?' · '+d.letter:''),
    make(t){const letter=(t.find(x=>/^[A-Za-z]$/.test(x))||'').toUpperCase();
      const n=[...new Set(digitsOf(t).map(Number))].filter(x=>x>=1&&x<=39);
      if(n.length!==5)return null;const o={nums:n.sort((a,b)=>a-b).map(x=>pad(x,2))};if(letter)o.letter=letter;return o}},
  pick3:{label:'Pick 3',mode:'position',board:['0','1','2','3','4','5','6','7','8','9'],wins:['5','10','15','all'],def:'10',
    ph:'390',hint:'Type the three digits in order, like 390.',
    show:d=>d.nums.join('-'),
    make(t){let n=digitsOf(t);if(n.length===1&&n[0].length===3)n=n[0].split('');if(n.length<3||n.slice(0,3).some(x=>x.length!==1))return null;return{nums:n.slice(0,3)}}}
};
const ORDER=['boledo','lottery','fantasy5','pick3'];
/* draw days (0=Sun), worked out from past results; used to spot missing draws */
const SCHED={boledo:[1,2,3,4,5],pick3:[1,2,3,4,5],fantasy5:[2,4,6],lottery:[0]};
const NUDGE_DAYS=14;
const ENCOURAGE=['Sharp eye! Your board is up to date.',"That's a winner's habit: every draw counted.",'Nice work! You stay one step ahead.','Every number tracked. That\'s how the pros do it.','Your board is fresh and ready.'];
const real=list=>list.filter(d=>!d.nodraw);
const SPOTS=['1st','2nd','3rd'];
const ERR={boledo:'Type a number from 00 to 99.',lottery:'Type at least the 1st prize number (up to 4 digits).',
  fantasy5:'Type five different numbers from 1 to 39.',pick3:'Type three digits, like 390.'};

/* ---------- settings remembered on this device ---------- */
const PREF='bz-prefs-v1';
let prefs={game:'boledo',wins:{}};
try{Object.assign(prefs,JSON.parse(localStorage.getItem(PREF)||'{}'))}catch(e){}
const state={game:GAMES[prefs.game]?prefs.game:'boledo',wins:Object.assign({},prefs.wins||{}),draws:[],sample:null,canWrite:true,loaded:false};
const curWin=()=>{const G=GAMES[state.game],w=state.wins[state.game];return G.wins.includes(w)?w:G.def};
const savePrefs=()=>{try{localStorage.setItem(PREF,JSON.stringify({game:state.game,wins:state.wins}))}catch(e){}};

/* ---------- game tabs and look-back chips ---------- */
const seg=$('gameSeg');
const BALL={boledo:'00',lottery:'1st',fantasy5:'5',pick3:'3'};
ORDER.forEach(g=>{const b=document.createElement('button');b.type='button';b.dataset.g=g;
  b.innerHTML='<span class="tile gball" data-game="'+g+'"><span>'+BALL[g]+'</span></span><span class="gtxt"><b>'+esc(GAMES[g].label).replace(/ (\d)$/,'&nbsp;$1')+'</b><small id="gl-'+g+'">&nbsp;</small></span>';
  b.onclick=()=>{state.game=g;savePrefs();setup();render()};seg.appendChild(b)});
function setup(){
  const G=GAMES[state.game];
  document.body.dataset.game=state.game;
  const box=$('winSeg');box.innerHTML='';
  G.wins.forEach(w=>{const b=document.createElement('button');b.type='button';b.dataset.w=w;b.textContent=w==='all'?'All':w;
    b.setAttribute('aria-label',w==='all'?'All draws':'Last '+w+' draws');
    b.onclick=()=>{state.wins[state.game]=w;savePrefs();render()};box.appendChild(b)});
  $('quickNums').placeholder=G.ph;
  $('quickNums').inputMode=state.game==='fantasy5'?'text':'numeric';
  $('quickLabel').textContent=G.label+' numbers';
  $('addHint').textContent=G.hint;
  $('addBall').dataset.game=state.game;$('addBallTxt').textContent=BALL[state.game];$('addGameName').textContent=G.label;
  renderSlots();
}

/* ---------- drawing helpers ---------- */
function drawsFor(){
  const src=real(state.sample||state.draws);
  return src.filter(d=>d.game===state.game).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
}
function ballEl(k,small){const t=document.createElement('div');t.className='tile'+(small?' sm':'');const s=document.createElement('span');s.textContent=k;t.appendChild(s);return t}
function ballWithTag(k,tagHTML,detail){const w=document.createElement('button');w.type='button';w.className='bwrap';w.appendChild(ballEl(k));
  const t=document.createElement('div');t.className='tag';t.innerHTML=tagHTML;w.appendChild(t);
  if(detail){w.dataset.detail=detail;w.setAttribute('aria-label',k+'. '+detail.replace(/<[^>]+>/g,''))}return w}
/* a grid of balls plus the note that appears when one is tapped */
function grid(items,extra){const set=document.createElement('div');set.className='ballset';
  const g=document.createElement('div');g.className='tiles'+(extra?' '+extra:'');items.forEach(el=>g.appendChild(el));
  const p=document.createElement('p');p.className='balldetail';p.hidden=true;p.setAttribute('aria-live','polite');
  set.append(g,p);return set}
/* per-key facts for the tap note: last date, draws since, times in the chosen draws */
function factsFor(allSeq,dates,n){
  const m={},L=allSeq.length;
  allSeq.forEach((ks,i)=>ks.forEach(k=>{const f=m[k]||(m[k]={last:-1,inWin:0});f.last=i;if(i>=L-n)f.inWin++}));
  return (k,prefix)=>{const f=m[k],span='the last '+n+' draw'+(n===1?'':'s');
    if(!f)return prefix+'Not seen in any of the '+L+' draws we have.';
    const out=L-1-f.last;
    return prefix+'Last played <b>'+esc(fmtDay(dates[f.last]))+'</b> · '+(out===0?'in the latest draw':out+' draw'+(out===1?'':'s')+' ago')+(f.inWin?' · played <b>'+f.inWin+'</b> time'+(f.inWin===1?'':'s')+' in '+span:'')+'.'}
}
const outTag=(o,total)=>o==null?'<b>'+total+'+</b> draws':o===1?'<b>1</b> draw':'<b>'+o+'</b> draws';
const hotTag=c=>'<b>'+c+'</b> times';

/* how many draws since each key last played, across all history.
   seq: list of key-arrays, oldest first. Returns {key: drawsOut or null if never seen} */
function drawsOut(seq,board){
  const out={};board.forEach(k=>out[k]=null);
  for(let i=seq.length-1;i>=0;i--){seq[i].forEach(k=>{if(k in out&&out[k]===null)out[k]=seq.length-1-i})}
  return out;
}
function counts(seq,board){const c={};board.forEach(k=>c[k]={n:0,last:-1});seq.forEach((ks,i)=>ks.forEach(k=>{if(c[k]){c[k].n++;c[k].last=i}}));return c}
function hotList(seq,board,max){
  const c=counts(seq,board);
  return board.filter(k=>c[k].n>=2).sort((a,b)=>c[b].n-c[a].n||c[b].last-c[a].last).slice(0,max).map(k=>[k,c[k].n]);
}
function missingSorted(winSeq,allSeq,board){
  const seen=new Set();winSeq.forEach(ks=>ks.forEach(k=>seen.add(k)));
  const out=drawsOut(allSeq,board);
  const total=allSeq.length;
  return board.filter(k=>!seen.has(k)).map(k=>[k,out[k]])
    .sort((a,b)=>(b[1]==null?total+1:b[1])-(a[1]==null?total+1:a[1])||(a[0]<b[0]?-1:1));
}

/* ---------- render ---------- */
function render(){
  const G=GAMES[state.game],W=curWin();
  seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.g===state.game));
  $('winSeg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.w===W));
  $('sampleBanner').hidden=!state.sample;
  $('addForm').hidden=!state.canWrite;
  if($('readonlyNote'))$('readonlyNote').hidden=state.canWrite;

  renderNudge();
  // freshness line: newest result across all games
  const src=real(state.sample||state.draws);
  const newest=src.reduce((m,d)=>d.date>m?d.date:m,'');
  ORDER.forEach(g=>{const l=src.filter(d=>d.game===g).reduce((m,d)=>d.date>m?d.date:m,'');
    const el=$('gl-'+g);if(el)el.textContent=l?'Last draw '+fmtDate(l).replace(/,? \d{4}$/,''):'No results yet'});
  $('fresh').innerHTML=newest?'Latest results: <b>'+esc(fmtDate(newest))+'</b>':'';

  const all=drawsFor();
  const win=W==='all'?all:all.slice(-Number(W));
  const body=$('tiles'),hot=$('hot'),last=$('lastDraw');
  body.innerHTML='';hot.innerHTML='';last.innerHTML='';
  $('note').textContent='';$('hotSay').textContent='';$('lastDate').textContent='';

  /* last draw */
  if(all.length){
    const d=all[all.length-1];
    const many=state.game!=='boledo';
    const badge=document.createElement('p');badge.className='winbadge';badge.textContent=many?'Winning Numbers':'Winning Number';last.appendChild(badge);
    const animKey=state.game+'|'+d.id+'|'+(state.sample?'s':'r');
    const roll=animKey!==lastAnim;lastAnim=animKey;
    last.classList.toggle('roll',roll);
    $('lastDate').textContent=fmtDay(d.date);
    let bi=0;
    if(state.game==='lottery'){
      d.nums.forEach((n,i)=>{const row=document.createElement('div');row.className='prizerow';
        const lab=document.createElement('span');lab.className='prizelab';lab.textContent=['1st','2nd','3rd'][i]+' prize';row.appendChild(lab);
        pad(n,4).split('').forEach((dg,j)=>{const t=ballEl(dg,true);t.classList.add('xs');if(j>=2)t.classList.add('counted');t.style.setProperty('--i',bi++);row.appendChild(t)});
        last.appendChild(row)});
      const ln=document.createElement('p');ln.className='lnote';ln.textContent='The gold-ringed balls are the last two digits, the ones the board counts.';last.appendChild(ln);
    }else{
      (state.game==='boledo'?[pad(d.nums[0],2)]:d.nums.map(String)).forEach(k=>{const t=ballEl(k,true);t.style.setProperty('--i',bi++);last.appendChild(t)});
      if(d.letter){const l=document.createElement('div');l.className='letter';l.textContent=d.letter;l.title='Free letter';l.style.setProperty('--i',bi++);last.appendChild(l)}
    }
  }else{last.innerHTML='<p class="empty">No '+esc(G.label)+' results yet.</p>'}

  const say=$('say');
  if(!state.loaded&&!state.sample){say.textContent='Loading results…'}
  else if(!win.length){say.textContent='There are no '+G.label+' results yet. Add one at the bottom of the page.'}
  else{
    const n=win.length,span=n===1?'the last draw':'the last <b>'+n+'</b> draws';
    const dates='Draws from '+fmtDate(win[0].date)+' to '+fmtDate(win[win.length-1].date)+'.';
    if(G.mode==='board'){
      const winSeq=win.map(G.keys),allSeq=all.map(G.keys);
      const facts=factsFor(allSeq,all.map(d=>d.date),n);
      const missing=missingSorted(winSeq,allSeq,G.board);
      say.innerHTML=missing.length===1?'This <b>1</b> number has <em>not</em> played in '+span+'.'
        :missing.length?'These <b>'+missing.length+'</b> numbers have <em>not</em> played in '+span+'. Longest wait first. Under each ball: how many draws since it last played. Tap a ball for more.'
        :'Every number from '+G.board[0]+' to '+G.board[G.board.length-1]+' has played in '+span+'.';
      if(missing.length)body.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,'<b>'+k+'</b> · ')))));
      $('note').textContent=dates+(G.note?' '+G.note:'');
      const hl=hotList(winSeq,G.board,state.game==='fantasy5'?6:8);
      $('hotSay').innerHTML=hl.length?'These numbers played the most in '+span+'. Under each ball: how many times.':'No number has played more than once in '+span+'. Try more draws.';
      if(hl.length)hot.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,'<b>'+k+'</b> · '))),'hot'));
    }else{
      let total=0,anyHot=false;
      SPOTS.forEach((spot,i)=>{
        const winSeq=win.map(d=>[String(d.nums[i])]),allSeq=all.map(d=>[String(d.nums[i])]);
        const facts=factsFor(allSeq,all.map(d=>d.date),n),pre=k=>'<b>'+k+'</b> in the '+spot+' spot · ';
        const missing=missingSorted(winSeq,allSeq,G.board);total+=missing.length;
        const row=document.createElement('div');row.className='posrow';
        row.innerHTML='<h3>'+spot+' digit</h3>';
        if(missing.length)row.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,pre(k))))));
        else row.insertAdjacentHTML('beforeend','<p class="allplayed">Every digit has played here.</p>');
        body.appendChild(row);
        const hl=hotList(winSeq,G.board,3);
        const hrow=document.createElement('div');hrow.className='posrow';hrow.innerHTML='<h3>'+spot+' digit</h3>';
        if(hl.length){anyHot=true;hrow.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,pre(k)))),'hot'))}
        else hrow.insertAdjacentHTML('beforeend','<p class="allplayed">No digit has played twice here.</p>');
        hot.appendChild(hrow);
      });
      say.innerHTML=total?'These digits have <em>not</em> played in each spot in '+span+'. Longest wait first. Under each ball: how many draws since it last played. Tap a ball for more.'
        :'Every digit from 0 to 9 has played in every spot in '+span+'.';
      $('hotSay').innerHTML=anyHot?'The digits that played the most in each spot in '+span+'.':'No digit has played more than once in any spot. Try more draws.';
      $('note').textContent=dates+' Each row is one spot in the Pick 3 number, read left to right.';
    }
    shadeColumns();
  }

  const h=$('hist');h.innerHTML='';
  // past results plus skipped ("no draw") dates for this game, newest first
  const rows=(state.sample||state.draws).filter(d=>d.game===state.game).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  $('histEmpty').hidden=rows.length>0;
  $('histEmpty').textContent='No '+G.label+' results yet.';
  rows.forEach(d=>{const tr=document.createElement('tr');if(d.nodraw)tr.className='skipped';
    const a=document.createElement('td');a.textContent=fmtDate(d.date);
    const b=document.createElement('td');b.className='num';b.textContent=d.nodraw?'No draw (skipped)':G.show(d);
    const td=document.createElement('td');td.className='x';
    if(!state.sample&&state.canWrite){const x=document.createElement('button');x.type='button';
      if(d.nodraw){x.className='undo';x.textContent='Undo';x.setAttribute('aria-label','Undo skip for '+d.date);
        x.onclick=()=>undoSkip(d)}
      else{x.className='del';x.textContent='Remove';x.setAttribute('aria-label','Remove draw on '+d.date);
        x.onclick=async()=>{try{await adapter.remove(d.id);toast('Removed '+fmtDate(d.date))}catch(e){toast("That draw wasn't removed. Try again.")}}}
      td.appendChild(x)}
    tr.append(a,b,td);h.appendChild(tr)});
}

/* alternate light/dark shade by column, whatever the screen width */
function shadeColumns(){
  document.querySelectorAll('.answer-body .tiles').forEach(g=>{
    const cols=getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length||1;
    [...g.children].forEach((t,i)=>t.classList.toggle('alt',(i%cols)%2===1))});
}
let lastAnim='';
function onBallTap(e){
  const b=e.target.closest('.bwrap');if(!b||!b.dataset.detail)return;
  const was=b.classList.contains('sel');
  document.querySelectorAll('.bwrap.sel').forEach(x=>{x.classList.remove('sel');x.setAttribute('aria-pressed','false')});
  document.querySelectorAll('.balldetail').forEach(p=>p.hidden=true);
  if(was)return;
  b.classList.add('sel');b.setAttribute('aria-pressed','true');
  const p=b.closest('.ballset').querySelector('.balldetail');p.innerHTML=b.dataset.detail;p.hidden=false;
}
$('tiles').addEventListener('click',onBallTap);$('hot').addEventListener('click',onBallTap);
try{const ro=new ResizeObserver(shadeColumns);ro.observe($('tiles'));ro.observe($('hot'))}catch(e){window.addEventListener('resize',shadeColumns)}

let toastTimer;
function toast(t,html,ms){const el=$('toast');if(!el)return;if(html)el.innerHTML=t;else el.textContent=t;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,ms||(html?4200:2400))}
async function undoSkip(d){
  const id=d.id||(d.game+'-'+d.date);
  try{await adapter.remove(id);delete recentSkips[id];renderNudge();toast(GAMES[d.game].label+' '+fmtDate(d.date)+' is back on the waiting list')}
  catch(e){toast("That didn't undo. Try again.")}
}

/* ---------- missing-draw nudges ---------- */
function isoOf(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1,2)+'-'+pad(dt.getDate(),2)}
function missingDraws(){
  const have=new Set((state.draws||[]).map(d=>d.id));
  const now=new Date(),out=[];
  const lastDay=new Date(now);if(now.getHours()<21)lastDay.setDate(now.getDate()-1); // tonight's draws count after 9 pm
  for(let i=0;i<NUDGE_DAYS;i++){const dt=new Date(lastDay);dt.setDate(lastDay.getDate()-i);const iso=isoOf(dt);
    ORDER.forEach(g=>{if(SCHED[g].includes(dt.getDay())&&!have.has(g+'-'+iso))out.push({game:g,date:iso})})}
  return out; // newest first
}
const recentSkips={}; // id -> {game,date}: just-skipped rows that offer Undo for a few seconds
const SKIP_UNDO_MS=8000;
/* remember whether the waiting box is shown or hidden on this device */
(function(){const n=$('nudge');if(!n)return;
  try{if(localStorage.getItem('bz-nudge-open')==='0')n.open=false}catch(e){}
  n.addEventListener('toggle',()=>{try{localStorage.setItem('bz-nudge-open',n.open?'1':'0')}catch(e){}})})();
function renderNudge(){
  const box=$('nudge');if(!box)return;
  if(state.sample||!state.canWrite||!state.loaded){box.hidden=true;return}
  const miss=missingDraws();
  const skips=Object.values(recentSkips);
  if(!miss.length&&!skips.length){box.hidden=true;return}
  box.hidden=false;
  $('nudgeTitle').textContent=miss.length===0?'All results are in':miss.length===1?'1 result is waiting':miss.length+' results are waiting';
  const list=$('nudgeList');list.innerHTML='';
  const rows=miss.slice(0,3).map(m=>Object.assign({kind:'miss'},m)).concat(skips.map(k=>Object.assign({kind:'skip'},k)))
    .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(a.game<b.game?-1:1));
  rows.forEach(m=>{const li=document.createElement('li');li.dataset.game=m.game;
    const when=esc(fmtDay(m.date).replace(/,? \d{4}$/,''));
    if(m.kind==='skip'){
      li.className='skipped';
      li.innerHTML='<span class="ndot dot-'+m.game+'"></span><span class="ntext"><b>Skipped · '+esc(GAMES[m.game].label)+'</b><small>'+when+' marked as no draw</small></span>';
      const u=document.createElement('button');u.type='button';u.className='btn small undo-btn';u.textContent='Undo';
      u.setAttribute('aria-label','Undo skip for '+GAMES[m.game].label+' on '+fmtDate(m.date));u.onclick=()=>undoSkip(m);
      const bar=document.createElement('span');bar.className='undo-bar';bar.style.animationDuration=Math.max(0,m.until-Date.now())+'ms';
      li.append(u,bar);list.appendChild(li);return}
    li.innerHTML='<span class="ndot dot-'+m.game+'"></span><span class="ntext"><b>'+esc(GAMES[m.game].label)+'</b><small>'+when+'</small></span>';
    const add=document.createElement('button');add.type='button';add.className='btn small';add.textContent='Enter result';add.setAttribute('aria-label','Add '+GAMES[m.game].label+' for '+fmtDate(m.date));add.onclick=()=>openAdd(m.game,m.date);
    const no=document.createElement('button');no.type='button';no.className='linkbtn';no.textContent='No draw this day? Skip it';no.title='Choose this if there was no draw that day';no.setAttribute('aria-label','No '+GAMES[m.game].label+' draw on '+fmtDate(m.date));
    no.onclick=async()=>{const id=m.game+'-'+m.date;
      try{await adapter.save([{id,game:m.game,date:m.date,nums:[],nodraw:true}]);
        recentSkips[id]={id,game:m.game,date:m.date,until:Date.now()+SKIP_UNDO_MS};renderNudge();
        setTimeout(()=>{if(recentSkips[id]){delete recentSkips[id];renderNudge()}},SKIP_UNDO_MS)}
      catch(e){toast("That didn't save. Try again.")}};
    li.append(add,no);list.appendChild(li)});
  $('nudgeMore').textContent=miss.length>3?'+ '+(miss.length-3)+' more from the last two weeks':'';
}
function nextMissingDate(g){const m=missingDraws().find(x=>x.game===g);return m?m.date:todayISO()}
function openAdd(g,date){
  if(state.game!==g){state.game=g;savePrefs();setup();render()}
  const fold=$('addFold');fold.open=true;$('dDate').value=date;$('addMsg').textContent='';
  fold.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>{try{$('quickNums').focus({preventScroll:true})}catch(e){$('quickNums').focus()}},350);
}

/* live preview of the numbers being typed, shaped like the chosen game */
function renderSlots(){
  const box=$('slots');if(!box)return;box.innerHTML='';
  const toks=$('quickNums').value.trim().split(/[\s,;\-\/.]+/).filter(Boolean);
  const dig=toks.map(t=>t.replace(/\D/g,'')).filter(Boolean);
  const slot=(v,cls)=>{const t=ballEl(v||'?',true);t.classList.add('xs');if(cls)t.classList.add(cls);if(!v)t.classList.add('blank');return t};
  const g=state.game;
  if(g==='boledo'){box.appendChild(slot(dig[0]?dig[0].slice(0,2):''))}
  else if(g==='pick3'){const d=(dig.length===1?dig[0]:dig.map(x=>x[0]).join('')).slice(0,3).split('');for(let i=0;i<3;i++)box.appendChild(slot(d[i]||''))}
  else if(g==='fantasy5'){for(let i=0;i<5;i++)box.appendChild(slot(dig[i]?dig[i].slice(0,2):''));
    const l=document.createElement('div');l.className='letter sm'+((toks.find(x=>/^[A-Za-z]$/.test(x)))?'':' blank');l.textContent=(toks.find(x=>/^[A-Za-z]$/.test(x))||'?').toUpperCase();box.appendChild(l)}
  else{['1st','2nd','3rd'].forEach((lab,i)=>{const row=document.createElement('div');row.className='prizerow';
    const sp=document.createElement('span');sp.className='prizelab';sp.textContent=lab+' prize';row.appendChild(sp);
    const d=(dig[i]||'').slice(0,4).split('');for(let j=0;j<4;j++)row.appendChild(slot(d[j]||'',j>=2?'counted':''));box.appendChild(row)})}
}
$('quickNums').addEventListener('input',renderSlots);

/* ---------- adding a result: one box ---------- */
function makeDraw(game,date,tokens){const o=GAMES[game].make(tokens);return o?Object.assign({id:game+'-'+date,game,date},o):null}
function flash(text,ok){const m=$('addMsg');m.textContent=text;m.className='msg '+(ok?'ok':'err')}
$('addFold').addEventListener('toggle',()=>{if($('addFold').open&&!$('quickNums').value)$('dDate').value=nextMissingDate(state.game)});
$('dDate').value=todayISO();
$('addForm').addEventListener('submit',async e=>{e.preventDefault();
  if(state.sample){flash('Go back to real results first, then add a result.',false);return}
  const date=$('dDate').value;
  const tokens=$('quickNums').value.trim().split(/[\s,;\-\/.]+/).filter(Boolean);
  const d=date&&makeDraw(state.game,date,tokens);
  if(!d){flash(ERR[state.game],false);return}
  const replacing=(state.draws||[]).some(x=>x.id===d.id);
  try{await adapter.save([d]);
    flash((replacing?'Updated ':'Added ')+GAMES[state.game].label+' for '+fmtDate(date)+': '+GAMES[state.game].show(d),true);
    $('quickNums').value='';renderSlots();
    toast('<b>Board Updated · <span class="nw">'+esc(GAMES[state.game].show(d))+'</span> Added</b><br>'+esc(ENCOURAGE[Math.floor(Math.random()*ENCOURAGE.length)]),true);
    const nx=missingDraws().find(x=>x.game===state.game);if(nx)$('dDate').value=nx.date}
  catch(err){flash("That result didn't save. "+(err&&err.message?err.message:'Try again.'),false)}
});

/* ---------- practice numbers (made up, never saved) ---------- */
$('sampleBtn').onclick=()=>{
  let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
  const out=[];const t=new Date();
  for(let i=0;i<150;i++){const d=new Date(t);d.setDate(t.getDate()-i-1);const day=d.getDay();
    const iso=d.getFullYear()+'-'+pad(d.getMonth()+1,2)+'-'+pad(d.getDate(),2);
    if(day!==0)out.push({id:'boledo-'+iso,game:'boledo',date:iso,nums:[pad(Math.floor(rnd()*100),2)]});
    if(day===0)out.push({id:'lottery-'+iso,game:'lottery',date:iso,nums:[0,1,2].map(()=>pad(Math.floor(rnd()*10000),4))});
    if(day===2||day===4||day===6){const s=new Set();while(s.size<5)s.add(1+Math.floor(rnd()*39));
      out.push({id:'fantasy5-'+iso,game:'fantasy5',date:iso,nums:[...s].sort((a,b)=>a-b).map(x=>pad(x,2)),letter:String.fromCharCode(65+Math.floor(rnd()*26))})}
    if(day>=1&&day<=5)out.push({id:'pick3-'+iso,game:'pick3',date:iso,nums:[0,1,2].map(()=>String(Math.floor(rnd()*10)))});
  }
  state.sample=out;render();window.scrollTo({top:0,behavior:'smooth'});
};
$('clearSample').onclick=()=>{state.sample=null;render()};

setup();render();
adapter.subscribe(rows=>{state.draws=rows;state.loaded=true;render()});
return{setCanWrite(v){state.canWrite=v;render()},toast,todayISO,getDraws:()=>state.draws};
}

(function(){
'use strict';
const $=id=>document.getElementById(id);
/* Results come from two places:
   1. draws.json, shipped with the app. Replace that file on your website to give everyone new results.
   2. Draws added on this phone, kept in this phone's storage.
   Draws removed on this phone are remembered so they don't come back from draws.json. */
const MINE='bz-mine-v1',GONE='bz-removed-v1',CACHE='bz-shipped-v1';
const load=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k)||'null');return v==null?f:v}catch(e){return f}};
const store=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};
let mine=load(MINE,{}),gone=load(GONE,{}),shipped=load(CACHE,{updated:null,draws:[]});
let cb=()=>{};
const fmt=s=>{try{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}catch(e){return s}};
function allDraws(){
  const map={};
  (shipped.draws||[]).forEach(d=>{if(!gone[d.id])map[d.id]=d});
  Object.values(mine).forEach(d=>{map[d.id]=d});
  return Object.values(map);
}
const push=()=>cb(allDraws());
const adapter={
  subscribe(f){cb=f;push()},
  async save(list){list.forEach(d=>{mine[d.id]=d;delete gone[d.id]});
    if(!(store(MINE,mine)&&store(GONE,gone)))throw new Error("This phone's storage is full or turned off.");push()},
  async remove(id){delete mine[id];gone[id]=1;store(MINE,mine);store(GONE,gone);push()}
};
const app=startApp(adapter);

async function refreshShipped(){
  try{const r=await fetch('draws.json',{cache:'no-cache'});if(!r.ok)throw 0;const j=await r.json();
    if(j&&Array.isArray(j.draws)){shipped=j;store(CACHE,j)}}catch(e){}
  $('storeNote').textContent=(shipped.updated?'Built-in results updated '+fmt(shipped.updated)+'. ':'')+'Draws you add are saved on this phone.';
  push();
}

/* backup / restore */
$('backupBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify({app:'boledo-missing-numbers',saved:app.todayISO(),draws:allDraws()},null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='boledo-backup-'+app.todayISO()+'.json';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);app.toast('Backup saved');
};
$('restoreFile').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const j=JSON.parse(await f.text());
    const ok=['boledo','lottery','fantasy5','pick3'];
    const list=(j.draws||[]).filter(d=>d&&d.id&&d.date&&Array.isArray(d.nums)&&ok.includes(d.game));
    if(!list.length)throw 0;await adapter.save(list);app.toast('Restored '+list.length+' draws');
  }catch(err){app.toast("That file isn't a backup from this app.")}
  e.target.value='';
};

/* install */
const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
let deferred=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;if(standalone)return;
  $('installBar').hidden=false;$('installBtn').hidden=false;$('installText').textContent='Put this app on your home screen.'});
$('installBtn').onclick=async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice}catch(e){}deferred=null;$('installBar').hidden=true};
window.addEventListener('appinstalled',()=>{$('installBar').hidden=true});
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(ios&&!standalone){$('installBar').hidden=false;$('installText').textContent='To install: tap the Share button, then "Add to Home Screen".'}
if('serviceWorker' in navigator&&location.protocol!=='file:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
refreshShipped();
})();
