// CampusConnect Clubs Directory: live Firestore clubs, joined clubs, filters, sorting, and stats.
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  USER_KEY,
  esc,
  refreshIcons,
  showToast,
  getClubMemberCount,
  isUserInLegacyMembers
} from "./utils.js";

const VALID_THEMES = new Set(["blue", "purple", "green", "orange", "pink", "teal"]);
const ICON_MAP = {
  code: "code",
  palette: "palette",
  ball: "trophy",
  sports: "trophy",
  book: "book-open",
  users: "users",
  leaf: "leaf",
  music: "music",
  cpu: "cpu"
};

let allClubs = [];
let joinedClubIds = new Set();
let currentCategory = "all";
let searchQuery = "";
let onlyMine = false;
let sortMode = 0; // 0: default, 1: A-Z, 2: most members
let currentUser = null;

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

function themeForClub(club) {
  const t = (club.theme || "").toLowerCase();
  if (VALID_THEMES.has(t)) return t;
  const cat = (club.cat || club.category || "").toLowerCase();
  if (cat.includes("cultur")) return "purple";
  if (cat.includes("sport")) return "green";
  if (cat.includes("liter")) return "orange";
  if (cat.includes("social")) return "pink";
  return "blue";
}

function iconForClub(club) {
  const raw = (club.icon || "").toLowerCase().trim();
  if (ICON_MAP[raw]) return ICON_MAP[raw];
  const cat = (club.cat || club.category || "").toLowerCase();
  if (cat.includes("tech")) return "code";
  if (cat.includes("cultur")) return "music";
  if (cat.includes("sport")) return "trophy";
  if (cat.includes("liter")) return "book-open";
  if (cat.includes("social")) return "users";
  return "sparkles";
}

function isJoined(club) {
  return joinedClubIds.has(club.id) || isUserInLegacyMembers(club, currentUser);
}

/* ---------- authentication ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = user;
  let displayName = user.displayName || user.email || "Student";
  const isAdmin = await checkIsAdmin(user);
  const roleLabel = isAdmin ? "Admin" : "Student";

  // Compulsory one-time student profile (admins are skipped).
  const profile = await ensureStudentProfile(user, { isAdmin });
  if (profile && profile.name) displayName = profile.name;

  const userNameEl = document.getElementById("userName");
  const userRoleEl = document.getElementById("userRole");
  const portalRoleEl = document.getElementById("portalRole");
  const avatarEl = document.getElementById("avatar");

  if (userNameEl) userNameEl.textContent = displayName;
  if (userRoleEl) userRoleEl.textContent = roleLabel;
  if (portalRoleEl) portalRoleEl.textContent = `${roleLabel} Portal`;

  if (avatarEl) {
    if (user.photoURL) {
      avatarEl.innerHTML = `<img src="${esc(user.photoURL)}" alt="${esc(displayName)}">`;
    } else {
      avatarEl.textContent = displayName.charAt(0).toUpperCase();
    }
  }

  if (isAdmin) {
    const nav = document.getElementById("sidebarNav");
    if (nav && !document.getElementById("adminNav")) {
      const a = document.createElement("a");
      a.id = "adminNav";
      a.href = "admin.html";
      a.innerHTML = '<i data-lucide="shield-check"></i>Admin Panel';
      nav.appendChild(a);
    }
  }

  if (authLoading) authLoading.hidden = true;
  if (clubsApp) clubsApp.hidden = false;
  refreshIcons();

  await loadClubsAndStats();
});

/* ---------- data loading ---------- */

async function loadClubsAndStats() {
  if (gridEl) {
    gridEl.innerHTML = '<p class="empty">Loading campus clubs…</p>';
  }

  try {
    const [clubsSnap, joinedSnap, userSnap] = await Promise.all([
      getDocs(collection(db, "clubs")),
      getDocs(collection(db, "users", currentUser.uid, "joinedClubs")).catch(() => null),
      getDoc(doc(db, "users", currentUser.uid)).catch(() => null)
    ]);

    allClubs = clubsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    joinedClubIds = new Set(joinedSnap ? joinedSnap.docs.map((d) => d.id) : []);

    // Load user's RSVP count for Club Statistics (best effort)
    let rsvpCount = 0;
    try {
      const rsvpSnap = await getDocs(collectionGroup(db, "rsvps"));
      rsvpSnap.forEach((d) => {
        if (d.id === currentUser.uid) rsvpCount++;
      });
    } catch {
      rsvpCount = 0;
    }

    const certsCount = userSnap?.exists() ? Number(userSnap.data().certificates) || 0 : 0;

    renderClubs();
    renderMyClubs();
    updateStats(rsvpCount, certsCount);
  } catch (error) {
    console.error("Error loading clubs:", error);
    if (gridEl) {
      gridEl.innerHTML =
        '<p class="empty">Failed to load clubs. Please check your connection or Firestore rules.</p>';
    }
    showToast(toastEl, "Could not load clubs.");
  }
}

/* ---------- rendering ---------- */

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
    const matchesCat =
      currentCategory === "all" || cat === currentCategory.toLowerCase();
    const matchesMine = !onlyMine || isJoined(club);

    return matchesSearch && matchesCat && matchesMine;
  });

  if (sortMode === 1) {
    filtered = [...filtered].sort((a, b) =>
      (a.name || a.title || "").localeCompare(b.name || b.title || "")
    );
  } else if (sortMode === 2) {
    filtered = [...filtered].sort(
      (a, b) => getClubMemberCount(b) - getClubMemberCount(a)
    );
  }

  if (filtered.length === 0) {
    const emptyMsg = allClubs.length === 0
      ? "No campus clubs have been created yet."
      : onlyMine
        ? "You haven't joined any clubs matching this filter yet."
        : "No matching clubs found. Try another category or search term.";
    gridEl.innerHTML = `<p class="empty">${esc(emptyMsg)}</p>`;
    refreshIcons();
    return;
  }

  gridEl.innerHTML = filtered
    .map((club) => {
      const name = club.name || club.title || "Campus Club";
      const desc = club.desc || club.description || "Explore activities and events with us.";
      const cat = club.cat || club.category || "General";
      const count = getClubMemberCount(club);
      const theme = themeForClub(club);
      const iconName = iconForClub(club);
      const joined = isJoined(club);
      const detailsHref = `club-details.html?id=${encodeURIComponent(club.id)}`;

      return `
        <article class="card ${theme}">
          <div class="card-top">
            <div class="ico"><i data-lucide="${iconName}"></i></div>
            <span class="tag">${esc(cat)}</span>
          </div>
          <h3>${esc(name)}</h3>
          <p>${esc(desc)}</p>
          <div class="foot">
            <span class="members"><i data-lucide="users"></i> ${count} ${count === 1 ? "Member" : "Members"}</span>
            <a class="btn ${joined ? "joined" : ""}" href="${detailsHref}">
              ${joined ? '<i data-lucide="check"></i> Joined · View' : 'View &amp; Join <i data-lucide="arrow-right"></i>'}
            </a>
          </div>
        </article>`;
    })
    .join("");

  refreshIcons();
}

function renderMyClubs() {
  if (!myClubsEl) return;

  const mine = allClubs.filter((club) => isJoined(club));

  if (mine.length === 0) {
    myClubsEl.innerHTML = `<li class="my-empty">You haven't joined any clubs yet. Click any club to request membership!</li>`;
    return;
  }

  myClubsEl.innerHTML = mine
    .map((club) => {
      const name = club.name || club.title || "Campus Club";
      const cat = club.cat || club.category || "General";
      const theme = themeForClub(club);
      const href = `club-details.html?id=${encodeURIComponent(club.id)}`;

      return `
        <li>
          <a href="${href}">
            <span class="ico ${theme}">${esc(name.charAt(0).toUpperCase())}</span>
            <span>
              <b>${esc(name)}</b>
              <small>${esc(cat)}</small>
            </span>
            <i data-lucide="chevron-right" class="go"></i>
          </a>
        </li>`;
    })
    .join("");

  refreshIcons();
}

function updateStats(rsvpCount, certsCount) {
  const joinedTotal = allClubs.filter((club) => isJoined(club)).length;
  const stJoined = document.getElementById("stJoined");
  const stTotal = document.getElementById("stTotal");
  const stEvents = document.getElementById("stEvents");
  const stCerts = document.getElementById("stCerts");

  if (stJoined) stJoined.textContent = String(Math.max(joinedTotal, joinedClubIds.size));
  if (stTotal) stTotal.textContent = String(allClubs.length);
  if (stEvents) stEvents.textContent = String(rsvpCount);
  if (stCerts) stCerts.textContent = String(certsCount);
}

/* ---------- interactions ---------- */

// Category chips
const chipsContainer = document.getElementById("chips");
chipsContainer?.addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip");
  if (!chip) return;
  onlyMine = false;
  if (viewAllBtn) viewAllBtn.innerHTML = 'Filter Mine <i data-lucide="arrow-right"></i>';
  currentCategory = (chip.dataset.cat || "all").toLowerCase();
  chipsContainer.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c === chip);
  });
  renderClubs();
});

// Synced search inputs
function handleSearchInput(val, otherInput) {
  searchQuery = val.toLowerCase().trim();
  if (otherInput && otherInput.value !== val) {
    otherInput.value = val;
  }
  renderClubs();
}

globalSearch?.addEventListener("input", (e) => handleSearchInput(e.target.value, clubSearch));
clubSearch?.addEventListener("input", (e) => handleSearchInput(e.target.value, globalSearch));

// Sort cycle button
const SORT_LABELS = ["Default", "Name (A–Z)", "Most Members"];
sortBtn?.addEventListener("click", () => {
  sortMode = (sortMode + 1) % SORT_LABELS.length;
  sortBtn.title = `Sort: ${SORT_LABELS[sortMode]}`;
  showToast(toastEl, `Sorted by: ${SORT_LABELS[sortMode]}`);
  renderClubs();
});

// My Clubs "Filter Mine" toggle
viewAllBtn?.addEventListener("click", () => {
  onlyMine = !onlyMine;
  viewAllBtn.innerHTML = onlyMine
    ? 'Show All <i data-lucide="arrow-right"></i>'
    : 'Filter Mine <i data-lucide="arrow-right"></i>';
  renderClubs();
  gridEl?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// CTA "Browse All Clubs"
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

// Mobile sidebar drawer
function setDrawer(open) {
  sidebar?.classList.toggle("open", open);
  sidebarBackdrop?.classList.toggle("show", open);
  menuBtn?.setAttribute("aria-expanded", String(open));
}

menuBtn?.addEventListener("click", () => {
  setDrawer(!sidebar?.classList.contains("open"));
});
sidebarBackdrop?.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setDrawer(false);
});

// Coming soon placeholders
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-coming-soon]");
  if (!link) return;
  e.preventDefault();
  showToast(toastEl, `${link.dataset.comingSoon} page is coming soon.`);
});

// Logout
logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut(auth);
    localStorage.removeItem(USER_KEY);
    window.location.replace("index.html");
  } catch (error) {
    console.error("Logout error:", error);
    showToast(toastEl, "Unable to log out. Please try again.");
    logoutBtn.disabled = false;
  }
});
