// CampusConnect events page.
//
// Students get the redesigned Student Portal Events view (hero with 3D calendar,
// category filters, illustrated event cards, upcoming rail, 3x2 category tiles,
// and notifications/user menus). Admins who sign in via the Mentor tab keep the
// classic event directory with inline management (post, edit, delete, attendees, CSV).
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import {
  collection,
  collectionGroup,
  doc,
  addDoc,
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
import { toggleEventRsvp } from "./rsvp-client.js";
import {
  USER_KEY,
  esc,
  safeHttpUrl,
  todayStr,
  parts,
  fmtShortDate,
  fmtTime,
  initThemeToggle,
  refreshIcons,
  showToast,
  sanitizeCsvCell,
  isSignedInAsStudent
} from "./utils.js";
import {
  eventCardHTML,
  upcomingItemHTML,
  categoryTileHTML,
  eventCategory,
  eventHref,
  catMeta,
  FILTER_CATEGORIES
} from "./events-ui.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
const toast = (msg, ms) => showToast(toastEl, msg, ms);

/* ---------- state ---------- */
let me = null;
let isAdmin = false;
let events = [];
let rsvps = {}; // eventId -> [{ uid, name, email, rollNo, year, branch }]
let profiles = { byUid: new Map(), byEmail: new Map() };
let profilesLoaded = false;
let eventsUnsub = null;
let adminRsvpUnsub = null;
let rsvpUnsubs = {};
let studentCat = "all"; // student: category filter
let onlyMineStudent = false; // student: "My Registrations" toggle from user menu
let adminFilter = "upcoming"; // admin: upcoming | mine | past | all
let searchQuery = "";
let sortMode = 0; // 0: soonest first, 1: most going
let editingId = null;
let loadNoticeTimer = null;
let notifAllRead = false;
const openLists = new Set();
const inFlightRsvps = new Set();

/* ---------- boot ---------- */
onAuthStateChanged(auth, async (user) => {
  cleanupListeners();

  if (!user) {
    window.location.replace("index.html");
    return;
  }

  me = user;

  let name = user.displayName || user.email || "Student";
  // Respect the role chosen at sign-in: if the user signed in through the Student
  // section on index.html, always render the Student Portal Events view.
  const forcedStudent = isSignedInAsStudent(user);
  isAdmin = forcedStudent ? false : await checkIsAdmin(user);

  const profile = await ensureStudentProfile(user, { isAdmin });
  if (profile && profile.name) name = profile.name;

  if (isAdmin) {
    paintAdminHeader(name);
    await enterAdminView();
  } else {
    paintStudentHeader(name, user.email || "", user.photoURL);
    await enterStudentView();
  }

  if ($("authLoading")) $("authLoading").hidden = true;
  refreshIcons();

  startListeners();
});

/* ---------- role-specific chrome ---------- */

// Bump when shared CSS changes so browsers fetch the new file instead of a cached copy.
const ASSET_VERSION = "20261116b";

function loadCss(href) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[data-role-css="${href}"]`)) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?v=${ASSET_VERSION}`;
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

function paintStudentHeader(name, email, photoURL) {
  const firstName = String(name || "Student").trim().split(/\s+/)[0] || "Student";
  const userNameEl = $("userName");
  const userRoleEl = $("userRole");
  const portalRoleEl = $("portalRole");
  const avatarEl = $("avatar");
  const ddNameEl = $("evDdName");
  const ddEmailEl = $("evDdEmail");

  if (userNameEl) userNameEl.textContent = firstName;
  if (userRoleEl) userRoleEl.textContent = "Student";
  if (portalRoleEl) portalRoleEl.textContent = "Student Portal";
  if (ddNameEl) ddNameEl.textContent = name;
  if (ddEmailEl) ddEmailEl.textContent = email;

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
  return (rsvps[id] || []).length;
}

function isMine(id) {
  return (rsvps[id] || []).some((g) => g.uid === me?.uid);
}

function attendeesFor(id) {
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
  if (profilesLoaded) return;
  profiles = await loadStudentProfiles();
  profilesLoaded = true;
}

/* ======================================================================
   STUDENT VIEW
   ====================================================================== */

function studentList() {
  const today = todayStr();
  let list = events.slice();

  if (onlyMineStudent) {
    list = list.filter((e) => isMine(e.id));
  }
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
    const emptyMsg = events.length === 0
      ? "No campus events have been posted yet. Check back soon!"
      : onlyMineStudent
        ? "You haven't registered for any events matching this filter yet."
        : "No events match this filter yet. Try another category or clear the search.";
    grid.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
    renderStudentRail();
    renderStudentNotifications();
    refreshIcons();
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
  renderStudentNotifications();
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
      ? upcoming.map((ev, idx) => upcomingItemHTML(ev, idx)).join("")
      : '<li class="ev-up-empty">No upcoming events right now.</li>';
  }

  const catsEl = $("evCats");
  if (catsEl) {
    const pool = events.filter((e) => (e.date || "") >= today);
    // Order matches the 3x2 grid in the design: Technical, Cultural, Sports, Literary, Social, All Events
    const orderedKeys = [...FILTER_CATEGORIES, "all"];
    catsEl.innerHTML = orderedKeys
      .map((key) => {
        const count =
          key === "all"
            ? pool.length
            : pool.filter((e) => eventCategory(e) === key).length;
        return categoryTileHTML(key, count, studentCat === key);
      })
      .join("");
  }
}

function renderStudentNotifications() {
  const badgeEl = $("evNotifBadge");
  const listEl = $("evNotifList");
  if (!badgeEl || !listEl) return;

  const today = todayStr();
  const upcoming = events
    .filter((e) => (e.date || "") >= today)
    .sort((a, b) => (`${a.date} ${a.time || ""}` < `${b.date} ${b.time || ""}` ? -1 : 1))
    .slice(0, 3);

  const count = notifAllRead ? 0 : upcoming.length;
  badgeEl.textContent = String(count);
  badgeEl.hidden = count === 0;

  if (!upcoming.length) {
    listEl.innerHTML = '<li class="ev-notif-empty">No upcoming event alerts yet.</li>';
    return;
  }

  listEl.innerHTML = upcoming
    .map(
      (ev) => `
      <li>
        <a href="${eventHref(ev)}">
          <span class="ev-notif-dot"></span>
          <div>
            <b>${esc(ev.title || "Campus Event")} is open for registration</b>
            <small>${esc(fmtShortDate(ev.date))}${ev.club ? ` · ${esc(ev.club)}` : ""}</small>
          </div>
        </a>
      </li>`
    )
    .join("");
}

/* student interactions */
$("evChips")?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  onlyMineStudent = false;
  studentCat = chip.dataset.cat || "all";
  $("evChips").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderStudent();
});

$("evCats")?.addEventListener("click", (ev) => {
  const tile = ev.target.closest(".ev-cat");
  if (!tile) return;
  onlyMineStudent = false;
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
  $("evSort").classList.toggle("active", sortMode === 1);
  toast(`Sorted by: ${SORT_LABELS[sortMode]}`);
  renderStudent();
});

$("evShowAll")?.addEventListener("click", resetStudentFilters);
$("evExplore")?.addEventListener("click", resetStudentFilters);

function resetStudentFilters() {
  onlyMineStudent = false;
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

/* student RSVP + card 3-dots menu */
$("evGrid")?.addEventListener("click", async (ev) => {
  const menuBtn = ev.target.closest("[data-card-menu]");
  if (menuBtn) {
    ev.stopPropagation();
    const id = menuBtn.dataset.cardMenu;
    const dd = $("evGrid").querySelector(`[data-card-dd="${CSS.escape(id)}"]`);
    $("evGrid").querySelectorAll("[data-card-dd]").forEach((el) => {
      if (el !== dd) el.hidden = true;
    });
    if (dd) dd.hidden = !dd.hidden;
    return;
  }

  const shareBtn = ev.target.closest("[data-share-ev]");
  if (shareBtn) {
    ev.stopPropagation();
    const id = shareBtn.dataset.shareEv;
    const url = new URL(`event-details.html?id=${encodeURIComponent(id)}`, window.location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      toast("Event link copied to clipboard!");
    } catch {
      toast(url);
    }
    $("evGrid").querySelectorAll("[data-card-dd]").forEach((el) => (el.hidden = true));
    return;
  }

  const btn = ev.target.closest("[data-rsvp]");
  if (!btn) return;
  toggleRsvp(btn.dataset.rsvp, btn);
});

/* Topbar bell & user dropdowns */
function closeTopMenus() {
  if ($("evNotifMenu")) $("evNotifMenu").hidden = true;
  if ($("evUserMenu")) $("evUserMenu").hidden = true;
  $("evBellBtn")?.setAttribute("aria-expanded", "false");
  $("evUserBtn")?.setAttribute("aria-expanded", "false");
}

$("evBellBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("evNotifMenu");
  if (!menu) return;
  const open = menu.hidden;
  closeTopMenus();
  menu.hidden = !open;
  $("evBellBtn")?.setAttribute("aria-expanded", String(open));
});

$("evMarkRead")?.addEventListener("click", (e) => {
  e.stopPropagation();
  notifAllRead = true;
  renderStudentNotifications();
  toast("Notifications marked as read.");
});

$("evUserBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("evUserMenu");
  if (!menu) return;
  const open = menu.hidden;
  closeTopMenus();
  menu.hidden = !open;
  $("evUserBtn")?.setAttribute("aria-expanded", String(open));
});

$("evMyRegFilter")?.addEventListener("click", () => {
  onlyMineStudent = !onlyMineStudent;
  closeTopMenus();
  toast(onlyMineStudent ? "Showing your registered events" : "Showing all events");
  renderStudent();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".ev-notif-wrap") && !e.target.closest(".ev-user-wrap")) {
    closeTopMenus();
  }
  if (!e.target.closest("[data-card-dd]") && !e.target.closest("[data-card-menu]")) {
    $("evGrid")?.querySelectorAll("[data-card-dd]").forEach((el) => (el.hidden = true));
  }
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
  if (e.key === "Escape") {
    setDrawer(false);
    closeTopMenus();
    $("evGrid")?.querySelectorAll("[data-card-dd]").forEach((el) => (el.hidden = true));
  }
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
  const own = ev.createdBy === me?.uid;
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
      (rows.length
        ? `<div class="club-members-foot">
             <span>${rows.length} attendee${rows.length === 1 ? "" : "s"}</span>
             <a class="linkbtn" href="certificates.html">Award certificates / credits →</a>
           </div>`
        : "") +
      "</div>";
  }

  return (
    `<article class="card" data-event="${esc(ev.id)}"><div class="row">` +
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

  if (!going && cap > 0 && goingFor(id) >= cap) {
    toast("This event is already full.");
    return;
  }

  inFlightRsvps.add(id);
  if (btn) btn.disabled = true;

  try {
    const result = await toggleEventRsvp(id);
    toast(result.going ? "You’re registered!" : "RSVP cancelled");
  } catch (error) {
    console.error(error);
    toast(error.code === "functions/resource-exhausted" ? "This event is full." : "Could not update your RSVP. Try again.");
  } finally {
    inFlightRsvps.delete(id);
    if (btn && btn.isConnected) btn.disabled = false;
  }
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
    if (f.tagline) f.tagline.value = ev.tagline || "";
    if (f.image) f.image.value = ev.image || "";
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
  const f = form.elements;
  const rawImg = f.image ? f.image.value.trim() : "";
  if (rawImg && !safeHttpUrl(rawImg)) {
    toast("Cover image URL must start with http:// or https://");
    return;
  }

  const rawTagline = f.tagline ? f.tagline.value.trim() : "";
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
  if (rawTagline) data.tagline = rawTagline;
  else if (editingId) data.tagline = "";
  if (rawImg) data.image = safeHttpUrl(rawImg);
  else if (editingId) data.image = "";

  if (!data.title || !data.date || !data.location) {
    toast("Title, date and location are required.");
    return;
  }

  saveBtn.disabled = true;
  let savedId = editingId;
  try {
    if (editingId) {
      await updateDoc(doc(db, "events", editingId), data);
      toast("Event updated");
    } else {
      const created = await addDoc(collection(db, "events"), {
        ...data,
        createdBy: me.uid,
        createdByName: me.displayName || me.email,
        createdAt: serverTimestamp()
      });
      savedId = created.id;
      toast("Event posted");
    }
    closeEventModal();
    focusEventCard(savedId);
  } catch (error) {
    console.error(error);
    toast("Could not save the event. Check permissions.");
  } finally {
    saveBtn.disabled = false;
  }
});

/**
 * Brings a freshly posted / edited event into view in the admin directory.
 */
function focusEventCard(eventId) {
  if (!eventId) return;

  adminFilter = "all";
  $("filters")?.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("on", chip.dataset.f === "all");
  });

  let tries = 0;
  const look = () => {
    renderAdmin();
    const card = $("list")?.querySelector(`[data-event="${CSS.escape(eventId)}"]`);
    if (!card) {
      if (tries++ < 20) setTimeout(look, 150);
      return;
    }
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("just-added");
    setTimeout(() => card.classList.remove("just-added"), 2400);
  };
  look();
}

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
  if (!datalist) return;
  try {
    const snap = await getDocs(collection(db, "clubs"));
    const names = new Set([
      "Technical Club",
      "Cultural Club",
      "Sports Club",
      "Literary Club",
      "Social Club"
    ]);
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
