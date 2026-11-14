// CampusConnect Clubs directory.
//
// Students see the club grid, their memberships and club stats.
// Admins get the same page with management controls inline — create / edit /
// delete clubs, view members, approve join requests and export CSVs — so no
// separate admin panel is needed.
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  increment,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { loadStudentProfiles, findProfile, yearLabel } from "./student-lookup.js";
import {
  USER_KEY,
  esc,
  safeHttpUrl,
  isValidClubId,
  refreshIcons,
  showToast,
  getClubMemberCount,
  isUserInLegacyMembers,
  sanitizeCsvCell
} from "./utils.js";
import { clubCardHTML, myClubItemHTML } from "./clubs-ui.js";


/* ---------- state ---------- */
let allClubs = [];
let joinedClubIds = new Set();
let pendingCounts = new Map(); // clubId -> number of pending join requests
let profiles = { byUid: new Map(), byEmail: new Map() };
let profilesLoaded = false;
let membersCache = new Map();
let currentCategory = "all";
let searchQuery = "";
let onlyMine = false;
let sortMode = 0; // 0: default, 1: A-Z, 2: most members
let currentUser = null;
let isAdmin = false;
let editingClubId = null;

/* ---------- DOM ---------- */
const authLoading = document.getElementById("authLoading");
const clubsApp = document.getElementById("clubsApp");
const gridEl = document.getElementById("grid");
const myClubsEl = document.getElementById("myClubs");
const toastEl = document.getElementById("toast");
const sidebar = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const menuBtn = document.getElementById("menuBtn");
const globalSearch = document.getElementById("globalSearch");
const clubSearch = document.getElementById("clubSearch");
const sortBtn = document.getElementById("sortBtn");
const viewAllBtn = document.getElementById("viewAll");
const browseAllBtn = document.getElementById("browseAll");
const logoutBtn = document.getElementById("logoutBtn");
const adminTools = document.getElementById("adminTools");
const reqCountEl = document.getElementById("reqCount");
const clubModal = document.getElementById("clubModal");
const clubForm = document.getElementById("clubForm");
const clubIdField = document.getElementById("clubIdField");
const clubModalTitle = document.getElementById("clubModalTitle");
const clubModalSub = document.getElementById("clubModalSub");
const clubSaveBtn = document.getElementById("clubSaveBtn");
const membersModal = document.getElementById("membersModal");
const membersBody = document.getElementById("membersBody");
const membersTitle = document.getElementById("membersTitle");
const membersSub = document.getElementById("membersSub");
const membersCsvBtn = document.getElementById("membersCsvBtn");
const requestsModal = document.getElementById("requestsModal");
const requestsBody = document.getElementById("requestsBody");

const toast = (msg, ms) => showToast(toastEl, msg, ms);

/* ---------- boot ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = user;

  let displayName = user.displayName || user.email || "Student";
  isAdmin = await checkIsAdmin(user);

  // Compulsory one-time student profile (admins are skipped).
  const profile = await ensureStudentProfile(user, { isAdmin });
  if (profile && profile.name) displayName = profile.name;

  paintProfile(displayName, isAdmin ? "Admin" : "Student", user.photoURL);
  reveal();
  await loadClubsAndStats();
});

function paintProfile(name, roleLabel, photoURL) {
  const userNameEl = document.getElementById("userName");
  const userRoleEl = document.getElementById("userRole");
  const portalRoleEl = document.getElementById("portalRole");
  const avatarEl = document.getElementById("avatar");

  if (userNameEl) userNameEl.textContent = name;
  if (userRoleEl) userRoleEl.textContent = roleLabel;
  if (portalRoleEl) portalRoleEl.textContent = isAdmin ? "Admin Portal" : "Student Portal";

  if (avatarEl) {
    if (photoURL) avatarEl.innerHTML = `<img src="${esc(photoURL)}" alt="${esc(name)}">`;
    else avatarEl.textContent = String(name || "?").charAt(0).toUpperCase();
  }
}

function reveal() {
  document.body.classList.toggle("is-admin", isAdmin);
  if (adminTools) adminTools.hidden = !isAdmin;
  if (authLoading) authLoading.hidden = true;
  if (clubsApp) clubsApp.hidden = false;
  refreshIcons();
}

/* ---------- data loading ---------- */

async function loadClubsAndStats() {
  if (gridEl) gridEl.innerHTML = '<p class="empty">Loading campus clubs…</p>';

  try {
    const [clubsSnap, joinedSnap, userSnap] = await Promise.all([
      getDocs(collection(db, "clubs")),
      getDocs(collection(db, "users", currentUser.uid, "joinedClubs")).catch(() => null),
      getDoc(doc(db, "users", currentUser.uid)).catch(() => null)
    ]);

    allClubs = clubsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    joinedClubIds = new Set(joinedSnap ? joinedSnap.docs.map((d) => d.id) : []);

    if (isAdmin) await loadPendingCounts();

    // Load the student's RSVP count for the statistics rail (best effort).
    let rsvpCount = 0;
    try {
      const rsvpSnap = await getDocs(collectionGroup(db, "rsvps"));
      rsvpSnap.forEach((d) => {
        if (d.id === currentUser.uid) rsvpCount += 1;
      });
    } catch {
      rsvpCount = 0;
    }

    const certsCount = userSnap?.exists() ? Number(userSnap.data().certificates) || 0 : 0;

    // Admins get a management-oriented statistics block.
    let eventCount = 0;
    if (isAdmin) {
      try {
        eventCount = (await getDocs(collection(db, "events"))).size;
      } catch {
        eventCount = 0;
      }
    }

    renderClubs();
    renderMyClubs();
    updateStats(rsvpCount, certsCount, eventCount);
  } catch (error) {
    console.error("Error loading clubs:", error);
    if (gridEl) {
      gridEl.innerHTML =
        '<p class="empty">Failed to load clubs. Please check your connection or Firestore rules.</p>';
    }
    toast("Could not load clubs.");
  }
}

async function loadPendingCounts() {
  const counts = new Map();
  await Promise.all(
    allClubs.map(async (club) => {
      try {
        const snap = await getDocs(collection(db, "clubs", club.id, "joinRequests"));
        let n = 0;
        snap.forEach((d) => {
          if ((d.data().status || "pending") === "pending") n += 1;
        });
        if (n) counts.set(club.id, n);
      } catch {
        /* rules or offline — just show no badge */
      }
    })
  );
  pendingCounts = counts;
  updateRequestBadge();
}

function updateRequestBadge() {
  const total = [...pendingCounts.values()].reduce((a, b) => a + b, 0);
  if (reqCountEl) {
    reqCountEl.textContent = String(total);
    reqCountEl.hidden = total === 0;
  }
  return total;
}

/* ---------- rendering ---------- */

function isJoined(club) {
  return joinedClubIds.has(club.id) || isUserInLegacyMembers(club, currentUser);
}

function renderClubs() {
  if (!gridEl) return;

  let filtered = allClubs.filter((club) => {
    const name = (club.name || club.title || "").toLowerCase();
    const desc = (club.desc || club.description || "").toLowerCase();
    const cat = (club.cat || club.category || "General").toLowerCase();

    const matchesSearch =
      !searchQuery ||
      name.includes(searchQuery) ||
      desc.includes(searchQuery) ||
      cat.includes(searchQuery);
    const matchesCat = currentCategory === "all" || cat === currentCategory.toLowerCase();
    const matchesMine = !onlyMine || isJoined(club);

    return matchesSearch && matchesCat && matchesMine;
  });

  if (sortMode === 1) {
    filtered = [...filtered].sort((a, b) =>
      (a.name || a.title || "").localeCompare(b.name || b.title || "")
    );
  } else if (sortMode === 2) {
    filtered = [...filtered].sort((a, b) => getClubMemberCount(b) - getClubMemberCount(a));
  }

  if (filtered.length === 0) {
    const emptyMsg =
      allClubs.length === 0
        ? isAdmin
          ? "No campus clubs yet. Use “Create club” above to add the first one."
          : "No campus clubs have been created yet."
        : onlyMine
          ? "You haven't joined any clubs matching this filter yet."
          : "No matching clubs found. Try another category or search term.";
    gridEl.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
    refreshIcons();
    return;
  }

  gridEl.innerHTML = filtered
    .map((club) =>
      clubCardHTML(club, {
        joined: isJoined(club),
        isAdmin,
        pending: pendingCounts.get(club.id) || 0
      })
    )
    .join("");

  refreshIcons();
}

function renderMyClubs() {
  if (!myClubsEl) return;

  const mine = allClubs.filter((club) => isJoined(club));

  if (mine.length === 0) {
    myClubsEl.innerHTML = isAdmin
      ? '<li class="my-empty">You are signed in as an admin. Use the manage buttons on any club card to edit it, see its members or delete it.</li>'
      : '<li class="my-empty">You haven\'t joined any clubs yet. Click any club to request membership!</li>';
    return;
  }

  myClubsEl.innerHTML = mine.map(myClubItemHTML).join("");
  refreshIcons();
}

function updateStats(rsvpCount, certsCount, eventCount = 0) {
  const stJoined = document.getElementById("stJoined");
  const stTotal = document.getElementById("stTotal");
  const stEvents = document.getElementById("stEvents");
  const stCerts = document.getElementById("stCerts");
  const lblJoined = document.getElementById("lblJoined");
  const lblEvents = document.getElementById("lblEvents");
  const lblCerts = document.getElementById("lblCerts");

  if (isAdmin) {
    const members = allClubs.reduce((sum, club) => sum + getClubMemberCount(club), 0);
    const pending = [...pendingCounts.values()].reduce((a, b) => a + b, 0);
    if (stJoined) stJoined.textContent = String(members);
    if (stTotal) stTotal.textContent = String(allClubs.length);
    if (stEvents) stEvents.textContent = String(pending);
    if (stCerts) stCerts.textContent = String(eventCount);
    if (lblJoined) lblJoined.textContent = "Club Members";
    if (lblEvents) lblEvents.textContent = "Join Requests";
    if (lblCerts) lblCerts.textContent = "Events";
    return;
  }

  if (stJoined) stJoined.textContent = String(Math.max(allClubs.filter(isJoined).length, joinedClubIds.size));
  if (stTotal) stTotal.textContent = String(allClubs.length);
  if (stEvents) stEvents.textContent = String(rsvpCount);
  if (stCerts) stCerts.textContent = String(certsCount);
}

/* ---------- student interactions ---------- */

const chipsContainer = document.getElementById("chips");

chipsContainer?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  onlyMine = false;
  if (viewAllBtn) viewAllBtn.innerHTML = 'Filter Mine <i data-lucide="arrow-right"></i>';
  currentCategory = (chip.dataset.cat || "all").toLowerCase();
  chipsContainer.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderClubs();
});

function handleSearchInput(val, otherInput) {
  searchQuery = val.toLowerCase().trim();
  if (otherInput && otherInput.value !== val) otherInput.value = val;
  renderClubs();
}

globalSearch?.addEventListener("input", (e) => handleSearchInput(e.target.value, clubSearch));
clubSearch?.addEventListener("input", (e) => handleSearchInput(e.target.value, globalSearch));

const SORT_LABELS = ["Default", "Name (A–Z)", "Most Members"];
sortBtn?.addEventListener("click", () => {
  sortMode = (sortMode + 1) % SORT_LABELS.length;
  sortBtn.title = `Sort: ${SORT_LABELS[sortMode]}`;
  toast(`Sorted by: ${SORT_LABELS[sortMode]}`);
  renderClubs();
});

viewAllBtn?.addEventListener("click", () => {
  onlyMine = !onlyMine;
  viewAllBtn.innerHTML = onlyMine
    ? 'Show All <i data-lucide="arrow-right"></i>'
    : 'Filter Mine <i data-lucide="arrow-right"></i>';
  renderClubs();
  gridEl?.scrollIntoView({ behavior: "smooth", block: "start" });
});

browseAllBtn?.addEventListener("click", () => {
  onlyMine = false;
  currentCategory = "all";
  searchQuery = "";
  if (globalSearch) globalSearch.value = "";
  if (clubSearch) clubSearch.value = "";
  chipsContainer?.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.cat === "all");
  });
  if (viewAllBtn) viewAllBtn.innerHTML = 'Filter Mine <i data-lucide="arrow-right"></i>';
  renderClubs();
  gridEl?.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- mobile drawer ---------- */
function setDrawer(open) {
  sidebar?.classList.toggle("open", open);
  sidebarBackdrop?.classList.toggle("show", open);
  menuBtn?.setAttribute("aria-expanded", String(open));
}

menuBtn?.addEventListener("click", () => setDrawer(!sidebar?.classList.contains("open")));
sidebarBackdrop?.addEventListener("click", () => setDrawer(false));

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-coming-soon]");
  if (!link) return;
  e.preventDefault();
  toast(`${link.dataset.comingSoon} page is coming soon.`);
});

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut(auth);
    localStorage.removeItem(USER_KEY);
    window.location.replace("index.html");
  } catch (error) {
    console.error("Logout error:", error);
    toast("Unable to log out. Please try again.");
    logoutBtn.disabled = false;
  }
});

/* ======================================================================
   Admin controls — club management lives on this page
   ====================================================================== */

async function ensureProfiles() {
  if (profilesLoaded) return;
  profiles = await loadStudentProfiles();
  profilesLoaded = true;
}

/* ----- card action buttons ----- */
gridEl?.addEventListener("click", async (ev) => {
  const editBtn = ev.target.closest("[data-edit-club]");
  if (editBtn) {
    ev.preventDefault();
    openClubModal(allClubs.find((c) => c.id === editBtn.dataset.editClub) || null);
    return;
  }

  const membersBtn = ev.target.closest("[data-members-club]");
  if (membersBtn) {
    ev.preventDefault();
    openMembersModal(membersBtn.dataset.membersClub);
    return;
  }

  const delBtn = ev.target.closest("[data-del-club]");
  if (delBtn) {
    ev.preventDefault();
    await deleteClub(delBtn.dataset.delClub, delBtn);
  }
});

/* ----- create / edit club ----- */
document.getElementById("createClubBtn")?.addEventListener("click", () => openClubModal(null));

function openClubModal(club) {
  if (!clubForm) return;
  editingClubId = club ? club.id : null;
  clubForm.reset();
  const f = clubForm.elements;

  if (club) {
    clubModalTitle.textContent = "Edit club";
    clubModalSub.textContent = "Update the details students see in the directory.";
    clubSaveBtn.textContent = "Save changes";
    if (clubIdField) clubIdField.hidden = true;
    f.clubId.disabled = true;
    f.name.value = club.name || club.title || "";
    f.cat.value = club.cat || club.category || "General";
    f.theme.value = club.theme || "blue";
    f.icon.value = club.icon || "";
    f.desc.value = club.desc || club.description || "";
    f.leaderName.value = club.leader?.name || "";
    f.leaderEmail.value = club.leader?.email || "";
    f.contactPhone.value = club.contactPhone || "";
    f.whatsappUrl.value = club.whatsappUrl && club.whatsappUrl !== "#" ? club.whatsappUrl : "";
    f.name.focus();
  } else {
    clubModalTitle.textContent = "Create club";
    clubModalSub.textContent = "Publish a new club to the student portal.";
    clubSaveBtn.textContent = "Create club";
    if (clubIdField) clubIdField.hidden = false;
    f.clubId.disabled = false;
    f.cat.value = "Technical";
    f.theme.value = "blue";
    f.clubId.focus();
  }

  clubModal.hidden = false;
  refreshIcons();
}

function closeClubModal() {
  if (clubModal) clubModal.hidden = true;
  editingClubId = null;
}

clubForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const f = clubForm.elements;
  const name = f.name.value.trim();
  const desc = f.desc.value.trim();
  const rawWa = f.whatsappUrl.value.trim();

  if (name.length < 2) return toast("Please enter a club name.");
  if (desc.length < 10) return toast("Please add a short description (at least 10 characters).");
  if (rawWa && !safeHttpUrl(rawWa)) {
    return toast("WhatsApp URL must start with http:// or https://");
  }

  const payload = {
    name,
    cat: f.cat.value,
    theme: f.theme.value,
    icon: f.icon.value.trim().toLowerCase(),
    desc,
    leader: { name: f.leaderName.value.trim(), email: f.leaderEmail.value.trim() },
    contactPhone: f.contactPhone.value.trim(),
    whatsappUrl: rawWa ? safeHttpUrl(rawWa) : "",
    updatedAt: serverTimestamp()
  };

  clubSaveBtn.disabled = true;
  let savedId = editingClubId;
  try {
    if (editingClubId) {
      await updateDoc(doc(db, "clubs", editingClubId), payload);
      toast("Club updated successfully!");
    } else {
      const id = f.clubId.value.trim().toLowerCase();
      if (!isValidClubId(id)) {
        toast("Club ID must be 2–49 characters: lowercase letters, numbers, hyphens or underscores.");
        clubSaveBtn.disabled = false;
        return;
      }
      const ref = doc(db, "clubs", id);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        toast(`A club with ID “${id}” already exists. Choose another one.`);
        clubSaveBtn.disabled = false;
        return;
      }
      await setDoc(ref, {
        id,
        ...payload,
        members: 0,
        membersCount: 0,
        createdAt: serverTimestamp()
      });
      savedId = id;
      toast("Club created and published to students.");
    }

    closeClubModal();
    await loadClubsAndStats();
    focusClubCard(savedId);
  } catch (error) {
    console.error("Error saving club:", error);
    toast("Could not save the club. Check your permissions.");
  } finally {
    clubSaveBtn.disabled = false;
  }
});

/**
 * Makes sure a freshly created / edited club is actually on screen:
 * clears filters and highlights its card for a moment.
 */
function focusClubCard(clubId) {
  if (!clubId || !gridEl) return;

  onlyMine = false;
  currentCategory = "all";
  searchQuery = "";
  if (globalSearch) globalSearch.value = "";
  if (clubSearch) clubSearch.value = "";
  chipsContainer?.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.cat === "all");
  });
  if (viewAllBtn) viewAllBtn.innerHTML = 'Filter Mine <i data-lucide="arrow-right"></i>';

  renderClubs();

  const card = gridEl.querySelector(`[data-club="${CSS.escape(clubId)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("just-added");
  setTimeout(() => card.classList.remove("just-added"), 2400);
}

/* ----- delete club ----- */
async function deleteClub(clubId, btn) {
  const club = allClubs.find((c) => c.id === clubId);
  const label = club?.name || clubId;
  if (!window.confirm(`Delete “${label}” and its membership records? This cannot be undone.`)) return;

  btn.disabled = true;
  try {
    const [membersSnap, reqSnap] = await Promise.all([
      getDocs(collection(db, "clubs", clubId, "members")).catch(() => null),
      getDocs(collection(db, "clubs", clubId, "joinRequests")).catch(() => null)
    ]);

    const cleanups = [];
    membersSnap?.docs.forEach((d) => {
      cleanups.push(deleteDoc(d.ref).catch(() => null));
      cleanups.push(deleteDoc(doc(db, "users", d.id, "joinedClubs", clubId)).catch(() => null));
    });
    reqSnap?.docs.forEach((d) => cleanups.push(deleteDoc(d.ref).catch(() => null)));
    await Promise.all(cleanups);

    await deleteDoc(doc(db, "clubs", clubId));
    toast("Club deleted.");
    await loadClubsAndStats();
  } catch (error) {
    console.error("Error deleting club:", error);
    toast("Could not delete the club. Check permissions.");
    btn.disabled = false;
  }
}

/* ----- members modal ----- */
async function openMembersModal(clubId) {
  const club = allClubs.find((c) => c.id === clubId) || {};
  membersModal.dataset.clubId = clubId;
  membersTitle.textContent = `${club.name || club.title || "Club"} · members`;
  membersSub.textContent = "Students who joined this club through the portal.";
  membersBody.innerHTML = '<p class="empty">Loading members…</p>';
  if (membersCsvBtn) membersCsvBtn.hidden = true;
  membersModal.hidden = false;
  refreshIcons();

  await ensureProfiles();

  try {
    const rows = new Map();
    const addMember = (uid, email, extra = {}) => {
      const p = findProfile(profiles, uid, email);
      const key = uid || (email || "").toLowerCase() || p?.email;
      if (!key) return;
      const prev = rows.get(key) || {};
      rows.set(key, {
        uid: uid || prev.uid || "",
        name: p?.name || extra.name || prev.name || email || "Student",
        email: (p?.email || email || prev.email || "").toLowerCase(),
        rollNo: p?.rollNo || prev.rollNo || "",
        year: p?.year || prev.year || 0,
        branch: p?.branch || prev.branch || ""
      });
    };

    const membersSnap = await getDocs(collection(db, "clubs", clubId, "members")).catch(() => null);
    membersSnap?.forEach((m) => {
      const data = m.data() || {};
      addMember(m.id, data.email || data.userEmail || "", { name: data.name || data.userName });
    });

    // Legacy array-based membership (uids or emails)
    ["members", "memberIds", "joined"].forEach((field) => {
      if (!Array.isArray(club[field])) return;
      club[field].forEach((value) => {
        if (typeof value !== "string") return;
        if (value.includes("@")) addMember("", value);
        else addMember(value, "");
      });
    });

    const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    membersCache.set(clubId, list);
    renderMembersTable(list, clubId);
  } catch (error) {
    console.error("Club members load failed:", error);
    membersBody.innerHTML =
      '<p class="empty">Couldn’t load members. Check the Firestore rules and try again.</p>';
  }
}

function renderMembersTable(list, clubId) {
  if (!list.length) {
    membersBody.innerHTML =
      '<p class="empty">No members yet. Approve join requests to add students to this club.</p>';
    if (membersCsvBtn) membersCsvBtn.hidden = true;
    return;
  }

  const withProfile = list.filter((m) => m.year || m.branch || m.rollNo).length;

  membersBody.innerHTML =
    `<div class="mem-table">
       <div class="mem-head"><span>Student</span><span>Roll no.</span><span>Year</span><span>Branch</span></div>
       ${list
         .map(
           (m) => `<div class="mem-row">
             <span class="mem-who">
               <span class="av">${esc(m.name.charAt(0).toUpperCase())}</span>
               <span>${esc(m.name)}<small>${esc(m.email || "No email")}</small></span>
             </span>
             <span class="mem-cell">${esc(m.rollNo || "—")}</span>
             <span class="mem-cell">${esc(yearLabel(m.year) || "—")}</span>
             <span class="mem-cell">${esc(m.branch || "—")}</span>
           </div>`
         )
         .join("")}
     </div>
     <p class="table-foot">
       ${list.length} member${list.length === 1 ? "" : "s"} · ${withProfile} with profile details on file
     </p>`;

  if (membersCsvBtn) {
    membersCsvBtn.hidden = false;
    membersCsvBtn.dataset.clubId = clubId;
  }
}

membersCsvBtn?.addEventListener("click", () => downloadMembersCsv(membersCsvBtn.dataset.clubId));

function downloadMembersCsv(clubId) {
  const list = membersCache.get(clubId) || [];
  if (!list.length) return;
  const club = allClubs.find((c) => c.id === clubId) || {};
  const rows = [["Name", "Email", "Roll No", "Year", "Branch"]].concat(
    list.map((m) => [m.name, m.email, m.rollNo, yearLabel(m.year), m.branch])
  );
  const csv = rows.map((r) => r.map(sanitizeCsvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download =
    (club.name || club.title || clubId)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() + "-members.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Member list downloaded.");
}

/* ----- join requests modal ----- */
let pendingRequests = new Map(); // key -> request

document.getElementById("requestsBtn")?.addEventListener("click", openRequestsModal);

async function openRequestsModal() {
  requestsBody.innerHTML = '<p class="empty">Loading requests…</p>';
  requestsModal.hidden = false;
  refreshIcons();
  pendingRequests.clear();

  await ensureProfiles();

  try {
    const clubsSnap = await getDocs(collection(db, "clubs"));
    const perClub = await Promise.all(
      clubsSnap.docs.map(async (clubDoc) => {
        const clubId = clubDoc.id;
        const data = clubDoc.data() || {};
        const clubName = data.name || data.title || clubId;
        const reqSnap = await getDocs(collection(db, "clubs", clubId, "joinRequests")).catch(() => null);
        const items = [];
        reqSnap?.forEach((reqDoc) => {
          const req = reqDoc.data() || {};
          if ((req.status || "pending") !== "pending") return;
          const p = findProfile(profiles, reqDoc.id, req.userEmail);
          items.push({
            key: `${clubId}::${reqDoc.id}`,
            clubId,
            clubName,
            userId: reqDoc.id,
            userName: p?.name || req.userName || "Student",
            userEmail: p?.email || req.userEmail || "",
            year: p?.year || 0,
            branch: p?.branch || "",
            requestedAt: req.requestedAt || null
          });
        });
        return items;
      })
    );

    const rows = perClub.flat().sort((a, b) => a.clubName.localeCompare(b.clubName));
    rows.forEach((r) => pendingRequests.set(r.key, r));
    renderRequestRows(rows);
  } catch (error) {
    console.error("Error loading join requests:", error);
    requestsBody.innerHTML =
      '<p class="empty">Couldn’t load join requests. Check the Firestore rules and try again.</p>';
  }
}

function renderRequestRows(rows) {
  if (!rows.length) {
    requestsBody.innerHTML = '<p class="empty">No pending membership requests right now.</p>';
    return;
  }

  requestsBody.innerHTML = `<div class="req-list">${rows
    .map((req) => {
      const profileBits = [yearLabel(req.year), req.branch].filter(Boolean).join(" · ");
      const when =
        req.requestedAt && typeof req.requestedAt.toDate === "function"
          ? req.requestedAt.toDate().toLocaleString("en-IN")
          : "Requested recently";
      return `<div class="req-row" data-req="${esc(req.key)}">
        <span class="who2">
          <b>${esc(req.userName)}<span class="club-pill">${esc(req.clubName)}</span></b>
          <small>${esc(req.userEmail || "No email")}${profileBits ? " · " + esc(profileBits) : ""}</small>
          <small>${esc(when)}</small>
        </span>
        <span class="acts2">
          <button class="btn solid" type="button" data-approve="${esc(req.key)}">Approve</button>
          <button class="btn ghost" type="button" data-reject="${esc(req.key)}">Reject</button>
        </span>
      </div>`;
    })
    .join("")}</div>`;
  refreshIcons();
}

requestsBody?.addEventListener("click", async (ev) => {
  const approveBtn = ev.target.closest("[data-approve]");
  const rejectBtn = ev.target.closest("[data-reject]");
  if (!approveBtn && !rejectBtn) return;

  const key = (approveBtn || rejectBtn).dataset.approve || (approveBtn || rejectBtn).dataset.reject;
  const req = pendingRequests.get(key);
  if (!req) return;

  const row = requestsBody.querySelector(`[data-req="${CSS.escape(key)}"]`);
  row?.querySelectorAll("button").forEach((b) => (b.disabled = true));

  try {
    if (approveBtn) {
      await approveRequest(req);
      toast(`Approved membership for ${req.userName}.`);
    } else {
      await deleteDoc(doc(db, "clubs", req.clubId, "joinRequests", req.userId));
      toast("Join request rejected.");
    }

    pendingRequests.delete(key);
    row?.remove();
    if (!requestsBody.querySelector(".req-row")) {
      requestsBody.innerHTML = '<p class="empty">No pending membership requests right now.</p>';
    }
    await loadClubsAndStats();
  } catch (error) {
    console.error("Error processing join request:", error);
    toast("Action failed. Check Firestore permissions.");
    row?.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

async function approveRequest(req) {
  const memberRef = doc(db, "clubs", req.clubId, "members", req.userId);
  const existingMember = await getDoc(memberRef);

  await Promise.all([
    setDoc(memberRef, {
      joinedAt: serverTimestamp(),
      email: req.userEmail,
      name: req.userName
    }),
    setDoc(doc(db, "users", req.userId, "joinedClubs", req.clubId), {
      clubId: req.clubId,
      joinedAt: serverTimestamp()
    })
  ]);

  if (!existingMember.exists()) {
    const clubRef = doc(db, "clubs", req.clubId);
    const clubSnap = await getDoc(clubRef);
    if (clubSnap.exists()) {
      const data = clubSnap.data();
      if (Array.isArray(data.members)) {
        await updateDoc(clubRef, { members: arrayUnion(req.userId), membersCount: increment(1) });
      } else {
        await updateDoc(clubRef, { members: increment(1), membersCount: increment(1) });
      }
    }
  }

  await deleteDoc(doc(db, "clubs", req.clubId, "joinRequests", req.userId));
}

/* ----- modal plumbing ----- */
document.querySelectorAll("[data-close-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeClubModal();
    if (membersModal) membersModal.hidden = true;
    if (requestsModal) requestsModal.hidden = true;
  });
});

[clubModal, membersModal, requestsModal].forEach((modal) => {
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeClubModal();
      membersModal.hidden = true;
      requestsModal.hidden = true;
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  setDrawer(false);
  closeClubModal();
  if (membersModal) membersModal.hidden = true;
  if (requestsModal) requestsModal.hidden = true;
});
