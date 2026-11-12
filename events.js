// Student events page: browse events, view details, RSVP (live updates).
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, doc, getDoc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const THEME_KEY = 'campushub_theme';
const root = document.documentElement;

let me = null;
let events = [];
let rsvps = {};
let rsvpUnsubs = {};
let filter = 'upcoming';
let started = false;
const openLists = new Set();
let loadTimeout = null;

// ---------- helpers ----------
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parts(iso) {
  const d = new Date(iso + 'T00:00:00');
  return { day: d.getDate(), month: d.toLocaleString('en-US', { month: 'short' }) };
}
function fmtTime(t) {
  if (!t) return '';
  const h = parseInt(t.slice(0, 2), 10);
  return (h % 12 || 12) + ':' + t.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM');
}
let toastTimer;
function toast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- theme ----------
try { const t = localStorage.getItem(THEME_KEY); if (t) root.dataset.theme = t; } catch (e) {}
$('theme')?.addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (e) {}
});

// ---------- auth ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  me = user;
  
  const name = user.displayName || user.email;
  if ($('uname')) $('uname').textContent = name;
  if ($('av')) $('av').textContent = name.charAt(0).toUpperCase();

  const sub = document.querySelector('.sub');
  if (sub) sub.textContent = "Explore upcoming campus events, view full details, and reserve your spot.";

  // Only check if user is admin to show/hide the Admin Panel link in the student header
  try {
    const email = (user.email || '').toLowerCase().trim();
    const isAdmin = email === '26ir1yo77@mitsgwl.ac.in' || 
                    (await getDoc(doc(db, 'organizers', email))).exists();

    if ($('adminLink')) $('adminLink').hidden = !isAdmin;
  } catch (e) {
    if ($('adminLink')) $('adminLink').hidden = true;
  }

  startListeners();
});

$('adminLink')?.addEventListener('click', () => { location.href = 'admin.html'; });

$('logout')?.addEventListener('click', async () => {
  try { await signOut(auth); } catch (e) {}
  try { localStorage.removeItem('campushub_user'); } catch (e) {}
  location.href = 'index.html';
});

// ---------- live data ----------
function onError(err) {
  console.error("Events load error:", err);
  clearTimeout(loadTimeout);
  const listEl = $('list');
  if (listEl) {
    listEl.innerHTML = '<p class="empty">Couldn’t load events. Check your Firestore rules or internet connection.</p>';
  }
}

function startListeners() {
  if (started) return;
  started = true;

  loadTimeout = setTimeout(() => {
    const listEl = $('list');
    if (listEl && listEl.innerHTML.includes('Loading events')) {
      listEl.innerHTML = '<p class="empty">Connection timeout. Please check your network connection.</p>';
    }
  }, 4000);

  const eventsQuery = query(collection(db, 'events'), orderBy('date'));

  onSnapshot(eventsQuery, (snap) => {
    clearTimeout(loadTimeout);
    events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ids = new Set(events.map((e) => e.id));

    events.forEach((ev) => {
      if (!rsvpUnsubs[ev.id]) {
        rsvpUnsubs[ev.id] = onSnapshot(collection(db, 'events', ev.id, 'rsvps'), (rSnap) => {
          rsvps[ev.id] = rSnap.docs.map((rd) => ({ uid: rd.id, ...rd.data() }));
          render();
        }, (err) => console.warn("RSVP read warning:", err));
      }
    });

    Object.keys(rsvpUnsubs).forEach((id) => {
      if (!ids.has(id)) { rsvpUnsubs[id](); delete rsvpUnsubs[id]; delete rsvps[id]; }
    });

    render();
  }, onError);
}

// ---------- rendering ----------
function card(e, today) {
  const going = rsvps[e.id] || [];
  const mine = going.some((g) => g.uid === me?.uid);
  const past = e.date < today;
  const cap = e.capacity || 0;
  const full = cap > 0 && going.length >= cap && !mine;
  const p = parts(e.date);
  const pct = cap > 0 ? Math.min(100, Math.round(going.length / cap * 100)) : 0;

  let rsvpBtn;
  if (past) rsvpBtn = '<button class="btn ghost" disabled>Event ended</button>';
  else if (mine) rsvpBtn = '<button class="btn on" data-rsvp="' + e.id + '">✓ Going · Cancel</button>';
  else if (full) rsvpBtn = '<button class="btn ghost" disabled>Full</button>';
  else rsvpBtn = '<button class="btn" data-rsvp="' + e.id + '">RSVP</button>';

  const when = [fmtTime(e.time), e.location].filter(Boolean).join(' · ');

  let att = '';
  if (openLists.has(e.id)) {
    att = '<div class="att">' + (going.length ? going.map((g) =>
      '<div><span class="av grad">' + esc((g.name || '?').charAt(0).toUpperCase()) + '</span><span>' + esc(g.name) + '</span></div>').join('')
      : '<span class="meta">No RSVPs yet. Be the first!</span>') + '</div>';
  }

  const detailsLink = '<a class="linkbtn" href="event-details.html?id=' + encodeURIComponent(e.id) + '" style="text-decoration:none;">Event Details</a>';

  return '<article class="card"><div class="row">' +
    '<div class="date grad"><div>' + p.day + '<small>' + p.month + '</small></div></div>' +
    '<div class="info"><span class="club">' + esc(e.club || 'General') + '</span>' +
    '<h3>' + esc(e.title) + '</h3><div class="meta">' + esc(when) + '</div>' +
    (e.description ? '<p class="desc">' + esc(e.description) + '</p>' : '') + '</div></div>' +
    (cap > 0 ? '<div class="meter"><i class="grad" style="width:' + pct + '%"></i></div>' : '') +
    '<div class="foot"><div class="count">' + going.length + ' going' +
    (cap > 0 ? ' <span>/ ' + cap + ' spots</span>' : '') + '</div>' +
    '<div class="acts">' + detailsLink +
    '<button class="linkbtn" data-att="' + e.id + '">' + (openLists.has(e.id) ? 'Hide attendees' : 'View attendees') + '</button>' +
    rsvpBtn + '</div></div>' + att + '</article>';
}

function render() {
  if (!me) return;
  const listEl = $('list');
  if (!listEl) return;

  const today = todayStr();
  const key = (e) => e.date + ' ' + (e.time || '');
  let list = events.slice();
  if (filter === 'upcoming') list = list.filter((e) => e.date >= today).sort((a, b) => key(a) < key(b) ? -1 : 1);
  else if (filter === 'past') list = list.filter((e) => e.date < today).sort((a, b) => key(a) < key(b) ? 1 : -1);
  else list = list.filter((e) => (rsvps[e.id] || []).some((g) => g.uid === me.uid)).sort((a, b) => key(a) < key(b) ? -1 : 1);

  const empty = { upcoming: 'No upcoming events yet.', past: 'No past events.', mine: 'You haven’t RSVP’d to any events yet.' };
  listEl.innerHTML = list.length ? list.map((e) => card(e, today)).join('') : '<p class="empty">' + empty[filter] + '</p>';
}

// ---------- actions ----------
$('filters')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  render();
});

$('list')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.att) {
    const id = b.dataset.att;
    if (openLists.has(id)) openLists.delete(id); else openLists.add(id);
    render();
  } else if (b.dataset.rsvp) {
    toggleRsvp(b.dataset.rsvp);
  }
});

async function toggleRsvp(id) {
  const ref = doc(db, 'events', id, 'rsvps', me.uid);
  const going = (rsvps[id] || []).some((g) => g.uid === me.uid);
  try {
    if (going) { await deleteDoc(ref); toast('RSVP cancelled'); }
    else {
      await setDoc(ref, {
        name: me.displayName || me.email,
        email: me.email,
        photo: me.photoURL || '',
        createdAt: serverTimestamp()
      });
      toast('You’re going!');
    }
  } catch (e) { console.error(e); toast('Could not update your RSVP. Try again.'); }
}