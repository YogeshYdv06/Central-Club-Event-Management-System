// CampusConnect events page.
//
// Students get the dashboard-style events page (hero, category filters, event
// cards, upcoming rail). Admins keep the classic event directory and now do all
// event management right here — post, edit, delete, attendees and CSV — so the
// old admin panel is no longer needed.
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { loadStudentProfiles, findProfile, yearLabel } from "./student-lookup.js";
import {
  USER_KEY,
  esc,
  todayStr,
  parts,
  fmtTime,
  initThemeToggle,
  refreshIcons,
  showToast,
  sanitizeCsvCell
} from "./utils.js";
import {
  eventCardHTML,
  upcomingItemHTML,
  categoryTileHTML,
  eventCategory,
  catMeta,
  FILTER_CATEGORIES
} from "./events-ui.js";
import {
  DEMO_EVENTS,
  DEMO_RSVP_COUNTS,
  DEMO_MY_RSVP_IDS
} from "./demo-data.js";
import { demoRole, demoRoleFromUrl, setDemoRole, clearDemoRole } from "./demo-session.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
const toast = (msg, ms) => showToast(toastEl, msg, ms);

/* ---------- preview mode ---------- */
// ?demo=1[&role=admin] starts a preview; the role is remembered in localStorage
// so navigating around inside the preview keeps working without the query string.
const URL_DEMO_ROLE = demoRoleFromUrl();

/* ---------- state ---------- */
let me = null;
let isAdmin = false;
let demoMode = false;
let events = [];
let rsvps = {}; // eventId -> [{ uid, name, email, rollNo, year, branch }]
let profiles = { byUid: new Map(), byEmail: new Map() };
let profilesLoaded = false;
let eventsUnsub = null;
let adminRsvpUnsub = null;
let rsvpUnsubs = {};
let studentCat = "all"; // student: category filter
let adminFilter = "upcoming"; // admin: upcoming | mine | past | all
let searchQuery = "";
let sortMode = 0; // 0: soonest first, 1: most going
let editingId = null;
let loadNoticeTimer = null;
const openLists = new Set();
const inFlightRsvps = new Set();

/* ---------- boot ---------- */
let booted = false;
let previewBooted = false;

// If Firebase auth cannot answer (blocked SDK, preview iframe), still show the
// preview when a preview session is active.
const previewFallback = setTimeout(() => {
  if (booted) return;
  const role = demoRole();
  if (!role) return;
  booted = true;
  previewBooted = true;
  startPreview(role === "admin");
}, 3500);

onAuthStateChanged(auth, async (user) => {
  if (booted && !previewBooted) return; // real boot already handled
  const wasPreview = previewBooted;
  if (wasPreview && !user) return; // preview is already on screen
  booted = true;
  previewBooted = false;
  clearTimeout(previewFallback);
  cleanupListeners();

  if (!user) {
    const role = URL_DEMO_ROLE || demoRole();
    if (role) {
      startPreview(role === "admin");
      return;
    }
    window.location.replace("index.html");
    return;
  }

  // A real signed-in user always takes precedence over a leftover preview session.
  clearDemoRole();
  me = user;

  let name = user.displayName || user.email || "Student";
  isAdmin = await checkIsAdmin(user);
  if (wasPreview) await resetPreview();

  const profile = await ensureStudentProfile(user, { isAdmin });
  if (profile && profile.name) name = profile.name;

  if (isAdmin) {
    paintAdminHeader(name);
    await enterAdminView();
  } else {
    paintStudentHeader(name, user.photoURL);
    await enterStudentView();
  }

  if ($("authLoading")) $("authLoading").hidden = true;
  refreshIcons();

  startListeners();
});

function startPreview(adminRole) {
  demoMode = true;
  isAdmin = adminRole;
  setDemoRole(adminRole ? "admin" : "student");
  me = { uid: "demo-user", email: "demo.student@mitsgwl.ac.in", displayName: "Yogesh Yadav" };
  events = DEMO_EVENTS.map((e) => ({ ...e }));

  showPreviewBar(adminRole ? "admin" : "student");
  guardPreviewLinks();

  (async () => {
    if (isAdmin) {
      paintAdminHeader("Yogesh Yadav", "Admin · preview");
      await enterAdminView();
    } else {
      paintStudentHeader("Yogesh Yadav", "");
      await enterStudentView();
    }
    if ($("authLoading")) $("authLoading").hidden = true;
    refreshIcons();
    isAdmin ? renderAdmin() : renderStudent();
  })();
}

/** Drops preview state when a real signed-in user takes over. */
async function resetPreview() {
  demoMode = false;
  events = [];
  openLists.clear();
  const bar = $("previewBar");
  if (bar) bar.hidden = true;
  if (isAdmin) {
    $("studentApp").hidden = true;
    await enterAdminView();
  } else {
    $("adminApp").hidden = true;
    await enterStudentView();
  }
}

/** Links to pages that need a real Firebase session show a hint in preview. */
function guardPreviewLinks() {
  document.addEventListener("click", (event) => {
    if (!demoMode) return;
    const link = event.target.closest(
      'a[href^="Dashboard.html"], a[href^="event-details"], a[href^="admin-students"], a[href^="students.html"]'
    );
    if (!link) return;
    event.preventDefault();
    toast("Preview mode — sign in to open this page.");
  });
}

document.addEventListener("click", (event) => {
  const exit = event.target.closest("[data-exit-demo]");
  if (!exit) return;
  event.preventDefault();
  clearDemoRole();
  window.location.href = "index.html";
});

function showPreviewBar(role) {
  const bar = $("previewBar");
  if (!bar) return;
  const other = role === "admin" ? "student" : "admin";
  bar.hidden = false;
  bar.innerHTML =
    `<span>Preview</span> · <b>${role === "admin" ? "Admin" : "Student"} view</b> · ` +
    `<a href="?demo=1&role=${other}">Switch to ${other} view</a> · ` +
    `<a href="index.html" data-exit-demo>Exit preview</a>`;
}

/* ---------- role-specific chrome ---------- */

function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[data-role-css="${href}"]`)) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.roleCss = href;
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

async function enterStudentView() {
  await loadCss("shell.css");
  await loadCss("student-events.css");
  document.body.style.background = "";
  document.body.style.color = "";
  document.body.style.fontFamily = "";
  $("studentApp").hidden = false;
}

async function enterAdminView() {
  await loadCss("events.css");
  await loadCss("admin.css");
  document.body.style.background = "";
  document.body.style.color = "";
  document.body.style.fontFamily = "";
  $("adminApp").hidden = false;
  initThemeToggle("theme");
}

function paintStudentHeader(name, photoURL) {
  const userNameEl = $("userName");
  const userRoleEl = $("userRole");
  const portalRoleEl = $("portalRole");
  const avatarEl = $("avatar");
  if (userNameEl) userNameEl.textContent = name;
  if (userRoleEl) userRoleEl.textContent = "Student";
  if (portalRoleEl) portalRoleEl.textContent = "Student Portal";
  if (avatarEl) {
    if (photoURL) avatarEl.innerHTML = `<img src="${esc(photoURL)}" alt="${esc(name)}">`;
    else avatarEl.textContent = String(name || "?").charAt(0).toUpperCase();
  }
}

function paintAdminHeader(name, roleLabel = "") {
  if ($("adminName")) $("adminName").textContent = roleLabel ? `${name} · ${roleLabel}` : name;
  if ($("adminAv")) $("adminAv").textContent = String(name || "A").charAt(0).toUpperCase();
}

/* ---------- live data ---------- */

function cleanupListeners() {
  clearTimeout(loadNoticeTimer);
  if (eventsUnsub) {
    try { eventsUnsub(); } catch { /* ignore */ }
    eventsUnsub = null;
  }
  if (adminRsvpUnsub) {
    try { adminRsvpUnsub(); } catch { /* ignore */ }
    adminRsvpUnsub = null;
  }
  Object.values(rsvpUnsubs).forEach((unsub) => {
    try { unsub(); } catch { /* ignore */ }
  });
  rsvpUnsubs = {};
}

function startListeners() {
  if (isAdmin) {
    // Admin: one live query for events + a collection-group read for every RSVP.
    eventsUnsub = onSnapshot(
      query(collection(db, "events"), orderBy("date")),
      (snap) => {
        events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderAdmin();
      },
      (err) => onError(err, "list")
    );

    adminRsvpUnsub = onSnapshot(
      collectionGroup(db, "rsvps"),
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const eid = d.ref.parent?.parent?.id;
          if (!eid) return;
          (map[eid] = map[eid] || []).push({ uid: d.id, ...d.data() });
        });
        rsvps = map;
        renderAdmin();
      },
      (err) => console.warn("RSVP read warning:", err)
    );
    return;
  }

  // Student: events plus a light RSVP listener per event.
  loadNoticeTimer = setTimeout(() => {
    const grid = $("evGrid");
    if (grid && grid.textContent.includes("Loading events")) {
      grid.innerHTML =
        '<p class="empty">Still connecting to Firestore… Check your internet connection if this persists.</p>';
    }
  }, 15000);

  eventsUnsub = onSnapshot(
    query(collection(db, "events"), orderBy("date")),
    (snap) => {
      clearTimeout(loadNoticeTimer);
      events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const ids = new Set(events.map((e) => e.id));
      events.forEach((ev) => {
        if (rsvpUnsubs[ev.id]) return;
        rsvpUnsubs[ev.id] = onSnapshot(
          collection(db, "events", ev.id, "rsvps"),
          (rSnap) => {
            rsvps[ev.id] = rSnap.docs.map((rd) => ({ uid: rd.id, ...rd.data() }));
            renderStudent();
          },
          (err) => console.warn("RSVP read warning:", err)
        );
      });

      Object.keys(rsvpUnsubs).forEach((id) => {
        if (ids.has(id)) return;
        try { rsvpUnsubs[id](); } catch { /* ignore */ }
        delete rsvpUnsubs[id];
        delete rsvps[id];
      });

      renderStudent();
    },
    (err) => onError(err, "evGrid")
  );
}

function onError(err, targetId) {
  console.error("Events load error:", err);
  clearTimeout(loadNoticeTimer);
  const el = $(targetId);
  if (!el) return;
  el.innerHTML =
    '<p class="empty">Couldn’t load events. Check your Firestore rules or internet connection.</p>';
}

/* ---------- shared helpers ---------- */

function goingFor(id) {
  if (demoMode) return DEMO_RSVP_COUNTS[id] || 0;
  return (rsvps[id] || []).length;
}

function isMine(id) {
  if (demoMode) return DEMO_MY_RSVP_IDS.includes(id);
  return (rsvps[id] || []).some((g) => g.uid === me?.uid);
}

function attendeesFor(id) {
  if (demoMode) {
    return [
      { uid: "d1", name: "Aarav Sharma", email: "aarav.sharma@mitsgwl.ac.in", rollNo: "0901CS221001", year: 3, branch: "CSE" },
      { uid: "d2", name: "Ishita Verma", email: "ishita.verma@mitsgwl.ac.in", rollNo: "0901CS221014", year: 3, branch: "CSE" },
      { uid: "d3", name: "Rohan Patel", email: "rohan.patel@mitsgwl.ac.in", rollNo: "0901IT221032", year: 2, branch: "IT" }
    ];
  }

  return (rsvps[id] || []).map((g) => {
    const p = findProfile(profiles, g.uid, g.email);
    return {
      uid: g.uid,
      name: p?.name || g.name || "Student",
      email: p?.email || g.email || "",
      rollNo: p?.rollNo || g.rollNo || "",
      year: p?.year || g.year || 0,
      branch: p?.branch || g.branch || "",
      createdAt: g.createdAt
    };
  });
}

async function ensureProfiles() {
  if (profilesLoaded || demoMode) return;
  profiles = await loadStudentProfiles();
  profilesLoaded = true;
}

/* ======================================================================
   STUDENT VIEW
   ====================================================================== */

function studentList() {
  const today = todayStr();
  let list = events.slice();

  if (studentCat !== "all") {
    list = list.filter((e) => eventCategory(e) === studentCat);
  }
  if (searchQuery) {
    list = list.filter((e) =>
      `${e.title || ""} ${e.club || ""} ${e.description || ""} ${e.location || ""}`
        .toLowerCase()
        .includes(searchQuery)
    );
  }

  const key = (e) => `${e.date || ""} ${e.time || ""}`;
  const upcoming = list
    .filter((e) => (e.date || "") >= today)
    .sort((a, b) => (key(a) < key(b) ? -1 : 1));
  const past = list
    .filter((e) => (e.date || "") < today)
    .sort((a, b) => (key(a) < key(b) ? 1 : -1));

  let ordered = [...upcoming, ...past];
  if (sortMode === 1) ordered = [...ordered].sort((a, b) => goingFor(b.id) - goingFor(a.id));
  return ordered;
}

function renderStudent() {
  if (!me || isAdmin) return;

  const grid = $("evGrid");
  if (!grid) return;

  const today = todayStr();
  const list = studentList();

  if (!list.length) {
    grid.innerHTML =
      '<p class="empty">No events match this filter yet. Try another category or clear the search.</p>';
    renderStudentRail();
    return;
  }

  grid.innerHTML = list
    .map((ev) =>
      eventCardHTML(ev, {
        going: goingFor(ev.id),
        capacity: ev.capacity,
        mine: isMine(ev.id),
        past: (ev.date || "") < today,
        busy: inFlightRsvps.has(ev.id)
      })
    )
    .join("");

  renderStudentRail();
  refreshIcons();
}

function renderStudentRail() {
  const today = todayStr();
  const upcoming = events
    .filter((e) => (e.date || "") >= today)
    .sort((a, b) => (`${a.date} ${a.time || ""}` < `${b.date} ${b.time || ""}` ? -1 : 1))
    .slice(0, 4);

  const railEl = $("evUpcoming");
  if (railEl) {
    railEl.innerHTML = upcoming.length
      ? upcoming.map(upcomingItemHTML).join("")
      : '<li class="ev-up-empty">No upcoming events right now.</li>';
  }

  const catsEl = $("evCats");
  if (catsEl) {
    const pool = events.filter((e) => (e.date || "") >= today);
    const tiles = [categoryTileHTML("all", pool.length, studentCat === "all")].concat(
      FILTER_CATEGORIES.map((key) =>
        categoryTileHTML(
          key,
          pool.filter((e) => eventCategory(e) === key).length,
          studentCat === key
        )
      )
    );
    catsEl.innerHTML = tiles.join("");
  }

  refreshIcons();
}

/* student interactions */
$("evChips")?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  studentCat = chip.dataset.cat || "all";
  $("evChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderStudent();
});

$("evCats")?.addEventListener("click", (ev) => {
  const tile = ev.target.closest(".ev-cat");
  if (!tile) return;
  studentCat = tile.dataset.cat || "all";
  $("evChips")?.querySelectorAll(".chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.cat === studentCat)
  );
  renderStudent();
  $("evGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

const SORT_LABELS = ["Soonest first", "Most going"];
$("evSort")?.addEventListener("click", () => {
  sortMode = (sortMode + 1) % SORT_LABELS.length;
  $("evSort").title = `Sort: ${SORT_LABELS[sortMode]}`;
  toast(`Sorted by: ${SORT_LABELS[sortMode]}`);
  renderStudent();
});

$("evShowAll")?.addEventListener("click", resetStudentFilters);
$("evExplore")?.addEventListener("click", resetStudentFilters);

function resetStudentFilters() {
  studentCat = "all";
  searchQuery = "";
  if ($("evSearch")) $("evSearch").value = "";
  if ($("globalSearch")) $("globalSearch").value = "";
  $("evChips")?.querySelectorAll(".chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.cat === "all")
  );
  renderStudent();
  $("evGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncSearch(value, other) {
  searchQuery = value.toLowerCase().trim();
  if (other && other.value !== value) other.value = value;
  renderStudent();
}

$("globalSearch")?.addEventListener("input", (e) => syncSearch(e.target.value, $("evSearch")));
$("evSearch")?.addEventListener("input", (e) => syncSearch(e.target.value, $("globalSearch")));

/* student RSVP buttons */
$("evGrid")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-rsvp]");
  if (!btn) return;
  toggleRsvp(btn.dataset.rsvp, btn);
});

/* student drawer + logout */
function setDrawer(open) {
  $("sidebar")?.classList.toggle("open", open);
  $("sidebarBackdrop")?.classList.toggle("show", open);
  $("menuBtn")?.setAttribute("aria-expanded", String(open));
}
$("menuBtn")?.addEventListener("click", () => setDrawer(!$("sidebar")?.classList.contains("open")));
$("sidebarBackdrop")?.addEventListener("click", () => setDrawer(false));

async function logout() {
  if (demoMode) {
    toast("This is a preview. Sign in to use the portal.");
    return;
  }
  cleanupListeners();
  try { await signOut(auth); } catch { /* ignore */ }
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  window.location.replace("index.html");
}
$("studentLogout")?.addEventListener("click", logout);
$("adminLogout")?.addEventListener("click", logout);

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-coming-soon]");
  if (!link) return;
  e.preventDefault();
  toast(`${link.dataset.comingSoon} page is coming soon.`);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setDrawer(false);
});

/* ======================================================================
   ADMIN VIEW — event management lives here now
   ====================================================================== */

function renderAdmin() {
  if (!me) return;
  const list = $("list");
  if (!list) return;

  const today = todayStr();
  const key = (e) => `${e.date || ""} ${e.time || ""}`;

  if ($("sEvents")) $("sEvents").textContent = String(events.length);
  if ($("sUpcoming")) {
    $("sUpcoming").textContent = String(events.filter((e) => (e.date || "") >= today).length);
  }
  if ($("sRsvps")) {
    $("sRsvps").textContent = String(events.reduce((sum, e) => sum + goingFor(e.id), 0));
  }

  let rows = events.slice();
  if (adminFilter === "upcoming") {
    rows = rows.filter((e) => (e.date || "") >= today).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  } else if (adminFilter === "past") {
    rows = rows.filter((e) => (e.date || "") < today).sort((a, b) => (key(a) < key(b) ? 1 : -1));
  } else if (adminFilter === "mine") {
    rows = rows.filter((e) => isMine(e.id)).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  } else {
    rows.sort((a, b) => (key(a) < key(b) ? -1 : 1));
  }

  const empty = {
    upcoming: 'No upcoming events. Use “+ Post event” to create one.',
    past: "No past events.",
    mine: "You haven’t RSVP’d to any events yet.",
    all: "No events yet. Use “+ Post event” to create the first one."
  };

  list.innerHTML = rows.length
    ? rows.map((ev) => adminCard(ev, today)).join("")
    : `<p class="empty">${empty[adminFilter]}</p>`;

  refreshIcons();
}

function adminCard(ev, today) {
  const going = goingFor(ev.id);
  const mine = isMine(ev.id);
  const past = (ev.date || "") < today;
  const cap = Number(ev.capacity) || 0;
  const full = cap > 0 && going >= cap && !mine;
  const busy = inFlightRsvps.has(ev.id);
  const pct = cap > 0 ? Math.min(100, Math.round((going / cap) * 100)) : 0;
  const p = parts(ev.date);
  const when = [fmtTime(ev.time), ev.location].filter(Boolean).join(" · ");
  const own = demoMode || ev.createdBy === me?.uid;
  const open = openLists.has(ev.id);

  let rsvpBtn;
  if (past) {
    rsvpBtn = '<button class="btn ghost" type="button" disabled>Event ended</button>';
  } else if (mine) {
    rsvpBtn = `<button class="btn on" type="button" data-rsvp="${esc(ev.id)}" ${busy ? "disabled" : ""}>✓ Going · Cancel</button>`;
  } else if (full) {
    rsvpBtn = '<button class="btn ghost" type="button" disabled>Full</button>';
  } else {
    rsvpBtn = `<button class="btn" type="button" data-rsvp="${esc(ev.id)}" ${busy ? "disabled" : ""}>RSVP</button>`;
  }

  let att = "";
  if (open) {
    const rows = attendeesFor(ev.id);
    att =
      '<div class="att">' +
      (rows.length
        ? `<div class="att-head"><span>Student</span><span>Roll no.</span><span>Year</span><span>Branch</span></div>` +
          rows
            .map(
              (g) => `<div class="att-row">
                <span class="att-who">
                  <span class="av grad">${esc(String(g.name || "?").charAt(0).toUpperCase())}</span>
                  <span class="att-name">${esc(g.name)}<small>${esc(g.email || "")}</small></span>
                </span>
                <span class="att-cell">${esc(g.rollNo || "—")}</span>
                <span class="att-cell">${esc(yearLabel(g.year) || "—")}</span>
                <span class="att-cell">${esc(g.branch || "—")}</span>
              </div>`
            )
            .join("")
        : '<span class="meta">No RSVPs yet. Be the first!</span>') +
      "</div>";
  }

  return (
    `<article class="card"><div class="row">` +
    `<div class="date grad"><div>${esc(p.day)}<small>${esc(p.month)}</small></div></div>` +
    `<div class="info"><span class="club">${esc(ev.club || catMeta(eventCategory(ev)).label)}</span>` +
    `<h3>${esc(ev.title || "Untitled event")}</h3><div class="meta">${esc(when)}</div>` +
    (ev.description ? `<p class="desc">${esc(ev.description)}</p>` : "") +
    `<div class="by">Posted by ${esc(ev.createdByName || "an admin")}</div></div></div>` +
    (cap > 0 ? `<div class="meter"><i class="grad" style="width:${pct}%"></i></div>` : "") +
    `<div class="foot"><div class="count">${going} going` +
    (cap > 0 ? ` <span>/ ${cap} spots</span>` : "") +
    `</div><div class="acts">` +
    `<a class="linkbtn" href="event-details.html?id=${encodeURIComponent(ev.id)}">Event Details</a>` +
    `<button class="linkbtn" type="button" data-att="${esc(ev.id)}">${open ? "Hide attendees" : "View attendees"}</button>` +
    (going ? `<button class="btn ghost sm" type="button" data-csv="${esc(ev.id)}">Download CSV</button>` : "") +
    (own
      ? `<button class="btn ghost sm" type="button" data-edit="${esc(ev.id)}">Edit</button>` +
        `<button class="btn danger sm" type="button" data-del="${esc(ev.id)}">Delete</button>`
      : "") +
    `${rsvpBtn}</div></div>${att}</article>`
  );
}

/* admin interactions */
$("filters")?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  adminFilter = chip.dataset.f;
  $("filters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
  renderAdmin();
});

$("list")?.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;

  if (btn.dataset.att) {
    const id = btn.dataset.att;
    if (openLists.has(id)) openLists.delete(id);
    else openLists.add(id);
    if (!openLists.has(id)) return renderAdmin();
    await ensureProfiles();
    renderAdmin();
    return;
  }

  if (btn.dataset.csv) {
    await ensureProfiles();
    downloadCsv(btn.dataset.csv);
    return;
  }

  if (btn.dataset.edit) {
    openEventModal(btn.dataset.edit);
    return;
  }

  if (btn.dataset.del) {
    if (demoMode) return toast("Preview mode — sign in as an admin to change data.");
    if (!window.confirm("Delete this event and its RSVPs? This cannot be undone.")) return;
    btn.disabled = true;
    try {
      await deleteEventWithRsvps(btn.dataset.del);
      toast("Event deleted");
    } catch (error) {
      console.error(error);
      toast("Could not delete the event.");
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.rsvp) {
    toggleRsvp(btn.dataset.rsvp, btn);
  }
});

/* ---------- RSVP (shared by both views) ---------- */
async function toggleRsvp(id, btn) {
  if (inFlightRsvps.has(id)) return;

  const going = isMine(id);
  const cap = Number(events.find((e) => e.id === id)?.capacity) || 0;

  if (demoMode) {
    toast("Preview mode — sign in to register for events.");
    return;
  }

  if (!going && cap > 0 && goingFor(id) >= cap) {
    toast("This event is already full.");
    return;
  }

  const ref = doc(db, "events", id, "rsvps", me.uid);
  inFlightRsvps.add(id);
  if (btn) btn.disabled = true;

  try {
    if (going) {
      await deleteDoc(ref);
      toast("RSVP cancelled");
    } else {
      await createRsvp(ref);
      toast("You’re going!");
    }
  } catch (error) {
    console.error(error);
    toast("Could not update your RSVP. Try again.");
  } finally {
    inFlightRsvps.delete(id);
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

async function createRsvp(ref) {
  const profile =
    profiles.byUid.get(me.uid) || profiles.byEmail.get((me.email || "").toLowerCase());
  await setDoc(ref, {
    name: profile?.name || me.displayName || me.email,
    email: me.email,
    rollNo: profile?.rollNo || "",
    year: Number(profile?.year) || 0,
    branch: profile?.branch || "",
    photo: me.photoURL || "",
    createdAt: serverTimestamp()
  });
}

/* ---------- post / edit / delete events ---------- */
const modal = $("modal");
const form = $("eform");
const saveBtn = $("saveBtn");

$("addBtn")?.addEventListener("click", () => openEventModal(null));

function openEventModal(id) {
  editingId = id || null;
  if (!form) return;
  form.reset();

  if (editingId) {
    const ev = events.find((e) => e.id === editingId);
    if (!ev) return;
    $("mtitle").textContent = "Edit event";
    saveBtn.textContent = "Save changes";
    const f = form.elements;
    f.title.value = ev.title || "";
    f.club.value = ev.club || "";
    f.cat.value = catMeta(eventCategory(ev)).label;
    f.date.value = ev.date || "";
    f.time.value = ev.time || "";
    f.location.value = ev.location || "";
    f.capacity.value = ev.capacity ?? 0;
    f.desc.value = ev.description || "";
  } else {
    $("mtitle").textContent = "Post an event";
    saveBtn.textContent = "Post event";
    form.elements.date.min = todayStr();
    form.elements.cat.value = "Technical";
    form.elements.capacity.value = "100";
  }

  modal.hidden = false;
  form.elements.title.focus();
  populateClubsDatalist();
}

function closeEventModal() {
  if (modal) modal.hidden = true;
  editingId = null;
}

modal?.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-close]")) closeEventModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal && !modal.hidden) closeEventModal();
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (demoMode) return toast("Preview mode — sign in as an admin to change data.");

  const f = form.elements;
  const data = {
    title: f.title.value.trim(),
    club: f.club.value.trim() || "General",
    cat: f.cat.value || "General",
    date: f.date.value,
    time: f.time.value,
    location: f.location.value.trim(),
    capacity: Math.max(0, parseInt(f.capacity.value, 10) || 0),
    description: f.desc.value.trim()
  };
  if (!data.title || !data.date || !data.location) {
    toast("Title, date and location are required.");
    return;
  }

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "events", editingId), data);
      toast("Event updated");
    } else {
      await addDoc(collection(db, "events"), {
        ...data,
        createdBy: me.uid,
        createdByName: me.displayName || me.email,
        createdAt: serverTimestamp()
      });
      toast("Event posted");
    }
    closeEventModal();
  } catch (error) {
    console.error(error);
    toast("Could not save the event. Check permissions.");
  } finally {
    saveBtn.disabled = false;
  }
});

async function deleteEventWithRsvps(eventId) {
  try {
    const snap = await getDocs(collection(db, "events", eventId, "rsvps"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => null)));
  } catch (error) {
    console.warn("Could not clean up event RSVPs before delete:", error);
  }
  await deleteDoc(doc(db, "events", eventId));
}

async function populateClubsDatalist() {
  const datalist = $("clubs");
  if (!datalist || demoMode) return;
  try {
    const snap = await getDocs(collection(db, "clubs"));
    const names = new Set(["Coding Club", "Music Club", "Robotics Club", "Photography Club"]);
    snap.forEach((d) => {
      const n = d.data().name || d.data().title;
      if (n) names.add(n);
    });
    datalist.innerHTML = [...names].map((n) => `<option value="${esc(n)}"></option>`).join("");
  } catch {
    /* keep the defaults */
  }
}

function downloadCsv(id) {
  const ev = events.find((x) => x.id === id);
  if (!ev) return;
  const rows = [["Name", "Email", "Roll No", "Year", "Branch"]].concat(
    attendeesFor(id).map((g) => [g.name, g.email, g.rollNo, yearLabel(g.year), g.branch])
  );
  const csv = rows.map((r) => r.map(sanitizeCsvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download =
    (ev.title || "event").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() +
    "-attendees.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Attendee list downloaded.");
}
