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
  lottery:{label:'Sunday Jackpot',mode:'board',board:range(0,99),wins:['10','20','30','all'],def:'30',
    ph:'1652 0188 7876',hint:'Type the 1st, 2nd and 3rd prize numbers with spaces between, like 1652 0188 7876.',
    note:'For the Sunday Jackpot, the board counts the last two digits of the 1st prize, the 2-digit number that wins. The 2nd and 3rd prizes are shown but not counted.',
    keys:d=>[pad(d.nums[0],4).slice(-2)],show:d=>d.nums.map(n=>pad(n,4)).join(' · '),
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
/* Official draw days (0=Sun) and times, Belize time (UTC-6, no daylight saving).
   Boledo & Sunday Jackpot: Belize Government Lotteries Ltd. Fantasy 5 & Pick 3: the game operator. */
const SCHEDULE={
  boledo:{days:[1,2,3,4,5],at:'21:10',text:'Monday to Friday at 9:10 pm'},
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
const isDrawDay=(g,iso)=>SCHED[g].includes(isoDow(iso));
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
const state={game:GAMES[prefs.game]?prefs.game:'boledo',wins:Object.assign({},prefs.wins||{}),draws:[],sample:null,canWrite:true,loaded:false};
const curWin=()=>{const G=GAMES[state.game],w=state.wins[state.game];return G.wins.includes(w)?w:G.def};
const savePrefs=()=>{try{localStorage.setItem(PREF,JSON.stringify({game:state.game,wins:state.wins,mine:prefs.mine||{}}))}catch(e){}};

/* ---------- game tabs and look-back picker ---------- */
const seg=$('gameSeg');
const BALL={boledo:'00',lottery:'1st',fantasy5:'5',pick3:'3'};
ORDER.forEach(g=>{const b=document.createElement('button');b.type='button';b.dataset.g=g;
  b.innerHTML='<span class="tile gball" data-game="'+g+'"><span>'+BALL[g]+'</span></span><span class="gtxt"><b>'+esc(GAMES[g].label).replace(/ (\d)$/,'&nbsp;$1')+'</b><small id="gl-'+g+'">&nbsp;</small></span>';
  b.onclick=()=>{state.game=g;savePrefs();setup();$('dDate').value=nextMissingDate(g);$('addMsg').textContent='';checkDate();render()};seg.appendChild(b)});
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
/* ---------- My Numbers: favourite numbers per game, saved on this device ---------- */
function mineList(g){const m=prefs.mine||{};return Array.isArray(m[g||state.game])?m[g||state.game]:[]}
function isMine(key){return mineList().includes(String(key))}
function toggleMine(key){key=String(key);const m=prefs.mine||(prefs.mine={});const L=mineList().slice();
  const i=L.indexOf(key);if(i>=0)L.splice(i,1);else{if(L.length>=12){toast('My Numbers holds up to 12 per game');return}L.push(key)}
  m[state.game]=L;savePrefs();
  document.querySelectorAll('.bwrap[data-key]').forEach(b=>b.classList.toggle('is-mine',L.includes(b.dataset.key)));
  document.querySelectorAll('.top-star').forEach(topStarLabel);
  renderMine();}
function topStarLabel(b){const on=isMine(b.dataset.key);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
  b.setAttribute('aria-label',(on?'Remove ':'Add ')+b.dataset.key+(on?' from':' to')+' My Numbers');b.textContent=on?'★':'☆'}
function mineLabel(key){if(state.game!=='pick3')return{ball:key,sub:''};const [i,d]=key.split(':');return{ball:d,sub:SPOTS[+i]+' spot'}}
function renderMine(){
  const box=$('mine'),sec=$('secMine');if(!box||!sec)return;
  const G=GAMES[state.game],all=drawsFor(),L=mineList();
  if(!state.loaded&&!state.sample){sec.hidden=true;return}
  sec.hidden=false;box.innerHTML='';
  $('mineHint').hidden=!!L.length;
  $('mixWrap').hidden=L.length<2;
  if(!L.length)return;
  const seqFor=key=>state.game==='pick3'?all.map(d=>[String(d.nums[+key.split(':')[0]])]):all.map(G.keys);
  // sort: just played first, then longest out
  const rows=L.map(key=>{const lbl=mineLabel(key),k=state.game==='pick3'?lbl.ball:key,seq=seqFor(key);
    let out=null;for(let i=seq.length-1;i>=0;i--){if(seq[i].includes(k)){out=seq.length-1-i;break}}return{key,lbl,out}})
    .sort((a,b)=>(a.out===0?-1:0)-(b.out===0?-1:0)||(b.out==null?1e9:b.out)-(a.out==null?1e9:a.out));
  rows.forEach(({key,lbl,out})=>{
    const it=document.createElement('div');it.className='mine-item'+(out===0?' hit':'');
    const t=ballEl(lbl.ball);it.appendChild(t);
    const s=document.createElement('div');s.className='mine-tag';
    s.innerHTML=(lbl.sub?'<small>'+esc(lbl.sub)+'</small>':'')+(out===0?'<b>Played!</b><small>latest draw</small>':out==null?'<b>'+all.length+'+</b><small>draws out</small>':'<b>'+out+'</b><small>draw'+(out===1?'':'s')+' out</small>');
    it.appendChild(s);
    const x=document.createElement('button');x.type='button';x.className='mine-x';x.dataset.key=key;x.setAttribute('aria-label','Remove '+lbl.ball+(lbl.sub?' ('+lbl.sub+')':'')+' from My Numbers');x.textContent='×';it.appendChild(x);
    box.appendChild(it)});
}

/* ---------- Mixer: swirl My Numbers like a tornado, then show ways to play them ---------- */
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
function showMixResults(){
  const out=$('mixOut');out.innerHTML='';let n=0;
  mixGroups.forEach(gr=>{const sec=document.createElement('div');sec.className='mixgroup';
    const h=document.createElement('h3');h.textContent=gr.label;sec.appendChild(h);
    const single=gr.plays.every(p=>p.length===1);
    const rows=document.createElement('div');rows.className='mixplays'+(single?' single':'');
    gr.plays.forEach(p=>{const row=document.createElement('div');row.className='mixplay';
      p.forEach(x=>{const fill=String(x).startsWith('+');const b=ballEl(fill?x.slice(1):x,true);if(fill)b.classList.add('fill');b.style.setProperty('--n',n++);row.appendChild(b)});
      rows.appendChild(row)});
    sec.appendChild(rows);out.appendChild(sec)});
  $('mixNote').hidden=false;$('mixBtns').hidden=false;out.hidden=false;
  const box=document.querySelector('.mixbox-in');box.classList.remove('swirl');box.classList.add('reveal');
}
function runMixer(){
  cancelAnimationFrame(mixAnim);
  mixGroups=mixPatterns();
  const stage=$('mixStage'),out=$('mixOut');out.hidden=true;out.innerHTML='';$('mixNote').hidden=true;$('mixBtns').hidden=true;
  stage.innerHTML='';stage.hidden=false;stage.classList.remove('flash');
  const box=document.querySelector('.mixbox-in');box.classList.remove('reveal');
  if(!reduceMotion())box.classList.add('swirl');
  const labels=mineList().map(k=>state.game==='pick3'?k.split(':')[1]:k);
  if(reduceMotion()){stage.hidden=true;showMixResults();return}
  const balls=[];const copies=labels.length<6?2:1;
  for(let c=0;c<copies;c++)labels.forEach(l=>{const b=ballEl(l,true);b.classList.add('mixball');stage.appendChild(b);balls.push({el:b,a:(balls.length/Math.max(1,labels.length*copies))*Math.PI*2,r0:.82+Math.random()*.18,ph:Math.random()})});
  const dur=3000+Math.random()*2000,t0=performance.now();
  const step=now=>{
    const W=stage.clientWidth,H=stage.clientHeight,R=Math.min(W,H)/2-24,t=Math.min(1,(now-t0)/dur);
    balls.forEach(b=>{
      const ease=t*t*(3-2*t),rad=R*(t<.12?1:b.r0)*(1-ease*.95),spin=(1.2+9*t*t)*(now-t0)/1000;
      const ang=b.a+spin*Math.PI*2*.35, lift=Math.sin(ang*2+b.ph*6)*R*.08*(1-t);
      const x=W/2+Math.cos(ang)*rad,y=H/2+Math.sin(ang)*rad+lift*.5;
      const sc=.55+.6*(1-ease)+.25*Math.sin(t*Math.PI);
      b.el.style.transform='translate('+(x-18)+'px,'+(y-18)+'px) rotate('+(spin*400%360)+'deg) scale('+sc.toFixed(3)+')';
      b.el.style.opacity=t>.93?String(1-(t-.93)/.07):'1';
    });
    if(t<1){mixAnim=requestAnimationFrame(step)}
    else{stage.classList.add('flash');setTimeout(()=>{stage.hidden=true;stage.innerHTML='';showMixResults()},380)}
  };
  mixAnim=requestAnimationFrame(step);
}
$('mixBtn').addEventListener('click',()=>{$('mixTitle').textContent='Mixer · '+GAMES[state.game].label;$('mixBox').hidden=false;runMixer();$('mixClose').focus({preventScroll:true})});
$('mixAgain').addEventListener('click',runMixer);
function closeMix(){cancelAnimationFrame(mixAnim);$('mixBox').hidden=true;$('mixBtn').focus()}
$('mixClose').addEventListener('click',closeMix);
$('mixBox').addEventListener('click',e=>{if(e.target.id==='mixBox')closeMix()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('mixBox').hidden)closeMix()});
$('mixShare').addEventListener('click',async()=>{
  try{await document.fonts.ready}catch(e){}
  const rowsN=mixGroups.reduce((a,g)=>a+1+Math.ceil(g.plays.length/2),0),S=1080,H=Math.max(1080,320+rowsN*120);
  const cv=document.createElement('canvas');cv.width=S;cv.height=H;const ctx=cv.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0b4aa0');bg.addColorStop(1,'#042456');ctx.fillStyle=bg;ctx.fillRect(0,0,S,H);
  ctx.textAlign='center';ctx.fillStyle='#c9d5ea';ctx.font='700 32px "Barlow Condensed", sans-serif';ctx.fillText('B E L I Z E   L O T T E R Y',S/2,90);
  ctx.fillStyle='#fec207';ctx.font='800 64px Outfit, Barlow, sans-serif';ctx.fillText('My Numbers Mix',S/2,170);
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
  shareBlob=blob;const url=URL.createObjectURL(blob),img=$('shareImg');if(img.dataset.url)URL.revokeObjectURL(img.dataset.url);img.src=url;img.dataset.url=url;img.alt='My Numbers mix';
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
  const box=document.createElement('div');box.className='trend';
  const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  box.innerHTML='<div class="trend-h"><span>Times played per week</span><span>last 10 weeks · <b>'+tot+'</b></span></div>'+
    '<div class="trend-bars">'+bins.map((b,i)=>'<span class="tb'+(b.n?'':' zero')+'" style="--h:'+(b.n?Math.max(12,Math.round(b.n/max*100)):4)+'%;--i:'+i+'" title="Week of '+mon[b.start.getUTCMonth()]+' '+b.start.getUTCDate()+': '+b.n+' of '+b.draws+' draws">'+(b.n?'<em>'+b.n+'</em>':'')+'</span>').join('')+'</div>'+
    '<div class="trend-x">'+bins.map((b,i)=>'<span>'+(i%3===0||i===WEEKS-1?mon[b.start.getUTCMonth()]+' '+b.start.getUTCDate():'')+'</span>').join('')+'</div>';
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
$('shareClose').addEventListener('click',()=>{$('shareBox').hidden=true;$('shareBtn').focus()});
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
function startCountdown(){clearInterval(cdTimer);tickCountdown();cdTimer=setInterval(tickCountdown,1000)}

/* ---------- bottom tab bar (phones) ---------- */
const TABS=[['tabGames','secGames'],['tabMiss','secMiss'],['tabHot','secHot'],['tabRes','histFold']];
TABS.forEach(([b,sec])=>{const btn=$(b);if(!btn)return;btn.addEventListener('click',()=>{
  const el=$(sec);if(sec==='histFold')el.open=true;
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
  const to=+m[1],rest=m[2];if(to<2){return}
  el.textContent='0'+rest;
  const t0=performance.now()+delay;
  const step=now=>{const p=Math.min(1,Math.max(0,(now-t0)/ms)),e=1-Math.pow(1-p,3);
    el.textContent=Math.round(to*e)+rest;if(p<1)requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
function playDrama(id){
  const box=$(id),st=dramaState[id];if(!box||st.played)return;
  st.played=true;box.classList.remove('dpending');box.classList.add('dplay');
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
  setTimeout(()=>box.classList.remove('dplay'),(WAVE_S+4)*1000);
}
function drama(key){
  if(reduceMotion())return;
  ['tiles','hot'].forEach(id=>{
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
const MISS_FIRST_ROWS=0,MISS_STEP_ROWS=4; // the grid starts folded: the Longest-out top 5 is the summary
const missView={key:null,rows:MISS_FIRST_ROWS};
function gridCols(g){return getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length||1}
function limitMissing(key,reveal){
  const box=$('tiles'),g=box.querySelector('.tiles'),mb=box.querySelector('.showmore');
  if(!g||!mb)return;
  if(key!==undefined&&key!==missView.key){missView.key=key;missView.rows=MISS_FIRST_ROWS}
  const balls=[...g.children],cols=gridCols(g),total=balls.length;
  let show=Math.min(total,missView.rows*cols);
  if(show>0&&total-show<=cols){show=total}   // don't leave a lonely last row behind the button
  if(total<=5)show=0;                        // all of them are already in the top 5
  g.closest('.ballset').hidden=show===0;
  const fresh=[];
  balls.forEach((b,i)=>{const hide=i>=show;if(!hide&&b.hidden&&reveal)fresh.push(b);b.hidden=hide});
  if(fresh.length&&!reduceMotion()){
    // one by one, slower: stagger shrinks a little for big batches so it never drags past ~2.6 s
    const step=Math.min(.16,1.6/Math.max(1,fresh.length-1));
    fresh.forEach((b,j)=>{b.classList.remove('reveal','reveal-star');void b.offsetWidth;
      b.style.setProperty('--r',(j*step).toFixed(3)+'s');b.classList.add('reveal');
      if(j===fresh.length-1)b.classList.add('reveal-star');
      const num=b.querySelector('.tag b');if(num)countUp(num,650,j*step*1000+350)});
    const first=fresh[0];setTimeout(()=>first.scrollIntoView({block:'center',behavior:'smooth'}),60);
  }
  const left=total-show,btn=mb.querySelector('button');
  if(total<=5){mb.hidden=true;return}
  mb.hidden=false;mb.classList.toggle('folded',show===0);
  if(show===0){btn.innerHTML='Show all <span class="cnt">'+total+' missing numbers</span> <span class="chev" aria-hidden="true">▾</span>';btn.dataset.act='more';btn.setAttribute('aria-expanded','false')}
  else if(left>0){btn.innerHTML='Continue <span class="cnt">'+left+' more</span> <span class="chev" aria-hidden="true">▾</span>';btn.dataset.act='more';btn.setAttribute('aria-expanded','false')}
  else{btn.innerHTML='Hide the balls <span class="chev" aria-hidden="true">▴</span>';btn.dataset.act='less';btn.setAttribute('aria-expanded','true')}
}
$('tiles').addEventListener('click',e=>{
  const btn=e.target.closest('.showmore-btn');if(!btn)return;
  if(btn.dataset.act==='more'){pickEnter();missView.rows+=MISS_STEP_ROWS;limitMissing(undefined,true)}
  else{missView.rows=MISS_FIRST_ROWS;limitMissing();$('say').scrollIntoView({block:'start',behavior:reduceMotion()?'auto':'smooth'})}
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
  setNote('','');$('hotSay').textContent='';$('lastDate').textContent='';

  /* last draw */
  if(all.length){
    const d=all[all.length-1];
    const many=state.game!=='boledo';
    const badge=document.createElement('p');badge.className='winbadge';badge.textContent=many?'Winning Numbers':'Winning Number';last.appendChild(badge);
    const animKey=state.game+'|'+d.id+'|'+(state.sample?'s':'r');
    const roll=animKey!==lastAnim;lastAnim=animKey;if(roll)pickEnter();
    last.classList.toggle('roll',roll);
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
    }
  }else{last.innerHTML='<p class="empty">No '+esc(G.label)+' results yet.</p>';$('shareBtn').hidden=true}
  { const nx=nextDrawDate(state.game),S=SCHEDULE[state.game],tonight=nx===bzNow().iso;
    $('drawNext').innerHTML='<span class="cd" id="cdChip"><span class="cd-dot" aria-hidden="true"></span><span id="cdLbl">Next draw in</span> <b id="cdTime">--:--:--</b></span>'+
      '<span class="cd-when">'+(tonight?'Today':esc(fmtDay(nx).replace(/,? \d{4}$/,'')))+' · '+fmtTime(state.game)+'</span>';
    startCountdown();
    $('drawFine').textContent=G.label+' is drawn '+S.text+', Belize time.'+(S.extra?' '+S.extra:''); }

  const say=$('say');say.removeAttribute('aria-busy');
  if(!state.loaded&&!state.sample){say.innerHTML='<span class="skl" style="width:85%"></span><span class="skl" style="width:55%"></span>';say.setAttribute('aria-busy','true');
    body.innerHTML='<div class="sk-grid" aria-hidden="true">'+'<span class="sk"></span>'.repeat(12)+'</div>';
    hot.innerHTML='<div class="sk-grid" aria-hidden="true">'+'<span class="sk"></span>'.repeat(4)+'</div>';
    last.innerHTML='<div class="sk-row" aria-hidden="true"><span class="sk big"></span><span class="sk big"></span><span class="sk big"></span></div>';}
  else if(!win.length){say.textContent='There are no '+G.label+' results yet. Add one at the bottom of the page.'}
  else{
    const n=win.length,span=n===1?'the last draw':'the last <b>'+n+'</b> draws';
    const dates='Draws from '+fmtDate(win[0].date)+' to '+fmtDate(win[win.length-1].date)+'.';
    if(G.mode==='board'){
      const winSeq=win.map(G.keys),allSeq=all.map(G.keys);
      const facts=factsFor(allSeq,all.map(d=>d.date),n);
      const missing=missingSorted(winSeq,allSeq,G.board);
      say.innerHTML=missing.length===1?'This <b>1</b> number has <em>not</em> played in '+span+'.'
        :missing.length?'These <b>'+missing.length+'</b> numbers have <em>not</em> played in '+span+'. The longest waits are below'+(missing.length>5?'; tap <b class="plain">Show all</b> to see every ball.':'.')
        :'Every number from '+G.board[0]+' to '+G.board[G.board.length-1]+' has played in '+span+'.';
      if(missing.length){body.appendChild(topOut(missing,all.length));
        body.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,'<b>'+k+'</b> · '),k))));
        const mb=document.createElement('div');mb.className='showmore';mb.hidden=true;
        mb.innerHTML='<button type="button" class="btn showmore-btn" aria-controls="tiles"></button>';body.appendChild(mb)}
      setNote(dates,G.note||'');
      const hl=hotList(winSeq,G.board,state.game==='fantasy5'?6:8);
      $('hotSay').innerHTML=hl.length?'These numbers played the most in '+span+'. Under each ball: how many times.':'No number has played more than once in '+span+'. Try more draws.';
      if(hl.length)hot.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,'<b>'+k+'</b> · '),k)),'hot'));
    }else{
      let total=0,anyHot=false;
      SPOTS.forEach((spot,i)=>{
        const winSeq=win.map(d=>[String(d.nums[i])]),allSeq=all.map(d=>[String(d.nums[i])]);
        const facts=factsFor(allSeq,all.map(d=>d.date),n),pre=k=>'<b>'+k+'</b> in the '+spot+' spot · ';
        const missing=missingSorted(winSeq,allSeq,G.board);total+=missing.length;
        const row=document.createElement('div');row.className='posrow';
        row.innerHTML='<h3>'+spot+' digit</h3>';
        if(missing.length)row.appendChild(grid(missing.map(([k,o])=>ballWithTag(k,outTag(o,all.length),facts(k,pre(k)),i+':'+k))));
        else row.insertAdjacentHTML('beforeend','<p class="allplayed">Every digit has played here.</p>');
        body.appendChild(row);
        const hl=hotList(winSeq,G.board,3);
        const hrow=document.createElement('div');hrow.className='posrow';hrow.innerHTML='<h3>'+spot+' digit</h3>';
        if(hl.length){anyHot=true;hrow.appendChild(grid(hl.map(([k,c])=>ballWithTag(k,hotTag(c),facts(k,pre(k)),i+':'+k)),'hot'))}
        else hrow.insertAdjacentHTML('beforeend','<p class="allplayed">No digit has played twice here.</p>');
        hot.appendChild(hrow);
      });
      say.innerHTML=total?'These digits have <em>not</em> played in each spot in '+span+'. Longest wait first. Under each ball: how many draws since it last played. Tap a ball for more.'
        :'Every digit from 0 to 9 has played in every spot in '+span+'.';
      $('hotSay').innerHTML=anyHot?'The digits that played the most in each spot in '+span+'.':'No digit has played more than once in any spot. Try more draws.';
      setNote(dates,'Each row is one spot in the Pick 3 number, read left to right.');
    }
    shadeColumns();
    limitMissing(state.game+'|'+W);
    renderMine();
    drama(state.game+'|'+W+'|'+(state.sample?'s':'r')+'|'+win.length+'|'+win[win.length-1].id);
  }

  applyMore();
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
  if(b.dataset.key!==undefined){const tc=trendChart(b.dataset.key);if(tc)p.appendChild(tc);
    const sb=document.createElement('button');sb.type='button';sb.className='starbtn';sb.dataset.key=b.dataset.key;starLabel(sb);p.appendChild(sb)}
}
function starLabel(sb){const on=isMine(sb.dataset.key);sb.classList.toggle('on',on);sb.setAttribute('aria-pressed',on);
  sb.innerHTML=on?'<span aria-hidden="true">★</span> In My Numbers · tap to remove':'<span aria-hidden="true">☆</span> Add to My Numbers'}
document.addEventListener('click',e=>{
  const sb=e.target.closest('.starbtn');if(sb){e.stopPropagation();toggleMine(sb.dataset.key);starLabel(sb);return}
  const x=e.target.closest('.mine-x');if(x){toggleMine(x.dataset.key);return}
  const ts=e.target.closest('.top-star');if(ts){e.stopPropagation();toggleMine(ts.dataset.key);if(isMine(ts.dataset.key))toast('★ '+ts.dataset.key+' added to My Numbers')}
},true);
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
    const d=(dig[i]||'').slice(0,4).split('');for(let j=0;j<4;j++)row.appendChild(slot(d[j]||'',j>=2?'counted':''));box.appendChild(row)})}
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
  if(!isDrawDay(g,date)){el.className='hint warn';el.textContent=G.label+' isn\'t normally drawn on '+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][isoDow(date)]+'s. It\'s drawn '+SCHEDULE[g].text+'. Check the date.'}
}
$('dDate').addEventListener('input',()=>{pendingOdd=null;checkDate()});
$('dDate').value=lastDrawDate(state.game);checkDate();
$('addForm').addEventListener('submit',async e=>{e.preventDefault();
  if(state.sample){flash('Go back to real results first, then add a result.',false);return}
  const date=$('dDate').value;
  if(date&&!drawDone(state.game,date)&&date>=bzNow().iso){flash(isDrawDay(state.game,date)?'That draw hasn\'t happened yet. Results come in after '+fmtTime(state.game)+' Belize time.':'That date is in the future. Pick the date of the draw.',false);return}
  if(date&&!isDrawDay(state.game,date)&&pendingOdd!==state.game+date){pendingOdd=state.game+date;
    flash(GAMES[state.game].label+' is normally drawn '+SCHEDULE[state.game].text+'. If this was a moved or special draw, tap Add again to save it.',false);return}
  const tokens=$('quickNums').value.trim().split(/[\s,;\-\/.]+/).filter(Boolean);
  const d=date&&makeDraw(state.game,date,tokens);
  if(!d){flash(ERR[state.game],false);return}
  const replacing=(state.draws||[]).some(x=>x.id===d.id);
  try{await adapter.save([d]);
    flash((replacing?'Updated ':'Added ')+GAMES[state.game].label+' for '+fmtDate(date)+': '+GAMES[state.game].show(d),true);
    $('quickNums').value='';renderSlots();
    toast('<b>Board Updated · <span class="nw">'+esc(GAMES[state.game].show(d))+'</span> Added</b><br>'+esc(ENCOURAGE[Math.floor(Math.random()*ENCOURAGE.length)]),true);
    pendingOdd=null;const nx=missingDraws().find(x=>x.game===state.game);if(nx)$('dDate').value=nx.date;checkDate()}
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

/* results come from draws.json on this site; while a result is awaited we also ask GitHub's raw file
   service with a cache-buster, which usually shows a new result sooner than the site's 10-minute cache */
const RAW_URL='https://raw.githubusercontent.com/bitcoinbelizeai-ops/Missing-Numbers-Lotto/main/draws.json';
async function getJSON(u){const r=await fetch(u,{cache:'no-cache'});if(!r.ok)throw 0;const j=await r.json();if(!j||!Array.isArray(j.draws))throw 0;return j}
async function refreshShipped(fast){
  const tries=[getJSON('draws.json')];if(fast)tries.push(getJSON(RAW_URL+'?t='+Date.now()));
  const got=(await Promise.allSettled(tries)).filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(got.length){const byId={};got.forEach(j=>j.draws.forEach(d=>{byId[d.id]=d}));
    const merged={updated:got.map(j=>j.updated||'').sort().pop(),draws:Object.values(byId).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0)};
    shipped=merged;store(CACHE,merged)}
  $('storeNote').textContent=(shipped.updated?'Built-in results updated '+fmt(shipped.updated)+'. ':'')+'Draws you add are saved on this phone.';
  push();
}

window.bzRefresh=()=>refreshShipped(true);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshShipped(true)});

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

if('serviceWorker' in navigator&&location.protocol!=='file:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
refreshShipped();
})();
