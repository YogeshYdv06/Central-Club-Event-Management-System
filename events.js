// Event directory + live RSVP tracking (Cloud Firestore)
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, doc, setDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const THEME_KEY = 'campushub_theme';
const root = document.documentElement;

// Strict single-mentor authorization
const AUTHORIZED_MENTOR_EMAIL = "26ir1yo77@mitsgwl.ac.in";

let me = null;            // signed-in user
let isOrganizer = false;  // true ONLY for 26ir1yo77@mitsgwl.ac.in
let events = [];          // all events (live)
let rsvps = {};           // { eventId: [ {uid, name, email, ...} ] } (live)
let rsvpUnsubs = {};
let filter = 'upcoming';
let started = false;
const openLists = new Set();

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

// ---------- auth & role enforcement ----------
onAuthStateChanged(auth, (user) => {
  if (!user) { location.replace('index.html'); return; }
  me = user;
  const name = user.displayName || user.email;
  if ($('uname')) $('uname').textContent = name;
  if ($('av')) $('av').textContent = name.charAt(0).toUpperCase();

  // Strictly check email against AUTHORIZED_MENTOR_EMAIL (ignores stale localStorage)
  const currentEmail = (user.email || "").toLowerCase().trim();
  isOrganizer = (currentEmail === AUTHORIZED_MENTOR_EMAIL.toLowerCase().trim());

  const addBtn = $('addBtn');
  const modal = $('modal');

  if (!isOrganizer) {
    // Student view: completely remove Create Event UI & customize subtitle
    if (addBtn) addBtn.remove();
    if (modal) modal.remove();
    const subtitle = document.querySelector('header p, .subtitle, .lead');
    if (subtitle) {
      subtitle.textContent = "Explore upcoming campus events, view full details, and reserve your spot.";
    }
  } else {
    // Mentor/Admin view: keep original create event button
    if (addBtn) addBtn.hidden = false;
  }

  startListeners();
});

$('logout')?.addEventListener('click', async () => {
  try { await signOut(auth); } catch (e) {}
  try { localStorage.removeItem('campushub_user'); } catch (e) {}
  location.href = 'index.html';
});

// ---------- live data ----------
function onError(err) {
  console.error("Events load error:", err);
  $('list').innerHTML = '<p class="empty">Couldn’t load events. Check that your Firestore rules are published and that you signed in with your college email.</p>';
}

function startListeners() {
  if (started) return;
  started = true;

  onSnapshot(query(collection(db, 'events'), orderBy('date')), (snap) => {
    events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    events.forEach((ev) => {
      if (!rsvpUnsubs[ev.id]) {
        rsvpUnsubs[ev.id] = onSnapshot(collection(db, 'events', ev.id, 'rsvps'), (rSnap) => {
          rsvps[ev.id] = rSnap.docs.map((rd) => ({ uid: rd.id, ...rd.data() }));
          render();
        }, (err) => console.warn("RSVP read warning:", err));
      }
    });

    render();
  }, onError);
}

// ---------- rendering ----------
function card(e, today) {
  const going = rsvps[e.id] || [];
  const mine = going.some((g) => g.uid === me.uid);
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

  const canDelete = isOrganizer && e.createdBy === me.uid;
  const when = [fmtTime(e.time), e.location].filter(Boolean).join(' · ');

  let att = '';
  if (openLists.has(e.id)) {
    att = '<div class="att">' + (going.length ? going.map((g) =>
      '<div><span class="av grad">' + esc((g.name || '?').charAt(0).toUpperCase()) + '</span><span>' + esc(g.name) +
      (isOrganizer ? ' <small>' + esc(g.email) + '</small>' : '') + '</span></div>').join('')
      : '<span class="meta">No RSVPs yet. Be the first!</span>') + '</div>';
  }

  // Dedicated Event Details page link for students
  const detailsLink = !isOrganizer
    ? '<a class="linkbtn" href="event-details.html?id=' + encodeURIComponent(e.id) + '" style="text-decoration:none;">Event Details</a>'
    : '';

  return '<article class="card"><div class="row">' +
    '<div class="date grad"><div>' + p.day + '<small>' + p.month + '</small></div></div>' +
    '<div class="info"><span class="club">' + esc(e.club || 'General') + '</span>' +
    '<h3>' + esc(e.title) + '</h3><div class="meta">' + esc(when) + '</div>' +
    (e.description ? '<p class="desc">' + esc(e.description) + '</p>' : '') + '</div></div>' +
    (cap > 0 ? '<div class="meter"><i class="grad" style="width:' + pct + '%"></i></div>' : '') +
    '<div class="foot"><div class="count">' + going.length + ' going' +
    (cap > 0 ? ' <span>/ ' + cap + ' spots</span>' : '') + '</div>' +
    '<div class="acts">' +
    detailsLink +
    '<button class="linkbtn" data-att="' + e.id + '">' + (openLists.has(e.id) ? 'Hide attendees' : 'View attendees') + '</button>' +
    (canDelete ? '<button class="btn ghost" data-del="' + e.id + '">Delete</button>' : '') + rsvpBtn + '</div></div>' + att + '</article>';
}

function render() {
  if (!me) return;
  const today = todayStr();
  const key = (e) => e.date + ' ' + (e.time || '');
  let list = events.slice();
  if (filter === 'upcoming') list = list.filter((e) => e.date >= today).sort((a, b) => key(a) < key(b) ? -1 : 1);
  else if (filter === 'past') list = list.filter((e) => e.date < today).sort((a, b) => key(a) < key(b) ? 1 : -1);
  else list = list.filter((e) => (rsvps[e.id] || []).some((g) => g.uid === me.uid)).sort((a, b) => key(a) < key(b) ? -1 : 1);

  const empty = { upcoming: 'No upcoming events yet.', past: 'No past events.', mine: 'You haven’t RSVP’d to any events yet.' };
  $('list').innerHTML = list.length ? list.map((e) => card(e, today)).join('') : '<p class="empty">' + empty[filter] + '</p>';
}

// ---------- actions ----------
$('filters')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  render();
});

$('list')?.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.att) {
    const id = b.dataset.att;
    if (openLists.has(id)) openLists.delete(id); else openLists.add(id);
    render();
  } else if (b.dataset.rsvp) {
    toggleRsvp(b.dataset.rsvp);
  } else if (b.dataset.del) {
    if (!window.confirm('Delete this event?')) return;
    try { await deleteDoc(doc(db, 'events', b.dataset.del)); toast('Event deleted'); }
    catch (e) { toast('Could not delete the event.'); }
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

// ---------- post event (mentors only) ----------
const modal = $('modal'), form = $('eform');
const addBtn = $('addBtn');

if (addBtn) {
  addBtn.addEventListener('click', () => {
    if (!isOrganizer) return;
    form.reset();
    form.elements.date.min = todayStr();
    modal.hidden = false;
    form.elements.title.focus();
  });
}

function closeModal() { if (modal) modal.hidden = true; }
if (modal) {
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal && !modal.hidden) closeModal(); });

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isOrganizer) return;
    const f = form.elements;
    const data = {
      title: f.title.value.trim(),
      club: f.club.value.trim() || 'General',
      date: f.date.value,
      time: f.time.value,
      location: f.location.value.trim(),
      capacity: parseInt(f.capacity.value, 10) || 0,
      description: f.desc.value.trim(),
      createdBy: me.uid,
      createdByName: me.displayName || me.email,
      createdAt: serverTimestamp()
    };
    if (!data.title || !data.date || !data.location) return;
    try {
      await addDoc(collection(db, 'events'), data);
      closeModal();
      toast('Event posted');
    } catch (err) {
      console.error(err);
      toast('Could not post the event. Check permissions.');
    }
  });
} 