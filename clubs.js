import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// Firebase setup
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Current logged-in student
let currentUser = null;

// Icons
const P = {
  cap:'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5',
  home:'M3 11l9-8 9 8M5 10v10h14V10',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  calendar:'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  trophy:'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 3M17 6h4v2a4 4 0 0 1-4 3',
  settings:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12h2M3 12h2M12 3v2M12 19v2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21h4',
  down:'M6 9l6 6 6-6',
  right:'M9 6l6 6-6 6',
  arrow:'M5 12h14M13 6l6 6-6 6',
  code:'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  palette:'M12 3a9 9 0 1 0 0 18c1.6 0 2-1 1.5-2s0-2 1.5-2h2a4 4 0 0 0 4-4c0-5-4.5-10-9-10zM7.5 11h.01M10 7.5h.01M14 7.5h.01',
  ball:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8l4 3-1.5 4.5h-5L8 11zM12 3v5M16 11l5-1M14.5 15.5L17 20M9.5 15.5L7 20M8 11L3 10',
  book:'M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z',
  leaf:'M5 19C5 9 11 4 20 4c0 9-5 15-15 15zM5 19l7-7',
  music:'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  filter:'M4 6h16M7 12h10M10 18h4',
  chart:'M5 21V10M12 21V4M19 21v-7',
  award:'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12M8.5 14L7 22l5-3 5 3-1.5-8',
  menu:'M4 6h16M4 12h16M4 18h16'
};

const I = (n, s = 20) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]:not([data-done])').forEach(el => {
    el.insertAdjacentHTML('afterbegin', I(el.dataset.icon, +el.dataset.size || 20));
    el.dataset.done = 1;
  });
}

/* ---------- Club Data ---------- */

const CLUBS = [
  { id:'techcore', name:'TechCore', cat:'Technical', icon:'code', theme:'blue', members:123, desc:'A club for tech enthusiasts to learn, build and innovate together.' },
  { id:'art', name:'Art & Culture Club', cat:'Cultural', icon:'palette', theme:'purple', members:97, desc:'Express. Create. Celebrate. Join us for art, music, and dance.' },
  { id:'sports', name:'Sports Club', cat:'Sports', icon:'ball', theme:'green', members:151, desc:'Play. Compete. Grow. Tournaments and fitness sessions.' },
  { id:'literary', name:'Literary Club', cat:'Literary', icon:'book', theme:'orange', members:76, desc:'For dreamers, writers, and thinkers. Debates and book discussions.' },
  { id:'impact', name:'Social Impact Club', cat:'Social', icon:'users', theme:'pink', members:65, desc:'Small steps. Big change. Volunteer and make a difference.' },
  { id:'environment', name:'Environment Club', cat:'Social', icon:'leaf', theme:'teal', members:54, desc:'For a greener tomorrow and a sustainable planet.' }
];

/* ---------- State ---------- */

const state = {
  cat: 'All',
  q: '',
  mine: false,
  sort: 0,
  joined: new Set()
};

const SORTS = ['default', 'most members', 'name A–Z'];
const $ = s => document.querySelector(s);
const busyClubs = new Set();
const members = c => c.members + (state.joined.has(c.id) ? 1 : 0);

/* ---------- Firestore Functions ---------- */

async function loadJoinedClubs(uid) {
  const clubsRef = collection(db, "users", uid, "joinedClubs");
  const snapshot = await getDocs(clubsRef);
  state.joined = new Set(snapshot.docs.map(document => document.id));
}

/* ---------- Render ---------- */

function visibleClubs() {
  const q = state.q.trim().toLowerCase();
  let list = CLUBS.filter(c =>
    (state.cat === 'All' || c.cat === state.cat) &&
    (!state.mine || state.joined.has(c.id)) &&
    (!q || (c.name + ' ' + c.cat + ' ' + c.desc).toLowerCase().includes(q))
  );

  if (state.sort === 1) list = [...list].sort((a, b) => members(b) - members(a));
  if (state.sort === 2) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderGrid() {
  const list = visibleClubs();

  $('#grid').innerHTML = list.length
    ? list.map(c => {
        const on = state.joined.has(c.id);
        return `
          <article class="card ${c.theme}" id="club-${c.id}" data-id="${c.id}">
            <button class="kebab" aria-label="More options for ${c.name}" aria-haspopup="true">&#8942;</button>
            <span class="ico">${I(c.icon, 32)}</span>
            <h3>${c.name}</h3>
            <span class="tag">${c.cat}</span>
            <p>${c.desc}</p>
            <div class="foot">
              <span class="members">${I('users', 18)} ${members(c)} Members</span>
              <button class="btn join ${on ? 'joined' : ''}" onclick="location.href='club-details.html?id=${c.id}'">
                ${on ? '✓ Member' : 'View & Request ' + I('arrow', 16)}
              </button>
            </div>
          </article>
        `;
      }).join('')
    : `<div class="empty">No clubs match your search. Try another keyword or category.</div>`;
}

function renderSide() {
  const mine = CLUBS.filter(c => state.joined.has(c.id));
  $('#myClubs').innerHTML = mine.length
    ? mine.map(c => `
        <li>
          <button data-go="${c.id}" class="${c.theme}">
            <span class="ico">${I(c.icon, 22)}</span>
            <span><b>${c.name}</b><small>Member</small></span>
            <span class="go">${I('right', 18)}</span>
          </button>
        </li>
      `).join('')
    : `<li class="my-empty">You haven't joined any clubs yet. Pick one from the list.</li>`;

  $('#stJoined').textContent = mine.length;
  $('#stTotal').textContent = CLUBS.length;
  $('#stEvents').textContent = '12';
  $('#stCerts').textContent = '2';
}

function render() {
  renderGrid();
  renderSide();
  paintIcons();
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 2200);
}

/* ---------- Filters & Events ---------- */

function setCat(cat) {
  state.cat = cat;
  state.mine = false;
  document.querySelectorAll('.chip').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  renderGrid();
  paintIcons();
}

function closeMenus() {
  document.querySelectorAll('.menu').forEach(m => m.remove());
}

$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (b) setCat(b.dataset.cat);
});

function onSearch(v) {
  state.q = v;
  $('#clubSearch').value = v;
  $('#globalSearch').value = v;
  renderGrid();
  paintIcons();
}

$('#clubSearch').addEventListener('input', e => onSearch(e.target.value));
$('#globalSearch').addEventListener('input', e => onSearch(e.target.value));

$('#sortBtn').addEventListener('click', e => {
  state.sort = (state.sort + 1) % SORTS.length;
  e.currentTarget.title = 'Sort: ' + SORTS[state.sort];
  toast('Sorted by ' + SORTS[state.sort]);
  renderGrid();
  paintIcons();
});

$('#grid').addEventListener('click', async e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;

  if (e.target.closest('.kebab')) {
    const had = card.querySelector('.menu');
    closeMenus();
    if (had) return;
    const on = state.joined.has(id);
    card.insertAdjacentHTML('beforeend',
      `<div class="menu" role="menu">
        <button data-a="open">View details</button>
        <button data-a="share">Copy link</button>
      </div>`
    );
    e.stopPropagation();
    return;
  }

  const action = e.target.closest('[data-a]')?.dataset.a;
  if (action === 'open') location.href = `club-details.html?id=${id}`;
  if (action === 'share') {
    const url = `${location.origin}${location.pathname}#club-${id}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('Link copied')).catch(() => toast('Could not copy link'));
    }
  }
  closeMenus();
});

document.addEventListener('click', e => { if (!e.target.closest('.kebab')) closeMenus(); });

/* ---------- Firebase Authentication ---------- */

paintIcons();

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace('index.html');
    return;
  }
  currentUser = user;
  const name = user.displayName || 'Student';
  $('#userName').textContent = name;
  $('#avatar').textContent = name.charAt(0).toUpperCase();

  try {
    await loadJoinedClubs(user.uid);
    render();
  } catch (error) {
    console.error('Unable to load club memberships:', error);
    toast('Unable to load your clubs.');
  }
});