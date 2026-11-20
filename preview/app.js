/* Shared logic for the tracker page and the phone app.
   startApp(adapter): adapter = {subscribe(cb), save(list)->Promise, remove(id)->Promise} */
function startApp(adapter){
'use strict';
// if a page element is missing (for example index.html is older than app.js after a partial upload),
// hand back a spare element so the rest of the app still loads instead of stopping
const $=id=>{const el=document.getElementById(id);if(el)return el;
  if(!$.warned){$.warned=true;console.warn('Missing page element #'+id+': index.html may be older than app.js. Upload all the files together.')}
  const d=document.createElement('div');d.id=id;d.hidden=true;return d};
const pad=(n,w)=>String(n).padStart(w,'0');
const fmtDate=s=>{try{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}catch(e){return s}};
const fmtDay=s=>{try{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}catch(e){return s}};
const todayISO=()=>{const t=new Date();return t.getFullYear()+'-'+pad(t.getMonth()+1,2)+'-'+pad(t.getDate(),2)};
const range=(a,b)=>{const r=[];for(let i=a;i<=b;i++)r.push(pad(i,2));return r};
const digitsOf=tokens=>tokens.map(t=>t.replace(/\D/g,'')).filter(Boolean);
// Jackpot: the three prizes may be typed with spaces or dots, or as 12 digits in a row (iPhone number pad has no space)
const jackDigits=tokens=>{const d=digitsOf(tokens);if(d.length===1&&d[0].length===12)return d[0].match(/.{4}/g);return d.filter(x=>x.length<=4)};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- the four games ---------- */
const GAMES={
  boledo:{label:'Boledo',mode:'board',board:range(0,99),wins:['10','20','30','all'],def:'30',hotWins:['20','40','60','all'],hotDef:'40',
    ph:'41',hint:'Type the winning number, like 41.',
    keys:d=>[pad(d.nums[0],2)],show:d=>pad(d.nums[0],2),
    make(t){const n=digitsOf(t);if(!n.length||n[0].length>2)return null;return{nums:[pad(n[0],2)]}}},
  lottery:{label:'Sunday Jackpot',mode:'board',board:range(0,99),wins:['10','20','30','all'],def:'30',hotWins:['10','20','30','all'],hotDef:'30',
    ph:'1652 0188 7876',hint:'Type the 1st, 2nd and 3rd prize, like 1652 0188 7876. On a phone you can type all 12 digits in a row (165201887876) or use a dot between them.',
    note:'For the Sunday Jackpot, the board counts the last two digits of the 1st prize, the 2-digit number that wins. The 2nd and 3rd prizes are shown but not counted.',
    keys:d=>[pad(d.nums[0],4).slice(-2)],show:d=>d.nums.map(n=>pad(n,4)).join(' · '),
    make(t){const n=jackDigits(t);if(!n.length)return null;return{nums:n.slice(0,3).map(x=>pad(x,4))}}},
  fantasy5:{label:'Fantasy 5',mode:'board',board:range(1,39),wins:['5','10','15','all'],def:'10',hotWins:['10','20','30','all'],hotDef:'20',
    ph:'12 18 25 27 33 Y',hint:'Type the five numbers with spaces between, then the letter if you have it, like 12 18 25 27 33 Y.',
    keys:d=>d.nums.map(n=>pad(n,2)),show:d=>d.nums.map(n=>pad(n,2)).join(' ')+(d.letter?' · '+d.letter:''),
    make(t){const letter=(t.find(x=>/^[A-Za-z]$/.test(x))||'').toUpperCase();
      const n=[...new Set(digitsOf(t).map(Number))].filter(x=>x>=1&&x<=39);
      if(n.length!==5)return null;const o={nums:n.sort((a,b)=>a-b).map(x=>pad(x,2))};if(letter)o.letter=letter;return o}},
  pick3:{label:'Pick 3',mode:'position',board:['0','1','2','3','4','5','6','7','8','9'],wins:['5','10','15','all'],def:'10',hotWins:['10','20','30','all'],hotDef:'20',
    ph:'390',hint:'Type the three digits in order, like 390.',
    show:d=>d.nums.join('-'),
    make(t){let n=digitsOf(t);if(n.length===1&&n[0].length===3)n=n[0].split('');if(n.length<3||n.slice(0,3).some(x=>x.length!==1))return null;return{nums:n.slice(0,3)}}}
};
const ORDER=['boledo','lottery','fantasy5','pick3'];
/* draw days (0=Sun), worked out from past results; used to spot missing draws */
/* Official draw days (0=Sun) and times, Belize time (UTC-6, no daylight saving).
   Boledo & Sunday Jackpot: Belize Government Lotteries Ltd. Fantasy 5 & Pick 3: the game operator. */
const SCHEDULE={
  boledo:{days:[1,2,3,4,5],at:'21:00',text:'Monday to Friday at 9:00 pm'},
  pick3:{days:[1,2,3,4,5],at:'20:30',text:'Monday to Friday at 8:30 pm'},
  fantasy5:{days:[2,4,6],at:'20:00',text:'Tuesday, Thursday and Saturday at 8:00 pm'},
  lottery:{days:[0],at:'10:00',text:'Sunday at 10:00 am',extra:'If a Sunday draw is postponed, it can be held on Monday instead.'}
};
// how long each drawing lasts (minutes); the chip says "Drawing now" during it
const DRAW_LEN={lottery:30,boledo:15,pick3:15,fantasy5:15};
const SCHED={};Object.keys(SCHEDULE).forEach(g=>SCHED[g]=SCHEDULE[g].days);
const RESULT_LAG_MIN=30; // give each draw 30 minutes before counting it as waiting
/* Belize clock, whatever time zone the viewer is in */
function bzNow(){const d=new Date(Date.now()-6*3600e3);return{iso:d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1,2)+'-'+pad(d.getUTCDate(),2),dow:d.getUTCDay(),min:d.getUTCHours()*60+d.getUTCMinutes()}}
const isoDow=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay()};
const isoAdd=(iso,n)=>{const [y,m,d]=iso.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1,2)+'-'+pad(t.getUTCDate(),2)};
const atMin=g=>{const [h,m]=SCHEDULE[g].at.split(':').map(Number);return h*60+m};
const fmtTime=g=>{const [h,m]=SCHEDULE[g].at.split(':').map(Number);return ((h%12)||12)+':'+pad(m,2)+' '+(h<12?'am':'pm')};
/* Public holidays: no Boledo, Pick 3 or Fantasy 5 draw (Lotteries Control Regulations; the game operator).
   The list lives in data/holidays.json on the site (editable from the Admin page); this copy is the fallback. */
const HOLIDAY_GAMES=['boledo','pick3','fantasy5'];
let HOLIDAYS={"2026-01-01":{"name":"New Year's Day","greeting":"Happy New Year! 🎆"},"2026-01-15":{"name":"George Price Day","greeting":"Happy George Price Day! 🇧🇿"},"2026-03-09":{"name":"National Heroes and Benefactors Day","greeting":"Happy National Heroes and Benefactors Day! 🇧🇿"},"2026-04-03":{"name":"Good Friday","greeting":"Blessed Good Friday"},"2026-04-04":{"name":"Holy Saturday","greeting":"Blessed Holy Saturday"},"2026-04-06":{"name":"Easter Monday","greeting":"Happy Easter! 🐣"},"2026-05-01":{"name":"Labour Day","greeting":"Happy Labour Day! 💪"},"2026-08-01":{"name":"Emancipation Day","greeting":"Happy Emancipation Day! 🕊️"},"2026-09-10":{"name":"St. George's Caye Day","greeting":"Happy St. George's Caye Day! 🇧🇿"},"2026-09-21":{"name":"Independence Day","greeting":"Happy Independence Day! 🇧🇿"},"2026-10-12":{"name":"Indigenous Peoples' Resistance Day","greeting":"Happy Indigenous Peoples' Resistance Day!"},"2026-11-19":{"name":"Garifuna Settlement Day","greeting":"Happy Garifuna Settlement Day! 🪘"},"2026-12-25":{"name":"Christmas Day","greeting":"Merry Christmas! 🎄"},"2026-12-26":{"name":"Boxing Day","greeting":"Happy Boxing Day! 🎁"}};
try{const c=JSON.parse(localStorage.getItem('bz-holidays-v1')||'null');if(c&&typeof c==='object')HOLIDAYS=c}catch(e){}
const holidayOn=(g,iso)=>(HOLIDAY_GAMES.includes(g)&&HOLIDAYS[iso])||null;
const holidayGreeting=h=>h?(h.greeting||('Happy '+h.name+'!')):'';
window.bzSetHolidays=days=>{if(!days||typeof days!=='object')return;HOLIDAYS=days;try{localStorage.setItem('bz-holidays-v1',JSON.stringify(days))}catch(e){}
  if(typeof render==='function'&&state.loaded)render()};
const isDrawDay=(g,iso)=>SCHED[g].includes(isoDow(iso))&&!holidayOn(g,iso);
/* has this game's draw on this date happened (plus the 30-minute allowance)? */
function drawDone(g,iso){const n=bzNow();if(iso<n.iso)return true;if(iso>n.iso)return false;return n.min>=atMin(g)+RESULT_LAG_MIN}
/* most recent scheduled draw date that has already happened */
function lastDrawDate(g){let iso=bzNow().iso;for(let i=0;i<8;i++){if(isDrawDay(g,iso)&&drawDone(g,iso))return iso;iso=isoAdd(iso,-1)}return bzNow().iso}
/* next scheduled draw date that hasn't happened yet */
function nextDrawDate(g){const n=bzNow();let iso=n.iso;for(let i=0;i<8;i++){if(isDrawDay(g,iso)&&(iso>n.iso||n.min<atMin(g)))return iso;iso=isoAdd(iso,1)}return n.iso}
const NUDGE_DAYS=14;
let pendingOdd=null;
const ENCOURAGE=['Sharp eye! Your board is up to date.',"That's a winner's habit: every draw counted.",'Nice work! You stay one step ahead.','Every number tracked. That\'s how the pros do it.','Your board is fresh and ready.'];
const real=list=>list.filter(d=>!d.nodraw);
const SPOTS=['1st','2nd','3rd'];
const ERR={boledo:'Type a number from 00 to 99.',lottery:'Type at least the 1st prize number (up to 4 digits).',
  fantasy5:'Type five different numbers from 1 to 39.',pick3:'Type three digits, like 390.'};

/* ---------- settings remembered on this device ---------- */
const PREF='bz-prefs-v1';
let prefs={game:'boledo',wins:{}};
try{Object.assign(prefs,JSON.parse(localStorage.getItem(PREF)||'{}'))}catch(e){}
const state={game:GAMES[prefs.game]?prefs.game:'boledo',wins:Object.assign({},prefs.wins||{}),hotWins:Object.assign({},prefs.hotWins||{}),draws:[],sample:null,canWrite:true,loaded:false,resW:1,resFrom:'',missRange:{}};
const curHot=()=>{const G=GAMES[state.game],w=state.hotWins[state.game];return G.hotWins.includes(w)?w:G.hotDef};
const curWin=()=>{const G=GAMES[state.game],w=state.wins[state.game];return G.wins.includes(w)?w:G.def};
const savePrefs=(quiet)=>{try{localStorage.setItem(PREF,JSON.stringify({game:state.game,wins:state.wins,hotWins:state.hotWins,mine:prefs.mine||{}}))}catch(e){}
  if(!quiet&&window.bzLucky&&typeof window.bzLucky.onChange==='function'){try{window.bzLucky.onChange()}catch(e){}}};
/* hooks used by the free-accounts feature in the phone app (unused in the tracker page) */
window.bzLucky={get:()=>JSON.parse(JSON.stringify(prefs.mine||{})),
  set(m){prefs.mine=m&&typeof m==='object'?m:{};savePrefs(true);if(state.loaded||state.sample)render()},onChange:null};

/* ---------- game tabs and look-back picker ---------- */
const seg=$('gameSeg');
const BALL={boledo:'00',lottery:'1st',fantasy5:'5',pick3:'3'};
ORDER.forEach(g=>{const b=document.createElement('button');b.type='button';b.dataset.g=g;
  b.innerHTML='<span class="tile gball" data-game="'+g+'"><span>'+BALL[g]+'</span></span><span class="gtxt"><b>'+esc(GAMES[g].label).replace(/ (\d)$/,'&nbsp;$1')+'</b><small id="gl-'+g+'">&nbsp;</small></span>';
  b.onclick=()=>{state.game=g;savePrefs();setup();$('dDate').value=nextMissingDate(g);$('addMsg').textContent='';checkDate();render();
    // bring the Last Draw box to the middle of the screen so the new game's result is in view
    requestAnimationFrame(()=>$('secLast').scrollIntoView({block:'center',behavior:reduceMotion()?'auto':'smooth'}))};seg.appendChild(b)});
function setup(){
  const G=GAMES[state.game];
  document.body.dataset.game=state.game;
  const box=$('winSeg');box.innerHTML='';
  G.wins.forEach(w=>{const b=document.createElement('button');b.type='button';b.dataset.w=w;b.textContent=w==='all'?'All':w;
    b.setAttribute('aria-label',w==='all'?'All draws':'Last '+w+' draws');
    b.onclick=()=>{state.wins[state.game]=w;state.missRange[state.game]=null;savePrefs();render()};box.appendChild(b)});
  { const c=document.createElement('button');c.type='button';c.dataset.w='cal';c.className='segcal';c.setAttribute('aria-label','Pick dates instead');c.title='Pick dates';
    c.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
    c.onclick=()=>{if(state.missRange[state.game]){$('missDates').hidden=!$('missDates').hidden;return}
      const all=drawsFor();if(!all.length)return;const to=all[all.length-1].date,from=isoAdd(to,-29);
      state.missRange[state.game]={from:from<all[0].date?all[0].date:from,to};render();$('missFrom').focus({preventScroll:true})};
    box.appendChild(c) }
  const hs=$('hotSeg');hs.innerHTML='';
  G.hotWins.forEach(w=>{const b=document.createElement('button');b.type='button';b.dataset.w=w;b.textContent=w==='all'?'All':w;
    b.setAttribute('aria-label',w==='all'?'All draws':'Last '+w+' draws');
    b.onclick=()=>{state.hotWins[state.game]=w;savePrefs();render()};hs.appendChild(b)});
  const rs=$('resSeg');rs.innerHTML='';
  [1,2,3,4].forEach(w=>{const b=document.createElement('button');b.type='button';b.dataset.w=w;b.textContent=w+'W';
    b.setAttribute('aria-label',w===1?'1 week':w+' weeks');
    b.onclick=()=>{state.resW=w;renderRes(true)};rs.appendChild(b)});
  $('resFrom').value=state.resFrom;
  $('quickNums').placeholder=G.ph;
  $('quickNums').inputMode=state.game==='fantasy5'?'text':state.game==='lottery'?'decimal':'numeric';
  $('quickLabel').textContent=G.label+' numbers';
  $('addHint').textContent=G.hint;
  $('addBall').dataset.game=state.game;$('addBallTxt').textContent=BALL[state.game];$('addGameName').textContent=G.label;
  $('addSched').textContent=G.label+' is drawn '+SCHEDULE[state.game].text+' (Belize time).';
  $('dDate').max=bzNow().iso;pendingOdd=null;checkDate();
  renderSlots();
}

/* ---------- drawing helpers ---------- */
function drawsFor(){
  const src=real(state.sample||state.draws);
  return src.filter(d=>d.game===state.game).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
}
function ballEl(k,small){const t=document.createElement('div');t.className='tile'+(small?' sm':'');const s=document.createElement('span');s.textContent=k;t.appendChild(s);return t}
function ballWithTag(k,tagHTML,detail,key){const w=document.createElement('button');w.type='button';w.className='bwrap';w.appendChild(ballEl(k));
  if(key!==undefined){w.dataset.key=key;if(isMine(key))w.classList.add('is-mine')}
  const t=document.createElement('div');t.className='tag';t.innerHTML=tagHTML;w.appendChild(t);
  if(detail){w.dataset.detail=detail;w.setAttribute('aria-label',k+'. '+detail.replace(/<[^>]+>/g,''))}return w}
/* a grid of balls plus the note that appears when one is tapped */
function grid(items,extra){const set=document.createElement('div');set.className='ballset';
  const g=document.createElement('div');g.className='tiles'+(extra?' '+extra:'');items.forEach(el=>g.appendChild(el));
  const p=document.createElement('p');p.className='balldetail';p.hidden=true;p.setAttribute('aria-live','polite');
  set.append(g,p);return set}
/* ---------- My Lucky Numbers: favourite numbers per game, saved on this device ---------- */
function mineList(g){const m=prefs.mine||{};return Array.isArray(m[g||state.game])?m[g||state.game]:[]}
function isMine(key){return mineList().includes(String(key))}
function toggleMine(key){key=String(key);const m=prefs.mine||(prefs.mine={});const L=mineList().slice();
  const i=L.indexOf(key);if(i>=0)L.splice(i,1);else{if(L.length>=12){toast('My Lucky Numbers holds up to 12 per game');return}L.push(key)}
  m[state.game]=L;savePrefs();SND.star(i<0);
  document.querySelectorAll('.bwrap[data-key]').forEach(b=>b.classList.toggle('is-mine',L.includes(b.dataset.key)));
  document.querySelectorAll('.top-star').forEach(topStarLabel);
  renderMine();}
function topStarLabel(b){const on=isMine(b.dataset.key);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
  b.setAttribute('aria-label',(on?'Remove ':'Add ')+b.dataset.key+(on?' from':' to')+' My Lucky Numbers');b.textContent=on?'★':'☆'}
function mineLabel(key){if(state.game!=='pick3')return{ball:key,sub:''};const [i,d]=key.split(':');return{ball:d,sub:SPOTS[+i]+' spot'}}
function renderMine(){
  const box=$('mine'),sec=$('secMine');if(!box||!sec)return;
  const G=GAMES[state.game],all=drawsFor(),L=mineList();
  if(!state.loaded&&!state.sample){sec.hidden=true;return}
  sec.hidden=false;box.innerHTML='';mineArmed=null;
  $('mineHint').hidden=!!L.length;$('mineTip').hidden=!L.length;
  $('mixWrap').hidden=L.length<2;
  const seqFor=key=>state.game==='pick3'?all.map(d=>[String(d.nums[+key.split(':')[0]])]):all.map(G.keys);
  // sort: just played first, then longest out
  const rows=L.map(key=>{const lbl=mineLabel(key),k=state.game==='pick3'?lbl.ball:key,seq=seqFor(key);
    let out=null;for(let i=seq.length-1;i>=0;i--){if(seq[i].includes(k)){out=seq.length-1-i;break}}return{key,lbl,out}})
    .sort((a,b)=>(a.out===0?-1:0)-(b.out===0?-1:0)||(b.out==null?1e9:b.out)-(a.out==null?1e9:a.out));
  rows.forEach(({key,lbl,out})=>{
    const it=document.createElement('div');it.className='mine-item'+(out===0?' hit':'');it.dataset.key=key;
    it.tabIndex=0;it.setAttribute('role','button');
    const outTxt=out===0?'played in the latest draw':out==null?all.length+'+ draws out':out+' draw'+(out===1?'':'s')+' out';
    it.setAttribute('aria-label',lbl.ball+(lbl.sub?' ('+lbl.sub+')':'')+', '+outTxt+'. Double-tap to remove.');
    const t=ballEl(lbl.ball);it.appendChild(t);
    const s=document.createElement('div');s.className='mine-tag';
    s.innerHTML=(lbl.sub?'<small>'+esc(lbl.sub)+'</small>':'')+(out===0?'<b>Played!</b><small>latest draw</small>':out==null?'<b>'+all.length+'+</b><small>draws out</small>':'<b>'+out+'</b><small>draw'+(out===1?'':'s')+' out</small>');
    it.appendChild(s);
    const rm=document.createElement('span');rm.className='mine-rm';rm.setAttribute('aria-hidden','true');rm.textContent='Tap again to remove';it.appendChild(rm);
    box.appendChild(it)});
  if(L.length<12){const add=document.createElement('button');add.type='button';add.className='mine-add';add.id='mineAdd';
    add.innerHTML='<span class="mine-add-ring" aria-hidden="true">＋</span><span class="mine-add-txt">Add</span>';
    add.setAttribute('aria-label','Add numbers to My Lucky Numbers');box.appendChild(add)}
}
/* double-tap (or two taps close together) removes a number; the first tap arms it */
let mineArmed=null,mineArmTimer=0;
function mineDisarm(){clearTimeout(mineArmTimer);document.querySelectorAll('.mine-item.armed').forEach(x=>x.classList.remove('armed'));mineArmed=null}
function mineRemove(it){mineDisarm();const key=it.dataset.key,lbl=mineLabel(key);it.classList.add('leaving');
  setTimeout(()=>{toggleMine(key);toast('Removed '+lbl.ball+(lbl.sub?' ('+lbl.sub+')':'')+' from My Lucky Numbers')},matchMedia('(prefers-reduced-motion:reduce)').matches?0:230)}
$('mine').addEventListener('click',e=>{
  if(e.target.closest('.mine-add')){mineDisarm();openPick();return}
  const it=e.target.closest('.mine-item');if(!it||it.classList.contains('leaving'))return;
  if(mineArmed===it.dataset.key){mineRemove(it);return}
  mineDisarm();mineArmed=it.dataset.key;it.classList.add('armed');mineArmTimer=setTimeout(mineDisarm,1800);
});
$('mine').addEventListener('keydown',e=>{const it=e.target.closest('.mine-item');if(!it)return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();mineRemove(it)}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();it.click()}});
document.addEventListener('click',e=>{if(mineArmed&&!e.target.closest('#mine'))mineDisarm()});

/* ---------- add numbers one at a time: a picker shown a page at a time ---------- */
let pickPage=0,pickOpener=null;
function pickPages(){
  const g=state.game;
  if(g==='pick3')return SPOTS.map((sp,i)=>({label:sp+' digit',keys:GAMES.pick3.board.map(d=>i+':'+d)}));
  const B=GAMES[g].board,size=g==='fantasy5'?20:25,out=[];
  for(let i=0;i<B.length;i+=size){const k=B.slice(i,i+size);out.push({label:k[0]+'–'+k[k.length-1],keys:k})}
  return out;
}
function pickCount(){const n=mineList().length;$('pickCount').textContent=n+' of 12 picked'}
function renderPick(){
  const pages=pickPages(),pg=pages[pickPage],grid=$('pickGrid');
  $('pickRange').textContent=pg.label;pickCount();grid.innerHTML='';
  grid.dataset.cols=state.game==='pick3'?'5':'5';
  pg.keys.forEach(key=>{const lbl=mineLabel(key);const b=document.createElement('button');b.type='button';b.className='pickball';b.dataset.key=key;
    const on=isMine(key);b.setAttribute('aria-pressed',on);b.setAttribute('aria-label',lbl.ball+(lbl.sub?' in the '+lbl.sub:'')+(on?', in My Lucky Numbers':''));
    b.appendChild(ballEl(lbl.ball,true));const st=document.createElement('i');st.className='pickstar';st.setAttribute('aria-hidden','true');st.textContent='★';b.appendChild(st);
    grid.appendChild(b)});
  $('pickDots').innerHTML=pages.map((_,i)=>'<span'+(i===pickPage?' class="on"':'')+'></span>').join('');
  $('pickBack').hidden=pickPage===0;
  const last=pickPage===pages.length-1;
  $('pickNext').textContent=last?'Done':'Continue';
  $('pickNext').setAttribute('aria-label',last?'Done':'Continue to '+pages[pickPage+1].label);
  $('pickDone').hidden=last;
}
function openPick(){SND.open();pickPage=0;pickOpener=document.activeElement;$('pickBoxTitle').textContent='Add '+GAMES[state.game].label+' numbers';
  $('pickBox').hidden=false;renderPick();$('pickNext').focus({preventScroll:true})}
function closePick(){if($('pickBox').hidden)return;SND.close();$('pickBox').hidden=true;const a=$('mineAdd');(a||pickOpener||document.body).focus&&(a||pickOpener).focus({preventScroll:true})}
$('pickGrid').addEventListener('click',e=>{const b=e.target.closest('.pickball');if(!b)return;
  toggleMine(b.dataset.key);const on=isMine(b.dataset.key);b.setAttribute('aria-pressed',on);
  if(on){b.classList.remove('pop');void b.offsetWidth;b.classList.add('pop')}pickCount()});
$('pickNext').addEventListener('click',()=>{const n=pickPages().length;if(pickPage>=n-1){closePick();return}pickPage++;renderPick()});
$('pickBack').addEventListener('click',()=>{if(pickPage>0){pickPage--;renderPick()}});
$('pickDone').addEventListener('click',closePick);
$('pickBox').addEventListener('click',e=>{if(e.target.id==='pickBox')closePick()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('pickBox').hidden)closePick()});

/* ---------- Mixer: swirl My Lucky Numbers like a tornado, then show ways to play them ---------- */
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const uniq=a=>[...new Set(a)];
function pairsOf(L){const out=[];for(let i=0;i<L.length;i++)for(let j=i+1;j<L.length;j++)out.push([L[i],L[j]]);return out}
function mixPatterns(){
  const g=state.game,L=mineList();const groups=[];
  if(g==='boledo'){
    groups.push({label:'Your numbers',plays:L.map(n=>[n])});
    const flips=uniq(L.map(n=>n[1]+n[0]).filter(f=>!L.includes(f)));
    if(flips.length)groups.push({label:'Flipped around',plays:flips.map(n=>[n])});
    const mix=uniq(shuffle(pairsOf(L)).flatMap(([a,b])=>[a[0]+b[1],b[0]+a[1],a[0]+b[0],a[1]+b[1]])).filter(n=>!L.includes(n)&&!flips.includes(n));
    if(mix.length)groups.push({label:'Pairs mixed from two of your numbers',plays:shuffle(mix).slice(0,10).map(n=>[n])});
  }else if(g==='pick3'){
    const spots=[[],[],[]],all=[];L.forEach(k=>{const [i,d]=k.split(':');spots[+i].push(d);all.push(d)});
    const pool=uniq(all),pick=i=>{const s=spots[i].length?spots[i]:pool;return s[Math.floor(Math.random()*s.length)]};
    const st=new Set();for(let t=0;t<60&&st.size<6;t++)st.add([pick(0),pick(1),pick(2)].join(''));
    groups.push({label:'Straight (exact order)',plays:[...st].map(x=>x.split(''))});
    const bx=new Set();for(let t=0;t<60&&bx.size<4;t++){const c=[0,1,2].map(()=>pool[Math.floor(Math.random()*pool.length)]).sort().join('');if(pool.length>=3&&new Set(c).size<3&&t<40)continue;bx.add(c)}
    groups.push({label:'Box (any order)',plays:[...bx].map(x=>shuffle(x.split('')))});
  }else if(g==='fantasy5'){
    const nums=shuffle(L);const sets=[];
    if(nums.length>=5){const n=nums.length,count=n===5?1:Math.ceil(n/5)+1;
      for(let i=0;i<count;i++){const start=(i*5)%n;let set=[];for(let k=0;k<5;k++)set.push(nums[(start+k)%n]);if(i===count-1&&n>5)set=shuffle(nums).slice(0,5);sets.push(uniq(set).sort())}
      groups.push({label:n===5?'Your 5 numbers':'Sets of 5 that use all your numbers',plays:sets});
    }else{
      const fill=[];for(let i=0;i<3;i++){const extra=shuffle(Array.from({length:39},(_,i)=>pad(i+1,2)).filter(x=>!nums.includes(x))).slice(0,5-nums.length);fill.push([...nums,...extra].sort().map(x=>nums.includes(x)?x:'+'+x))}
      groups.push({label:'Your numbers + random fill (outlined)',plays:fill});
    }
  }else{ // Sunday Jackpot
    const t=uniq(shuffle(pairsOf(L)).flatMap(([a,b])=>[a+b,b+a]));
    groups.push({label:'4-digit tickets from two of your numbers',plays:t.slice(0,8).map(x=>x.split(''))});
    groups.push({label:'Last two digits (the $2 prize)',plays:L.map(n=>[n])});
  }
  return groups;
}
let mixAnim=null,mixGroups=[];
/* ---------- Mixer sounds: made on the fly with Web Audio, no sound files ---------- */
const SND=(()=>{
  let ctx=null,master=null,noiseBuf=null,hiss=null,hissGain=null,muted=false,hissAt=0,unlocked=false;const last={};
  try{muted=localStorage.getItem('bz-sound')==='off'}catch(e){}
  function init(){if(muted)return;try{
    if(!ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();master=ctx.createGain();master.gain.value=1;const lim=ctx.createDynamicsCompressor();lim.threshold.value=-10;lim.knee.value=6;lim.ratio.value=8;lim.attack.value=.003;lim.release.value=.15;master.connect(lim);lim.connect(ctx.destination);
      noiseBuf=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}
    if(ctx.state!=='running'){const r=ctx.resume();if(r&&r.catch)r.catch(()=>{})}
    // iPhone: play one silent sample inside the tap, which unlocks sound for the page
    if(!unlocked){const b=ctx.createBuffer(1,1,22050),s=ctx.createBufferSource();s.buffer=b;s.connect(ctx.destination);s.start(0);if(ctx.state==='running')unlocked=true}
  }catch(e){}}
  const ok=()=>!!ctx&&!muted&&ctx.state==='running';
  const gap=(k,ms)=>{const n=performance.now();if(last[k]&&n-last[k]<ms)return false;last[k]=n;return true};
  function env(g,t,vol,dur){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol),t+Math.min(.008,dur/4));g.gain.exponentialRampToValueAtTime(.0001,t+dur)}
  function noise(dur,f,q,vol,type,f2,delay){const t=ctx.currentTime+(delay||0),s=ctx.createBufferSource(),fl=ctx.createBiquadFilter(),g=ctx.createGain();
    s.buffer=noiseBuf;s.loop=true;fl.type=type||'bandpass';fl.frequency.setValueAtTime(f,t);if(f2)fl.frequency.exponentialRampToValueAtTime(f2,t+dur);fl.Q.value=q;
    env(g,t,vol,dur);s.connect(fl);fl.connect(g);g.connect(master);s.start(t,Math.random()*.5);s.stop(t+dur+.03)}
  function tone(f,dur,vol,type,f2,delay){const t=ctx.currentTime+(delay||0),o=ctx.createOscillator(),g=ctx.createGain();
    o.type=type||'sine';o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
    env(g,t,vol,dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.03)}
  function stopHiss(){if(!hiss)return;const h=hiss,hg=hissGain;hiss=null;try{hg.gain.setTargetAtTime(0,ctx.currentTime,.06)}catch(e){}setTimeout(()=>{try{h.stop()}catch(e){}},400)}
  return{
    init,isMuted:()=>muted,
    running:()=>!!ctx&&!muted&&ctx.state==='running',
    // inside a tap: switch sound on, then run cb once it is really playing
    unlock(cb){init();if(!ctx||muted)return;if(ctx.state==='running'){cb();return}
      try{const r=ctx.resume();if(r&&r.then)r.then(()=>{if(ctx.state==='running')cb()},()=>{})}catch(e){}},
    setMuted(m){muted=m;try{localStorage.setItem('bz-sound',m?'off':'on')}catch(e){}if(m)stopHiss();else init()},
    // ball hits ball: a hard plastic clack
    clack(v){if(!ok()||v<60||!gap('clack',24))return;const vol=Math.min(.42,.05+v/2600);
      noise(.03,2400+Math.random()*2200,7,vol);tone(1500+Math.random()*1300,.035,vol*.45,'triangle')},
    // ball hits the glass: a light, bright tink
    glass(v){if(!ok()||v<110||!gap('glass',40))return;const vol=Math.min(.2,.025+v/6000);
      tone(2900+Math.random()*1600,.08,vol);noise(.018,5500,4,vol*.5)},
    jet(p){if(!ok()||!gap('jet',110))return;noise(.18+.12*Math.random(),700+Math.random()*500,1.3,.1+.08*p,'bandpass',3200+Math.random()*1500)},
    gust(){if(!ok()||!gap('gust',220))return;noise(.5,320,.8,.3,'bandpass',2400)},
    // the steady roar of the blower
    hiss(level){if(!ok()){stopHiss();return}const n=performance.now();if(n-hissAt<90)return;hissAt=n;
      if(!hiss&&level>0){hiss=ctx.createBufferSource();hiss.buffer=noiseBuf;hiss.loop=true;const fl=ctx.createBiquadFilter();fl.type='lowpass';fl.frequency.value=1300;
        hissGain=ctx.createGain();hissGain.gain.value=0;hiss.connect(fl);fl.connect(hissGain);hissGain.connect(master);hiss.start()}
      if(hiss)hissGain.gain.setTargetAtTime(level*.1,ctx.currentTime,.08)},
    stopHiss,
    tick(){if(!ok()||!gap('tick',60))return;tone(2300+Math.random()*200,.016,.06,'square')},
    lock(){if(!ok())return;tone(190,.13,.38,'sine',65);noise(.03,3200,3,.22)},
    ding(){if(!ok())return;[1318.5,1975.5,2637].forEach((f,i)=>tone(f,1.2-i*.25,.2/(i+1)))},
    win(){if(!ok())return;[1046.5,1318.5,1568,2093].forEach((f,i)=>tone(f,.55,.11,'triangle',null,i*.09))},
    /* quiet sounds for the rest of the site */
    tap(){if(!ok()||!gap('tap',40))return;tone(1250,.025,.045,'triangle');noise(.012,4200,3,.025)},
    select(){if(!ok()||!gap('sel',80))return;tone(587,.07,.05,'sine');tone(880,.1,.045,'sine',null,.05)},
    pop(){if(!ok()||!gap('pop',50))return;tone(520,.06,.06,'sine',900)},
    star(on){if(!ok())return;on?(tone(988,.08,.055,'sine'),tone(1480,.14,.05,'sine',null,.06)):tone(880,.12,.045,'sine',520)},
    roll(i){if(!ok())return;tone(260+i*35,.07,.07,'sine',150);noise(.025,1800+i*120,4,.04)},
    // a ball rolling in: quick clicks across a hard surface that spread out as it slows, then a wooden tok
    rollIn(i,dur,vol){if(!ok())return;let t=0,gap=.035,k=0;const base=640+i*40,q=vol||1;
      while(t<dur*.92&&k<40){const v=.09*q*(1-.55*t/dur),dl=t;
        tone(base*(1+(Math.random()-.5)*.08),.018,v,'triangle',null,dl);
        if(k%2===0)tone(170,.03,v*.6,'sine',null,dl);
        t+=gap;gap*=1.09;k++}
      tone(210+i*12,.11,.14*q,'sine',120,dur);noise(.035,900,2,.07*q,'bandpass',null,dur)},
    // a ball spinning in: an airy whir that flutters faster then slows like a spinning coin, then a light ting
    spinIn(i,dur){if(!ok())return;const t=ctx.currentTime,src=ctx.createBufferSource(),fl=ctx.createBiquadFilter(),g=ctx.createGain(),am=ctx.createGain(),lfo=ctx.createOscillator(),depth=ctx.createGain();
      src.buffer=noiseBuf;src.loop=true;fl.type='bandpass';fl.frequency.setValueAtTime(2600,t);fl.frequency.exponentialRampToValueAtTime(1300,t+dur);fl.Q.value=3;
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.06,t+.05);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      am.gain.value=.5;lfo.type='triangle';lfo.frequency.setValueAtTime(16,t);lfo.frequency.exponentialRampToValueAtTime(4,t+dur);depth.gain.value=.5;lfo.connect(depth);depth.connect(am.gain);
      src.connect(fl);fl.connect(am);am.connect(g);g.connect(master);src.start(t,Math.random()*.5);lfo.start(t);src.stop(t+dur+.05);lfo.stop(t+dur+.05);
      tone(1568+i*90,.22,.035,'sine',null,dur);tone(2349+i*120,.15,.015,'sine',null,dur+.01)},
    open(){if(!ok()||!gap('open',150))return;noise(.18,500,1,.05,'bandpass',2200);tone(660,.09,.03,'sine',990,.05)},
    close(){if(!ok()||!gap('close',150))return;noise(.14,1800,1,.04,'bandpass',500)},
    success(){if(!ok())return;[784,1046.5,1318.5].forEach((f,i)=>tone(f,.3,.06,'sine',null,i*.08))},
    shimmer(){if(!ok()||!gap('shim',600))return;[1568,1760,2093,2349].forEach((f,i)=>tone(f,.18,.018,'sine',null,i*.05))},
    // a ball landing in the Missing Numbers grid: quieter than the Last Draw knock, rising a little through the batch
    land(j){if(!ok())return;const f=Math.min(560,280+j*16);tone(f,.06,.05,'sine',f*.6);noise(.02,1600+j*60,4,.025)},
    ping(){if(!ok())return;tone(1760,.35,.045,'sine');tone(2637,.25,.02,'sine',null,.01)},
    later(ms,fn){return setTimeout(fn,ms)},
    // the opening intro: sparkles, a rising shimmer that builds, and a mystical chime at the peak
    intro(off){if(!ok())return;off=Math.max(0,off||0);if(off<.12)off=0;
      // started late (first tap): parts already gone are skipped, the peak chord still lands with the picture
      // (or straight away if the peak has passed)
      const late=off>1.5,sh=late?1.55:off,c=ctx,T=x=>c.currentTime+.03+Math.max(0,x-sh),gone=x=>off>0&&x<sh+.001&&x<1.55,rr=(a,b)=>a+Math.random()*(b-a);
      const out=c.createGain();out.gain.value=.8;out.connect(master);
      const dl=c.createDelay(1);dl.delayTime.value=.19;const fb=c.createGain();fb.gain.value=.38;const wet=c.createGain();wet.gain.value=.45;
      dl.connect(fb);fb.connect(dl);dl.connect(wet);wet.connect(out);
      const bell=(f,t,dur,vol)=>[[1,1],[2.76,.28],[5.4,.1]].forEach(([m,a])=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=f*m;
        g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol*a,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+dur/m**.4);
        o.connect(g);g.connect(out);g.connect(dl);o.start(t);o.stop(t+dur+.1)});
      if(!gone(.02))bell(2637,T(.02),.5,.05);
      [3136,3520,3951,4186].forEach((f,k)=>{if(!gone(.18+k*.07))bell(f,T(.18+k*.07),.35,.025)});
      if(!gone(.55)){const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();s.buffer=noiseBuf;s.loop=true;f.type='bandpass';f.Q.value=2.5;
        f.frequency.setValueAtTime(500,T(.55));f.frequency.exponentialRampToValueAtTime(5200,T(1.52));
        g.gain.setValueAtTime(.0001,T(.55));g.gain.exponentialRampToValueAtTime(.16,T(1.48));g.gain.exponentialRampToValueAtTime(.0001,T(1.6));
        s.connect(f);f.connect(g);g.connect(out);s.start(T(.55));s.stop(T(1.7))}
      if(!gone(.8)){const o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.setValueAtTime(220,T(.8));o.frequency.exponentialRampToValueAtTime(660,T(1.52));
        g.gain.setValueAtTime(.0001,T(.8));g.gain.exponentialRampToValueAtTime(.05,T(1.45));g.gain.exponentialRampToValueAtTime(.0001,T(1.58));o.connect(g);g.connect(out);o.start(T(.8));o.stop(T(1.7))}
      for(let k=0;k<5;k++)if(!gone(.95+k*.025))bell(rr(2800,4600),T(.95+k*.025),.3,.03);
      if(!gone(1.03))bell(1568,T(1.03),.6,.05);
      [1318.5,1661.2,1975.5,2637].forEach((f,k)=>bell(f,T(1.55+k*.055),1.9,.13-k*.015));
      {const o=c.createOscillator(),g=c.createGain();o.frequency.value=329.6;g.gain.setValueAtTime(.0001,T(1.55));g.gain.exponentialRampToValueAtTime(.09,T(1.6));g.gain.exponentialRampToValueAtTime(.0001,T(3.2));o.connect(g);g.connect(out);o.start(T(1.55));o.stop(T(3.3))}
    }
  };
})();
const MUTE_ON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>';
const MUTE_OFF='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
function muteLabel(){const m=SND.isMuted();['mixMute','sndBtn'].forEach(id=>{const b=$(id);if(!b)return;b.setAttribute('aria-pressed',String(m));b.setAttribute('aria-label',m?'Turn sound on':'Mute sound');b.title=m?'Sound off':'Sound on';b.innerHTML=m?MUTE_ON:MUTE_OFF})}
['mixMute','sndBtn'].forEach(id=>{const b=$(id);if(b)b.addEventListener('click',e=>{e.stopPropagation();const m=!SND.isMuted();SND.setMuted(m);muteLabel();if(!m)setTimeout(()=>SND.select(),60)})});
/* ---------- Easy reading (magnifier button, + / −): larger, clearer text for anyone who wants it ----------
   Remembered on this device. On the very first visit it switches on by itself if the phone is set to
   "increase contrast", and a one-time hint points at the magnifier. */
const EASY=(()=>{
  const KEY='bz-easy',HINT='bz-easy-hint',root=document.documentElement,btn=$('eyeBtn');
  const get=k=>{try{return localStorage.getItem(k)}catch(e){return null}},put=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
  let saved=get(KEY);
  let on=saved==='on'||(saved===null&&window.matchMedia&&matchMedia('(prefers-contrast: more)').matches);
  function apply(){root.classList.toggle('easy',on);if(btn){btn.setAttribute('aria-pressed',String(on));btn.title=on?'Easy reading on':'Easy reading'}}
  apply();
  function hideHint(){const h=$('eyeHint');if(h)h.remove();put(HINT,'1')}
  if(btn)btn.addEventListener('click',e=>{e.stopPropagation();on=!on;put(KEY,on?'on':'off');apply();hideHint();
    try{SND.select()}catch(_){}
    toast(on?'Easy reading on: larger, clearer text. Tap the magnifier again to switch it off.':'Easy reading off.',false,3200)});
  function maybeHint(){
    if(!btn||get(HINT)||on)return;
    if(document.querySelector('#intro:not([hidden]),.sheet:not([hidden]),.mixbox:not([hidden])')){setTimeout(maybeHint,1500);return}
    const h=document.createElement('div');h.className='eyehint';h.id='eyeHint';h.setAttribute('role','status');
    h.innerHTML='Easier to read? Tap the magnifier for larger, clearer text.<button type="button" aria-label="Close tip">×</button>';
    h.querySelector('button').onclick=ev=>{ev.stopPropagation();hideHint()};
    btn.parentElement.appendChild(h);setTimeout(()=>{if($('eyeHint'))hideHint()},9000);
  }
  setTimeout(maybeHint,4200);
  return {isOn:()=>on};
})();
// the browser only allows sound after a tap, so wake the sound up on the first one
['pointerdown','touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,()=>SND.init(),{capture:true,passive:true}));
// soft taps for buttons and switches across the page (the mixer and My Lucky Numbers make their own)
document.addEventListener('click',e=>{const t=e.target;if(!t.closest)return;
  if(t.closest('#mixBox,#mineAdd,.mine-item,.pickball,.starbtn,.top-star,#sndBtn,#eyeBtn,#eyeHint,#mixMute,#mixBtn'))return;
  if(t.closest('.games button')){SND.select();return}
  if(t.closest('.bwrap')){SND.pop();return}
  if(t.closest('.showless-btn'))return;
  if(t.closest('.seg button,.tabbar button,button.more,.showmore-btn,.btn,summary,#resMore,.pickbtns button,.pickdone,.sharebtn'))SND.tap();
},true);
muteLabel();
/* results land like slot-machine reels: every ball of the first group spins through numbers,
   then they lock one by one, slowing down, with a pause of suspense before the last one */
let reelTimers=[];
function stopReels(){reelTimers.forEach(t=>{clearTimeout(t);clearInterval(t)});reelTimers=[]}
function showMixResults(){
  stopReels();
  const out=$('mixOut');out.innerHTML='';out.onclick=null;
  const pool=state.game==='pick3'?GAMES.pick3.board:GAMES[state.game].board;
  const secs=[];
  mixGroups.forEach(g=>{const seen=new Set();g.plays=g.plays.filter(p=>{const k=p.join(',');if(seen.has(k))return false;seen.add(k);return true})});
  mixGroups.forEach((gr,gi)=>{const sec=document.createElement('div');sec.className='mixgroup';let n=0;
    const h=document.createElement('h3');h.textContent=gr.label;sec.appendChild(h);
    const single=gr.plays.every(p=>p.length===1);
    const rows=document.createElement('div');rows.className='mixplays'+(single?' single':'');
    gr.plays.forEach(p=>{const row=document.createElement('div');row.className='mixplay';
      p.forEach(x=>{const fill=String(x).startsWith('+');const b=ballEl(fill?x.slice(1):x,true);if(fill)b.classList.add('fill');b.style.setProperty('--n',n++);row.appendChild(b)});
      rows.appendChild(row)});
    sec.appendChild(rows);if(gi>0)sec.hidden=true;out.appendChild(sec);secs.push(sec)});
  out.hidden=false;
  const box=$('mixBox').querySelector('.mixbox-in');box.classList.remove('swirl');box.classList.add('reveal');
  const reels=secs.length?[...secs[0].querySelectorAll('.tile')]:[];
  let done=false;
  const lock=(b,quiet,big)=>{clearInterval(b._iv);b.classList.remove('reel','tension');b.firstChild.textContent=b.dataset.final;
    if(!quiet){if(big)SND.ding();else SND.lock();b.classList.remove('locked');void b.offsetWidth;b.classList.add('locked');box.classList.remove('thud');void box.offsetWidth;box.classList.add('thud')}};
  const finish=()=>{if(done)return;done=true;stopReels();reels.forEach(b=>{if(b.classList.contains('reel'))lock(b,true)});
    secs.forEach(x=>x.hidden=false);if(secs[0])secs[0].classList.add('win');box.classList.remove('tense');if(reels.length&&!reduceMotion())SND.win();
    $('mixNote').hidden=false;$('mixBtns').hidden=false;out.onclick=null;out.removeAttribute('title')};
  if(reduceMotion()||!reels.length){finish();return}
  reels.forEach(b=>{b.dataset.final=b.firstChild.textContent;b.classList.add('reel');
    b._iv=setInterval(()=>{b.firstChild.textContent=pool[Math.floor(Math.random()*pool.length)]},55);reelTimers.push(b._iv)});
  reelTimers.push(setInterval(()=>{if(reels.some(b=>b.classList.contains('reel')))SND.tick()},reels.length>1?75:90));
  // lock times: gaps grow so the reels slow down, and the last one waits longer
  const N=reels.length,budget=Math.min(3600,700+N*300);let t=650;
  const w=reels.map((_,i)=>1+1.6*i/Math.max(1,N-1)),ws=w.reduce((x,y)=>x+y,0);
  reels.forEach((b,i)=>{
    t+=(budget-650)*w[i]/ws;
    if(i===N-1&&N>1){reelTimers.push(setTimeout(()=>{b.classList.add('tension');box.classList.add('tense')},t-60));t+=950}
    const at=t,big=i===N-1;reelTimers.push(setTimeout(()=>lock(b,false,big),at))});
  reelTimers.push(setTimeout(finish,t+500));
  out.onclick=finish;out.title='Tap to show all now';
}
function runMixer(){
  cancelAnimationFrame(mixAnim);stopReels();
  mixGroups=mixPatterns();
  const stage=$('mixStage'),out=$('mixOut');out.hidden=true;out.innerHTML='';$('mixNote').hidden=true;$('mixBtns').hidden=true;
  stage.innerHTML='';stage.hidden=false;stage.classList.remove('flash','blowing');stage.style.transform='';
  const box=$('mixBox').querySelector('.mixbox-in');box.classList.remove('reveal','thud','tense');
  if(!reduceMotion())box.classList.add('swirl');
  const labels=mineList().map(k=>state.game==='pick3'?k.split(':')[1]:k);
  if(reduceMotion()){stage.hidden=true;showMixResults();return}
  // A lottery air-mix drum: balls drop in through the top tube, then high-pressure jets blast
  // them around the glass globe in chaos. The air dies, the balls fall, and the results roll in.
  stage.innerHTML='<div class="globe"><span class="globe-tube"></span><span class="globe-shine"></span><span class="globe-vent"></span>'+
    '<span class="globe-jet" style="--a:-28deg;--d:0s"></span><span class="globe-jet" style="--a:0deg;--d:-.12s"></span><span class="globe-jet" style="--a:28deg;--d:-.23s"></span>'+
    '<span class="globe-jet" style="--a:-12deg;--d:-.3s"></span><span class="globe-jet" style="--a:14deg;--d:-.06s"></span></div>';
  const copies=labels.length<4?3:labels.length<7?2:1,balls=[];
  for(let c=0;c<copies;c++)labels.forEach(l=>{const b=ballEl(l,true);b.classList.add('mixball');b.style.opacity='0';stage.appendChild(b);
    balls.push({el:b,x:0,y:0,vx:0,vy:0,rot:0,spin:0,inAt:0,live:false})});
  const N=balls.length,DROP=Math.min(1500,170*N),RAMP=700,CHAOS=5200+Math.random()*1600,SETTLE=900;
  const airOn=DROP+150,airFull=airOn+RAMP,airOff=airFull+CHAOS,dur=airOff+SETTLE,t0=performance.now();
  balls.forEach((b,i)=>b.inAt=i*(DROP/N));
  const r=18;let last=t0,swirlDir=1,nextFlip=airOn+700,nextGust=airFull+300,shake=0;
  const step=now=>{
    const W=stage.clientWidth,H=stage.clientHeight,cx=W/2,cy=H/2,R=Math.min(W,H)/2-10-r;
    const el=now-t0,dt=Math.min(.03,(now-last)/1000);last=now;
    // air level: ramps up, roars, then cuts out
    const air=el<airOn?0:el<airFull?(el-airOn)/RAMP:el<airOff?1:0;
    stage.classList.toggle('blowing',air>0);stage.style.setProperty('--air',air.toFixed(2));
    if(air>0&&el>nextFlip){swirlDir=-swirlDir;nextFlip=el+500+Math.random()*900}
    let gust=null;
    if(air>.6&&el>nextGust){const ang=-Math.PI/2+(Math.random()-.5)*2.2;gust={x:Math.cos(ang),y:Math.sin(ang),p:700+Math.random()*700};nextGust=el+380+Math.random()*700;shake=1}
    // a jet fires from one of the nozzles at the bottom
    const jet=air>.3&&Math.random()<.35?(Math.random()-.5)*1.1:null;if(jet!==null&&Math.random()<.4)SND.jet(air);
    SND.hiss(air);
    for(const b of balls){
      if(!b.live){if(el<b.inAt)continue;b.live=true;b.x=cx+(Math.random()-.5)*8;b.y=cy-R+2;b.vx=(Math.random()-.5)*90;b.vy=140;b.el.style.opacity='1'}
      let ax=0,ay=1050;
      if(air>0){
        const dx=b.x-cx,dy=b.y-cy,d=Math.hypot(dx,dy)||1,low=dy/R;
        // the main up-draft from the vent, strongest at the bottom
        ay-=air*(low>.3?3000+3400*Math.random():low>-.2?450+1100*Math.random():0);
        // a swirl round the globe that flips direction now and then
        ax+=air*swirlDir*1500*(-dy/d);ay+=air*swirlDir*1500*(dx/d);
        // turbulence
        ax+=air*(Math.random()-.5)*4200;ay+=air*(Math.random()-.5)*2600;
        // a jet stream kicks balls near the bottom
        if(jet!==null&&low>.35&&Math.abs(dx/R-jet*.6)<.35){b.vy-=air*(900+900*Math.random());b.vx+=air*jet*900;b.spin+=(Math.random()-.5)*2400}
        if(gust){if(b===balls[0])SND.gust();b.vx+=gust.x*gust.p*air*(.6+.8*Math.random());b.vy+=gust.y*gust.p*air*(.6+.8*Math.random());b.spin+=(Math.random()-.5)*3000}
      }
      b.vx+=ax*dt;b.vy+=ay*dt;b.vx*=.993;b.vy*=.993;
      const sp=Math.hypot(b.vx,b.vy),max=800+1100*air;if(sp>max){b.vx*=max/sp;b.vy*=max/sp}
      b.x+=b.vx*dt;b.y+=b.vy*dt;
      // bounce off the glass, with a kick of spin
      const dx=b.x-cx,dy=b.y-cy,d=Math.hypot(dx,dy);
      if(d>R){const nx=dx/d,ny=dy/d;b.x=cx+nx*R;b.y=cy+ny*R;const vn=b.vx*nx+b.vy*ny;
        if(vn>0){SND.glass(vn);const e=air>0?1.82:1.55;b.vx-=e*vn*nx;b.vy-=e*vn*ny;b.spin+=(b.vx*ny-b.vy*nx)*1.2}}
      b.spin*=air>0?.985:.94;
      b.rot+=(b.spin+b.vx*1.4)*dt;
    }
    // balls knock into each other
    for(let i=0;i<N;i++)for(let k=i+1;k<N;k++){const a=balls[i],c=balls[k];if(!a.live||!c.live)continue;
      const dx=c.x-a.x,dy=c.y-a.y,d=Math.hypot(dx,dy)||.01,min=2*r;
      if(d<min){const nx=dx/d,ny=dy/d,o=(min-d)/2;a.x-=nx*o;a.y-=ny*o;c.x+=nx*o;c.y+=ny*o;
        const rv=(c.vx-a.vx)*nx+(c.vy-a.vy)*ny;if(rv<0){SND.clack(-rv);const j=-.95*rv;a.vx-=j*nx;a.vy-=j*ny;c.vx+=j*nx;c.vy+=j*ny;
          const tw=(Math.random()-.5)*600*air;a.spin+=tw;c.spin-=tw}}}
    // fast balls stretch along their path
    for(const b of balls)if(b.live){const sp=Math.hypot(b.vx,b.vy),st=Math.min(.22,sp/7000),dir=Math.atan2(b.vy,b.vx)*57.3;
      b.el.style.transform='translate('+(b.x-r).toFixed(1)+'px,'+(b.y-r).toFixed(1)+'px) rotate('+dir.toFixed(1)+'deg) scale('+(1+st).toFixed(3)+','+(1-st*.6).toFixed(3)+') rotate('+((b.rot-dir)%360).toFixed(1)+'deg)'}
    // the globe shakes with the roar of the air, harder on each gust
    shake*=.9;const amp=air*(1.2+4.5*shake);
    stage.style.transform=amp>.05?'translate('+((Math.random()-.5)*amp).toFixed(1)+'px,'+((Math.random()-.5)*amp).toFixed(1)+'px)':'';
    if(el<dur){mixAnim=requestAnimationFrame(step)}
    else{SND.stopHiss();stage.style.transform='';stage.classList.remove('blowing');stage.classList.add('flash');setTimeout(()=>{stage.hidden=true;stage.innerHTML='';showMixResults()},380)}
  };
  mixAnim=requestAnimationFrame(step);
}
$('mixBtn').addEventListener('click',()=>{SND.init();$('mixTitle').textContent='Mixer · '+GAMES[state.game].label;$('mixBox').hidden=false;runMixer();$('mixClose').focus({preventScroll:true})});
$('mixAgain').addEventListener('click',()=>{SND.init();runMixer()});
function closeMix(){cancelAnimationFrame(mixAnim);stopReels();SND.stopHiss();SND.close();$('mixBox').hidden=true;$('mixBtn').focus()}
$('mixClose').addEventListener('click',closeMix);
$('mixBox').addEventListener('click',e=>{if(e.target.id==='mixBox')closeMix()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('mixBox').hidden)closeMix()});
$('mixShare').addEventListener('click',async()=>{
  try{await document.fonts.ready}catch(e){}
  const rowsN=mixGroups.reduce((a,g)=>a+1+Math.ceil(g.plays.length/2),0),S=1080,H=Math.max(1080,320+rowsN*120);
  const cv=document.createElement('canvas');cv.width=S;cv.height=H;const ctx=cv.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0b4aa0');bg.addColorStop(1,'#042456');ctx.fillStyle=bg;ctx.fillRect(0,0,S,H);
  ctx.textAlign='center';ctx.fillStyle='#c9d5ea';ctx.font='700 32px "Barlow Condensed", sans-serif';ctx.fillText('B E L I Z E   L O T T E R Y',S/2,90);
  ctx.fillStyle='#fec207';ctx.font='800 64px Outfit, Barlow, sans-serif';ctx.fillText('My Lucky Numbers Mix',S/2,170);
  ctx.fillStyle='#e9c46a';ctx.font='700 40px "Barlow Condensed", sans-serif';ctx.fillText(GAMES[state.game].label.toUpperCase(),S/2,230);
  const c=ballColors();let y=300;
  mixGroups.forEach(gr=>{ctx.textAlign='left';ctx.fillStyle='#f7f0dc';ctx.font='600 30px Barlow, sans-serif';ctx.fillText(gr.label,70,y+10);y+=60;
    gr.plays.forEach((p,i)=>{const col=i%2,x0=110+col*480,r=p.length>3?30:36,gap=r*2.3;
      p.forEach((v,k)=>{const fill=String(v).startsWith('+');drawBall(ctx,x0+k*gap,y,r,fill?v.slice(1):String(v),fill?{hi:'#ffffff',main:'#cfd6e4',deep:'#7b879e'}:c)});
      if(col===1||i===gr.plays.length-1)y+=110});
    y+=10});
  ctx.textAlign='center';ctx.fillStyle='#c9d5ea';ctx.font='500 28px Barlow, sans-serif';ctx.fillText('These are ways to play your numbers. No pattern improves your odds.',S/2,H-60);
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));const file=new File([blob],'my-numbers-mix.png',{type:'image/png'});
  try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file]});return}}catch(e){if(e&&e.name==='AbortError')return}
  shareBlob=blob;const url=URL.createObjectURL(blob),img=$('shareImg');if(img.dataset.url)URL.revokeObjectURL(img.dataset.url);img.src=url;img.dataset.url=url;img.alt='My Lucky Numbers mix';
  $('shareTitle').textContent='Share your mix';$('shareGo').hidden=true;$('mixBox').hidden=true;$('shareBox').hidden=false;$('shareClose').focus();
});

/* ---------- Longest out: top 5 with bars, above the Missing grid ---------- */
function topOut(missing,total){
  const top=missing.slice(0,5),val=o=>o==null?total+1:o,max=val(top[0][1])||1;
  const wrap=document.createElement('div');wrap.className='topout';
  wrap.innerHTML='<h3 class="topout-h">Longest out</h3>';
  const ol=document.createElement('ol');ol.className='topout-list';
  top.forEach(([k,o],i)=>{const li=document.createElement('li');li.style.setProperty('--i',i);
    li.innerHTML='<span class="rk">'+(i+1)+'</span>';li.appendChild(ballEl(k,true));
    const bar=document.createElement('span');bar.className='tbar';bar.innerHTML='<s style="--w:'+Math.max(6,Math.round(val(o)/max*100))+'%"></s>';li.appendChild(bar);
    const v=document.createElement('span');v.className='tval';v.innerHTML=o==null?'<b>'+total+'+</b> draws':'<b>'+o+'</b> draw'+(o===1?'':'s');li.appendChild(v);
    const st=document.createElement('button');st.type='button';st.className='top-star';st.dataset.key=k;topStarLabel(st);li.appendChild(st);
    ol.appendChild(li)});
  wrap.appendChild(ol);return wrap;
}

/* ---------- trend chart in the tap note: times played per week, last 10 weeks ---------- */
function trendChart(key){
  const all=drawsFor();if(!all.length)return null;
  const G=GAMES[state.game];let k=key,keysOf=G.keys;
  if(state.game==='pick3'){const [i,dg]=key.split(':');k=dg;keysOf=d=>[String(d.nums[+i])]}
  const WEEKS=10,end=all[all.length-1].date,endMs=Date.UTC(+end.slice(0,4),+end.slice(5,7)-1,+end.slice(8,10));
  const bins=Array.from({length:WEEKS},(_,i)=>({n:0,draws:0,start:new Date(endMs-(WEEKS-i)*7*864e5+864e5)}));
  all.forEach(d=>{const ms=Date.UTC(+d.date.slice(0,4),+d.date.slice(5,7)-1,+d.date.slice(8,10));
    const w=WEEKS-1-Math.floor((endMs-ms)/(7*864e5));if(w<0||w>=WEEKS)return;bins[w].draws++;if(keysOf(d).includes(k))bins[w].n++});
  const max=Math.max(1,...bins.map(b=>b.n)),tot=bins.reduce((a,b)=>a+b.n,0);
  const box=document.createElement('div');box.className='trend';box.dataset.tot=tot;
  const avg=tot/WEEKS,best=bins.reduce((m,b,i)=>b.n>bins[m].n?i:m,0);
  const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  box.innerHTML='<div class="trend-h"><span>Times played per week</span><span>last 10 weeks · <b>'+tot+'</b> time'+(tot===1?'':'s')+'</span></div>'+
    '<div class="trend-bars">'+(tot?'<i class="trend-avg" style="--a:'+Math.round(avg/max*100)+'%"><span>avg '+(Math.round(avg*10)/10)+'/wk</span></i>':'')+bins.map((b,i)=>'<span class="tb'+(b.n?'':' zero')+(i===WEEKS-1?' now':'')+'" style="--h:'+(b.n?Math.max(12,Math.round(b.n/max*100)):4)+'%;--i:'+i+'" title="Week of '+mon[b.start.getUTCMonth()]+' '+b.start.getUTCDate()+': '+b.n+' of '+b.draws+' draws">'+(b.n?'<em>'+b.n+'</em>':'')+'</span>').join('')+'</div>'+
    '<div class="trend-x">'+bins.map((b,i)=>'<span>'+(i%3===0||i===WEEKS-1?mon[b.start.getUTCMonth()]+' '+b.start.getUTCDate():'')+'</span>').join('')+'</div>'+
    (tot?'<p class="trend-sum">Busiest week: <b>'+mon[bins[best].start.getUTCMonth()]+' '+bins[best].start.getUTCDate()+'</b> ('+bins[best].n+' of '+bins[best].draws+' draws). The last bar is the latest week.</p>':'');
  return box;
}

/* ---------- share the last draw as a picture ---------- */
let shareBlob=null;
function ballColors(){const cs=getComputedStyle(document.body);const v=n=>cs.getPropertyValue(n).trim();
  return{hi:v('--b-hi')||'#fff3a8',main:v('--b-main')||'#f7c600',deep:v('--b-deep')||'#c98f00'}}
function drawBall(ctx,x,y,r,label,c){
  ctx.save();ctx.shadowColor='rgba(0,0,0,.45)';ctx.shadowBlur=r*.35;ctx.shadowOffsetY=r*.12;
  const g=ctx.createRadialGradient(x-r*.32,y-r*.38,r*.1,x,y,r);g.addColorStop(0,c.hi);g.addColorStop(.45,c.main);g.addColorStop(1,c.deep);
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,r*.6,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#1b1b1b';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font='700 '+Math.round(r*(label.length>2?.5:.62))+'px Barlow, "Barlow Condensed", system-ui, sans-serif';ctx.fillText(label,x,y+r*.03);
}
async function makeShareImage(){
  const all=drawsFor(),d=all[all.length-1];if(!d||d.nodraw)return null;
  try{await document.fonts.ready}catch(e){}
  const S=1080,cv=document.createElement('canvas');cv.width=cv.height=S;const ctx=cv.getContext('2d');
  const bg=ctx.createRadialGradient(S/2,0,50,S/2,S*.4,S*.95);bg.addColorStop(0,'#1a64c0');bg.addColorStop(.5,'#094692');bg.addColorStop(1,'#042456');
  ctx.fillStyle=bg;ctx.fillRect(0,0,S,S);
  ctx.strokeStyle='rgba(233,196,106,.7)';ctx.lineWidth=6;ctx.beginPath();ctx.roundRect?ctx.roundRect(40,40,S-80,S-80,48):ctx.rect(40,40,S-80,S-80);ctx.stroke();
  ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle='#c9d5ea';ctx.font='700 34px "Barlow Condensed", Barlow, sans-serif';ctx.fillText('B E L I Z E   L O T T E R Y',S/2,150);
  ctx.fillStyle='#ffffff';ctx.font='800 74px Outfit, Barlow, sans-serif';const t1='Missing ',t2='Numbers';
  const w1=ctx.measureText(t1).width,w2=ctx.measureText(t2).width,x0=S/2-(w1+w2)/2;ctx.textAlign='left';ctx.fillText(t1,x0,240);ctx.fillStyle='#fec207';ctx.fillText(t2,x0+w1,240);
  ctx.textAlign='center';ctx.fillStyle='#e9c46a';ctx.font='700 58px "Barlow Condensed", Barlow, sans-serif';ctx.fillText(GAMES[state.game].label.toUpperCase(),S/2,360);
  ctx.fillStyle='#f7f0dc';ctx.font='500 38px Barlow, sans-serif';ctx.fillText(fmtDay(d.date)+' · '+fmtTime(state.game),S/2,420);
  const c=ballColors(),cy=640;
  if(state.game==='lottery'){
    const prizes=['1st','2nd','3rd'];d.nums.forEach((n,row)=>{const digits=pad(n,4).split(''),y=530+row*130,r=52,gap=124,xs=S/2-gap*1.5+60;
      ctx.fillStyle='#c9d5ea';ctx.font='700 34px "Barlow Condensed", sans-serif';ctx.textAlign='right';ctx.fillText(prizes[row],xs-80,y+12);
      digits.forEach((dg,i)=>drawBall(ctx,xs+i*gap,y,r,dg,c))});
  }else{
    const labels=state.game==='boledo'?[pad(d.nums[0],2)]:d.nums.map(String);if(d.letter)labels.push(d.letter);
    const r=state.game==='boledo'?150:labels.length>4?72:100,gap=r*2.25,x1=S/2-gap*(labels.length-1)/2;
    labels.forEach((l,i)=>drawBall(ctx,x1+i*gap,cy,r,l,i===labels.length-1&&d.letter?{hi:'#ffffff',main:'#e9e2cf',deep:'#9a917a'}:c));
  }
  ctx.textAlign='center';ctx.fillStyle='#c9d5ea';ctx.font='500 30px Barlow, sans-serif';ctx.fillText('Every draw is random. Independent tracker.',S/2,S-110);
  return new Promise(res=>cv.toBlob(b=>res(b),'image/png'));
}
$('shareBtn').addEventListener('click',async()=>{
  const blob=await makeShareImage();if(!blob){toast('Nothing to share yet');return}
  shareBlob=blob;const file=new File([blob],'belize-'+state.game+'-result.png',{type:'image/png'});
  const text=GAMES[state.game].label+' result · Belize Lottery Missing Numbers';
  try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],text});return}}catch(e){if(e&&e.name==='AbortError')return}
  const url=URL.createObjectURL(blob),img=$('shareImg');if(img.dataset.url)URL.revokeObjectURL(img.dataset.url);img.src=url;img.dataset.url=url;img.alt=text;
  $('shareGo').hidden=!(navigator.canShare&&navigator.canShare({files:[file]}));
  $('shareTitle').textContent='Share this result';$('shareBox').hidden=false;$('shareClose').focus();
});
$('shareClose').addEventListener('click',()=>{SND.close();$('shareBox').hidden=true;$('shareBtn').focus()});
$('shareBox').addEventListener('click',e=>{if(e.target.id==='shareBox')$('shareBox').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('shareBox').hidden)$('shareBox').hidden=true});
$('shareGo').addEventListener('click',async()=>{if(!shareBlob)return;try{await navigator.share({files:[new File([shareBlob],'belize-result.png',{type:'image/png'})]})}catch(e){}});

/* ---------- live countdown to the next draw (Belize time, UTC-6) ---------- */
let cdTimer=null;
function drawEpoch(g,iso){const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)+(atMin(g)+360)*60000}
function fmtLeft(ms){const t=Math.max(0,Math.floor(ms/1000)),d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60),sec=t%60;
  return d?d+'d '+h+'h '+pad(m,2)+'m':pad(h,2)+':'+pad(m,2)+':'+pad(sec,2)}
/* the latest scheduled draw whose draw time has passed (Belize time) */
function lastHeldDate(g){const n=bzNow();let iso=n.iso;for(let i=0;i<8;i++){if(isDrawDay(g,iso)&&(iso<n.iso||n.min>=atMin(g)))return iso;iso=isoAdd(iso,-1)}return null}
const WAIT_MAX_H=36;let lastPoll=0;
function tickCountdown(){
  const el=$('cdTime');if(!el){clearInterval(cdTimer);return}
  const g=state.game,chip=$('cdChip'),when=chip.parentNode.querySelector('.cd-when');
  if(when&&when.dataset.next===undefined)when.dataset.next=when.textContent;
  // Hold the "next draw" timer until the result of the draw that just happened is posted
  const held=lastHeldDate(g),since=held?Date.now()-drawEpoch(g,held):Infinity;
  const posted=held&&drawsFor().some(d=>d.date===held);
  const waiting=held&&!posted&&since>=0&&since<WAIT_MAX_H*3600e3&&(state.loaded||state.sample);
  chip.classList.toggle('live',!!waiting);chip.classList.remove(waiting?'soon':'x');
  if(waiting){
    const mins=Math.floor(since/60000);
    $('cdLbl').textContent=mins<(DRAW_LEN[g]||15)?'Drawing now':'Waiting for results';
    el.textContent=mins<1?'just drawn':mins<60?mins+' min ago':Math.floor(mins/60)+' h '+pad(mins%60,2)+' m ago';
    if(when)when.textContent=(held===bzNow().iso?'Today':fmtDay(held).replace(/,? \d{4}$/,''))+' · '+fmtTime(g)+' draw';
    // the phone app re-checks for new results every 3 minutes while waiting
    if(typeof window.bzRefresh==='function'&&Date.now()-lastPoll>180e3){lastPoll=Date.now();window.bzRefresh()}
    return;
  }
  if(when&&when.dataset.next!==undefined)when.textContent=when.dataset.next;
  const left=drawEpoch(g,nextDrawDate(g))-Date.now();
  if(left<=0){render();return}
  $('cdLbl').textContent='Next draw in';el.textContent=fmtLeft(left);
  chip.classList.toggle('soon',left<3600e3);
}
/* "No draw today · Happy Garifuna Settlement Day! 🪘" on a holiday, "No draw tomorrow · …" the day before */
function holidayLine(g){
  const td=bzNow().iso,tm=isoAdd(td,1),h1=SCHED[g].includes(isoDow(td))&&holidayOn(g,td),h2=!h1&&SCHED[g].includes(isoDow(tm))&&holidayOn(g,tm);
  const h=h1||h2;if(!h)return'';
  return '<span class="cd-holiday">'+(h1?'No draw today':'No draw tomorrow')+' · '+esc(holidayGreeting(h))+'</span>';
}
function startCountdown(){clearInterval(cdTimer);tickCountdown();cdTimer=setInterval(tickCountdown,1000)}

/* ---------- bottom tab bar (phones) ---------- */
const TABS=[['tabGames','secGames'],['tabMiss','secMiss'],['tabHot','secHot'],['tabLucky','secMine'],['tabRes','secRes']];
TABS.forEach(([b,sec])=>{const btn=$(b);if(!btn)return;btn.addEventListener('click',()=>{
  const el=$(sec);
  el.scrollIntoView({block:'start',behavior:reduceMotion()?'auto':'smooth'});setTab(b)})});
function setTab(id){TABS.forEach(([b])=>{const x=$(b);if(x){x.classList.toggle('on',b===id);x.setAttribute('aria-current',b===id?'true':'false')}})}
try{const seen=new Map();const io=new IntersectionObserver(es=>{es.forEach(e=>seen.set(e.target.id,e.isIntersecting?e.intersectionRatio:0));
  let best=null,br=0;TABS.forEach(([b,sec])=>{const r=seen.get(sec)||0;if(r>br){br=r;best=b}});if(best)setTab(best)},{threshold:[0,.15,.3,.5,.75,1],rootMargin:'-10% 0px -35% 0px'});
  TABS.forEach(([,sec])=>{const el=$(sec);if(el)io.observe(el)})}catch(e){}

/* ---------- entrance styles: roll, drop or flip, picked at random, never the same twice in a row ---------- */
const ENTER_STYLES=['roll','drop','flip'];
let enterPickedAt=0;
function pickEnter(){
  enterPickedAt=Date.now();
  const cur=document.body.dataset.enter;
  const pool=ENTER_STYLES.filter(x=>x!==cur);
  document.body.dataset.enter=pool[Math.floor(Math.random()*pool.length)];
}

/* ---------- drama for Missing and Hot Numbers ----------
   A wave that always lasts about 0.8 s however many balls there are, then a
   spotlight on the leader (longest wait / hottest), with the numbers counting up.
   Plays once per game or look-back change, when the section scrolls into view. */
const WAVE_S=.8,TOP_STEP=.3;
const reduceMotion=()=>window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const dramaState={tiles:{key:null,played:false},hot:{key:null,played:false}};
let dramaIO=null;
function countUp(el,ms,delay){
  const m=/^(\d+)(.*)$/.exec(el.textContent);if(!m)return;
  const to=+m[1],rest=m[2];el.dataset.final=to;if(to<2){return}
  el.textContent='0'+rest;
  const t0=performance.now()+delay;
  const step=now=>{const p=Math.min(1,Math.max(0,(now-t0)/ms)),e=1-Math.pow(1-p,3);
    el.textContent=Math.round(to*e)+rest;if(p<1)requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
function playDrama(id){
  const box=$(id),st=dramaState[id];if(!box||st.played)return;
  st.played=true;box.classList.remove('dpending');box.classList.add('dplay');
  SND.shimmer();SND.later((WAVE_S+.15)*1000+250,()=>SND.ping());
  const hot=id==='hot';
  box.querySelectorAll('.tiles').forEach(g=>{
    const balls=[...g.querySelectorAll('.bwrap')].filter(b=>!b.hidden),n=balls.length;
    balls.forEach((b,i)=>{
      if(i===0){b.classList.add(hot?'dstar-hot':'dstar');b.style.setProperty('--d',(WAVE_S+.15)+'s')}
      else b.style.setProperty('--d',(n>2?((i-1)/(n-2))*WAVE_S:0).toFixed(3)+'s');
      const num=b.querySelector('.tag b');
      if(num)countUp(num,i===0?1100:700,i===0?(WAVE_S+.15)*1000:(parseFloat(b.style.getPropertyValue('--d'))||0)*1000);
    });
  });
  if(!hot){const sb=$('say').querySelector('b');if(sb)countUp(sb,WAVE_S*1000+300,0);
    box.querySelectorAll('.topout-list li').forEach((li,i)=>{const v=li.querySelector('.tval b');if(v)countUp(v,700,TOP_STEP*1000*i+900)})}
  clearTimeout(box._dt);box._dt=setTimeout(()=>box.classList.remove('dplay'),(WAVE_S+4)*1000);
}
function drama(key,ids){
  if(reduceMotion())return;
  (ids||['tiles']).forEach(id=>{
    const st=dramaState[id],box=$(id);if(!box)return;
    if(st.key!==key){st.key=key;st.played=false;if(id==='tiles'&&Date.now()-enterPickedAt>120)pickEnter()}
    if(st.played)return;           // already shown for this game and look-back
    if(!box.querySelector('.bwrap')){st.played=true;return}
    box.classList.add('dpending');
    if(!('IntersectionObserver' in window)){playDrama(id);return}
    if(!dramaIO)dramaIO=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){dramaIO.unobserve(e.target);playDrama(e.target.id)}}),{threshold:0,rootMargin:'0px 0px -15% 0px'});
    dramaIO.unobserve(box);dramaIO.observe(box);
  });
}

/* ---------- Missing Numbers: show a few rows, "Continue" opens more ---------- */
const MISS_FIRST_ROWS=2,MISS_STEP_ROWS=4; // the first two rows show straight away (longest wait first), like Pick 3
const missView={key:null,rows:MISS_FIRST_ROWS};
function gridCols(g){return getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length||1}
function limitMissing(key,reveal){
  const box=$('tiles'),g=box.querySelector('.tiles'),mb=box.querySelector('.showmore');
  if(!g||!mb)return;
  if(key!==undefined&&key!==missView.key){missView.key=key;missView.rows=MISS_FIRST_ROWS}
  const balls=[...g.children],cols=gridCols(g),total=balls.length;
  let show=Math.min(total,missView.rows*cols);
  if(show>0&&total-show<=cols){show=total}   // don't leave a lonely last row behind the button
  g.closest('.ballset').hidden=show===0;
  const fresh=[];
  balls.forEach((b,i)=>{const hide=i>=show;if(!hide&&b.hidden&&reveal)fresh.push(b);b.hidden=hide});
  if(fresh.length&&!reduceMotion()){
    // one by one, slower: stagger shrinks a little for big batches so it never drags past ~2.6 s
    const step=Math.min(.16,1.6/Math.max(1,fresh.length-1));
    fresh.forEach((b,j)=>{b.classList.remove('reveal','reveal-star');void b.offsetWidth;
      b.style.setProperty('--r',(j*step).toFixed(3)+'s');b.classList.add('reveal');
      if(j===fresh.length-1)b.classList.add('reveal-star');
      const num=b.querySelector('.tag b');if(num)countUp(num,650,j*step*1000+350);
      // a soft knock as each ball lands, timed to its entrance; a ping on the last, gold-glowing one
      const kind=document.body.dataset.enter,hit=kind==='drop'?450:kind==='flip'?620:600,at=j*step*1000+hit;
      SND.later(at,()=>SND.land(j));if(j===fresh.length-1)SND.later(at+420,()=>SND.ping())});
    const first=fresh[0];setTimeout(()=>first.scrollIntoView({block:'center',behavior:'smooth'}),60);
  }
  const left=total-show,btn=mb.querySelector('.showmore-btn'),less=mb.querySelector('.showless-btn');
  const firstView=Math.min(total,MISS_FIRST_ROWS*cols);
  if(total-firstView<=cols){mb.hidden=true;return}   // everything fits in the first view: no button needed
  mb.hidden=false;mb.classList.toggle('folded',missView.rows===MISS_FIRST_ROWS);mb.classList.toggle('open',missView.rows>MISS_FIRST_ROWS);
  // once opened, a Close button sits beside Continue and the bar follows you down the list
  if(less){less.hidden=!(missView.rows>MISS_FIRST_ROWS&&left>0);less.setAttribute('aria-label','Close the list and go back to the top of Missing Numbers')}
  if(missView.rows===MISS_FIRST_ROWS&&left>0){btn.innerHTML='Show all <span class="cnt">'+left+' more</span> <span class="chev" aria-hidden="true">▾</span>';btn.dataset.act='more';btn.setAttribute('aria-expanded','false')}
  else if(left>0){btn.innerHTML='Continue <span class="cnt">'+left+' more</span> <span class="chev" aria-hidden="true">▾</span>';btn.dataset.act='more';btn.setAttribute('aria-expanded','false')}
  else{btn.innerHTML='Close <span class="chev" aria-hidden="true">▴</span>';btn.dataset.act='less';btn.setAttribute('aria-expanded','true')}
}
$('tiles').addEventListener('click',e=>{
  const btn=e.target.closest('.showmore-btn,.showless-btn');if(!btn)return;
  if(btn.classList.contains('showmore-btn')&&btn.dataset.act==='more'){pickEnter();missView.rows+=MISS_STEP_ROWS;limitMissing(undefined,true)}
  else{missView.rows=MISS_FIRST_ROWS;limitMissing();SND.close();$('secMiss').scrollIntoView({block:'start',behavior:reduceMotion()?'auto':'smooth'})}
});
window.addEventListener('resize',()=>limitMissing());

/* "More info": fine print stays folded until the person asks for it */
function setNote(main,extra){
  $('note').textContent=main;$('noteFine').textContent=extra;
  const b=document.querySelector('[data-more="noteFine"]');b.hidden=!extra;
  applyMore();
}
// each game remembers its own open "More info" boxes; the footer one is shared
const moreOpen={};
const MORE_SHARED=new Set(['footFine']);
function setMoreBtn(b,open){
  const t=$(b.dataset.more);if(!t)return;
  t.hidden=!open||b.hidden;b.setAttribute('aria-expanded',open);
  const base=b.dataset.label||'More info';b.textContent=open?(base==='More info'?'Less info':'Close'):base;
}
function applyMore(){
  const set=moreOpen[state.game]||new Set();
  document.querySelectorAll('button.more').forEach(b=>{if(!MORE_SHARED.has(b.dataset.more))setMoreBtn(b,set.has(b.dataset.more))});
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button.more');if(!b)return;
  const id=b.dataset.more,open=b.getAttribute('aria-expanded')!=='true';
  if(!MORE_SHARED.has(id)){const set=moreOpen[state.game]||(moreOpen[state.game]=new Set());open?set.add(id):set.delete(id)}
  setMoreBtn(b,open);
});

/* per-key facts for the tap note: last date, draws since, times in the chosen draws */
function factsFor(allSeq,dates,n,lo,hi,spanTxt){
  const m={},L=allSeq.length;if(lo==null){lo=L-n;hi=L-1}
  allSeq.forEach((ks,i)=>ks.forEach(k=>{const f=m[k]||(m[k]={last:-1,inWin:0});f.last=i;if(i>=lo&&i<=hi)f.inWin++}));
  return (k,prefix)=>{const f=m[k],span=spanTxt||'the last '+n+' draw'+(n===1?'':'s');
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
  const RANGE=state.missRange[state.game]||null;
  $('winSeg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',RANGE?b.dataset.w==='cal':b.dataset.w===W));
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
  const win=RANGE?all.filter(d=>d.date>=RANGE.from&&d.date<=RANGE.to):W==='all'?all:all.slice(-Number(W));
  { const md=$('missDates');md.hidden=!RANGE;
    if(RANGE){$('missFrom').value=RANGE.from;$('missTo').value=RANGE.to;const mn=all.length?all[0].date:'',mx=bzNow().iso;
      ['missFrom','missTo'].forEach(id=>{$(id).min=mn;$(id).max=mx})} }
  const WK=RANGE?'d'+RANGE.from+'_'+RANGE.to:W;
  const body=$('tiles'),hot=$('hot'),last=$('lastDraw');
  body.innerHTML='';hot.innerHTML='';
  setNote('','');$('hotSay').textContent='';$('lastDate').textContent='';

  /* last draw: rebuilt only when its results change, so a refresh with the same results
     doesn't cut the roll-in short */
  const ldNew=all.length?state.game+'|'+(state.sample?'s':'r')+'|'+all.slice(-8).map(x=>x.id+':'+(x.nums||[]).join('.')+(x.letter||'')+(x.nodraw?'x':'')).join(','):'empty|'+state.game;
  if(all.length&&ldNew===ldSig){const d=all[all.length-1];$('lastDate').textContent=fmtDay(d.date)+(d.nodraw?'':' · '+fmtTime(state.game));$('shareBtn').hidden=!!d.nodraw}
  else if(all.length){
    ldSig=ldNew;last.innerHTML='';
    const d=all[all.length-1];
    const many=state.game!=='boledo';
    const badge=document.createElement('p');badge.className='winbadge';badge.textContent=many?'Winning Numbers':'Winning Number';last.appendChild(badge);
    const animKey=state.game+'|'+d.id+'|'+(state.sample?'s':'r');
    const roll=animKey!==lastAnim;lastAnim=animKey;if(roll)pickEnter();
    last.classList.remove('roll','hold');ldPending=false;
    if(roll){if(introRunning()){last.classList.add('hold');ldPending=true}else requestAnimationFrame(()=>startLastRoll())}
    $('lastDate').textContent=fmtDay(d.date)+(d.nodraw?'':' · '+fmtTime(state.game));
    $('shareBtn').hidden=!!d.nodraw;
    let bi=0;
    if(state.game==='lottery'){
      d.nums.forEach((n,i)=>{const row=document.createElement('div');row.className='prizerow';
        const lab=document.createElement('span');lab.className='prizelab';lab.textContent=['1st','2nd','3rd'][i]+' prize';row.appendChild(lab);
        pad(n,4).split('').forEach((dg,j)=>{const t=ballEl(dg,true);t.classList.add('xs');if(i===0&&j>=2)t.classList.add('counted');t.style.setProperty('--i',bi++);row.appendChild(t)});
        last.appendChild(row)});
      const ln=document.createElement('p');ln.className='lnote';ln.textContent='The gold-ringed balls are the last two digits of the 1st prize, the number the board counts.';last.appendChild(ln);
    }else{
      (state.game==='boledo'?[pad(d.nums[0],2)]:d.nums.map(String)).forEach(k=>{const t=ballEl(k,true);t.style.setProperty('--i',bi++);last.appendChild(t)});
      if(d.letter){const l=document.createElement('div');l.className='letter';l.textContent=d.letter;l.title='Free letter';l.style.setProperty('--i',bi++);last.appendChild(l)}
      if(!d.nodraw&&(state.game==='boledo'||state.game==='pick3'))addRecent(last,all,bi);
    }
  }else{ldSig=ldNew;last.classList.remove('roll','hold');last.innerHTML='<p class="empty">No '+esc(G.label)+' results yet.</p>';$('shareBtn').hidden=true}
  { const nx=nextDrawDate(state.game),S=SCHEDULE[state.game],tonight=nx===bzNow().iso;
    $('drawNext').innerHTML='<span class="cd" id="cdChip"><span class="cd-dot" aria-hidden="true"></span><span id="cdLbl">Next draw in</span> <b id="cdTime">--:--:--</b></span>'+
      '<span class="cd-when">'+(tonight?'Today':esc(fmtDay(nx).replace(/,? \d{4}$/,'')))+' · '+fmtTime(state.game)+'</span>'+holidayLine(state.game);
    startCountdown();
    $('drawFine').textContent=G.label+' is drawn '+S.text+', Belize time.'+(S.extra?' '+S.extra:''); }

  const say=$('say');say.removeAttribute('aria-busy');
  if(!state.loaded&&!state.sample){say.innerHTML='<span class="skl" style="width:85%"></span><span class="skl" style="width:55%"></span>';say.setAttribute('aria-busy','true');
    body.innerHTML='<div class="sk-grid" aria-hidden="true">'+'<span class="sk"></span>'.repeat(12)+'</div>';
    hot.innerHTML='<div class="sk-grid" aria-hidden="true">'+'<span class="sk"></span>'.repeat(4)+'</div>';
    ldSig='skel';last.innerHTML='<div class="sk-row" aria-hidden="true"><span class="sk big"></span><span class="sk big"></span><span class="sk big"></span></div>';}
  else if(!win.length&&RANGE){say.innerHTML='There were no '+esc(G.label)+' draws between <b>'+esc(fmtDate(RANGE.from))+'</b> and <b>'+esc(fmtDate(RANGE.to))+'</b>. Try other dates.'}
  else if(!win.length){say.textContent='There are no '+G.label+' results yet. Add one at the bottom of the page.'}
  else{
    const n=win.length,short=d=>esc(fmtDate(d).replace(/,? \d{4}$/,''));
    const span=RANGE?'the <b>'+n+'</b> draw'+(n===1?'':'s')+' from <b>'+short(RANGE.from)+'</b> to <b>'+short(RANGE.to)+'</b>':n===1?'the last draw':'the last <b>'+n+'</b> draws';
    const lo=all.indexOf(win[0]),hi=all.indexOf(win[win.length-1]),spanTxt=span.replace(/<[^>]+>/g,'');
    const dates='Draws from '+fmtDate(win[0].date)+' to '+fmtDate(win[win.length-1].date)+'.';
    if(G.mode==='board'){
      const winSeq=win.map(G.keys),allSeq=all.map(G.keys);
      const facts=factsFor(allSeq,all.map(d=>d.date),n,lo,hi,spanTxt);
      const missing=missingSorted(winSeq,allSeq,G.board);
      const jp=state.game==='lottery'?' Only the last 2 digits of the 1st prize count.':'';
      say.innerHTML=(missing.length===1?'<b>1</b> number has <em>not</em> come out in '+span+'.'
        :missing.length?'<b>'+missing.length+'</b> numbers have <em>not</em> come out in '+span+'.'
        :'Every number from '+G.board[0]+' to '+G.board[G.board.length-1]+' has come out at least once in '+span+'.')+jp+
        (missing.length?' The number under each ball shows how many draws it has been waiting. Tap a ball for details.':'');
      if(missing.length){
        body.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,'<b>'+k+'</b> · '),k))));
        const mb=document.createElement('div');mb.className='showmore';mb.hidden=true;
        mb.innerHTML='<button type="button" class="btn showmore-btn" aria-controls="tiles"></button><button type="button" class="btn showless-btn" aria-controls="tiles" hidden>Close <span class="chev" aria-hidden="true">▴</span></button>';body.appendChild(mb)}
      setNote(dates,G.note||'');
    }else{
      let total=0,anyHot=false;
      SPOTS.forEach((spot,i)=>{
        const winSeq=win.map(d=>[String(d.nums[i])]),allSeq=all.map(d=>[String(d.nums[i])]);
        const facts=factsFor(allSeq,all.map(d=>d.date),n,lo,hi,spanTxt),pre=k=>'<b>'+k+'</b> in the '+spot+' spot · ';
        const missing=missingSorted(winSeq,allSeq,G.board);total+=missing.length;
        const row=document.createElement('div');row.className='posrow';
        row.innerHTML='<h3>'+spot+' digit</h3>';
        if(missing.length)row.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,pre(k)),i+':'+k))));
        else row.insertAdjacentHTML('beforeend','<p class="allplayed">Every digit has played here.</p>');
        body.appendChild(row);
      });
      say.innerHTML=total?'A Pick 3 number has 3 spots. Below, for each spot, are the digits that have <em>not</em> come out there in '+span+'. The number under each ball shows how many draws it has been waiting. Tap a ball for details.'
        :'Every digit from 0 to 9 has come out in every spot in '+span+'.';
      setNote(dates,'Each row is one spot in the Pick 3 number, read left to right.');
    }
    shadeColumns();
    limitMissing(state.game+'|'+WK);
    renderMine();
    drama(state.game+'|'+WK+'|'+(state.sample?'s':'r')+'|'+win.length+'|'+win[win.length-1].id);
  }
  renderHot(all);

  applyMore();
  renderRes(false);
}

/* ---------- Missing Numbers: pick dates instead of the slider ---------- */
function missDatesChanged(){let f=$('missFrom').value,t=$('missTo').value;if(!f||!t)return;
  const mx=bzNow().iso;if(t>mx)t=mx;if(f>t)[f,t]=[t,f];state.missRange[state.game]={from:f,to:t};render()}
$('missFrom').addEventListener('change',missDatesChanged);$('missTo').addEventListener('change',missDatesChanged);
$('missClear').addEventListener('click',()=>{state.missRange[state.game]=null;render()});

/* ---------- past results: balls by week ---------- */
const RES_INLINE=6;
const shortDay=iso=>{const [y,m,d]=iso.split('-').map(Number);const t=new Date(y,m-1,d);
  return{wd:t.toLocaleDateString(undefined,{weekday:'short'}),dm:t.toLocaleDateString(undefined,{day:'numeric',month:'short'}),yr:y}};
function resRange(){
  const today=bzNow().iso,days=state.resW*7;
  if(state.resFrom){const start=state.resFrom;let end=isoAdd(start,days-1);if(end>today)end=today;return{start,end}}
  return{start:isoAdd(today,-(days-1)),end:today};
}
function resRow(d){
  const row=document.createElement('div');row.className='resrow'+(d.nodraw?' skipped':'');
  const sd=shortDay(d.date);
  const dt=document.createElement('div');dt.className='resdate';
  dt.innerHTML='<b>'+esc(sd.wd)+'</b><span>'+esc(sd.dm)+(sd.yr!==new Date().getFullYear()?' '+sd.yr:'')+'</span>';
  const bx=document.createElement('div');bx.className='resballs';
  if(d.nodraw){const h=holidayOn(state.game,d.date)||(d.holiday?{name:d.holiday}:null);
    bx.innerHTML='<span class="resnone'+(h?' resholiday':'')+'">No draw'+(h?' · '+esc(holidayGreeting(h)):'')+'</span>'}
  else if(state.game==='lottery'){
    const first=document.createElement('div');first.className='resprize';
    pad(d.nums[0],4).split('').forEach((dg,j)=>{const t=ballEl(dg,true);t.classList.add('rb');if(j>=2)t.classList.add('counted');first.appendChild(t)});
    bx.appendChild(first);
    const rest=document.createElement('span');rest.className='resrest';
    rest.innerHTML='2nd <b>'+esc(pad(d.nums[1],4))+'</b> · 3rd <b>'+esc(pad(d.nums[2],4))+'</b>';bx.appendChild(rest);
  }else{
    (state.game==='boledo'?[pad(d.nums[0],2)]:d.nums.map(String)).forEach(k=>{const t=ballEl(k,true);t.classList.add('rb');bx.appendChild(t)});
    if(d.letter){const l=document.createElement('div');l.className='letter rbl';l.textContent=d.letter;l.title='Free letter';bx.appendChild(l)}
  }
  row.append(dt,bx);return row;
}
function fillRes(box,rows){box.innerHTML='';rows.forEach(d=>box.appendChild(resRow(d)))}
function renderRes(fromUser){
  const G=GAMES[state.game];
  $('resSeg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.w)===state.resW)));
  const {start,end}=resRange();
  const mine=(state.draws||[]).filter(d=>d.game===state.game);
  const rows=mine.filter(d=>d.date>=start&&d.date<=end).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  const first=mine.reduce((m,d)=>!m||d.date<m?d.date:m,'');
  const inp=$('resFrom');inp.max=bzNow().iso;if(first)inp.min=first;
  $('resLatest').hidden=!state.resFrom;
  const span=fmtDay(start).replace(/,? \d{4}$/,'')+' – '+fmtDay(end).replace(/,? \d{4}$/,'');
  const cnt=rows.filter(d=>!d.nodraw).length;
  const say=$('resSay');
  if(!state.loaded&&!mine.length){say.textContent='Loading results…'}
  else if(!rows.length)say.innerHTML='No '+esc(G.label)+' draws from <b>'+esc(span)+'</b>.'+(state.resFrom?'':' Try more weeks or pick a date below.');
  else say.innerHTML='<b>'+esc(span)+'</b> · '+cnt+' draw'+(cnt===1?'':'s');
  fillRes($('resList'),rows.slice(0,RES_INLINE));
  const big=rows.length>RES_INLINE;
  $('resMoreWrap').hidden=!big;
  if(big)$('resMore').innerHTML='See all '+rows.length+' results <span class="chev" aria-hidden="true">↗</span>';
  $('resBoxTitle').textContent=G.label+' results';
  $('resBoxSub').textContent=span+' · '+cnt+' draw'+(cnt===1?'':'s');
  if(!$('resBox').hidden||(fromUser&&big)){fillRes($('resBoxList'),rows);if(rows.length)openRes();else closeRes()}
}
let resOpener=null;
function openRes(){if(!$('resBox').hidden)return;SND.open();resOpener=document.activeElement;$('resBox').hidden=false;$('resBoxList').scrollTop=0;$('resClose').focus({preventScroll:true})}
function closeRes(){if($('resBox').hidden)return;SND.close();$('resBox').hidden=true;if(resOpener&&resOpener.focus)resOpener.focus({preventScroll:true})}
$('resMore').addEventListener('click',()=>{renderRes(true)});
$('resClose').addEventListener('click',closeRes);
$('resBox').addEventListener('click',e=>{if(e.target.id==='resBox')closeRes()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('resBox').hidden)closeRes()});
$('resFrom').addEventListener('change',e=>{const v=e.target.value;if(v&&v>bzNow().iso){e.target.value=state.resFrom;return}state.resFrom=v||'';renderRes(!!v)});
$('resLatest').addEventListener('click',()=>{state.resFrom='';$('resFrom').value='';renderRes(false)});

/* Hot Numbers has its own look-back switch, separate from Missing Numbers */
function renderHot(all){
  const G=GAMES[state.game],HW=curHot(),hot=$('hot');
  $('hotSeg').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.w===HW));
  if(!state.loaded&&!state.sample)return;
  hot.innerHTML='';
  if(!all.length){$('hotSay').textContent='There are no '+G.label+' results yet.';return}
  const win=HW==='all'?all:all.slice(-Number(HW)),n=win.length,lo=all.length-n,hi=all.length-1;
  const span=HW==='all'?'all <b>'+n+'</b> draws we have':n===1?'the last draw':'the last <b>'+n+'</b> draws',spanTxt=span.replace(/<[^>]+>/g,'');
  const dates=all.map(d=>d.date);
  if(G.mode==='board'){
    const facts=factsFor(all.map(G.keys),dates,n,lo,hi,spanTxt);
    const hl=hotList(win.map(G.keys),G.board,state.game==='fantasy5'?6:8);
    $('hotSay').innerHTML=hl.length?'The numbers that came out most often in '+span+'. The number under each ball shows how many times.':'No number came out more than once in '+span+'. Try more draws.';
    if(hl.length)hot.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,'<b>'+k+'</b> · '),k)),'hot'));
  }else{
    let anyHot=false;
    SPOTS.forEach((spot,i)=>{
      const facts=factsFor(all.map(d=>[String(d.nums[i])]),dates,n,lo,hi,spanTxt),pre=k=>'<b>'+k+'</b> in the '+spot+' spot · ';
      const hl=hotList(win.map(d=>[String(d.nums[i])]),G.board,3);
      const hrow=document.createElement('div');hrow.className='posrow';hrow.innerHTML='<h3>'+spot+' digit</h3>';
      if(hl.length){anyHot=true;hrow.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,pre(k)),i+':'+k)),'hot'))}
      else hrow.insertAdjacentHTML('beforeend','<p class="allplayed">No digit came out twice here.</p>');
      hot.appendChild(hrow)});
    $('hotSay').innerHTML=anyHot?'The digits that came out most often in each spot in '+span+'.':'No digit came out more than once in any spot. Try more draws.';
  }
  shadeColumns();
  // replay the hot reveal when its switch changes
  drama(state.game+'|'+HW+'|'+(state.sample?'s':'r')+'|'+n+'|'+all[all.length-1].id,['hot']);
}

/* alternate light/dark shade by column, whatever the screen width */
function shadeColumns(){
  document.querySelectorAll('.answer-body .tiles').forEach(g=>{
    const cols=getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length||1;
    [...g.children].forEach((t,i)=>t.classList.toggle('alt',(i%cols)%2===1))});
}
let lastAnim='',ldSig='',ldPending=false;
/* start the Last Draw entrance: winning balls roll in, then the earlier results from the right, with sounds */
function startLastRoll(){
  const last=$('lastDraw');ldPending=false;
  last.classList.remove('hold','roll');void last.offsetWidth;last.classList.add('roll');
  if(reduceMotion())return;
  const rec=last.querySelector('.recent'),rs=rec?parseFloat(rec.style.getPropertyValue('--rs'))*1000:0;
  [...last.querySelectorAll('.recent .tile')].filter(t=>!t.closest('.off')).forEach((t,r)=>SND.later(rs+r*220,()=>SND.rollIn(4+r,.55,.45)));
  const ts=[...last.querySelectorAll('.tile,.letter')].filter(t=>!t.closest('.recent'));ts.forEach((t,j)=>{const i=+(t.style.getPropertyValue('--i')||j),pr=!!t.closest('.prizerow');const st=200+i*(pr?200:380),D=pr?1250:1500,kind=document.body.dataset.enter;
    if(kind==='roll')SND.later(st,()=>SND.rollIn(j,D*.6/1000));
    else if(kind==='flip')SND.later(st,()=>SND.spinIn(j,D*.62/1000));
    else SND.later(st+D*.45,()=>SND.roll(j))});
}
/* while the opening intro covers the screen, the Last Draw waits and rolls in as the intro fades */
let introOn=false;const introRunning=()=>introOn;
function introFading(){introOn=false;if(ldPending)startLastRoll()}

/* Last Draw: earlier results beside the winning ball.
   Boledo: up to 6 smaller balls, newest first, as many as fit ("Past 4 Draws"); tap one for its ball card.
   Pick 3: the one draw before, as three mini balls ("Yesterday" only when it really was yesterday, counted from today; otherwise its weekday). */
const WKD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],WKD_LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const isoDay=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d)};
function addRecent(last,all,nBig){
  const d=all[all.length-1],prev=all.slice(0,-1).filter(x=>!x.nodraw).reverse();
  if(!prev.length)return;
  const box=document.createElement('div');box.className='recent';
  box.style.setProperty('--rs',(.2+(nBig-1)*.38+1.05).toFixed(2)+'s');   // start after the winning balls land
  const cap=document.createElement('p');cap.className='recent-cap';
  const list=document.createElement('div');list.className='recent-list';
  const dayLab=iso=>{const t=isoDay(iso);return WKD[t.getDay()]+' '+t.getDate()};
  if(state.game==='pick3'){
    const p=prev[0];
    cap.textContent=p.date===isoAdd(bzNow().iso,-1)?'Yesterday':WKD_LONG[isoDay(p.date).getDay()];
    const it=document.createElement('div');it.className='recent-item';
    it.setAttribute('role','img');it.setAttribute('aria-label',cap.textContent+', '+fmtDay(p.date)+': '+p.nums.join(' '));
    const chips=document.createElement('div');chips.className='p3chips';
    p.nums.forEach((n,r)=>{const t=ballEl(String(n));t.style.setProperty('--r',r);chips.appendChild(t)});
    const lab=document.createElement('span');lab.className='recent-day';lab.textContent=dayLab(p.date);
    it.append(chips,lab);list.appendChild(it);
  }else{
    const G=GAMES.boledo,L=all.length;
    const facts=factsFor(all.map(G.keys),all.map(x=>x.date),L,null,null,'all '+L+' draws we have');
    prev.slice(0,6).forEach(p=>{const k=G.keys(p)[0];
      const it=document.createElement('button');it.type='button';it.className='bwrap recent-item';
      it.dataset.key=k;it.dataset.detail=facts(k,'<b>'+k+'</b> · ');
      it.setAttribute('aria-label',k+', drawn '+fmtDay(p.date)+'. Tap for details.');
      const t=ballEl(k);const lab=document.createElement('span');lab.className='recent-day';lab.textContent=dayLab(p.date);
      it.append(t,lab);list.appendChild(it)});
  }
  box.append(cap,list);last.appendChild(box);
  fitRecent(last);
}
/* show only as many small balls as fit on the line; Pick 3 drops below the big balls if there's no room */
function fitRecent(last){
  last=last||$('lastDraw');const box=last&&last.querySelector('.recent');if(!box)return;
  const list=box.querySelector('.recent-list'),items=[...list.children];
  box.classList.remove('below');items.forEach(x=>x.classList.remove('off'));
  if(state.game==='pick3'){
    const it=items[0],big=[...last.querySelectorAll(':scope>.tile')];
    const used=big.reduce((s,t)=>s+t.offsetWidth+12,0),need=it.offsetWidth+parseFloat(getComputedStyle(box).paddingLeft)+2;
    box.classList.toggle('below',last.clientWidth-used<need);return;
  }
  const W=list.clientWidth,vw=document.documentElement.clientWidth,cap=vw<360?3:vw<600?4:6;let n=0;
  items.forEach(x=>{const fits=x.offsetLeft-list.offsetLeft+x.offsetWidth<=W+1;if(!fits||n>=cap)x.classList.add('off');else{x.style.setProperty('--r',n);n++}});
  if(!n){items[0].classList.remove('off');n=1}
  box.querySelector('.recent-cap').textContent=n===1?'Previous Draw':'Past '+n+' Draws';
}
if(window.ResizeObserver){let fr=0;const ro=new ResizeObserver(()=>{cancelAnimationFrame(fr);fr=requestAnimationFrame(()=>fitRecent())});
  ro.observe($('lastDraw'));new MutationObserver(()=>fitRecent()).observe(document.documentElement,{attributes:true,attributeFilter:['class']})}
else window.addEventListener('resize',()=>fitRecent());
/* tapping a ball opens a card that slides up from the bottom of the screen, so it is always in view,
   however long the list is. The weekly chart only shows for a ball that has played in those weeks. */
let sheetFrom=null;
function onBallTap(e){
  const b=e.target.closest('.bwrap');if(!b||!b.dataset.detail)return;
  openBallSheet(b);
}
function openBallSheet(b){
  document.querySelectorAll('.bwrap.sel').forEach(x=>{x.classList.remove('sel');x.setAttribute('aria-pressed','false')});
  b.classList.add('sel');b.setAttribute('aria-pressed','true');sheetFrom=b;
  const key=b.dataset.key,label=(b.querySelector('.tile span')||{}).textContent||'';
  const pick=state.game==='pick3'&&key&&key.includes(':');
  const sb=$('sheetBall');sb.innerHTML='';const t=ballEl(label);if(b.classList.contains('alt'))t.classList.add('alt');sb.appendChild(t);
  $('sheetTitle').textContent=pick?'Digit '+label+' · '+SPOTS[+key.split(':')[0]]+' spot':(GAMES[state.game].label+' '+label);
  let tag=b.querySelector('.tag');if(tag){tag=tag.cloneNode(true);tag.querySelectorAll('[data-final]').forEach(x=>{x.textContent=x.dataset.final+x.textContent.replace(/^\d+/,'')})}
  $('sheetSub').innerHTML=tag?tag.innerHTML+(b.closest('#hot')?' played':' since it last played'):'';
  $('sheetFacts').innerHTML=b.dataset.detail;
  const tr=$('sheetTrend');tr.innerHTML='';
  if(key!==undefined){const tc=trendChart(key);
    if(tc&&+tc.dataset.tot>0)tr.appendChild(tc);
    else tr.innerHTML='<p class="sheet-none">No plays in the last 10 weeks, so there is no weekly chart for this '+(pick?'digit':'number')+' yet.</p>'}
  const st=$('sheetStar');st.innerHTML='';
  if(key!==undefined){const btn=document.createElement('button');btn.type='button';btn.className='starbtn';btn.dataset.key=key;starLabel(btn);st.appendChild(btn)}
  const sh=$('ballSheet');const wasOpen=!sh.hidden;sh.hidden=false;
  const inn=sh.querySelector('.sheet-in');inn.style.transform='';
  if(!wasOpen){inn.classList.remove('up');void inn.offsetWidth;inn.classList.add('up')}
  $('sheetClose').focus({preventScroll:true});
}
function closeBallSheet(){const sh=$('ballSheet');if(sh.hidden)return;sh.hidden=true;SND.close();
  document.querySelectorAll('.bwrap.sel').forEach(x=>{x.classList.remove('sel');x.setAttribute('aria-pressed','false')});
  if(sheetFrom&&document.contains(sheetFrom))sheetFrom.focus({preventScroll:true});sheetFrom=null}
$('sheetClose').addEventListener('click',closeBallSheet);
$('ballSheet').addEventListener('click',e=>{if(e.target.id==='ballSheet')closeBallSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('ballSheet').hidden)closeBallSheet()});
// swipe the card down to close it
(()=>{const inn=$('ballSheet').querySelector('.sheet-in')||document.createElement('div');let y0=null,dy=0;
  inn.addEventListener('touchstart',e=>{if(inn.scrollTop>0)return;y0=e.touches[0].clientY;dy=0;inn.style.transition='none'},{passive:true});
  inn.addEventListener('touchmove',e=>{if(y0==null)return;dy=Math.max(0,e.touches[0].clientY-y0);inn.style.transform=dy?'translateY('+dy+'px)':''},{passive:true});
  inn.addEventListener('touchend',()=>{if(y0==null)return;inn.style.transition='';if(dy>90)closeBallSheet();else inn.style.transform='';y0=null})})();
function starLabel(sb){const on=isMine(sb.dataset.key);sb.classList.toggle('on',on);sb.setAttribute('aria-pressed',on);
  sb.innerHTML=on?'<span aria-hidden="true">★</span> In My Lucky Numbers · tap to remove':'<span aria-hidden="true">☆</span> Add to My Lucky Numbers'}
document.addEventListener('click',e=>{
  const sb=e.target.closest('.starbtn');if(sb){e.stopPropagation();toggleMine(sb.dataset.key);starLabel(sb);return}
  const x=e.target.closest('.mine-x');if(x){toggleMine(x.dataset.key);return}
  const ts=e.target.closest('.top-star');if(ts){e.stopPropagation();toggleMine(ts.dataset.key);if(isMine(ts.dataset.key))toast('★ '+ts.dataset.key+' added to My Lucky Numbers')}
},true);
$('tiles').addEventListener('click',onBallTap);$('hot').addEventListener('click',onBallTap);$('lastDraw').addEventListener('click',onBallTap);
try{const ro=new ResizeObserver(shadeColumns);ro.observe($('tiles'));ro.observe($('hot'))}catch(e){window.addEventListener('resize',shadeColumns)}

let toastTimer;
window.bzToast=(t)=>toast(t,false,3600);
window.bzSnd=SND;
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
  const out=[],today=bzNow().iso;
  for(let i=0;i<NUDGE_DAYS;i++){const iso=isoAdd(today,-i);
    ORDER.forEach(g=>{if(isDrawDay(g,iso)&&drawDone(g,iso)&&!have.has(g+'-'+iso))out.push({game:g,date:iso})})}
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
function nextMissingDate(g){const m=missingDraws().find(x=>x.game===g);return m?m.date:lastDrawDate(g)}
function openAdd(g,date){
  if(state.game!==g){state.game=g;savePrefs();setup();render()}
  const fold=$('addFold');fold.open=true;$('dDate').value=date;$('addMsg').textContent='';pendingOdd=null;checkDate();
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
    const jd=(dig.length===1&&dig[0].length>4)?(dig[0].match(/.{1,4}/g)||[]):dig;const d=(jd[i]||'').slice(0,4).split('');for(let j=0;j<4;j++)row.appendChild(slot(d[j]||'',j>=2?'counted':''));box.appendChild(row)})}
}
$('quickNums').addEventListener('input',renderSlots);

/* ---------- adding a result: one box ---------- */
function makeDraw(game,date,tokens){const o=GAMES[game].make(tokens);return o?Object.assign({id:game+'-'+date,game,date},o):null}
function flash(text,ok){const m=$('addMsg');m.textContent=text;m.className='msg '+(ok?'ok':'err')}
$('addFold').addEventListener('toggle',()=>{if($('addFold').open&&!$('quickNums').value){$('dDate').value=nextMissingDate(state.game);$('dDate').max=bzNow().iso;checkDate()}});
/* warn about dates that aren't draw days, and block draws that haven't happened yet */
function checkDate(){
  const el=$('dateHint');if(!el)return;const g=state.game,date=$('dDate').value,G=GAMES[g];
  el.className='hint';el.textContent='';
  if(!date)return;
  if(!drawDone(g,date)&&date>=bzNow().iso){el.className='hint warn';el.textContent=isDrawDay(g,date)?'This '+G.label+' draw is at '+fmtTime(g)+' Belize time and hasn\'t happened yet.':'That date is in the future.';return}
  const hol=holidayOn(g,date);
  if(hol&&SCHED[g].includes(isoDow(date))){el.className='hint warn';el.textContent='No '+G.label+' draw that day: it was a public holiday ('+hol.name+'). Check the date.';return}
  if(!isDrawDay(g,date)){el.className='hint warn';el.textContent=G.label+' isn\'t normally drawn on '+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][isoDow(date)]+'s. It\'s drawn '+SCHEDULE[g].text+'. Check the date.'}
}
$('dDate').addEventListener('input',()=>{pendingOdd=null;checkDate()});
$('dDate').value=lastDrawDate(state.game);checkDate();
$('addForm').addEventListener('submit',async e=>{e.preventDefault();
  if(state.sample){flash('Go back to real results first, then add a result.',false);return}
  const date=$('dDate').value;
  if(date&&!drawDone(state.game,date)&&date>=bzNow().iso){flash(isDrawDay(state.game,date)?'That draw hasn\'t happened yet. Results come in after '+fmtTime(state.game)+' Belize time.':'That date is in the future. Pick the date of the draw.',false);return}
  if(date&&!isDrawDay(state.game,date)&&pendingOdd!==state.game+date){pendingOdd=state.game+date;
    const hol=holidayOn(state.game,date);
    flash(hol?'That day was a public holiday ('+hol.name+'), so there\'s normally no '+GAMES[state.game].label+' draw. If there really was one, tap Add again to save it.':GAMES[state.game].label+' is normally drawn '+SCHEDULE[state.game].text+'. If this was a moved or special draw, tap Add again to save it.',false);return}
  const tokens=$('quickNums').value.trim().split(/[\s,;\-\/.]+/).filter(Boolean);
  const d=date&&makeDraw(state.game,date,tokens);
  if(!d){flash(ERR[state.game],false);return}
  const replacing=(state.draws||[]).some(x=>x.id===d.id);
  try{await adapter.save([d]);
    SND.success();flash((replacing?'Updated ':'Added ')+GAMES[state.game].label+' for '+fmtDate(date)+': '+GAMES[state.game].show(d),true);
    $('quickNums').value='';renderSlots();
    toast('<b>Board Updated · <span class="nw">'+esc(GAMES[state.game].show(d))+'</span> Added</b><br>'+esc(ENCOURAGE[Math.floor(Math.random()*ENCOURAGE.length)]),true);
    pendingOdd=null;const nx=missingDraws().find(x=>x.game===state.game);if(nx)$('dDate').value=nx.date;checkDate()}
  catch(err){flash("That result didn't save. "+(err&&err.message?err.message:'Try again.'),false)}
});


/* ---------- opening intro: plays once when the app opens; tapping the title replays it with the chime ---------- */
const INTRO=(()=>{
  const sp=document.getElementById('izSplash'),tpl=document.getElementById('izBallTpl');
  if(!sp||!tpl)return{play(){}};
  sp.querySelectorAll('.iz-ball').forEach((b,n)=>{b.innerHTML=tpl.innerHTML.replace(/id="(\w+)"/g,'id="iz$1'+n+'"').replace(/url\(#(\w+)\)/g,'url(#iz$1'+n+')')});
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const mk=(cls,vars)=>{const e=document.createElement('i');e.className=cls;for(const k in vars)e.style.setProperty('--'+k,vars[k]);return e};
  const g=id=>document.getElementById(id);
  function build(dx,dy,size){
    const ring=g('izRing'),trail=g('izTrail'),pop=g('izPop'),shower=g('izShower');
    ring.innerHTML=trail.innerHTML=pop.innerHTML=shower.innerHTML='';
    const R=size/2+12;
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2,r=R+rnd(-3,4);
      ring.appendChild(mk('iz-spark',{i,x:(Math.cos(a)*r).toFixed(1)+'px',y:(Math.sin(a)*r).toFixed(1)+'px',s:(i%3?rnd(9,12):rnd(13,17)).toFixed(1)+'px'}))}
    for(let i=0;i<14;i++){const t=i/13;
      trail.appendChild(mk('iz-dust',{d:Math.round(470+t*460)+'ms',x:(dx*(1-t)+rnd(-6,6)).toFixed(1)+'px',y:(dy*(1-t)+rnd(-size*.3,size*.3)).toFixed(1)+'px',vx:rnd(-14,14).toFixed(1)+'px',vy:rnd(-30,18).toFixed(1)+'px',s:rnd(3,6).toFixed(1)+'px'}))}
    for(let i=0;i<10;i++){const a=rnd(0,Math.PI*2),r=rnd(size*.6,size*1.1);
      pop.appendChild(mk('iz-spark',{d:Math.round(rnd(950,1010))+'ms',x:(Math.cos(a)*r).toFixed(1)+'px',y:(Math.sin(a)*r).toFixed(1)+'px',s:rnd(6,11).toFixed(1)+'px'}))}
    const W=g('izLockup').offsetWidth;
    for(let i=0;i<26;i++){const star=i%3===0;
      shower.appendChild(mk(star?'iz-spark':'iz-dust',{d:Math.round(rnd(1500,1640))+'ms',x:rnd(-W*.55,W*.55).toFixed(1)+'px',y:rnd(-size*1.4,-size*.4).toFixed(1)+'px',vx:rnd(-12,12).toFixed(1)+'px',vy:rnd(60,120).toFixed(1)+'px',s:(star?rnd(7,11):rnd(3,5)).toFixed(1)+'px'}))}
  }
  function measure(){
    const r=g('izBallslot').getBoundingClientRect();
    const dx=innerWidth/2-(r.left+r.width/2),dy=innerHeight/2-(r.top+r.height/2);
    sp.style.setProperty('--dx',dx.toFixed(1)+'px');sp.style.setProperty('--dy',dy.toFixed(1)+'px');sp.style.setProperty('--rot',(-(dx/(Math.PI*r.width))*360).toFixed(1)+'deg');
    const w1=sp.querySelector('.iz-w1'),gaps=w1.querySelectorAll('.iz-gap'),r0=w1.getBoundingClientRect();
    ['izG1','izG2'].forEach((id,k)=>{const q=gaps[k].getBoundingClientRect();g(id).style.left=(q.left-r0.left+q.width/2)+'px';g(id).style.top=(q.top-r0.top-2)+'px'});
    build(dx,dy,r.width);
  }
  let timer=0,running=false,t0=0,soundOn=false;
  const elapsed=()=>(performance.now()-t0)/1000;
  let fadeT=0;
  function end(){clearTimeout(timer);clearTimeout(fadeT);sp.classList.remove('iz-play','iz-exit','iz-skip');sp.hidden=true;running=false;introFading()}
  function play(withSound){
    if(reduceMotion()||running)return false;
    running=true;sp.hidden=false;sp.classList.remove('iz-play','iz-exit','iz-skip');void sp.offsetWidth;measure();
    sp.classList.add('iz-play','iz-exit');
    t0=performance.now();soundOn=false;
    // try the chime straight away: allowed for home-screen apps on Android and installed apps on computers.
    // Elsewhere (iPhone, phone browsers) the first tap on the intro starts it.
    if(withSound){SND.intro(0);soundOn=true}
    else if(!SND.isMuted()){SND.init();const go=()=>{if(!soundOn&&running&&SND.running()&&elapsed()<.4){soundOn=true;SND.intro(elapsed())}};go();setTimeout(go,120)}
    // the words stay on screen until about 6.5 seconds so they can be read without rushing (Nov 20, 2026; was 2.6 s)
    introOn=true;fadeT=setTimeout(introFading,6450);
    timer=setTimeout(end,6800);return true;
  }
  // tap anywhere on the intro to skip it
  sp.addEventListener('click',e=>{e.stopPropagation();if(!running)return;
    // first tap while silent: switch the sound on and let the intro finish; the next tap skips
    if(!soundOn&&!SND.isMuted()){soundOn=true;SND.unlock(()=>{if(running||elapsed()<7.1)SND.intro(elapsed())});return}
    clearTimeout(timer);clearTimeout(fadeT);introFading();sp.classList.add('iz-skip');timer=setTimeout(end,220)});
  return{play};
})();
// tap the "Missing Numbers" title to watch the intro again, with sound
(()=>{const h=document.querySelector('.brand h1');if(!h)return;
  h.classList.add('iz-title-btn');h.tabIndex=0;h.title='Tap to play the intro';
  const go=()=>{SND.init();setTimeout(()=>INTRO.play(true),30)};
  h.addEventListener('click',go);
  h.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  // a small sparkle on the title hints that it can be tapped
  setTimeout(()=>h.classList.add('iz-hint'),reduceMotion()?600:2300);
})();
INTRO.play(false);
/* always open at the top: browsers otherwise jump back to where you were last time.
   A phone app that comes back after 15+ minutes away also returns to the top. */
try{if('scrollRestoration' in history)history.scrollRestoration='manual'}catch(e){}
const toTop=()=>{try{window.scrollTo({top:0,left:0,behavior:'instant'})}catch(e){window.scrollTo(0,0)}};
toTop();addEventListener('load',toTop);addEventListener('pageshow',e=>{if(e.persisted)toTop()});
(()=>{let hiddenAt=0;document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')hiddenAt=Date.now();
  else if(hiddenAt&&Date.now()-hiddenAt>15*60*1000){toTop();hiddenAt=0}})})();

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

/* results come from draws.json on this site; while a result is awaited we also ask GitHub's raw file
   service with a cache-buster, which usually shows a new result sooner than the site's 10-minute cache */
const RAW_URL='https://raw.githubusercontent.com/bitcoinbelizeai-ops/Missing-Numbers-Lotto/main/draws.json';
async function getJSON(u){const r=await fetch(u,{cache:'no-cache'});if(!r.ok)throw 0;const j=await r.json();if(!j||!Array.isArray(j.draws))throw 0;return j}
async function refreshShipped(fast){
  const tries=[getJSON('../draws.json')];if(fast)tries.push(getJSON(RAW_URL+'?t='+Date.now()));
  const got=(await Promise.allSettled(tries)).filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(got.length){const byId={};got.forEach(j=>j.draws.forEach(d=>{byId[d.id]=d}));
    const merged={updated:got.map(j=>j.updated||'').sort().pop(),draws:Object.values(byId).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)};
    shipped=merged;store(CACHE,merged)}
  $('storeNote').textContent=(shipped.updated?'Built-in results updated '+fmt(shipped.updated)+'. ':'')+'Draws you add are saved on this phone.';
  push();
}

/* public holidays (no Boledo, Pick 3 or Fantasy 5 draw), edited from the Admin page */
const HOL_URL='../data/holidays.json';
async function refreshHolidays(){try{const r=await fetch(HOL_URL,{cache:'no-cache'});if(!r.ok)return;const j=await r.json();
  if(j&&j.days&&typeof j.days==='object'&&typeof window.bzSetHolidays==='function')window.bzSetHolidays(j.days)}catch(e){}}

window.bzRefresh=()=>refreshShipped(true);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshShipped(true);refreshHolidays()}});


if(false){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').then(reg=>{
    // iPhones keep a home-screen app paused instead of reopening it, so look for a new version each time it comes back
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg&&reg.update().catch(()=>{})});
  }).catch(()=>{}));
  // when a new version takes over, reload once so the new screens show right away
  const hadSW=!!navigator.serviceWorker.controller;let reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadSW||reloaded)return;reloaded=true;location.reload()});
}
refreshShipped();
refreshHolidays();
})();


/* ---------- free accounts: sign up / sign in with an email code, Lucky Numbers synced to every device ----------
   Phone app only. Needs supabase-config.js (project address + public key) and the Supabase library.
   If either is missing, this part simply stays switched off and the app works as before. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const CFG=window.MN_SUPABASE||{};
const strip=$('acctStrip'),sheet=$('acctSheet');
if(!strip||!sheet||!CFG.url||/PASTE/.test(CFG.url)||!CFG.key||/PASTE/.test(CFG.key))return;

const PENDING='mn-pending-profile',SYNCAT='mn-sync-at',NUDGED='mn-acct-nudged';
const ls={get(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const msg=(el,t,k)=>{el.textContent=t||'';el.className='ac-msg'+(k?' '+k:'')};
const emailOk=e=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const NICK_RE=/^[A-Za-z0-9_]{3,16}$/;
const NICK_BAD=/(fuck|shit|bitch|cunt|nigg|pussy|dick|whore|slut|admin|support|official|bgl)/i;
const THROWAWAY=/@(mailinator|10minutemail|guerrillamail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop)\./i;
const day=d=>d?new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'';
const timeOf=d=>d?new Date(d).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
function explain(err){
  const m=(err&&(err.message||err.error_description||String(err)))||'Something went wrong';
  if(err&&err.status===429||/rate limit|only request this after|too many/i.test(m))return 'Too many tries. Please wait a minute, then try again.';
  if(/expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(m))return 'That code didn\'t match or has expired.';
  if(/fetch|network|failed to load|load failed/i.test(m))return 'No connection. Check your internet and try again.';
  if(/profiles_nickname_unique|duplicate key/i.test(m))return 'That nickname was just taken. Please choose another.';
  if(/banned|suspended/i.test(m))return 'This account is suspended.';
  return m;
}

let sb=null,user=null,profile=null,offline=false,glowOn=false;

/* ---------- the strip in My Lucky Numbers ---------- */
function luckyCount(){const m=(window.bzLucky&&window.bzLucky.get())||{};return Object.values(m).reduce((n,L)=>n+(Array.isArray(L)?L.length:0),0)}
const hbtn=$('acctBtn');
function drawHeader(){
  if(!hbtn)return;hbtn.hidden=false;const t=$('acctBtnTxt');hbtn.classList.remove('me');
  if(user&&profile){hbtn.classList.add('me');t.textContent=String(profile.nickname||'?').charAt(0).toUpperCase();hbtn.setAttribute('aria-label','Your account, '+profile.nickname);return}
  if(user&&!profile){t.textContent='Finish';hbtn.setAttribute('aria-label','Finish creating your account');return}
  t.textContent='Sign up';hbtn.setAttribute('aria-label','Sign up or sign in');
}
if(hbtn)hbtn.onclick=()=>{if(offline){window.bzToast&&window.bzToast('Accounts need an internet connection.');return}
  window.bzSnd&&window.bzSnd.open&&window.bzSnd.open();openSheet(user&&profile?'me':user?'finish':'up')};
function drawStrip(){
  drawHeader();
  // the box under My Lucky Numbers only shows for people who aren't signed in and have 3 or more numbers
  const show=!offline&&((user&&!profile)||(!user&&luckyCount()>=3));
  strip.hidden=!show;if(!show)return;
  const txt=$('acctTxt'),btns=$('acctBtns');btns.textContent='';
  const btn=(label,cls,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn small'+(cls?' '+cls:'');b.textContent=label;b.onclick=fn;btns.appendChild(b)};
  strip.classList.toggle('glow',glowOn&&!user);
  if(offline){txt.textContent='Accounts need an internet connection. Your Lucky Numbers are safe on this device.';return}
  if(user&&profile){txt.innerHTML='';const b=document.createElement('b');b.textContent=profile.nickname;txt.append('Saved to your account, ',b,'. They show on every device you sign in on.');btn('Account','ghost',()=>openSheet('me'));return}
  if(user&&!profile){txt.textContent='Your email is confirmed. Finish your details to save your Lucky Numbers.';btn('Finish','',()=>openSheet('finish'));return}
  txt.innerHTML='Saved on this device only. <b>Create a free account</b> to keep them on every device.';
  btn('Create account','',()=>openSheet('up'));btn('Sign in','ghost',()=>openSheet('in'));
}

/* ---------- the sheet ---------- */
let opener=null;
const VIEWS=['acUp','acIn','acCode','acMe'];
function view(v){
  const map={up:'acUp',finish:'acUp',in:'acIn',code:'acCode',me:'acMe'};
  VIEWS.forEach(id=>$(id).hidden=id!==map[v]);
  $('acTabs').hidden=!(v==='up'||v==='in');
  $('acTabUp').setAttribute('aria-selected',v==='up');$('acTabIn').setAttribute('aria-selected',v==='in');
  $('acTitle').textContent={up:'Free account',in:'Sign in',finish:'Finish your account',code:'Check your email',me:'Your account'}[v];
  $('acSub').textContent={up:'Keep your Lucky Numbers on every device.',in:'We\'ll email you a code. No password needed.',finish:'Just a few details and you\'re done.',code:'Type or paste the code from the email.',me:'Your Lucky Numbers are saved to this account.'}[v];
  const fin=v==='finish';$('acEmail').disabled=fin;$('acUpBtn').textContent=fin?'Save my details':'Send my code';
  if(fin&&user)$('acEmail').value=user.email||'';
  if(v==='me')fillMe();
}
function openSheet(v){opener=document.activeElement;sheet.hidden=false;const inn=sheet.querySelector('.sheet-in');inn.classList.remove('up');void inn.offsetWidth;inn.classList.add('up');view(v);
  setTimeout(()=>{const f={up:'acNick',finish:'acNick',in:'acInEmail',code:'acCodeIn',me:'acClose'}[v];$(f)&&$(f).focus({preventScroll:true})},60)}
function closeSheet(){if(sheet.hidden)return;sheet.hidden=true;$('acDelBox').hidden=true;delDisarm();(opener&&opener.focus)?opener.focus({preventScroll:true}):0}
$('acClose').onclick=closeSheet;
sheet.addEventListener('click',e=>{if(e.target===sheet)closeSheet()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet()});
$('acTabUp').onclick=()=>view('up');$('acTabIn').onclick=()=>view('in');

/* ---------- nickname ---------- */
let nickTimer=0,nickFree=null;
function nickLocal(n){if(!n)return 'Choose a nickname.';if(!NICK_RE.test(n))return 'Use 3–16 letters, numbers or _ only.';if(NICK_BAD.test(n))return 'Please choose a different nickname.';if(/\d{7,}/.test(n))return 'Nicknames can\'t contain phone numbers.';return ''}
async function checkNick(){
  const n=$('acNick').value.trim(),bad=nickLocal(n);nickFree=null;
  if(bad){msg($('acNickMsg'),bad,'bad');$('acNick').setAttribute('aria-invalid','true');return false}
  msg($('acNickMsg'),'Checking…');
  const {data,error}=await sb.rpc('nickname_available',{nick:n});
  if($('acNick').value.trim()!==n)return null;
  if(error){msg($('acNickMsg'),explain(error),'bad');return false}
  nickFree=!!data;
  if(data){msg($('acNickMsg'),'✓ '+n+' is available','good');$('acNick').removeAttribute('aria-invalid')}
  else{msg($('acNickMsg'),n+' is taken. Try '+n.slice(0,13)+Math.floor(10+Math.random()*89)+'.','bad');$('acNick').setAttribute('aria-invalid','true')}
  return !!data;
}
$('acNick').addEventListener('input',()=>{clearTimeout(nickTimer);nickFree=null;nickTimer=setTimeout(checkNick,450)});
const W1=['Lucky','Gold','Jaguar','Toucan','Reef','Mango','Coral','Keel','Star','Tapir','Manatee','Cayo','Ceiba','Breeze','Palm'],W2=['Ball','Draw','Pick','Spin','Number','Charm','Streak','Wave','Seven','Lime'];
$('acSuggest').onclick=()=>{$('acNick').value=W1[Math.floor(Math.random()*W1.length)]+W2[Math.floor(Math.random()*W2.length)]+Math.floor(10+Math.random()*89);checkNick()};

/* ---------- create account / finish details ---------- */
let codeEmail='',tries=0,resendTimer=0;
function startResend(){let t=60;const b=$('acResend');b.disabled=true;clearInterval(resendTimer);b.textContent='Send a new code ('+t+')';
  resendTimer=setInterval(()=>{t--;if(t<=0){clearInterval(resendTimer);b.disabled=false;b.textContent='Send a new code'}else b.textContent='Send a new code ('+t+')'},1000)}
async function sendCode(email,btn,m){
  btn.disabled=true;const old=btn.textContent;btn.textContent='Sending…';
  const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true}});
  btn.disabled=false;btn.textContent=old;
  if(error){msg(m,explain(error),'bad');return false}
  codeEmail=email;tries=0;$('acCodeTo').textContent=email;$('acCodeIn').value='';msg($('acCodeMsg'),'');view('code');startResend();
  setTimeout(()=>$('acCodeIn').focus(),60);return true;
}
$('acUp').addEventListener('submit',async e=>{
  e.preventDefault();const m=$('acUpMsg');msg(m,'','bad');
  const fin=!!(user&&!profile);
  const nick=$('acNick').value.trim(),first=$('acFirst').value.trim(),age=$('acAge').value,dist=$('acDist').value,email=(fin?(user.email||''):$('acEmail').value.trim()).toLowerCase();
  ['acAge','acDist','acEmail'].forEach(id=>$(id).removeAttribute('aria-invalid'));
  const free=nickFree===true?true:await checkNick();
  if(!free){msg(m,'Please fix the nickname first.','bad');$('acNick').focus();return}
  if(!age){$('acAge').setAttribute('aria-invalid','true');msg(m,'Choose your age range.','bad');$('acAge').focus();return}
  if(!dist){$('acDist').setAttribute('aria-invalid','true');msg(m,'Choose your district.','bad');$('acDist').focus();return}
  if(!emailOk(email)){$('acEmail').setAttribute('aria-invalid','true');msg(m,'Check the email address.','bad');$('acEmail').focus();return}
  if(THROWAWAY.test(email)){$('acEmail').setAttribute('aria-invalid','true');msg(m,'Please use a permanent email address.','bad');return}
  if(!$('acAgree').checked){msg(m,'Please tick the box to confirm you are 18 or older and agree.','bad');return}
  const details={nickname:nick,first_name:first||null,age_range:age,district:dist,news_opt_in:$('acNews').checked,email,at:Date.now()};
  ls.set(PENDING,details);
  if(fin){$('acUpBtn').disabled=true;await makeProfile();$('acUpBtn').disabled=false;return}
  await sendCode(email,$('acUpBtn'),m);
});
$('acIn').addEventListener('submit',async e=>{e.preventDefault();const email=$('acInEmail').value.trim().toLowerCase(),m=$('acInMsg');
  if(!emailOk(email)){msg(m,'Check the email address.','bad');return}await sendCode(email,$('acInBtn'),m)});

/* ---------- code ---------- */
$('acCodeIn').addEventListener('input',e=>{const v=$('acCodeIn').value.replace(/\D/g,'').slice(0,10);$('acCodeIn').value=v;
  const whole=e.inputType==='insertFromPaste'||e.inputType==='insertReplacementText'||!e.inputType;if(whole&&v.length>=6)$('acCode').requestSubmit()});
$('acCode').addEventListener('submit',async e=>{
  e.preventDefault();const code=$('acCodeIn').value,m=$('acCodeMsg');
  if(!/^\d{6,10}$/.test(code)){msg(m,'Enter all the digits from the email.','bad');return}
  if(tries>=5){msg(m,'Too many tries. Send a new code.','bad');return}
  $('acCodeBtn').disabled=true;msg(m,'Checking…');
  const {data,error}=await sb.auth.verifyOtp({email:codeEmail,token:code,type:'email'});
  $('acCodeBtn').disabled=false;
  if(error){tries++;const left=5-tries;msg(m,explain(error)+(left>0?' '+left+(left===1?' try':' tries')+' left.':' Send a new code.'),'bad');$('acCodeIn').select();return}
  clearInterval(resendTimer);user=data.user;await afterSignIn(true);
});
$('acResend').onclick=async()=>{if(codeEmail)await sendCode(codeEmail,$('acResend'),$('acCodeMsg'))};
$('acBack').onclick=()=>{clearInterval(resendTimer);view(ls.get(PENDING)?'up':'in')};

/* record a visit (keeps the account from the 2-year clean-up); at most once every 20 hours */
let seenAt=0;
function touchSeen(){if(!user||!profile)return;const t=Date.now();if(t-seenAt<20*3600e3)return;seenAt=t;
  sb.from('profiles').update({last_seen:new Date(t).toISOString()}).eq('id',user.id).then(()=>{},()=>{})}
/* ---------- after sign-in ---------- */
async function afterSignIn(fromSheet){
  if(!user){profile=null;drawStrip();return}
  const {data:prof,error}=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(error){if(fromSheet){view('up');msg($('acUpMsg'),explain(error),'bad')}return}
  if(prof){profile=prof;ls.del(PENDING);touchSeen();
    await firstSync();drawStrip();if(fromSheet){view('me');window.bzToast&&window.bzToast('Signed in. Your Lucky Numbers are saved to your account.')}return}
  const p=ls.get(PENDING);
  if(p&&p.email===(user.email||'').toLowerCase()){await makeProfile(fromSheet);return}
  profile=null;drawStrip();if(fromSheet)view('finish');
}
async function makeProfile(){
  const p=ls.get(PENDING);if(!p||!user)return;
  const row={id:user.id,nickname:p.nickname,first_name:p.first_name,age_range:p.age_range,district:p.district,news_opt_in:!!p.news_opt_in,terms_version:CFG.termsVersion||'2026-11'};
  const {data,error}=await sb.from('profiles').insert(row).select().single();
  if(error){view('finish');msg($('acUpMsg'),explain(error)+' Your email is confirmed; choose another nickname and press Save my details.','bad');return}
  ls.del(PENDING);profile=data;await firstSync();drawStrip();view('me');
  window.bzToast&&window.bzToast('Welcome, '+(profile.first_name||profile.nickname)+'! Your Lucky Numbers are saved to your account.');
}

/* ---------- Lucky Numbers sync ----------
   First sign-in on a device: numbers here and numbers in the account are combined (up to 12 per game).
   After that: changes here are saved to the account a moment later, and coming back to the app
   picks up changes made on other devices. */
const same=(a,b)=>JSON.stringify(norm(a))===JSON.stringify(norm(b));
function norm(m){const o={};Object.keys(m||{}).sort().forEach(g=>{if(Array.isArray(m[g])&&m[g].length)o[g]=m[g].map(String)});return o}
function merge(here,there){const out={};new Set([...Object.keys(here||{}),...Object.keys(there||{})]).forEach(g=>{
  const L=[];[...(Array.isArray(here[g])?here[g]:[]),...(Array.isArray((there||{})[g])?there[g]:[])].forEach(k=>{k=String(k);if(!L.includes(k)&&L.length<12)L.push(k)});if(L.length)out[g]=L});return out}
let pushTimer=0,pushing=false,lastSaved=null;
async function firstSync(){
  if(!window.bzLucky||!user)return;
  const {data,error}=await sb.from('lucky_numbers').select('mine,updated_at').eq('user_id',user.id).maybeSingle();
  if(error)return;
  const server=(data&&data.mine)||{},merged=merge(window.bzLucky.get(),server);
  if(!same(merged,window.bzLucky.get()))window.bzLucky.set(merged);
  if(!data||!same(merged,server))await push();else{lastSaved=norm(merged);ls.set(SYNCAT,data.updated_at)}
}
async function push(){
  if(!user||!profile||!window.bzLucky)return;
  pushing=true;const mine=norm(window.bzLucky.get()),at=new Date().toISOString();
  const {error}=await sb.from('lucky_numbers').upsert({user_id:user.id,mine,updated_at:at});
  pushing=false;
  if(!error){lastSaved=mine;ls.set(SYNCAT,at)}
  if(!sheet.hidden&&!$('acMe').hidden)fillMe(error?'Couldn\'t save just now. We\'ll try again.':'');
}
function onLocalChange(){if(!user||!profile)return;clearTimeout(pushTimer);pushTimer=setTimeout(()=>{if(!same(window.bzLucky.get(),lastSaved))push()},1200)}
async function pull(){
  if(!user||!profile||pushing||!window.bzLucky)return;
  if(lastSaved&&!same(window.bzLucky.get(),lastSaved)){push();return}  // unsaved changes here win
  const {data,error}=await sb.from('lucky_numbers').select('mine,updated_at').eq('user_id',user.id).maybeSingle();
  if(error||!data)return;
  const at=ls.get(SYNCAT);
  if(!at||data.updated_at>at){if(!same(data.mine,window.bzLucky.get()))window.bzLucky.set(norm(data.mine));lastSaved=norm(data.mine);ls.set(SYNCAT,data.updated_at)}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){pull();touchSeen()}});

/* ---------- account view ---------- */
function fillMe(note){
  if(!profile||!user)return;
  $('acMeNick').textContent=profile.nickname;$('acMeAge').textContent=profile.age_range;$('acMeDist').textContent=profile.district;
  $('acMeEmail').textContent=user.email||'';$('acMeSince').textContent=day(profile.created_at);
  const at=ls.get(SYNCAT);$('acMeSync').textContent=note||(at?'✓ Lucky Numbers saved to your account at '+timeOf(at)+'.':'✓ Lucky Numbers saved to your account.');
  $('acMeSync').style.color=note?'#ffb0a8':'';$('acDelNick').textContent=profile.nickname;
}
async function signOut(scope){
  await sb.auth.signOut({scope}).catch(()=>{});user=null;profile=null;lastSaved=null;ls.del(SYNCAT);closeSheet();drawStrip();
  window.bzToast&&window.bzToast('Signed out. Your Lucky Numbers stay on this device.');
}
$('acOut').onclick=()=>signOut('local');
// delete needs two taps on the red button (the first tap arms it for 3 seconds), like removing a Lucky Number
let delArmed=false,delTimer=0;
function delDisarm(){delArmed=false;clearTimeout(delTimer);const b=$('acDelGo');b.textContent='Double-tap to delete';b.classList.remove('armed')}
$('acDel').onclick=()=>{$('acDelBox').hidden=false;delDisarm();msg($('acMeMsg'),'');$('acDelBox').scrollIntoView({block:'nearest'})};
$('acDelNo').onclick=()=>{$('acDelBox').hidden=true;delDisarm()};
$('acDelGo').onclick=async()=>{
  if(!delArmed){delArmed=true;const b=$('acDelGo');b.textContent='Tap again to delete';b.classList.add('armed');clearTimeout(delTimer);delTimer=setTimeout(delDisarm,3000);return}
  delDisarm();
  $('acDelGo').disabled=true;const {error}=await sb.rpc('delete_my_account');$('acDelGo').disabled=false;
  if(error){msg($('acMeMsg'),explain(error),'bad');return}
  await sb.auth.signOut({scope:'local'}).catch(()=>{});user=null;profile=null;lastSaved=null;ls.del(SYNCAT);closeSheet();drawStrip();
  window.bzToast&&window.bzToast('Your account was deleted. Your Lucky Numbers stay on this device.');
};

/* ---------- the "sign up" moment: when a signed-out person reaches 3 Lucky Numbers ----------
   Once per visit: the account box comes into view, sparkles burst around it, a magic chime plays,
   the box pulses gold and the Create account button shines. Waits until the number picker is closed. */
let lastCount=null,dramaDone=false,dramaWait=0;
const reduce=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
function overlayOpen(){return ['pickBox','ballSheet','mixBox','shareBox'].some(id=>$(id)&&!$(id).hidden)||!sheet.hidden}
function maybeDrama(){
  const n=luckyCount(),prev=lastCount;lastCount=n;
  if(!user)drawStrip();
  if(user||offline||dramaDone||prev===null||!(prev<3&&n>=3))return;
  dramaDone=true;clearInterval(dramaWait);
  const inPicker=$('pickBox')&&!$('pickBox').hidden;
  if(inPicker)pickerMoment();
  dramaWait=setInterval(()=>{if(overlayOpen())return;clearInterval(dramaWait);setTimeout(()=>drama(inPicker),350)},250);
}
/* inside the number picker: a banner with sparkles and the chime, right where the person is looking */
function pickerMoment(){
  const inn=$('pickBox').querySelector('.mixbox-in');if(!inn)return;
  let ban=$('acPickBan');
  if(!ban){ban=document.createElement('div');ban.id='acPickBan';ban.className='ac-pickban';ban.setAttribute('role','status');
    ban.innerHTML='<b>★ 3 Lucky Numbers!</b><span>Keep them on every device with a free account.</span><button type="button" class="btn small" id="acPickGo">Create account</button>';
    inn.insertBefore(ban,inn.children[1]||null);
    ban.querySelector('#acPickGo').onclick=()=>{$('pickDone').click();setTimeout(()=>openSheet('up'),250)}}
  ban.hidden=false;ban.classList.remove('wow');void ban.offsetWidth;ban.classList.add('wow');
  const S=window.bzSnd;if(S){try{S.intro()}catch(e){}}
  if(!reduce())burst(ban);
}
function drama(quiet){
  if(user)return;
  const ban=$('acPickBan');if(ban)ban.hidden=true;
  glowOn=true;drawStrip();
  strip.scrollIntoView({block:'center',behavior:reduce()?'auto':'smooth'});
  $('acctTxt').innerHTML='<b>★ Nice picks!</b> Don\'t lose them. <b>Create a free account</b> and they\'ll be on every device you use.';
  setTimeout(()=>{
    const S=window.bzSnd;if(S){try{quiet?S.shimmer():S.intro()}catch(e){}}
    strip.classList.remove('wow');void strip.offsetWidth;strip.classList.add('wow');
    if(!reduce())burst(strip);
    setTimeout(()=>strip.classList.remove('wow'),2600);
  },reduce()?0:450);
}
function burst(host){
  const box=document.createElement('div');box.className='acct-burst';box.setAttribute('aria-hidden','true');
  const COLORS=['#fff0b8','#e9c46a','#ffd77a','#ffffff','#fec207'];
  for(let i=0;i<34;i++){const sp=document.createElement('i');const a=Math.random()*Math.PI*2,d=70+Math.random()*130;
    sp.style.setProperty('--dx',Math.cos(a)*d*1.6+'px');sp.style.setProperty('--dy',Math.sin(a)*d+'px');
    sp.style.setProperty('--d',(.6+Math.random()*.7).toFixed(2)+'s');sp.style.setProperty('--w',(.05+Math.random()*.5).toFixed(2)+'s');
    sp.style.setProperty('--s',(6+Math.random()*12).toFixed(0)+'px');sp.style.color=COLORS[i%COLORS.length];
    sp.textContent=i%3?'✦':'★';box.appendChild(sp)}
  host.appendChild(box);setTimeout(()=>box.remove(),2200);
}
function onAnyChange(){onLocalChange();maybeDrama()}

/* ---------- start ---------- */
function whenLibrary(cb){let n=0;(function wait(){if(window.supabase&&window.supabase.createClient)return cb(true);if(++n>100)return cb(false);setTimeout(wait,100)})()}
drawStrip();lastCount=luckyCount();
if(window.bzLucky)window.bzLucky.onChange=onAnyChange;
whenLibrary(async ok=>{
  if(!ok){offline=true;drawStrip();return}
  let base;try{base=new URL(String(CFG.url).trim()).origin}catch(e){base=String(CFG.url).trim()}
  sb=window.supabase.createClient(base,String(CFG.key).trim(),{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'mn-auth'}});
  if(window.bzLucky)window.bzLucky.onChange=onAnyChange;
  const {data:{session}}=await sb.auth.getSession();
  if(session&&session.user){user=session.user;await afterSignIn(false)}else drawStrip();
});
})();
