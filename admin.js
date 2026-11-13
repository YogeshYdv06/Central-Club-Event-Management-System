// Admin panel: only people listed in the "organizers" collection can use it.
import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, collectionGroup, doc, getDoc, addDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
 
const $ = (id) => document.getElementById(id);
const THEME_KEY = 'campushub_theme';
const root = document.documentElement;
 
let me = null;
let events = [];
let rsvps = {};
let filter = 'upcoming';
let started = false;
let editingId = null;
const openLists = new Set();
 
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
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
 
// theme
try { const t = localStorage.getItem(THEME_KEY); if (t) root.dataset.theme = t; } catch (e) {}
$('theme').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, root.dataset.theme); } catch (e) {}
});
 
// auth + admin check
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  me = user;
  const name = user.displayName || user.email;
  $('uname').textContent = name;
  $('av').textContent = name.charAt(0).toUpperCase();
 
  let isAdmin = false;
  try { isAdmin = (await getDoc(doc(db, 'organizers', user.email.toLowerCase()))).exists(); } catch (e) {}
  if (!isAdmin) {
    $('list').innerHTML = '<div class="denied"><p>This page is only for admins.</p><p><a href="events.html">Go to the events page</a></p></div>';
    setTimeout(() => location.replace('events.html'), 2500);
    return;
  }
  $('addBtn').hidden = false;
  $('stats').hidden = false;
  $('filters').hidden = false;
  startListeners();
});
 
$('logout').addEventListener('click', async () => {
  try { await signOut(auth); } catch (e) {}
  try { localStorage.removeItem('campushub_user'); } catch (e) {}
  location.href = 'index.html';
});
 
// live data
function onError(err) {
  console.error(err);
  $('list').innerHTML = '<p class="empty">Couldn’t load events. Check your Firestore rules.</p>';
}
function startListeners() {
  if (started) return;
  started = true;
  onSnapshot(query(collection(db, 'events'), orderBy('date')), (snap) => {
    events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, onError);
  onSnapshot(collectionGroup(db, 'rsvps'), (snap) => {
    const map = {};
    snap.forEach((d) => {
      const eid = d.ref.parent.parent.id;
      (map[eid] = map[eid] || []).push({ uid: d.id, ...d.data() });
    });
    rsvps = map;
    render();
  }, onError);
}
 
// rendering
function card(e) {
  const going = rsvps[e.id] || [];
  const cap = e.capacity || 0;
  const pct = cap > 0 ? Math.min(100, Math.round(going.length / cap * 100)) : 0;
  const p = parts(e.date);
  const own = e.createdBy === me.uid;
  const when = [fmtTime(e.time), e.location].filter(Boolean).join(' · ');
 
  let att = '';
  if (openLists.has(e.id)) {
    att = '<div class="att">' + (going.length ? going.map((g) =>
      '<div><span class="av grad">' + esc((g.name || '?').charAt(0).toUpperCase()) + '</span><span>' + esc(g.name) +
      ' <small>' + esc(g.email) + '</small></span></div>').join('')
      : '<span class="meta">No RSVPs yet.</span>') + '</div>';
  }
 
  return '<article class="card"><div class="row">' +
    '<div class="date grad"><div>' + p.day + '<small>' + p.month + '</small></div></div>' +
    '<div class="info"><span class="club">' + esc(e.club || 'General') + '</span>' +
    '<h3>' + esc(e.title) + '</h3><div class="meta">' + esc(when) + '</div>' +
    (e.description ? '<p class="desc">' + esc(e.description) + '</p>' : '') +
    '<div class="by">Posted by ' + esc(e.createdByName || 'an admin') + '</div></div></div>' +
    (cap > 0 ? '<div class="meter"><i class="grad" style="width:' + pct + '%"></i></div>' : '') +
    '<div class="foot"><div class="count">' + going.length + ' going' + (cap > 0 ? ' <span>/ ' + cap + ' spots</span>' : '') + '</div>' +
    '<div class="acts"><button class="linkbtn" data-att="' + e.id + '">' + (openLists.has(e.id) ? 'Hide attendees' : 'View attendees') + '</button>' +
    (going.length ? '<button class="btn ghost sm" data-csv="' + e.id + '">Download CSV</button>' : '') +
    (own ? '<button class="btn ghost sm" data-edit="' + e.id + '">Edit</button><button class="btn ghost sm" data-del="' + e.id + '">Delete</button>' : '') +
    '</div></div>' + att + '</article>';
}
 
function render() {
  if (!me) return;
  const today = todayStr();
  const key = (e) => e.date + ' ' + (e.time || '');
 
  $('sEvents').textContent = events.length;
  $('sUpcoming').textContent = events.filter((e) => e.date >= today).length;
  $('sRsvps').textContent = events.reduce((s, e) => s + (rsvps[e.id] || []).length, 0);
 
  let list = events.slice();
  if (filter === 'upcoming') list = list.filter((e) => e.date >= today).sort((a, b) => key(a) < key(b) ? -1 : 1);
  else if (filter === 'past') list = list.filter((e) => e.date < today).sort((a, b) => key(a) < key(b) ? 1 : -1);
  else list.sort((a, b) => key(a) < key(b) ? -1 : 1);
 
  const empty = { upcoming: 'No upcoming events. Click “+ Post event” to create one.', past: 'No past events.', all: 'No events yet.' };
  $('list').innerHTML = list.length ? list.map(card).join('') : '<p class="empty">' + empty[filter] + '</p>';
}
 
// CSV download of the attendee list
function downloadCsv(id) {
  const e = events.find((x) => x.id === id);
  if (!e) return;
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Name', 'Email', 'RSVP time']].concat((rsvps[id] || []).map((g) => [
    g.name, g.email,
    g.createdAt && g.createdAt.toDate ? g.createdAt.toDate().toLocaleString('en-IN') : ''
  ]));
  const csv = rows.map((r) => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = (e.title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-attendees.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
 
// actions
$('filters').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  render();
});
 
$('list').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.att) {
    const id = b.dataset.att;
    if (openLists.has(id)) openLists.delete(id); else openLists.add(id);
    render();
  } else if (b.dataset.csv) {
    downloadCsv(b.dataset.csv);
  } else if (b.dataset.edit) {
    openModal(b.dataset.edit);
  } else if (b.dataset.del) {
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    try { await deleteDoc(doc(db, 'events', b.dataset.del)); toast('Event deleted'); }
    catch (e) { console.error(e); toast('Could not delete the event.'); }
  }
});
 
// post / edit form
const modal = $('modal'), form = $('eform');
function openModal(id) {
  editingId = id || null;
  form.reset();
  form.elements.date.min = '';
  if (editingId) {
    const e = events.find((x) => x.id === editingId);
    if (!e) return;
    $('mtitle').textContent = 'Edit event';
    $('saveBtn').textContent = 'Save changes';
    const f = form.elements;
    f.title.value = e.title || '';
    f.club.value = e.club || '';
    f.date.value = e.date || '';
    f.time.value = e.time || '';
    f.location.value = e.location || '';
    f.capacity.value = e.capacity || 0;
    f.desc.value = e.description || '';
  } else {
    $('mtitle').textContent = 'Post an event';
    $('saveBtn').textContent = 'Post event';
    form.elements.date.min = todayStr();
  }
  modal.hidden = false;
  form.elements.title.focus();
}
function closeModal() { modal.hidden = true; editingId = null; }
$('addBtn').addEventListener('click', () => openModal(null));
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
 
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const data = {
    title: f.title.value.trim(),
    club: f.club.value.trim() || 'General',
    date: f.date.value,
    time: f.time.value,
    location: f.location.value.trim(),
    capacity: parseInt(f.capacity.value, 10) || 0,
    description: f.desc.value.trim()
  };
  if (!data.title || !data.date || !data.location) return;
  try {
    if (editingId) {
      await updateDoc(doc(db, 'events', editingId), data);
      toast('Event updated');
    } else {
      await addDoc(collection(db, 'events'), {
        ...data,
        createdBy: me.uid,
        createdByName: me.displayName || me.email,
        createdAt: serverTimestamp()
      });
      toast('Event posted');
    }
    closeModal();
  } catch (err) {
    console.error(err);
    toast('Could not save the event. Are you an admin?');
  }
});

// --- Manage Existing Clubs Extensions ---

const manageClubsBtn = $('manageClubsBtn');
const manageClubsContainer = $('manageClubsContainer');

if (manageClubsBtn) {
  manageClubsBtn.addEventListener('click', async () => {
    const isHidden = manageClubsContainer.style.display === 'none';
    manageClubsContainer.style.display = isHidden ? 'block' : 'none';
    if (isHidden) await loadAdminClubsList();
  });
}

async function loadAdminClubsList() {
  const listEl = $('adminClubsList');
  if (!listEl) return;

  listEl.innerHTML = `<p style="color: #cbd5e1; padding: 10px;">Loading clubs...</p>`;

  try {
    const snap = await getDocs(collection(db, "clubs"));
    if (snap.empty) {
      listEl.innerHTML = `<p style="color: #94a3b8; padding: 10px;">No clubs created yet in Firestore database.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs.map(d => {
      const club = d.data();
      const clubName = club.name || club.title || 'Unnamed Club';
      const clubDesc = club.desc || club.description || 'No description provided';
      const clubCat = club.cat || club.category || 'General';

      return `
        <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <h4 style="margin: 0 0 4px 0; color: #818cf8; font-size: 16px;">${esc(clubName)} <span style="font-size: 11px; background: rgba(129,140,248,0.15); color: #818cf8; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${esc(clubCat)}</span></h4>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">${esc(clubDesc)}</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="window.editClubPrompt('${d.id}', '${esc(clubName)}', '${esc(clubDesc)}')" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">Edit</button>
            <button onclick="window.deleteClub('${d.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error("Error loading clubs:", error);
    listEl.innerHTML = `<p style="color: #ef4444; padding: 10px;">Failed to load clubs. Check Firestore rules or collection name.</p>`;
  }
}

window.editClubPrompt = async function(clubId, currentName, currentDesc) {
  const newName = prompt("Edit Club Name:", currentName);
  if (newName === null) return;
  const newDesc = prompt("Edit Club Description:", currentDesc);
  if (newDesc === null) return;

  try {
    await updateDoc(doc(db, "clubs", clubId), {
      name: newName.trim(),
      desc: newDesc.trim()
    });
    toast("Club updated successfully!");
    await loadAdminClubsList();
  } catch (error) {
    console.error("Error updating club:", error);
    toast("Failed to update club.");
  }
};

window.deleteClub = async function(clubId) {
  if (!window.confirm("Are you sure you want to delete this club? This action cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "clubs", clubId));
    toast("Club deleted successfully.");
    await loadAdminClubsList();
  } catch (error) {
    console.error("Error deleting club:", error);
    toast("Failed to delete club. Check permissions.");
  }
};