// Admin panel: unified admin check via checkIsAdmin(), event CRUD, CSV export, and club management.
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { loadStudentProfiles, findProfile, profileLine, yearLabel } from "./student-lookup.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, getDocs,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  USER_KEY,
  esc,
  safeHttpUrl,
  todayStr,
  parts,
  fmtTime,
  initThemeToggle,
  showToast,
  sanitizeCsvCell,
  getClubMemberCount
} from "./utils.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");

let me = null;
let events = [];
let rsvps = {};
let adminClubsMap = new Map();
let profiles = { byUid: new Map(), byEmail: new Map() };
let clubMembersCache = new Map(); // clubId -> [{ uid, name, email, rollNo, year, branch }]
let filter = "upcoming";
let editingId = null;
let editingClubId = null;
const openLists = new Set();
let unsubs = [];

initThemeToggle("theme");

function cleanupListeners() {
  unsubs.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
  unsubs = [];
}

// auth + admin check
onAuthStateChanged(auth, async (user) => {
  cleanupListeners();

  if (!user) {
    window.location.replace("index.html");
    return;
  }
  me = user;
  const name = user.displayName || user.email || "Admin";
  if ($("uname")) $("uname").textContent = name;
  if ($("av")) $("av").textContent = name.charAt(0).toUpperCase();

  const isAdmin = await checkIsAdmin(user);
  if (!isAdmin) {
    if ($("list")) {
      $("list").innerHTML =
        '<div class="denied"><p>This page is only for admins.</p><p><a href="events.html">Go to the events page</a></p></div>';
    }
    setTimeout(() => window.location.replace("events.html"), 2500);
    return;
  }

  $("adminActions").hidden = false;
  $("stats").hidden = false;
  $("filters").hidden = false;

  profiles = await loadStudentProfiles();
  startListeners();
  populateClubsDatalist();
});

$("logout")?.addEventListener("click", async () => {
  cleanupListeners();
  try { await signOut(auth); } catch { /* ignore */ }
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  window.location.replace("index.html");
});

// live data
function onError(err) {
  console.error(err);
  if ($("list")) {
    $("list").innerHTML = '<p class="empty">Couldn’t load events. Check your Firestore rules.</p>';
  }
}

function startListeners() {
  unsubs.push(
    onSnapshot(
      query(collection(db, "events"), orderBy("date")),
      (snap) => {
        events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        render();
      },
      onError
    )
  );

  unsubs.push(
    onSnapshot(
      collectionGroup(db, "rsvps"),
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const eid = d.ref.parent?.parent?.id;
          if (!eid) return;
          (map[eid] = map[eid] || []).push({ uid: d.id, ...d.data() });
        });
        rsvps = map;
        render();
      },
      onError
    )
  );
}

async function populateClubsDatalist() {
  const datalist = $("clubs");
  if (!datalist) return;
  try {
    const snap = await getDocs(collection(db, "clubs"));
    const names = new Set(["Coding Club", "Music Club", "Robotics Club", "Photography Club"]);
    snap.forEach((d) => {
      const n = d.data().name || d.data().title;
      if (n) names.add(n);
    });
    datalist.innerHTML = [...names].map((n) => `<option value="${esc(n)}"></option>`).join("");
  } catch {
    // keep defaults
  }
}

// rendering
function card(e) {
  const going = rsvps[e.id] || [];
  const cap = Number(e.capacity) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round((going.length / cap) * 100)) : 0;
  const p = parts(e.date);
  const own = e.createdBy === me.uid;
  const when = [fmtTime(e.time), e.location].filter(Boolean).join(" · ");

  let att = "";
  const showAtt = openLists.has(e.id);
  if (showAtt) {
    att =
      '<div class="att">' +
      (going.length
        ? `<div class="att-head">
             <span>Student</span><span>Roll no.</span><span>Year</span><span>Branch</span>
           </div>` +
          going
            .map((g) => {
              const p = findProfile(profiles, g.uid, g.email);
              const name = p?.name || g.name || "Student";
              const email = p?.email || g.email || "";
              return `<div class="att-row">
                <span class="att-who">
                  <span class="av grad">${esc(name.charAt(0).toUpperCase())}</span>
                  <span class="att-name">${esc(name)}<small>${esc(email)}</small></span>
                </span>
                <span class="att-cell">${esc(p?.rollNo || "—")}</span>
                <span class="att-cell">${esc(yearLabel(p?.year) || "—")}</span>
                <span class="att-cell">${esc(p?.branch || "—")}</span>
              </div>`;
            })
            .join("")
        : '<span class="meta">No RSVPs yet.</span>') +
      "</div>";
  }

  return (
    `<article class="card"><div class="row">` +
    `<div class="date grad"><div>${esc(p.day)}<small>${esc(p.month)}</small></div></div>` +
    `<div class="info"><span class="club">${esc(e.club || "General")}</span>` +
    `<h3>${esc(e.title)}</h3><div class="meta">${esc(when)}</div>` +
    (e.description ? `<p class="desc">${esc(e.description)}</p>` : "") +
    `<div class="by">Posted by ${esc(e.createdByName || "an admin")}</div></div></div>` +
    (cap > 0 ? `<div class="meter"><i class="grad" style="width:${pct}%"></i></div>` : "") +
    `<div class="foot"><div class="count">${going.length} going` +
    (cap > 0 ? ` <span>/ ${cap} spots</span>` : "") +
    `</div><div class="acts">` +
    `<button class="linkbtn" type="button" data-att="${esc(e.id)}">${openLists.has(e.id) ? "Hide attendees" : "View attendees"}</button>` +
    (going.length ? `<button class="btn ghost sm" type="button" data-csv="${esc(e.id)}">Download CSV</button>` : "") +
    (own
      ? `<button class="btn ghost sm" type="button" data-edit="${esc(e.id)}">Edit</button>` +
        `<button class="btn ghost sm" type="button" data-del="${esc(e.id)}">Delete</button>`
      : "") +
    `</div></div>${att}</article>`
  );
}

function render() {
  if (!me) return;
  const today = todayStr();
  const key = (e) => (e.date || "") + " " + (e.time || "");

  $("sEvents").textContent = String(events.length);
  $("sUpcoming").textContent = String(events.filter((e) => (e.date || "") >= today).length);
  $("sRsvps").textContent = String(events.reduce((s, e) => s + (rsvps[e.id] || []).length, 0));

  let list = events.slice();
  if (filter === "upcoming") {
    list = list.filter((e) => (e.date || "") >= today).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  } else if (filter === "past") {
    list = list.filter((e) => (e.date || "") < today).sort((a, b) => (key(a) < key(b) ? 1 : -1));
  } else {
    list.sort((a, b) => (key(a) < key(b) ? -1 : 1));
  }

  const empty = {
    upcoming: 'No upcoming events. Click “+ Post event” to create one.',
    past: "No past events.",
    all: "No events yet."
  };
  $("list").innerHTML = list.length
    ? list.map(card).join("")
    : `<p class="empty">${empty[filter]}</p>`;
}

// CSV download of attendee list with spreadsheet formula-injection sanitization
function downloadCsv(id) {
  const e = events.find((x) => x.id === id);
  if (!e) return;
  const rows = [["Name", "Email", "Roll No", "Year", "Branch", "RSVP time"]].concat(
    (rsvps[id] || []).map((g) => {
      const p = findProfile(profiles, g.uid, g.email);
      return [
        p?.name || g.name || "",
        p?.email || g.email || "",
        p?.rollNo || "",
        yearLabel(p?.year),
        p?.branch || "",
        g.createdAt && g.createdAt.toDate ? g.createdAt.toDate().toLocaleString("en-IN") : ""
      ];
    })
  );
  const csv = rows.map((r) => r.map(sanitizeCsvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download =
    (e.title || "event").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() +
    "-attendees.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Delete event and clean up its RSVP subcollection docs
async function deleteEventWithRsvps(eventId) {
  try {
    const rsvpSnap = await getDocs(collection(db, "events", eventId, "rsvps"));
    await Promise.all(rsvpSnap.docs.map((d) => deleteDoc(d.ref).catch(() => null)));
  } catch (err) {
    console.warn("Could not clean up event RSVPs before delete:", err);
  }
  await deleteDoc(doc(db, "events", eventId));
}

// actions
$("filters")?.addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip");
  if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
  render();
});

$("list")?.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.att) {
    const id = b.dataset.att;
    if (openLists.has(id)) openLists.delete(id);
    else openLists.add(id);
    render();
  } else if (b.dataset.csv) {
    downloadCsv(b.dataset.csv);
  } else if (b.dataset.edit) {
    openModal(b.dataset.edit);
  } else if (b.dataset.del) {
    if (!window.confirm("Delete this event and its RSVPs? This cannot be undone.")) return;
    b.disabled = true;
    try {
      await deleteEventWithRsvps(b.dataset.del);
      showToast(toastEl, "Event deleted");
    } catch (e) {
      console.error(e);
      showToast(toastEl, "Could not delete the event.");
      b.disabled = false;
    }
  }
});

// post / edit event form
const modal = $("modal");
const form = $("eform");
const saveBtn = $("saveBtn");

function openModal(id) {
  editingId = id || null;
  form.reset();
  form.elements.date.min = "";
  if (editingId) {
    const e = events.find((x) => x.id === editingId);
    if (!e) return;
    $("mtitle").textContent = "Edit event";
    saveBtn.textContent = "Save changes";
    const f = form.elements;
    f.title.value = e.title || "";
    f.club.value = e.club || "";
    f.date.value = e.date || "";
    f.time.value = e.time || "";
    f.location.value = e.location || "";
    f.capacity.value = e.capacity || 0;
    f.desc.value = e.description || "";
  } else {
    $("mtitle").textContent = "Post an event";
    saveBtn.textContent = "Post event";
    form.elements.date.min = todayStr();
  }
  modal.hidden = false;
  form.elements.title.focus();
}

function closeModal() {
  modal.hidden = true;
  editingId = null;
}

$("addBtn")?.addEventListener("click", () => openModal(null));
modal?.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-close]")) closeModal();
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = form.elements;
  const data = {
    title: f.title.value.trim(),
    club: f.club.value.trim() || "General",
    date: f.date.value,
    time: f.time.value,
    location: f.location.value.trim(),
    capacity: Math.max(0, parseInt(f.capacity.value, 10) || 0),
    description: f.desc.value.trim()
  };
  if (!data.title || !data.date || !data.location) return;

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "events", editingId), data);
      showToast(toastEl, "Event updated");
    } else {
      await addDoc(collection(db, "events"), {
        ...data,
        createdBy: me.uid,
        createdByName: me.displayName || me.email,
        createdAt: serverTimestamp()
      });
      showToast(toastEl, "Event posted");
    }
    closeModal();
  } catch (err) {
    console.error(err);
    showToast(toastEl, "Could not save the event. Check permissions.");
  } finally {
    saveBtn.disabled = false;
  }
});

// --- Manage Existing Clubs (safe event delegation + Edit Club modal) ---

const manageClubsBtn = $("manageClubsBtn");
const manageClubsContainer = $("manageClubsContainer");
const adminClubsList = $("adminClubsList");
const clubModal = $("clubModal");
const clubForm = $("clubForm");
const saveClubBtn = $("saveClubBtn");

manageClubsBtn?.addEventListener("click", async () => {
  const willShow = manageClubsContainer.hidden;
  manageClubsContainer.hidden = !willShow;
  if (willShow) await loadAdminClubsList();
});

async function loadAdminClubsList() {
  if (!adminClubsList) return;
  adminClubsList.innerHTML = '<p class="empty" style="padding:16px 0;">Loading clubs...</p>';

  try {
    const snap = await getDocs(collection(db, "clubs"));
    adminClubsMap.clear();

    if (snap.empty) {
      adminClubsList.innerHTML =
        '<p class="empty" style="padding:16px 0;">No clubs created yet in Firestore.</p>';
      return;
    }

    adminClubsList.innerHTML = snap.docs
      .map((d) => {
        const club = { id: d.id, ...d.data() };
        adminClubsMap.set(d.id, club);

        const clubName = club.name || club.title || "Unnamed Club";
        const clubDesc = club.desc || club.description || "No description provided";
        const clubCat = club.cat || club.category || "General";
        const members = getClubMemberCount(club);

        return `
          <div class="club-admin-row">
            <div>
              <h4>${esc(clubName)} <span class="club-admin-badge">${esc(clubCat)} · ${members} members</span></h4>
              <p>${esc(clubDesc)}</p>
            </div>
            <div class="club-admin-btns">
              <button class="btn ghost sm" type="button" data-members-club="${esc(d.id)}">
                ${clubMembersCache.has(d.id) ? "Hide members" : "View members"}
              </button>
              <button class="btn ghost sm" type="button" data-edit-club="${esc(d.id)}">Edit</button>
              <button class="btn danger sm" type="button" data-del-club="${esc(d.id)}">Delete</button>
            </div>
          </div>
          <div class="club-members" id="clubMembers-${esc(d.id)}" hidden></div>`;
      })
      .join("");
  } catch (error) {
    console.error("Error loading clubs:", error);
    adminClubsList.innerHTML =
      '<p class="empty" style="padding:16px 0;">Failed to load clubs. Check Firestore rules.</p>';
  }
}

/**
 * Loads clubs/{id}/members plus any students who joined through the
 * users/{uid}/joinedClubs subcollection, then renders full student details
 * (name, roll no., year, branch, email) for the club admin.
 */
async function renderClubMembers(clubId) {
  const box = document.getElementById(`clubMembers-${clubId}`);
  const club = adminClubsMap.get(clubId) || {};
  if (!box) return;

  box.hidden = false;
  box.innerHTML = '<p class="empty" style="padding:14px 0;">Loading members…</p>';

  const rows = new Map(); // uid||email -> member

  function addMember(uid, email, extra = {}) {
    const p = findProfile(profiles, uid, email);
    const key = uid || (email || "").toLowerCase() || (p && p.email);
    if (!key) return;
    const existing = rows.get(key) || {};
    rows.set(key, {
      uid: uid || existing.uid || "",
      name: p?.name || extra.name || existing.name || email || "Student",
      email: (p?.email || email || existing.email || "").toLowerCase(),
      rollNo: p?.rollNo || existing.rollNo || "",
      year: p?.year || existing.year || 0,
      branch: p?.branch || existing.branch || ""
    });
  }

  try {
    const membersSnap = await getDocs(collection(db, "clubs", clubId, "members")).catch(() => null);
    if (membersSnap) {
      membersSnap.forEach((m) => {
        const data = m.data() || {};
        addMember(m.id, data.email || data.userEmail || "", { name: data.name || data.userName });
      });
    }

    // Legacy array-based members (uids or emails)
    ["members", "memberIds", "joined"].forEach((field) => {
      if (!Array.isArray(club[field])) return;
      club[field].forEach((value) => {
        if (typeof value !== "string") return;
        if (value.includes("@")) addMember("", value);
        else addMember(value, "");
      });
    });

    const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    clubMembersCache.set(clubId, list);

    if (!list.length) {
      box.innerHTML =
        '<p class="empty" style="padding:14px 0;">No members yet. Approve join requests or add students to this club.</p>';
      return;
    }

    const withProfile = list.filter((m) => m.year || m.branch || m.rollNo).length;

    box.innerHTML =
      `<div class="att-head club-att-head">
         <span>Student</span><span>Roll no.</span><span>Year</span><span>Branch</span>
       </div>` +
      list
        .map(
          (m) => `<div class="att-row">
            <span class="att-who">
              <span class="av grad">${esc(m.name.charAt(0).toUpperCase())}</span>
              <span class="att-name">${esc(m.name)}<small>${esc(m.email || "No email")}</small></span>
            </span>
            <span class="att-cell">${esc(m.rollNo || "—")}</span>
            <span class="att-cell">${esc(yearLabel(m.year) || "—")}</span>
            <span class="att-cell">${esc(m.branch || "—")}</span>
          </div>`
        )
        .join("") +
      `<p class="club-members-foot">
         ${list.length} member${list.length === 1 ? "" : "s"} ·
         ${withProfile} with profile details on file
         <button class="linkbtn" type="button" data-csv-members="${esc(clubId)}">Download CSV</button>
       </p>`;
  } catch (error) {
    console.error("Club members load failed:", error);
    box.innerHTML = '<p class="empty" style="padding:14px 0;">Couldn’t load members. Check Firestore rules.</p>';
  }
}

function downloadClubMembersCsv(clubId) {
  const club = adminClubsMap.get(clubId) || {};
  const list = clubMembersCache.get(clubId) || [];
  if (!list.length) return;

  const rows = [["Name", "Email", "Roll No", "Year", "Branch"]].concat(
    list.map((m) => [m.name, m.email, m.rollNo, yearLabel(m.year), m.branch])
  );
  const csv = rows.map((r) => r.map(sanitizeCsvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download =
    (club.name || club.title || clubId).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() +
    "-members.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(toastEl, "Member list downloaded.");
}

function openClubModal(clubId) {
  const club = adminClubsMap.get(clubId);
  if (!club) return;
  editingClubId = clubId;
  clubForm.reset();

  const f = clubForm.elements;
  f.name.value = club.name || club.title || "";
  f.cat.value = club.cat || club.category || "General";
  f.desc.value = club.desc || club.description || "";
  f.leaderName.value = club.leader?.name || "";
  f.leaderEmail.value = club.leader?.email || "";
  f.contactPhone.value = club.contactPhone || "";
  f.whatsappUrl.value = club.whatsappUrl && club.whatsappUrl !== "#" ? club.whatsappUrl : "";

  clubModal.hidden = false;
  f.name.focus();
}

function closeClubModal() {
  clubModal.hidden = true;
  editingClubId = null;
}

clubModal?.addEventListener("click", (e) => {
  if (e.target === clubModal || e.target.closest("[data-close-club]")) closeClubModal();
});

clubForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingClubId) return;

  const f = clubForm.elements;
  const rawWa = f.whatsappUrl.value.trim();
  if (rawWa && !safeHttpUrl(rawWa)) {
    showToast(toastEl, "WhatsApp URL must start with http:// or https://");
    return;
  }

  saveClubBtn.disabled = true;
  try {
    await updateDoc(doc(db, "clubs", editingClubId), {
      name: f.name.value.trim(),
      cat: f.cat.value,
      desc: f.desc.value.trim(),
      leader: {
        name: f.leaderName.value.trim(),
        email: f.leaderEmail.value.trim()
      },
      contactPhone: f.contactPhone.value.trim(),
      whatsappUrl: rawWa ? safeHttpUrl(rawWa) : "",
      updatedAt: serverTimestamp()
    });
    showToast(toastEl, "Club updated successfully!");
    closeClubModal();
    await loadAdminClubsList();
    await populateClubsDatalist();
  } catch (error) {
    console.error("Error updating club:", error);
    showToast(toastEl, "Failed to update club.");
  } finally {
    saveClubBtn.disabled = false;
  }
});

async function deleteClubWithSubcollections(clubId) {
  try {
    const [membersSnap, reqSnap] = await Promise.all([
      getDocs(collection(db, "clubs", clubId, "members")).catch(() => null),
      getDocs(collection(db, "clubs", clubId, "joinRequests")).catch(() => null)
    ]);

    const cleanups = [];
    if (membersSnap) {
      membersSnap.docs.forEach((d) => {
        cleanups.push(deleteDoc(d.ref).catch(() => null));
        cleanups.push(deleteDoc(doc(db, "users", d.id, "joinedClubs", clubId)).catch(() => null));
      });
    }
    if (reqSnap) {
      reqSnap.docs.forEach((d) => {
        cleanups.push(deleteDoc(d.ref).catch(() => null));
      });
    }
    await Promise.all(cleanups);
  } catch (err) {
    console.warn("Club subcollection cleanup warning:", err);
  }
  await deleteDoc(doc(db, "clubs", clubId));
}

adminClubsList?.addEventListener("click", async (ev) => {
  const memBtn = ev.target.closest("button[data-members-club]");
  if (memBtn) {
    const clubId = memBtn.dataset.membersClub;
    const box = document.getElementById(`clubMembers-${clubId}`);
    if (clubMembersCache.has(clubId)) {
      clubMembersCache.delete(clubId);
      if (box) { box.hidden = true; box.innerHTML = ""; }
      memBtn.textContent = "View members";
    } else {
      await renderClubMembers(clubId);
      memBtn.textContent = "Hide members";
    }
    return;
  }

  const editBtn = ev.target.closest("button[data-edit-club]");
  if (editBtn) {
    openClubModal(editBtn.dataset.editClub);
    return;
  }

  const csvBtn = ev.target.closest("button[data-csv-members]");
  if (csvBtn) {
    downloadClubMembersCsv(csvBtn.dataset.csvMembers);
    return;
  }

  const delBtn = ev.target.closest("button[data-del-club]");
  if (delBtn) {
    const clubId = delBtn.dataset.delClub;
    const club = adminClubsMap.get(clubId);
    const label = club?.name || clubId;
    if (!window.confirm(`Delete "${label}" and its membership records? This cannot be undone.`)) return;

    delBtn.disabled = true;
    try {
      await deleteClubWithSubcollections(clubId);
      showToast(toastEl, "Club deleted successfully.");
      await loadAdminClubsList();
      await populateClubsDatalist();
    } catch (error) {
      console.error("Error deleting club:", error);
      showToast(toastEl, "Failed to delete club. Check permissions.");
      delBtn.disabled = false;
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (modal && !modal.hidden) closeModal();
    if (clubModal && !clubModal.hidden) closeClubModal();
  }
});
