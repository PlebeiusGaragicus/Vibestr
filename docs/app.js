/* Vibestr PWA - Nostr viewer (begin scaffolding) */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

// Service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}

// Disable browser scroll restoration so we control scroll position after reload/back
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch {}

// Fetch latest kind 0 for a given hex pubkey and update state.profiles
async function refreshProfile(pk){
  if (!pk) return false;
  try{
    const meta = await queryRelaysOnce(state.relays, { kinds:[0], authors:[pk], limit: 1 });
    if (!Array.isArray(meta) || !meta.length) return false;
    // pick latest by created_at (across relays)
    let latest = null;
    for (const m of meta){ if (!latest || (m?.created_at||0) > (latest?.created_at||0)) latest = m; }
    if (!latest) return false;
    try { state.profiles[pk] = JSON.parse(latest.content || '{}'); } catch { return false; }
    persistStorage();
    return true;
  } catch { return false; }
}

// Setup clickable shortened pubkey that copies npub to clipboard with feedback
async function npubOf(pk){ try{ const n = await getNip19(); return n?.npubEncode ? n.npubEncode(pk) : null; } catch { return null; } }
function setupPkCopy(el, pk){
  if (!el) return;
  el.classList.add('copyable');
  const render = () => {
    // Show shortened npub (not hex) once available; fallback to hex short
    el.textContent = 'npub…';
    const addIcon = () => { const ic = document.createElement('span'); ic.className='copy-icon'; ic.textContent='📋'; el.append(' ', ic); };
    npubOf(pk).then(n => {
      const disp = n ? (n.length > 14 ? n.slice(0,6) + '…' + n.slice(-4) : n) : shortenAuthor(pk);
      el.textContent = disp; addIcon();
    }).catch(() => { el.textContent = shortenAuthor(pk); addIcon(); });
  };
  render();
  el.title = 'Click to copy npub';
  el.onclick = async () => {
    let npub = await npubOf(pk); if (!npub) npub = pk;
    const doCopy = async (text) => {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
      try {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); document.body.removeChild(ta); return true;
      } catch { return false; }
    };
    const ok = await doCopy(npub);
    const prevTitle = el.title;
    el.title = ok ? 'Copied!' : 'Copy failed';
    el.textContent = ok ? 'Copied to clipboard!' : 'Copy failed';
    setTimeout(()=>{ render(); el.title = prevTitle; }, 1200);
  };
}

// State
const state = {
  view: 'inbox', // inbox | past | favorites
  follows: [], // list of npub/nprofile/hex strings (stored in cookie)
  posts: {}, // id -> event
  hidden: new Set(), // read/hidden event ids
  favorites: new Set(), // favorite event ids
  relays: [
    'wss://relay.damus.io'
  ],
  profiles: {}, // pubkey -> profile metadata (kind 0 content JSON)
  quotes: {}, // id -> mentioned note event cache
  nip05: {}, // pubkey -> { id, status: 'ok'|'unverified'|'none', ts }
  lastRefresh: 0,
};

// Session-only: track posts marked read during this visit so they remain visible until reload
const sessionReadNow = new Set();

// Cookies (for follows)
function setCookie(name, value, days = 365){
  const d = new Date();
  d.setTime(d.getTime() + days*24*60*60*1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  try { console.debug('[Vibestr][cookie] setCookie', { name, bytes: String(value||'').length }); } catch {}
}
function getCookie(name){
  const v = document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1] ?? '';
  try { console.debug('[Vibestr][cookie] getCookie', { name, found: !!v, bytes: String(v).length }); } catch {}
  return v;
}
function delCookie(name){ document.cookie = `${name}=; Max-Age=0; path=/`; try { console.debug('[Vibestr][cookie] delCookie', { name }); } catch {} }

function loadFollows(){
  try { console.debug('[Vibestr][follows] loadFollows: begin'); } catch {}
  try {
    const raw = decodeURIComponent(getCookie('vibestr_follows') || '');
    let arr = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(arr)){
      try { arr = JSON.parse(localStorage.getItem(LS_FOLLOWS) || '[]'); } catch { arr = []; }
    }
    state.follows = Array.isArray(arr) ? arr : [];
    try { console.debug('[Vibestr][follows] loadFollows: cookie/localStorage read', { count: state.follows.length, follows: state.follows }); } catch {}
  } catch {
    try { state.follows = JSON.parse(localStorage.getItem(LS_FOLLOWS) || '[]') ?? []; }
    catch { state.follows = []; }
    try { console.debug('[Vibestr][follows] loadFollows: fallback localStorage', { count: state.follows.length, follows: state.follows }); } catch {}
  }
}
function saveFollows(){
  setCookie('vibestr_follows', JSON.stringify(state.follows));
  try { localStorage.setItem(LS_FOLLOWS, JSON.stringify(state.follows)); } catch {}
  try { console.debug('[Vibestr][follows] saveFollows', { count: state.follows.length, follows: state.follows }); } catch {}
}

// localStorage (for posts/hidden/favorites/profiles)
const LS_POSTS = 'vibestr_posts';
const LS_HIDDEN = 'vibestr_hidden';
const LS_FAVS = 'vibestr_favorites';
const LS_PROFILES = 'vibestr_profiles';
const LS_QUOTES = 'vibestr_quotes'; // cached mentioned notes (id -> event)
const LS_FOLLOWS = 'vibestr_follows_ls'; // mirror follows in localStorage for reliability
const LS_NIP05 = 'vibestr_nip05'; // cache of NIP-05 verification results

function loadStorage(){
  try { state.posts = JSON.parse(localStorage.getItem(LS_POSTS) || '{}') ?? {}; } catch { state.posts = {}; }
  try { state.hidden = new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]')); } catch { state.hidden = new Set(); }
  try { state.favorites = new Set(JSON.parse(localStorage.getItem(LS_FAVS) || '[]')); } catch { state.favorites = new Set(); }
  try { state.profiles = JSON.parse(localStorage.getItem(LS_PROFILES) || '{}') ?? {}; } catch { state.profiles = {}; }
  try { state.quotes = JSON.parse(localStorage.getItem(LS_QUOTES) || '{}') ?? {}; } catch { state.quotes = {}; }
  try { state.nip05 = JSON.parse(localStorage.getItem(LS_NIP05) || '{}') ?? {}; } catch { state.nip05 = {}; }
}
function persistStorage(){
  // Enforce retention: keep only last 100 non-favorite posts (by created_at). Favorites are never purged.
  const nonFav = Object.keys(state.posts).filter(id => !state.favorites.has(id));
  if (nonFav.length > 100){
    nonFav.sort((a,b)=> (state.posts[a]?.created_at||0) - (state.posts[b]?.created_at||0)); // oldest first
    const toRemove = nonFav.length - 100;
    for (let i=0; i<toRemove; i++){
      const id = nonFav[i]; delete state.posts[id];
    }
  }
  // Try persisting posts; if quota throws, keep trimming oldest non-favorites until it fits
  const tryPersistPosts = () => { try { localStorage.setItem(LS_POSTS, JSON.stringify(state.posts)); return true; } catch { return false; } };
  while (!tryPersistPosts()){
    const ids = Object.keys(state.posts).sort((a,b)=> (state.posts[a]?.created_at||0)-(state.posts[b]?.created_at||0));
    const victim = ids.find(id => !state.favorites.has(id));
    if (!victim) break; // only favorites left
    delete state.posts[victim];
  }
  try { localStorage.setItem(LS_HIDDEN, JSON.stringify([...state.hidden])); } catch {}
  try { localStorage.setItem(LS_FAVS, JSON.stringify([...state.favorites])); } catch {}
  try { localStorage.setItem(LS_PROFILES, JSON.stringify(state.profiles)); } catch {}
  try { localStorage.setItem(LS_QUOTES, JSON.stringify(state.quotes)); } catch {}
  try { localStorage.setItem(LS_NIP05, JSON.stringify(state.nip05)); } catch {}
}
function localStorageBytesUsed(){
  let total = 0; for (const [k,v] of Object.entries(localStorage)) { total += (k.length + String(v).length); }
  return total; // approximate bytes (UTF-16 varies)
}

function fmtBytes(n){
  const u=['B','KB','MB','GB']; let i=0; let x=n; while(x>1024 && i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>100?0:x>10?1:2)} ${u[i]}`;
}

// UI controls
const feedEl = $('#feed');
const emptyStateEl = $('#emptyState');
const drawer = $('#drawer');
const scrim = $('#scrim');
const bottomSheet = $('#bottomSheet');
const archiveToolbar = $('#archiveToolbar');
const archiveFavToggle = $('#archiveFavToggle');
const refreshBtn = $('#refreshBtn');
const buildTag = $('#buildTag');

async function updateBuildTag(){
  if (!buildTag) return;
  try{
    const swUrl = new URL('sw.js', location.href).toString();
    const res = await fetch(swUrl, { cache: 'no-store' });
    if (!res.ok) { buildTag.textContent = 'dev'; return; }
    const txt = await res.text();
    const m = txt.match(/const\s+CACHE\s*=\s*['"][^'"]+['"]/);
    if (m){
      const full = (m[0].split('=')[1] || '').replace(/['";\s]/g, '');
      const short = full.replace(/^vibestr-/, '');
      buildTag.textContent = short; // e.g. v13
      buildTag.title = `Build ${full}`;
    } else {
      buildTag.textContent = 'dev';
    }
  }catch(e){ buildTag.textContent = 'dev'; try { console.debug('[Vibestr][build] updateBuildTag failed', e); } catch{} }
}
const settingsView = $('#settingsView');

function toggleDrawer(open){
  drawer.classList.toggle('open', open ?? !drawer.classList.contains('open'));
  const isOpen = drawer.classList.contains('open');
  scrim.hidden = !isOpen;
  if (isOpen) updateBuildTag();
}
function toggleSheet(open){ if (!bottomSheet) return; bottomSheet.classList.toggle('open', open ?? !bottomSheet.classList.contains('open')); }

function updateNavSelection(){
  const items = $$('.drawer .drawer-nav .nav-item[data-view]');
  for (const el of items){
    const isCur = el.dataset.view === state.view;
    if (isCur) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
    el.disabled = isCur;
  }
  try { console.debug('[Vibestr][nav] updateNavSelection', { view: state.view }); } catch {}
  updateViewTitle();
}

function updateViewTitle(){
  const el = $('#viewTitle'); if (!el) return;
  let title = 'Inbox';
  switch (state.view){
    case 'favorites': title = 'Favorites'; break;
    case 'archive': title = 'Archive'; break;
    case 'following': title = 'Following'; break;
    case 'settings': title = 'Settings'; break;
    default: title = 'Inbox';
  }
  el.textContent = title;
}

function updateSettingsStats(){
  $('#lsUsed').textContent = fmtBytes(localStorageBytesUsed());
  $('#postCount').textContent = Object.keys(state.posts).length;
}

$('#burgerBtn')?.addEventListener('click', () => toggleDrawer(true));
$('#closeDrawerBtn')?.addEventListener('click', () => toggleDrawer(false));
scrim?.addEventListener('click', () => toggleDrawer(false));
$('#bottomSheetToggle')?.addEventListener('click', () => toggleSheet());
$('#sheetFollow')?.addEventListener('click', () => { toggleSheet(false); openFollowDialog(); });
$('#sheetRefresh')?.addEventListener('click', () => { toggleSheet(false); refreshFeed(); });
$('#sheetStorage')?.addEventListener('click', () => { toggleSheet(false); openStorageDialog(); });

$('#addFollowBtn')?.addEventListener('click', openFollowDialog);
$('#drawerFollowBtn')?.addEventListener('click', () => { toggleDrawer(false); openFollowDialog(); });
$('#emptyFetchBtn')?.addEventListener('click', refreshFeed);
$('#refreshBtn')?.addEventListener('click', refreshFeed);
// (archive favorites toggle removed)

$('.drawer .drawer-nav')?.addEventListener?.('click', (e) => {
  const t = e.target.closest('.nav-item'); if(!t) return;
  const view = t.dataset.view;
  if (view === 'settings') { toggleDrawer(false); openStorageDialog(); return; }
  if (view) { state.view = view; renderFeed(); toggleDrawer(false); }
});

// Follow dialog
const followDialog = $('#followDialog');
function openFollowDialog(){ followDialog.showModal?.(); $('#npubInput').focus(); }
$('#followForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#npubInput').value.trim();
  if (!v) return followDialog.close();
  if (!state.follows.includes(v)) { state.follows.push(v); saveFollows(); }
  $('#npubInput').value = '';
  followDialog.close();
  // Do not auto-refresh; respect requirement. User can tap Refresh.
});

// QR scanner
const qrDialog = $('#qrDialog');
const qrVideo = $('#qrVideo');
let qrStream = null; let qrStopLoop = null;
$('#scanQRBtn')?.addEventListener('click', startQRScan);
$('#qrCloseBtn')?.addEventListener('click', stopQRScan);
qrDialog?.addEventListener('close', stopQRScan);

async function startQRScan(){
  if (!navigator.mediaDevices?.getUserMedia){ alert('Camera not supported on this device/browser.'); return; }
  try {
    qrDialog.showModal?.();
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    qrVideo.srcObject = qrStream;
    await qrVideo.play().catch(()=>{});
    if ('BarcodeDetector' in window){
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!qrDialog.open) return;
        try {
          const codes = await det.detect(qrVideo);
          if (codes && codes.length){
            const raw = codes[0].rawValue || '';
            handleQRValue(raw);
            return;
          }
        } catch {}
        qrStopLoop = requestAnimationFrame(loop);
      };
      loop();
    } else {
      const { default: jsQR } = await import('https://esm.sh/jsqr@1.4.0');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const loop = () => {
        if (!qrDialog.open) return;
        const w = qrVideo.videoWidth, h = qrVideo.videoHeight;
        if (w && h){
          canvas.width = w; canvas.height = h;
          ctx.drawImage(qrVideo, 0, 0, w, h);
          const img = ctx.getImageData(0,0,w,h);
          const code = jsQR(img.data, w, h);
          if (code && code.data){ handleQRValue(code.data); return; }
        }
        qrStopLoop = requestAnimationFrame(loop);
      };
      loop();
    }
  } catch (err){
    alert('Camera access denied or unavailable.');
    try { qrDialog.close(); } catch {}
  }
}

function stopQRScan(){
  if (qrStopLoop){ cancelAnimationFrame(qrStopLoop); qrStopLoop = null; }
  try { qrVideo.pause(); } catch {}
  try { if (qrStream){ qrStream.getTracks().forEach(t => t.stop()); qrStream = null; } } catch {}
}

function handleQRValue(text){
  stopQRScan();
  try { qrDialog.close(); } catch {}
  const val = extractNostrKey(text);
  if (!val){ alert('QR did not contain a valid npub/nprofile.'); return; }
  if (!followDialog.open) followDialog.showModal?.();
  $('#npubInput').value = val;
}

function extractNostrKey(s){
  if (!s) return null;
  let t = String(s);
  const lower = t.toLowerCase();
  const idx = lower.indexOf('nostr:');
  if (idx >= 0) t = t.slice(idx + 6);
  const m = t.match(/(npub1[02-9ac-hj-np-z]{58})|(nprofile1[02-9ac-hj-np-z]+)|([0-9a-f]{64})/i);
  if (m) { try { console.debug('[Vibestr][follow] extractNostrKey: matched', { input: s, output: m[0] }); } catch {}; return m[0]; }
  try { console.debug('[Vibestr][follow] extractNostrKey: no match', { input: s }); } catch {}
  return null;
}

// Settings (dialog)
const storageDialog = $('#storageDialog');
const nukePostsBtn = $('#nukePostsConfirmBtn');
const nukeFollowsBtn = $('#nukeFollowsConfirmBtn');
const exportFollowsBtn = $('#exportFollowsBtn');
const importFollowsBtn = $('#importFollowsBtn');
const importFollowsFile = $('#importFollowsFile');
const restoreFollowsBtn = $('#restoreFollowsConfirmBtn');
const restoreFollowsFile = $('#restoreFollowsFile');

function setupConfirmButton(btn, action){
  if (!btn) return;
  const original = btn.textContent;
  let staged = false; let timer = null;
  const reset = () => { staged=false; btn.textContent = original; btn.classList.remove('confirm'); if (timer){ clearTimeout(timer); timer=null; } };
  btn.addEventListener('click', () => {
    if (!staged){
      staged = true; btn.textContent = 'Are you sure?'; btn.classList.add('confirm');
      timer = setTimeout(reset, 3500);
    } else {
      try { action(); } finally { reset(); }
    }
  });
  storageDialog?.addEventListener('close', reset);
}

setupConfirmButton(nukePostsBtn, () => {
  state.posts = {};
  state.hidden = new Set();
  state.favorites = new Set();
  persistStorage();
  renderFeed();
});
setupConfirmButton(nukeFollowsBtn, () => {
  state.follows = [];
  saveFollows();
  delCookie('vibestr_follows');
  if (state.view === 'following') renderFeed();
});
// Export follows as JSON file
function exportFollows(){
  const data = JSON.stringify(state.follows, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  a.download = `vibestr-follows-${y}${m}${d}.json`;
  a.href = url; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
exportFollowsBtn?.addEventListener('click', exportFollows);

// Helpers for import/restore
function sanitizeFollowsArray(arr){
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(arr) ? arr : [])){
    if (typeof item !== 'string') continue;
    let s = item.trim();
    if (!s) continue;
    const ex = extractNostrKey(s);
    if (ex) s = ex;
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

// Import (merge)
importFollowsBtn?.addEventListener('click', () => importFollowsFile?.click());
importFollowsFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const incoming = sanitizeFollowsArray(parsed);
    const before = new Set(state.follows.map(s => s.trim()));
    let added = 0;
    for (const s of incoming){ if (!before.has(s)) { state.follows.push(s); before.add(s); added++; } }
    saveFollows();
    if (state.view === 'following') renderFeed();
    alert(`Imported ${incoming.length} follows (added ${added} new).`);
  } catch { alert('Failed to import: invalid JSON.'); }
  finally { e.target.value = ''; }
});

// Restore (replace) with confirm flow triggering file picker
setupConfirmButton(restoreFollowsBtn, () => restoreFollowsFile?.click());
restoreFollowsFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const incoming = sanitizeFollowsArray(parsed);
    state.follows = incoming;
    saveFollows();
    if (state.view === 'following') renderFeed();
    alert(`Restored follow list (${incoming.length} entries).`);
  } catch { alert('Failed to restore: invalid JSON.'); }
  finally { e.target.value = ''; }
});
function openStorageDialog(){
  try { $('#lsUsed').textContent = fmtBytes(localStorageBytesUsed()); } catch {}
  try { $('#postCount').textContent = Object.keys(state.posts).length; } catch {}
  storageDialog?.showModal?.();
}

// Rendering
function eventToCard(ev){
  const tpl = $('#postTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = ev.id;
  const prof = state.profiles?.[ev.pubkey] || null;
  const displayName = (prof?.display_name || prof?.name || '').trim() || shortenAuthor(ev.pubkey);
  const authorEl = node.querySelector('[data-field="author"]');
  authorEl.textContent = displayName;
  authorEl.title = ev.pubkey;
  const t = new Date((ev.created_at||0)*1000);
  const timeEl = node.querySelector('[data-field="time"]');
  timeEl.textContent = `${t.toLocaleString()} • ${timeago(t.getTime())}`;
  timeEl.title = t.toISOString();
  const ava = node.querySelector('.avatar');
  if (prof?.picture) {
    ava.innerHTML = '';
    const img = document.createElement('img');
    img.src = prof.picture;
    img.alt = '';
    ava.appendChild(img);
  } else {
    ava.textContent = '👤';
  }
  const contentEl = node.querySelector('[data-field="content"]');
  contentEl.replaceChildren(...buildContent(ev, { allowQuotes: true }));
  const favBtn = node.querySelector('.fav');
  if (state.favorites.has(ev.id)) favBtn.textContent = '★';
  favBtn.addEventListener('click', () => {
    const wasFav = state.favorites.has(ev.id);
    if (wasFav) state.favorites.delete(ev.id); else state.favorites.add(ev.id);
    persistStorage();
    // Update the star icon in place without re-rendering the whole feed
    favBtn.textContent = state.favorites.has(ev.id) ? '★' : '☆';
    // Only re-render when in Favorites view (list membership changes)
    if (state.view === 'favorites') renderFeed();
  });
  return node;
}

function renderFeed(){
  // Settings is a dialog now; no content view rendering

  if (state.view === 'following') {
    try { console.debug('[Vibestr][render] enter view', { view: 'following', followsCount: state.follows.length }); } catch {}
    emptyStateEl.style.display = 'none';
    feedEl.innerHTML = '';
    if (archiveToolbar) archiveToolbar.hidden = true;
    renderFollowingView().catch(()=>{});
    updateNavSelection();
    return;
  }
  // Scroll to top before rendering Inbox/Archive/Favorites
  try {
    window.scrollTo(0, 0);
    const content = $('#content'); if (content) content.scrollTop = 0;
    if (feedEl) feedEl.scrollTop = 0;
    console.debug('[Vibestr][render] scrolled to top for view', { view: state.view });
  } catch {}
  const all = Object.values(state.posts);
  let toShow = [];
  if (state.view === 'favorites') {
    toShow = all.filter(ev => state.favorites.has(ev.id));
  } else if (state.view === 'archive') {
    toShow = all;
  } else { // inbox
    // Keep items visible during current session even if marked hidden now
    toShow = all.filter(ev => !(state.hidden.has(ev.id) && !sessionReadNow.has(ev.id)));
  }
  toShow.sort((a,b)=> (b.created_at||0)-(a.created_at||0));
  feedEl.innerHTML = '';
  for (const ev of toShow) feedEl.appendChild(eventToCard(ev));
  // Empty state messaging
  const totalPosts = all.length;
  if (toShow.length) {
    emptyStateEl.style.display = 'none';
  } else {
    const ps = emptyStateEl.querySelectorAll('p');
    if (state.view === 'favorites'){
      if (ps[0]) ps[0].textContent = 'No favorites yet';
      if (ps[1]) ps[1].textContent = 'Tap ★ on posts to add them to Favorites.';
    } else if (state.view === 'inbox' && totalPosts > 0) {
      if (ps[0]) ps[0].textContent = 'Inbox zero';
      if (ps[1]) ps[1].textContent = 'All posts have been viewed. Fetch new posts or browse the Archive.';
    } else {
      if (ps[0]) ps[0].textContent = 'No posts yet.';
      if (ps[1]) ps[1].textContent = 'Add npubs to follow, then tap "Fetch posts".';
    }
    emptyStateEl.style.display = 'block';
  }
  if (archiveToolbar) archiveToolbar.hidden = true;
  setupReadObserver();
  updateNavSelection();
}

async function renderFollowingView(){
  const feed = feedEl;
  // Inline add-follow form
  const wrap = document.createElement('div'); wrap.className='follow-add';
  const row = document.createElement('div'); row.className='row';
  const input = document.createElement('input'); input.type='text'; input.placeholder='npub1… or nprofile1… or hex'; input.autocomplete='off'; input.id='followAddInput';
  const addBtn = document.createElement('button'); addBtn.className='chip'; addBtn.type='button'; addBtn.id='followAddBtn'; addBtn.textContent='Add';
  row.append(input, addBtn); wrap.append(row);
  feed.appendChild(wrap);
  try { console.debug('[Vibestr][following] renderFollowingView: initial', { follows: state.follows }); } catch {}

  // Wire add-follow interactions immediately (must work even when there are 0 follows)
  const addFollow = () => {
    let v = input.value.trim(); if (!v) return;
    const extracted = extractNostrKey(v); if (extracted) v = extracted;
    const vNorm = /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : v;
    const before = state.follows.length;
    if (!state.follows.includes(vNorm)) { state.follows.push(vNorm); saveFollows(); }
    try { console.debug('[Vibestr][follow] addFollow', { raw: input.value, extracted, stored: vNorm, before, after: state.follows.length, follows: state.follows }); } catch {}
    input.value='';
    renderFeed();
  };
  addBtn.addEventListener('click', addFollow);
  input.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { e.preventDefault(); addFollow(); } });

  // Decode follows to hex pubkeys (lazy-load nip19 only if needed)
  const pubs = [];
  let nip19 = null; // lazy load when encountering non-hex entries
  for (const x of state.follows){
    const s = (x||'').trim(); if(!s) continue;
    if (/^[0-9a-f]{64}$/i.test(s)) { pubs.push(s.toLowerCase()); continue; }
    if (!nip19){ try { nip19 = await getNip19(); } catch { nip19 = null; } }
    if (nip19){
      try{
        const d = nip19.decode(s);
        if (d.type === 'npub' && typeof d.data === 'string') pubs.push(d.data.toLowerCase());
        else if (d.type === 'nprofile' && d.data?.pubkey) pubs.push(String(d.data.pubkey).toLowerCase());
      }catch{}
    }
  }
  const uniq = [...new Set(pubs)];
  try { console.debug('[Vibestr][following] decoded pubs', { uniq, count: uniq.length }); } catch {}
  // No follows: keep feed visible with the add form; don't show global empty state
  if (!uniq.length){ return; }
  // Fetch profiles for missing pubkeys
  const need = uniq.filter(pk => !state.profiles[pk]);
  if (need.length){
    const meta = await queryRelaysOnce(state.relays, { kinds:[0], authors: need, limit: 1 });
    const latest = {};
    for (const m of meta){
      const pk = m.pubkey; const prev = latest[pk];
      if (!prev || (m.created_at||0) > (prev.created_at||0)) latest[pk] = m;
    }
    for (const [pk, m] of Object.entries(latest)){
      try { const j = JSON.parse(m.content || '{}'); state.profiles[pk] = j; } catch {}
    }
    persistStorage();
  }
  // Add "Refresh all" button at top of list
  const refreshAllBtn = document.createElement('button'); refreshAllBtn.className='chip'; refreshAllBtn.type='button'; refreshAllBtn.id='followRefreshAllBtn'; refreshAllBtn.textContent='Refresh all profiles';
  wrap.append(refreshAllBtn);
  refreshAllBtn.addEventListener('click', async () => {
    const prev = refreshAllBtn.textContent; refreshAllBtn.textContent='Refreshing…'; refreshAllBtn.disabled = true;
    for (const pk of uniq){ await refreshProfile(pk); }
    refreshAllBtn.textContent = prev; refreshAllBtn.disabled = false; renderFeed();
  });
  // Render cards
  for (const pk of uniq){
    const prof = state.profiles?.[pk] || null;
    const card = document.createElement('article'); card.className='post follow-card';
    const header = document.createElement('header'); header.className='post-h';
    const ava = document.createElement('div'); ava.className='avatar';
    if (prof?.picture){ const img=document.createElement('img'); img.src=prof.picture; img.alt=''; ava.append(img);} else { ava.textContent='👤'; }
    const meta = document.createElement('div'); meta.className='meta';
    const name = document.createElement('div'); name.className='author'; name.textContent=(prof?.display_name||prof?.name||'').trim() || shortenAuthor(pk);
    const pkline = document.createElement('div'); pkline.className='time'; setupPkCopy(pkline, pk);
    const nipEl = document.createElement('div'); nipEl.className='nip05'; renderNip05Badge(nipEl, pk);
    const metaLine = document.createElement('div'); metaLine.className='meta-line';
    // Order: Display name - npub - NIP-05
    const sep1 = document.createTextNode(' 𑗅 ');
    const sep2 = document.createTextNode(' 𑗅 ');
    metaLine.append(name, sep1, pkline, sep2, nipEl);
    meta.append(metaLine);
    const actions = document.createElement('div'); actions.className='actions';
    // Overflow menu: single "..." button
    const menuBtn = document.createElement('button'); menuBtn.className='icon-btn menu-btn'; menuBtn.type='button'; menuBtn.setAttribute('aria-haspopup','true'); menuBtn.setAttribute('aria-expanded','false'); menuBtn.title = 'More actions'; menuBtn.textContent = '…';
    const bubble = document.createElement('div'); bubble.className='menu-bubble';
    const unfollowBtn = document.createElement('button'); unfollowBtn.className='danger unfollow-btn'; unfollowBtn.type='button'; unfollowBtn.textContent='Unfollow';
    const refreshBtn = document.createElement('button'); refreshBtn.className='icon-btn'; refreshBtn.type='button'; refreshBtn.textContent='Refresh';
    bubble.append(unfollowBtn, refreshBtn);
    actions.append(menuBtn, bubble);
    header.append(ava, meta, actions);
    const body = document.createElement('div'); body.className='post-content';
    const about = (prof?.about||'').trim();
    if (about) { body.textContent = about; }
    else { body.innerHTML = '<span class="muted"><em>no description</em></span>'; }
    card.append(header, body);
    feed.appendChild(card);

    // Menu open/close
    const closeMenu = () => { bubble.classList.remove('open'); menuBtn.setAttribute('aria-expanded','false'); };
    const openMenu = () => { bubble.classList.add('open'); menuBtn.setAttribute('aria-expanded','true'); };
    menuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (bubble.classList.contains('open')) { closeMenu(); }
      else {
        openMenu();
        const onDocClick = (e) => {
          if (!bubble.contains(e.target) && e.target !== menuBtn) { closeMenu(); document.removeEventListener('click', onDocClick); }
        };
        setTimeout(() => document.addEventListener('click', onDocClick), 0);
      }
    });

    // Per-card Refresh handler (submenu)
    refreshBtn.addEventListener('click', async () => {
      const keep = refreshBtn.textContent; refreshBtn.textContent='Refreshing…'; refreshBtn.disabled = true;
      await refreshProfile(pk);
      const updated = state.profiles?.[pk] || null;
      name.textContent = (updated?.display_name||updated?.name||'').trim() || shortenAuthor(pk);
      const about2 = (updated?.about||'').trim();
      if (about2) { body.textContent = about2; } else { body.innerHTML = '<span class="muted"><em>no description</em></span>'; }
      if (updated?.picture){ ava.innerHTML=''; const img=document.createElement('img'); img.src=updated.picture; img.alt=''; ava.append(img);} else { ava.textContent='👤'; ava.innerHTML='👤'; }
      setupPkCopy(pkline, pk);
      renderNip05Badge(nipEl, pk, true);
      refreshBtn.textContent = keep; refreshBtn.disabled = false; closeMenu();
    });

    // Unfollow handler: double-click confirm using shared helper (submenu)
    setupConfirmButton(unfollowBtn, async () => {
      try { console.debug('[Vibestr][follow] Unfollow confirmed', { targetHex: pk }); } catch {}
      const hexOf = async (s) => {
        const v = (s||'').trim(); if (!v) return null;
        if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase();
        if (!nip19){ try { nip19 = await getNip19(); } catch { return null; } }
        try{
          const d = nip19.decode(v);
          if (d.type === 'npub' && typeof d.data === 'string') return d.data.toLowerCase();
          if (d.type === 'nprofile' && d.data?.pubkey) return String(d.data.pubkey).toLowerCase();
        }catch{}
        return null;
      };
      const before = state.follows.length;
      const keep = [];
      for (const x of state.follows){
        const hx = await hexOf(x);
        if (hx !== pk) keep.push(x);
      }
      state.follows = keep;
      // Purge cached posts authored by this pubkey
      const removedIds = [];
      for (const [id, ev] of Object.entries(state.posts)){
        if (ev?.pubkey === pk){
          delete state.posts[id];
          state.hidden.delete(id);
          state.favorites.delete(id);
          removedIds.push(id);
        }
      }
      if (state.follows.length !== before){ try { console.debug('[Vibestr][follow] Unfollow removed', { before, after: state.follows.length, follows: state.follows, purgedPosts: removedIds.length }); } catch {} ; saveFollows(); persistStorage(); renderFeed(); }
      closeMenu();
    });
  }

  // (listeners already attached above)
}

// IntersectionObserver to hide posts once fully viewed in Inbox
let observer;
function setupReadObserver(){
  observer?.disconnect?.();
  if (state.view !== 'inbox') return;
  observer = new IntersectionObserver((entries) => {
    for (const ent of entries){
      if (ent.isIntersecting && ent.intersectionRatio >= 0.6){
        const id = ent.target.dataset.id;
        if (id && !state.hidden.has(id)) {
          state.hidden.add(id);
          sessionReadNow.add(id);
          persistStorage();
        }
        try { observer.unobserve(ent.target); } catch {}
      }
    }
  }, { threshold: [0.6] });
  $$('.post', feedEl).forEach(el => observer.observe(el));
}

// (desktop fetch button is always visible via CSS; no sentinel logic)

function shortenAuthor(pub){ if(!pub) return 'unknown'; return pub.length>12 ? pub.slice(0,8)+'…'+pub.slice(-4) : pub; }
function timeago(ts){
  const s=Math.floor((Date.now()-ts)/1000); if(s<60) return `${s}s ago`; const m=Math.floor(s/60); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<24) return `${h}h ago`; const d=Math.floor(h/24); return `${d}d ago`;
}

// (pull-to-refresh removed)

// Build rich content: linkify URLs (embed images) and embed quoted notes below content
function isImageUrl(u){ return /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(u); }
let nip19Cached = null;
async function getNip19(){
  if (nip19Cached) return nip19Cached;
  let mod; try { mod = await import('https://esm.sh/nostr-tools@2.9.0'); console.debug('[Vibestr][nip19] loaded 2.9.0'); }
  catch { try { mod = await import('https://esm.sh/nostr-tools@1.17.0'); console.debug('[Vibestr][nip19] loaded 1.17.0'); } catch (e) { console.error('[Vibestr][nip19] failed to load', e); throw e; } }
  const n = mod.nip19 || mod.default?.nip19; if (!n) { console.error('[Vibestr][nip19] missing nip19 export'); throw new Error('nostr-tools nip19 failed to load'); }
  nip19Cached = n; return n;
}

// --- NIP-05 verification helpers ---
function parseNip05Id(idRaw){
  if (!idRaw || typeof idRaw !== 'string') return null;
  const s = idRaw.trim().toLowerCase();
  if (!s) return null;
  let name = '_'; let domain = s;
  if (s.includes('@')){
    const [n, d] = s.split('@');
    name = (n || '_'); domain = d || '';
  }
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return null;
  if (!/^[a-z0-9._-]+$/.test(name)) return null;
  const display = name === '_' ? domain : `${name}@${domain}`;
  return { name, domain, display };
}

async function verifyNip05For(pk, force=false){
  try{
    const prof = state.profiles?.[pk] || null;
    const idRaw = (prof?.nip05 || '').trim();
    if (!idRaw){
      state.nip05[pk] = { id: '', status: 'none', ts: Date.now() };
      persistStorage();
      return state.nip05[pk];
    }
    const parsed = parseNip05Id(idRaw);
    const TTL = 6 * 60 * 60 * 1000; // 6 hours
    const now = Date.now();
    const cached = state.nip05?.[pk];
    if (!force && cached && cached.id && cached.id.toLowerCase() === (parsed?.display||'').toLowerCase() && (now - (cached.ts||0)) < TTL){
      return cached;
    }
    if (!parsed){
      state.nip05[pk] = { id: idRaw, status: 'unverified', ts: now };
      persistStorage();
      return state.nip05[pk];
    }
    const url1 = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`;
    const url2 = `https://${parsed.domain}/.well-known/nostr.json`;
    let data = null;
    try{
      const r1 = await fetch(url1, { cache: 'no-store', headers: { 'accept': 'application/json' } });
      if (r1.ok) { data = await r1.json().catch(()=>null); }
      if (!data){
        const r2 = await fetch(url2, { cache: 'no-store', headers: { 'accept': 'application/json' } });
        if (r2.ok) data = await r2.json().catch(()=>null);
      }
    } catch {}
    let status = 'unverified';
    if (data && data.names && typeof data.names === 'object'){
      const names = data.names;
      const got = names[parsed.name] || names[parsed.name.toLowerCase()] || null;
      if (got && typeof got === 'string' && got.toLowerCase() === pk.toLowerCase()) status = 'ok';
    }
    state.nip05[pk] = { id: parsed.display, status, ts: now };
    persistStorage();
    return state.nip05[pk];
  } catch {
    const prof = state.profiles?.[pk] || null;
    const idRaw = (prof?.nip05 || '').trim();
    const parsed = parseNip05Id(idRaw);
    state.nip05[pk] = { id: parsed?.display || idRaw || '', status: idRaw ? 'unverified' : 'none', ts: Date.now() };
    persistStorage();
    return state.nip05[pk];
  }
}

function renderNip05Badge(el, pk, force=false){
  if (!el) return;
  const prof = state.profiles?.[pk] || null;
  const idRaw = (prof?.nip05 || '').trim();
  if (!idRaw){
    el.className = 'nip05 nip05-none';
    el.textContent = 'no NIP-05';
    return;
  }
  el.className = 'nip05 nip05-pending';
  const parsed = parseNip05Id(idRaw);
  const label = parsed?.display || idRaw.toLowerCase();
  el.textContent = `⏳ ${label}`;
  verifyNip05For(pk, !!force).then(res => {
    el.className = 'nip05';
    if (res?.status === 'ok'){
      el.classList.add('nip05-ok');
      el.textContent = `✓ ${res.id || label}`;
    } else if (res?.status === 'none'){
      el.classList.add('nip05-none');
      el.textContent = 'no NIP-05';
    } else {
      el.classList.add('nip05-bad');
      el.textContent = `⚠︎ ${res?.id || label}`;
    }
  }).catch(() => {
    el.className = 'nip05 nip05-bad';
    el.textContent = `⚠︎ ${label}`;
  });
}
function buildContent(ev, opts={}){
  const allowQuotes = !!opts.allowQuotes;
  const text = ev.content || '';
  const frag = document.createDocumentFragment();
  const parts = text.split(/(\s+)/);
  for (const p of parts){
    if (/^\s+$/.test(p)) { frag.append(document.createTextNode(p)); continue; }
    // URL?
    const urlMatch = p.match(/^https?:\/\/[^\s]+$/i);
    if (urlMatch){
      let url = urlMatch[0].replace(/[),.;!?]+$/, '');
      if (isImageUrl(url)){
        const img = document.createElement('img'); img.src = url; img.alt=''; frag.append(img);
      } else {
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel='noopener noreferrer'; a.textContent = url; frag.append(a);
      }
      continue;
    }
    frag.append(document.createTextNode(p));
  }
  if (allowQuotes){
    const refs = Array.from(text.matchAll(/(?:nostr:)?(note1[02-9ac-hj-np-z]+|nevent1[02-9ac-hj-np-z]+)/ig)).map(m=>m[1]);
    const seen = new Set();
    for (const spec of refs){
      if (seen.has(spec)) continue; seen.add(spec);
      const holder = document.createElement('div'); holder.className = 'quote'; holder.textContent = 'Loading note…';
      frag.append(document.createTextNode('\n'));
      frag.append(holder);
      fetchAndRenderQuote(spec, holder);
    }
  }
  return frag.childNodes;
}
function eventToQuote(ev){
  const wrap = document.createElement('div'); wrap.className = 'quote';
  const prof = state.profiles?.[ev.pubkey] || null;
  const header = document.createElement('div'); header.className='quote-h';
  const ava = document.createElement('div'); ava.className='avatar'; if (prof?.picture){ const i=document.createElement('img'); i.src=prof.picture; i.alt=''; ava.append(i);} else { ava.textContent='👤'; }
  const meta = document.createElement('div'); meta.className='meta';
  const name = document.createElement('div'); name.className='author'; name.textContent=(prof?.display_name||prof?.name||'').trim() || shortenAuthor(ev.pubkey);
  const time = document.createElement('div'); time.className='time'; const dt=new Date((ev.created_at||0)*1000); time.textContent = `${dt.toLocaleString()} • ${timeago(dt.getTime())}`; time.title = dt.toISOString();
  meta.append(name, time);
  header.append(ava, meta);
  const body = document.createElement('div'); body.className='content'; body.replaceChildren(...buildContent(ev, { allowQuotes: false }));
  wrap.append(header, body);
  return wrap;
}
async function fetchAndRenderQuote(spec, holder){
  try{
    const nip19 = await getNip19();
    let id=null; const d = nip19.decode(spec);
    if (d.type==='note') id = d.data; else if (d.type==='nevent') id = d.data?.id;
    if (!id){ holder.textContent='(unknown note)'; return; }
    // Try cache first
    let ev = state.posts?.[id] || state.quotes?.[id] || null;
    if (!ev){
      const evs = await queryRelaysOnce(state.relays, { ids: [id], limit: 1 });
      ev = evs[0] || null;
      if (!ev){ holder.textContent='(note not found)'; return; }
      state.quotes[id] = ev; // cache mentioned note
      persistStorage();
    }
    // ensure profile for quoted author if missing
    if (!state.profiles[ev.pubkey]){
      const meta = await queryRelaysOnce(state.relays, { kinds:[0], authors:[ev.pubkey], limit:1 });
      if (meta[0]){ try{ state.profiles[ev.pubkey] = JSON.parse(meta[0].content||'{}'); persistStorage(); }catch{} }
    }
    holder.replaceWith(eventToQuote(ev));
  }catch{ holder.textContent='(failed to load note)'; }
}
// Nostr refresh (user-initiated only)
async function refreshFeed(){
  if (!state.follows.length) { alert('Add at least one npub first.'); return; }
  try {
    // Load only nip19 for decoding npub/nprofile
    let mod; try { mod = await import('https://esm.sh/nostr-tools@2.9.0'); }
    catch { mod = await import('https://esm.sh/nostr-tools@1.17.0'); }
    const nip19 = mod.nip19 || mod.default?.nip19;
    if (!nip19) throw new Error('nostr-tools nip19 failed to load');

    // Build authors list (hex pubkeys)
    const authors = [];
    for (const x of state.follows){
      const s = (x||'').trim(); if(!s) continue;
      if (/^[0-9a-f]{64}$/i.test(s)) { authors.push(s.toLowerCase()); continue; }
      try{
        const d = nip19.decode(s);
        if (d.type === 'npub' && typeof d.data === 'string') authors.push(d.data.toLowerCase());
        else if (d.type === 'nprofile' && d.data?.pubkey) authors.push(String(d.data.pubkey).toLowerCase());
      }catch{}
    }
    if (!authors.length) { alert('No valid pubkeys in follow list.'); return; }

    const events = await queryRelaysOnce(state.relays, { kinds: [1], authors, limit: 100 });
    for (const ev of events){ state.posts[ev.id] = ev; }
    // Fetch kind 0 metadata for authors we don't have yet
    const authorSet = new Set(events.map(e => e.pubkey).filter(Boolean));
    const needProfiles = [...authorSet].filter(pk => !state.profiles[pk]);
    if (needProfiles.length){
      const meta = await queryRelaysOnce(state.relays, { kinds: [0], authors: needProfiles, limit: 1 });
      // keep latest by author
      const latest = {};
      for (const m of meta){
        const pk = m.pubkey; const prev = latest[pk];
        if (!prev || (m.created_at||0) > (prev.created_at||0)) latest[pk] = m;
      }
      for (const [pk, m] of Object.entries(latest)){
        try { const j = JSON.parse(m.content || '{}'); state.profiles[pk] = j; } catch {}
      }
    }
    state.lastRefresh = Date.now();
    persistStorage();
    renderFeed();
  } catch (err){ console.error(err); alert('Failed to refresh from relays.'); }
}

// Connect to each relay via WebSocket, send REQ with filters, collect until EOSE, CLOSE and close socket.
function queryRelaysOnce(relayUrls, filter){
  const subId = `vibe-${Math.random().toString(36).slice(2,8)}-${Date.now()}`;
  const timeoutMs = 6000;

  function connect(url){
    return new Promise(resolve => {
      let ws; let events = []; let settled = false; let timer;
      const done = () => {
        if (settled) return; settled = true;
        try { ws?.send(JSON.stringify(['CLOSE', subId])); } catch {}
        try { ws?.close(); } catch {}
        clearTimeout(timer);
        resolve(events);
      };
      try { ws = new WebSocket(url); } catch { return resolve([]); }
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, filter]));
          timer = setTimeout(done, timeoutMs);
        } catch { done(); }
      };
      ws.onmessage = (e) => {
        try{
          const msg = JSON.parse(e.data);
          if (!Array.isArray(msg)) return;
          const [type, ...rest] = msg;
          if (type === 'EVENT'){
            const [sid, ev] = rest; if (sid === subId && ev?.id) events.push(ev);
          } else if (type === 'EOSE'){
            const [sid] = rest; if (sid === subId) done();
          } else if (type === 'CLOSED'){
            done();
          }
        }catch{}
      };
      ws.onerror = () => done();
      ws.onclose = () => done();
    });
  }

  return Promise.allSettled(relayUrls.map(connect)).then(results => {
    const map = new Map();
    for (const r of results){
      const arr = r.status === 'fulfilled' ? r.value : [];
      for (const ev of arr){ if (ev?.id) map.set(ev.id, ev); }
    }
    return [...map.values()];
  });
}
 
// (duplicate pull-to-refresh block removed)

// Boot
loadFollows();
loadStorage();
renderFeed();
updateBuildTag();
// Do NOT auto-load new posts on open (per requirement)
