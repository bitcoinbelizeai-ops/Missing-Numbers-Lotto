/* ---------- Draw alerts: the "Notify me" bell in the Last Draw box (Nov 22, 2026) ----------
   Web push, no account needed. Tapping the bell opens a card to pick games, then the phone asks
   "Allow notifications?". The phone's push address + chosen games + My Lucky Numbers are saved in
   Supabase (push_save); GitHub Actions (scripts/send_alerts.py) sends one alert per draw.
   iPhones only allow alerts for sites added to the Home Screen, so on an iPhone in Safari the card
   shows a short "Add to Home Screen" guide instead; opening the Home Screen app offers alerts once.
   Android/computers: alerts work in the browser; after turning them on, an "Install app" offer
   appears if the browser supports it. Lottery number logic is not touched here. */
(()=>{
'use strict';
const VAPID_PUBLIC='BB1fUvh7s9b30-KUOr7rqGZiHS_I5d0vZUInctkRd0zTyNE7SAynnfYKgk6l1BlLmmN6MGhRDKrsFgP19yfygF0';
const GAMES=[['boledo','Boledo','00'],['lottery','Sunday Jackpot','1st'],['fantasy5','Fantasy 5','5'],['pick3','Pick 3','3']];
const ALL=GAMES.map(g=>g[0]);
const KEY='mn-alerts-v1';           // {games:[...]} saved on this device
const WELCOME='mn-alerts-welcome';  // the Home Screen app offered alerts once
const CFG=window.MN_SUPABASE||{};
const $=id=>document.getElementById(id);
const bell=$('bellBtn'),sheet=$('bellSheet');
if(!bell||!sheet)return;

/* ---------- what this device can do ---------- */
const ua=navigator.userAgent||'';
const isIOS=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=navigator.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
const iosVer=(()=>{const m=/OS (\d+)_(\d+)/.exec(ua);return m?+m[1]+(+m[2])/100:0})();
const canPush='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&window.isSecureContext;
const inApp=/FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|TikTok|; wv\)/.test(ua);

let sub=null,busy=false,installEvt=null,opener=null;
const load=()=>{try{const o=JSON.parse(localStorage.getItem(KEY)||'null');if(o&&Array.isArray(o.games))return o}catch(e){}return null};
const store=o=>{try{if(o)localStorage.setItem(KEY,JSON.stringify(o));else localStorage.removeItem(KEY)}catch(e){}};
const myGames=()=>{const o=load();const g=o&&o.games.filter(x=>ALL.includes(x));return g&&g.length?g:ALL.slice()};
const curGame=()=>ALL.includes(document.body.dataset.game)?document.body.dataset.game:'boledo';
const lucky=games=>{let m={};try{m=(window.bzLucky&&window.bzLucky.get())||{}}catch(e){}
  const o={};games.forEach(g=>{if(Array.isArray(m[g])&&m[g].length)o[g]=m[g].slice(0,12).map(String)});return o};
const luckyCount=()=>{const m=lucky(ALL);return Object.values(m).reduce((a,b)=>a+b.length,0)};

window.addEventListener('beforeinstallprompt',e=>{installEvt=e});

/* ---------- talking to Supabase (plain fetch; no account needed) ---------- */
async function rpc(fn,body){
  const base=String(CFG.url||'').replace(/\/+$/,'');if(!base||!CFG.key)throw new Error('no config');
  const r=await fetch(base+'/rest/v1/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:CFG.key,Authorization:'Bearer '+CFG.key},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(fn+' '+r.status);
}
function keysOf(s){const j=s.toJSON();return{p_endpoint:j.endpoint,p_p256dh:j.keys&&j.keys.p256dh,p_auth:j.keys&&j.keys.auth}}
const saveRemote=(s,games)=>rpc('push_save',Object.assign(keysOf(s),{p_games:games,p_mine:lucky(games)}));

/* ---------- service worker ---------- */
let regP=null;
function reg(){if(!regP)regP=navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready);return regP}
const b64=s=>{const p='='.repeat((4-s.length%4)%4),raw=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))};

/* ---------- the bell ---------- */
function paint(ring){
  const on=!!sub;bell.classList.toggle('on',on);bell.setAttribute('aria-pressed',on);
  $('bellTxt').textContent=on?'Alerts on':'Notify me';
  bell.setAttribute('aria-label',on?'Draw alerts are on. Change or turn off':'Notify me when draw results are in');
  if(ring){bell.classList.remove('ring');void bell.offsetWidth;bell.classList.add('ring')}
}
function toast(t){const el=$('toast');if(!el)return;el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,3200)}

/* ---------- the card (bottom sheet) ---------- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ICON={
  share:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  add:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>'
};
function open(view,opts){
  if(!sheet.hidden){render(view,opts);return}
  opener=document.activeElement;sheet.hidden=false;render(view,opts);
  const inn=sheet.querySelector('.sheet-in');inn.style.transform='';inn.classList.remove('up');void inn.offsetWidth;inn.classList.add('up');
  $('bsClose').focus({preventScroll:true});
}
function close(){if(sheet.hidden)return;sheet.hidden=true;if(opener&&document.contains(opener))opener.focus({preventScroll:true});opener=null}
function head(t,s){$('bsTitle').textContent=t;$('bsSub').innerHTML=s||''}
function render(view,opts){
  opts=opts||{};const body=$('bsBody');
  if(view==='pick'){
    const on=!!sub,chosen=on?myGames():(opts.games||ALL);
    head(opts.welcome?'Welcome! Turn on draw alerts?':on?'Draw alerts':'Get draw alerts',
      on?'Choose which games buzz your phone.':'The winning numbers on your phone the moment they’re in.');
    const n=luckyCount();
    body.innerHTML='<fieldset class="bs-games"><legend>Alert me for</legend>'+
      GAMES.map(([g,l,b])=>'<label class="bs-game"><input type="checkbox" value="'+g+'"'+(chosen.includes(g)?' checked':'')+'>'+
        '<span class="tile gball sm" data-game="'+g+'"><span>'+b+'</span></span><span class="bs-gname">'+esc(l)+'</span><span class="bs-tick" aria-hidden="true"></span></label>').join('')+
      '</fieldset>'+
      (n?'<p class="bs-lucky"><span aria-hidden="true">★</span> Your <b>'+n+' Lucky Number'+(n===1?'':'s')+'</b> are included. We’ll tell you when one plays, or how long it’s been out.</p>'
        :'<p class="bs-lucky dim"><span aria-hidden="true">☆</span> Tip: add <b>My Lucky Numbers</b> and alerts will tell you when yours play.</p>')+
      '<p class="bs-err" id="bsErr" role="alert" hidden></p>'+
      '<button type="button" class="btn bs-go" id="bsGo">'+(on?'Save':'Turn on alerts')+'</button>'+
      (on?'<button type="button" class="bs-off" id="bsOff">Turn off alerts</button>':'')+
      '<p class="bs-fine">One alert per draw, only for the games you pick. No alerts late at night. Turn off any time.</p>';
    $('bsGo').onclick=()=>{const g=[...body.querySelectorAll('.bs-games input:checked')].map(i=>i.value);
      if(!g.length){showErr('Pick at least one game.');return}on?update(g):turnOn(g)};
    if(on)$('bsOff').onclick=turnOff;
  }else if(view==='ios'){
    const old=iosVer&&iosVer<16.4;
    head('Add to Home Screen first',old?'Alerts need iOS 16.4 or newer. Update your iPhone in Settings › General › Software Update, then come back.'
      :'iPhones only show alerts for apps on the Home Screen. It takes 3 taps:');
    body.innerHTML=old?'':
      '<ol class="bs-steps">'+
      '<li><span class="bs-ico">'+ICON.share+'</span><span>Tap the <b>Share</b> button<small>'+(/iPad/.test(ua)?'at the top of Safari':'at the bottom of Safari (or tap ••• first)')+'</small></span></li>'+
      '<li><span class="bs-ico">'+ICON.add+'</span><span>Scroll down and tap <b>Add to Home Screen</b><small>then tap <b>Add</b></small></span></li>'+
      '<li><span class="bs-ico">'+ICON.bell+'</span><span>Open <b>Missing Numbers</b> from your Home Screen<small>and tap <b>Turn on alerts</b></small></span></li></ol>'+
      '<p class="bs-note"><b>No Share button or no “Add to Home Screen”?</b> You’re probably inside WhatsApp or Facebook. Copy the link, then open it in <b>Safari</b>.</p>'+
      '<button type="button" class="btn ghost bs-go" id="bsCopy">Copy link</button>';
    if(!old)$('bsCopy').onclick=copyLink;
  }else if(view==='blocked'){
    head('Alerts are blocked','Your phone said “Don’t allow” for this site. To turn alerts on:');
    body.innerHTML=isIOS?'<ol class="bs-steps plain"><li><span>Open the iPhone <b>Settings</b> app</span></li><li><span>Tap <b>Notifications</b>, then this app</span></li><li><span>Turn on <b>Allow Notifications</b>, then tap the bell again</span></li></ol>'
      :'<ol class="bs-steps plain"><li><span>Tap the <b>icon left of the web address</b> (a lock or sliders)</span></li><li><span>Tap <b>Permissions</b> or <b>Notifications</b></span></li><li><span>Choose <b>Allow</b>, then tap the bell again</span></li></ol>';
  }else if(view==='nosupport'){
    head('Open in your browser',inApp?'Alerts can’t be turned on inside this app’s browser.':'This browser can’t show alerts.');
    body.innerHTML='<p class="bs-note">Copy the link and open it in <b>'+(isIOS?'Safari':'Chrome')+'</b>, then tap the bell.</p>'+
      '<button type="button" class="btn ghost bs-go" id="bsCopy">Copy link</button>';
    $('bsCopy').onclick=copyLink;
  }else if(view==='done'){
    head('Alerts are on ✓','You’ll hear from us after each '+esc(opts.list)+' draw.');
    body.innerHTML='<p class="bs-note">Add Missing Numbers to your Home Screen too? It opens like an app, one tap from your alerts.</p>'+
      '<button type="button" class="btn bs-go" id="bsInstall">Install app</button><button type="button" class="bs-off" id="bsLater">Not now</button>';
    $('bsInstall').onclick=async()=>{const e=installEvt;installEvt=null;close();if(!e)return;try{e.prompt();await e.userChoice}catch(x){}};
    $('bsLater').onclick=close;
  }
}
function showErr(t){const e=$('bsErr');if(e){e.textContent=t;e.hidden=false}}
async function copyLink(){const u=location.origin+'/';let ok=false;try{await navigator.clipboard.writeText(u);ok=true}catch(e){}
  const b=$('bsCopy');if(b)b.textContent=ok?'Link copied ✓':u}
const listOf=(g,and)=>{const n=GAMES.filter(x=>g.includes(x[0])).map(x=>x[1]);return n.length===4&&!and?'game':n.length>1?n.slice(0,-1).join(', ')+(and?' and ':' or ')+n[n.length-1]:n[0]};
function setBusy(b){busy=b;const go=$('bsGo');if(go){go.disabled=b;if(b)go.textContent='One moment…'}}

/* ---------- turning on, changing, turning off ---------- */
async function turnOn(games){
  if(busy)return;setBusy(true);
  try{
    const regReady=reg();
    // ask right away, while the tap still counts (iPhones need that)
    const perm=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(perm!=='granted'){setBusy(false);render(perm==='denied'?'blocked':'pick',{games});if(perm!=='denied')showErr('Alerts need you to tap “Allow”.');return}
    const r=await regReady;
    let s=await r.pushManager.getSubscription();
    if(!s)s=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID_PUBLIC)});
    await saveRemote(s,games);
    sub=s;store({games});paint(true);
    if(installEvt&&!standalone)render('done',{list:listOf(games)});
    else{close();toast('Alerts on for '+(games.length===4?'all games':listOf(games,1)))}
  }catch(e){console.warn('alerts',e);setBusy(false);render('pick',{games});showErr('Couldn’t turn alerts on. Check your connection and try again.')}
  busy=false;
}
async function update(games){
  if(busy||!sub)return;setBusy(true);
  try{await saveRemote(sub,games);store({games});close();toast('Alerts saved: '+(games.length===4?'all games':listOf(games,1)))}
  catch(e){setBusy(false);render('pick');showErr('Couldn’t save. Check your connection and try again.')}
  busy=false;
}
async function turnOff(){
  if(busy||!sub)return;busy=true;const s=sub;
  try{await rpc('push_remove',{p_endpoint:s.endpoint})}catch(e){}
  try{await s.unsubscribe()}catch(e){}
  sub=null;store(null);busy=false;paint();close();toast('Alerts turned off');
}

/* ---------- the bell's tap ---------- */
bell.addEventListener('click',()=>{
  if(sub){open('pick');return}
  if(isIOS&&!standalone){open('ios');return}
  if(!canPush){open('nosupport');return}
  if(Notification.permission==='denied'){open('blocked');return}
  reg().catch(()=>{});  // get the worker ready while they choose
  open('pick',{games:[curGame()].concat(ALL.filter(g=>g!==curGame()))});
});
$('bsClose').addEventListener('click',close);
sheet.addEventListener('click',e=>{if(e.target===sheet)close()});
document.addEventListener('keydown',e=>{if(sheet.hidden)return;if(e.key==='Escape'){close();return}
  // keep the Tab key inside the open card
  if(e.key!=='Tab')return;const f=[...sheet.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(x=>x.offsetParent!==null||x.type==='checkbox');
  if(!f.length)return;const a=f[0],z=f[f.length-1];
  if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}});
(()=>{const inn=sheet.querySelector('.sheet-in');let y0=null,dy=0;
  inn.addEventListener('touchstart',e=>{if(inn.scrollTop>0)return;y0=e.touches[0].clientY;dy=0;inn.style.transition='none'},{passive:true});
  inn.addEventListener('touchmove',e=>{if(y0==null)return;dy=Math.max(0,e.touches[0].clientY-y0);inn.style.transform=dy?'translateY('+dy+'px)':''},{passive:true});
  inn.addEventListener('touchend',()=>{if(y0==null)return;inn.style.transition='';if(dy>90)close();else inn.style.transform='';y0=null})})();

/* Lucky Numbers changed: send the new list with the alerts (a moment later, in case of several taps) */
let syncT=0;
document.addEventListener('bz-lucky',()=>{if(!sub)return;clearTimeout(syncT);syncT=setTimeout(()=>{saveRemote(sub,myGames()).catch(()=>{})},1500)});

/* ---------- on page load ---------- */
(async()=>{
  bell.hidden=false;
  const q=new URLSearchParams(location.search),fromAlert=q.has('alert'),g=q.get('game');
  if(fromAlert||g){try{history.replaceState(null,'',location.pathname+location.hash)}catch(e){}}
  // tapped an alert: show that game's result
  if(g&&ALL.includes(g)){const b=document.querySelector('#gameSeg button[data-g="'+g+'"]');if(b&&g!==curGame())setTimeout(()=>b.click(),300)}
  if(!canPush){paint();return}
  try{
    const r=await navigator.serviceWorker.getRegistration();
    if(r)sub=await r.pushManager.getSubscription();
    if(sub&&Notification.permission!=='granted')sub=null;
    if(sub){reg().catch(()=>{});                       // keep the worker up to date
      if(fromAlert)rpc('push_opened',{p_endpoint:sub.endpoint}).catch(()=>{})}
  }catch(e){}
  paint();
  // first time the Home Screen app opens on an iPhone: offer alerts once
  let seen=false;try{seen=!!localStorage.getItem(WELCOME)}catch(e){}
  if(isIOS&&standalone&&!sub&&Notification.permission==='default'&&!seen){
    try{localStorage.setItem(WELCOME,'1')}catch(e){}
    setTimeout(()=>{if(sheet.hidden&&!document.querySelector('.sheet:not([hidden]),.mixbox:not([hidden])'))open('pick',{welcome:true})},2200)}
})();
})();
