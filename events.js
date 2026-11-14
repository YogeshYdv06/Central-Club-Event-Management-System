// Student events page: browse events, view details, RSVP (live updates).
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, doc, setDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  USER_KEY,
  esc,
  todayStr,
  parts,
  fmtTime,
  initThemeToggle,
  showToast
} from "./utils.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");

let me = null;
let events = [];
let rsvps = {};
let eventsUnsub = null;
let rsvpUnsubs = {};
let filter = "upcoming";
const openLists = new Set();
const inFlightRsvps = new Set();
let loadNoticeTimer = null;

initThemeToggle("theme");

function cleanupListeners() {
  clearTimeout(loadNoticeTimer);
  if (eventsUnsub) {
    try { eventsUnsub(); } catch { /* ignore */ }
    eventsUnsub = null;
  }
  Object.values(rsvpUnsubs).forEach((unsub) => {
    try { unsub(); } catch { /* ignore */ }
  });
  rsvpUnsubs = {};
}

// ---------- auth ----------
onAuthStateChanged(auth, async (user) => {
  cleanupListeners();

  if (!user) {
    window.location.replace("index.html");
    return;
  }
  me = user;

  const name = user.displayName || user.email || "Student";
  if ($("uname")) $("uname").textContent = name;
  if ($("av")) $("av").textContent = name.charAt(0).toUpperCase();

  const isAdmin = await checkIsAdmin(user);
  if ($("adminLink")) $("adminLink").hidden = !isAdmin;

  startListeners();
});

$("logout")?.addEventListener("click", async () => {
  cleanupListeners();
  try { await signOut(auth); } catch { /* ignore */ }
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  window.location.replace("index.html");
});

// ---------- live data ----------
function onError(err) {
  console.error("Events load error:", err);
  clearTimeout(loadNoticeTimer);
  const listEl = $("list");
  if (listEl) {
    listEl.innerHTML =
      '<p class="empty">Couldn’t load events. Check your Firestore rules or internet connection.</p>';
  }
}

function startListeners() {
  loadNoticeTimer = setTimeout(() => {
    const listEl = $("list");
    if (listEl && listEl.textContent.includes("Loading events")) {
      listEl.innerHTML =
        '<p class="empty">Still connecting to Firestore… Please check your internet connection if this persists.</p>';
    }
  }, 15000);

  const eventsQuery = query(collection(db, "events"), orderBy("date"));

  eventsUnsub = onSnapshot(
    eventsQuery,
    (snap) => {
      clearTimeout(loadNoticeTimer);
      events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const ids = new Set(events.map((e) => e.id));

      events.forEach((ev) => {
        if (!rsvpUnsubs[ev.id]) {
          rsvpUnsubs[ev.id] = onSnapshot(
            collection(db, "events", ev.id, "rsvps"),
            (rSnap) => {
              rsvps[ev.id] = rSnap.docs.map((rd) => ({ uid: rd.id, ...rd.data() }));
              render();
            },
            (err) => console.warn("RSVP read warning:", err)
          );
        }
      });

      Object.keys(rsvpUnsubs).forEach((id) => {
        if (!ids.has(id)) {
          rsvpUnsubs[id]();
          delete rsvpUnsubs[id];
          delete rsvps[id];
        }
      });

      render();
    },
    onError
  );
}

// ---------- rendering ----------
function card(e, today) {
  const going = rsvps[e.id] || [];
  const mine = going.some((g) => g.uid === me?.uid);
  const past = (e.date || "") < today;
  const cap = Number(e.capacity) || 0;
  const full = cap > 0 && going.length >= cap && !mine;
  const busy = inFlightRsvps.has(e.id);
  const p = parts(e.date);
  const pct = cap > 0 ? Math.min(100, Math.round((going.length / cap) * 100)) : 0;

  let rsvpBtn;
  if (past) {
    rsvpBtn = '<button class="btn ghost" type="button" disabled>Event ended</button>';
  } else if (mine) {
    rsvpBtn = `<button class="btn on" type="button" data-rsvp="${esc(e.id)}" ${busy ? "disabled" : ""}>✓ Going · Cancel</button>`;
  } else if (full) {
    rsvpBtn = '<button class="btn ghost" type="button" disabled>Full</button>';
  } else {
    rsvpBtn = `<button class="btn" type="button" data-rsvp="${esc(e.id)}" ${busy ? "disabled" : ""}>RSVP</button>`;
  }

  const when = [fmtTime(e.time), e.location].filter(Boolean).join(" · ");

  let att = "";
  if (openLists.has(e.id)) {
    att =
      '<div class="att">' +
      (going.length
        ? going
            .map(
              (g) =>
                `<div><span class="av grad">${esc((g.name || "?").charAt(0).toUpperCase())}</span><span>${esc(g.name || "Student")}</span></div>`
            )
            .join("")
        : '<span class="meta">No RSVPs yet. Be the first!</span>') +
      "</div>";
  }

  const detailsLink = `<a class="linkbtn" href="event-details.html?id=${encodeURIComponent(e.id)}">Event Details</a>`;

  return (
    `<article class="card"><div class="row">` +
    `<div class="date grad"><div>${esc(p.day)}<small>${esc(p.month)}</small></div></div>` +
    `<div class="info"><span class="club">${esc(e.club || "General")}</span>` +
    `<h3>${esc(e.title)}</h3><div class="meta">${esc(when)}</div>` +
    (e.description ? `<p class="desc">${esc(e.description)}</p>` : "") +
    `</div></div>` +
    (cap > 0 ? `<div class="meter"><i class="grad" style="width:${pct}%"></i></div>` : "") +
    `<div class="foot"><div class="count">${going.length} going` +
    (cap > 0 ? ` <span>/ ${cap} spots</span>` : "") +
    `</div><div class="acts">${detailsLink}` +
    `<button class="linkbtn" type="button" data-att="${esc(e.id)}">${openLists.has(e.id) ? "Hide attendees" : "View attendees"}</button>` +
    `${rsvpBtn}</div></div>${att}</article>`
  );
}

function render() {
  if (!me) return;
  const listEl = $("list");
  if (!listEl) return;

  const today = todayStr();
  const key = (e) => (e.date || "") + " " + (e.time || "");
  let list = events.slice();
  if (filter === "upcoming") {
    list = list.filter((e) => (e.date || "") >= today).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  } else if (filter === "past") {
    list = list.filter((e) => (e.date || "") < today).sort((a, b) => (key(a) < key(b) ? 1 : -1));
  } else {
    list = list
      .filter((e) => (rsvps[e.id] || []).some((g) => g.uid === me.uid))
      .sort((a, b) => (key(a) < key(b) ? -1 : 1));
  }

  const empty = {
    upcoming: "No upcoming events yet.",
    past: "No past events.",
    mine: "You haven’t RSVP’d to any events yet."
  };
  listEl.innerHTML = list.length
    ? list.map((e) => card(e, today)).join("")
    : `<p class="empty">${empty[filter]}</p>`;
}

// ---------- actions ----------
$("filters")?.addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip");
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
  render();
});

$("list")?.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.att) {
    const id = b.dataset.att;
    if (openLists.has(id)) openLists.delete(id);
    else openLists.add(id);
    render();
  } else if (b.dataset.rsvp) {
    toggleRsvp(b.dataset.rsvp, b);
  }
});

async function toggleRsvp(id, btn) {
  if (!me || inFlightRsvps.has(id)) return;

  const eventObj = events.find((e) => e.id === id);
  const currentGoing = rsvps[id] || [];
  const going = currentGoing.some((g) => g.uid === me.uid);
  const cap = Number(eventObj?.capacity) || 0;

  if (!going && cap > 0 && currentGoing.length >= cap) {
    showToast(toastEl, "This event is already full.");
    return;
  }

  const ref = doc(db, "events", id, "rsvps", me.uid);
  inFlightRsvps.add(id);
  if (btn) btn.disabled = true;

  try {
    if (going) {
      await deleteDoc(ref);
      showToast(toastEl, "RSVP cancelled");
    } else {
      await setDoc(ref, {
        name: me.displayName || me.email,
        email: me.email,
        photo: me.photoURL || "",
        createdAt: serverTimestamp()
      });
      showToast(toastEl, "You’re going!");
    }
  } catch (e) {
    console.error(e);
    showToast(toastEl, "Could not update your RSVP. Try again.");
  } finally {
    inFlightRsvps.delete(id);
    if (btn && btn.isConnected) btn.disabled = false;
  }
}
