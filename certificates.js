// CampusConnect Certificates & Credits page.
//
// Students get both tabs shown in the Student Portal design:
//   1. My Certificates — 3x2 certificate cards (View Certificate + Download),
//      Total Credits Earned spotlight card, and Recent Activity feed.
//   2. My Credits — Total Credits / This Semester / Last Month summary cards,
//      Credit History table, Credit Categories (2x2), How to Earn Credits, and
//      Keep Participating CTA.
//
// Admins / Mentors get inline certificate & credit issuance so every record is
// 100% live from Firestore (`users/{uid}/certificates`).
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { loadStudentProfiles } from "./student-lookup.js";
import {
  USER_KEY,
  esc,
  safeHttpUrl,
  todayStr,
  fmtShortDate,
  initThemeToggle,
  refreshIcons,
  showToast,
  isSignedInAsStudent
} from "./utils.js";
import {
  certificateCardHTML,
  certActivityItemHTML,
  creditHistoryRowHTML,
  creditBucket,
  renderCertificateDataUrl
} from "./certificates-ui.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
const toast = (msg, ms) => showToast(toastEl, msg, ms);

/* ---------- state ---------- */
let me = null;
let studentFullName = "Student";
let isAdmin = false;
let activeTab = new URLSearchParams(window.location.search).get("tab") === "credits" ? "credits" : "certificates";
let searchQuery = "";
let creditCatFilter = ""; // "" | "technical" | "cultural" | "sports" | "social"
let certs = []; // student: own certificates; admin: all issued certificates
let certUnsub = null;
let notifAllRead = false;
let activePreviewCert = null;

// Admin state
let adminStudents = [];
let adminEvents = [];

/* ---------- boot ---------- */
onAuthStateChanged(auth, async (user) => {
  cleanup();

  if (!user) {
    window.location.replace("index.html");
    return;
  }

  me = user;
  let name = user.displayName || user.email || "Student";

  const forcedStudent = isSignedInAsStudent(user);
  isAdmin = forcedStudent ? false : await checkIsAdmin(user);

  const profile = await ensureStudentProfile(user, { isAdmin });
  if (profile && profile.name) name = profile.name;
  studentFullName = name;

  if (isAdmin) {
    paintAdminHeader(name);
    await enterAdminView();
    await startAdminData();
  } else {
    paintStudentHeader(name, user.email || "", user.photoURL);
    await enterStudentView();
    switchStudentTab(activeTab, false);
    startStudentListener();
  }

  if ($("authLoading")) $("authLoading").hidden = true;
  refreshIcons();
});

function cleanup() {
  if (certUnsub) {
    try { certUnsub(); } catch { /* ignore */ }
    certUnsub = null;
  }
}

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
  await loadCss("certificates.css");
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
  if ($("userName")) $("userName").textContent = firstName;
  if ($("userRole")) $("userRole").textContent = "Student";
  if ($("portalRole")) $("portalRole").textContent = "Student Portal";
  if ($("evDdName")) $("evDdName").textContent = name;
  if ($("evDdEmail")) $("evDdEmail").textContent = email;

  const avatarEl = $("avatar");
  if (avatarEl) {
    if (photoURL) avatarEl.innerHTML = `<img src="${esc(photoURL)}" alt="${esc(name)}">`;
    else avatarEl.textContent = String(name || "?").charAt(0).toUpperCase();
  }
}

function paintAdminHeader(name) {
  if ($("adminName")) $("adminName").textContent = name;
  if ($("adminAv")) $("adminAv").textContent = String(name || "A").charAt(0).toUpperCase();
}

/* ======================================================================
   STUDENT VIEW — My Certificates & My Credits
   ====================================================================== */

function switchStudentTab(tab, pushUrl = true) {
  activeTab = tab === "credits" ? "credits" : "certificates";
  const isCredits = activeTab === "credits";

  if ($("certsSection")) $("certsSection").hidden = isCredits;
  if ($("creditsSection")) $("creditsSection").hidden = !isCredits;

  // Update search placeholder & sidebar active label like the two frames in image-2
  const searchEl = $("certSearch");
  if (searchEl) {
    searchEl.placeholder = isCredits
      ? "Search credits, events, or keywords..."
      : "Search certificates, events, or keywords...";
  }

  const sideText = $("sidebarCertText");
  const sideIcon = $("sidebarCertIcon");
  if (sideText) sideText.textContent = isCredits ? "Credits" : "Certificates / Credits";
  if (sideIcon) sideIcon.setAttribute("data-lucide", isCredits ? "star" : "trophy");

  document.querySelectorAll("[data-cc-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ccTab === activeTab);
  });

  if (pushUrl) {
    const params = new URLSearchParams(window.location.search);
    if (isCredits) params.set("tab", "credits");
    else params.delete("tab");
    const qs = params.toString();
    const nextUrl = `certificates.html${qs ? "?" + qs : ""}`;
    window.history.replaceState(null, "", nextUrl);
  }

  renderStudent();
  refreshIcons();
}

function startStudentListener() {
  const ref = query(collection(db, "users", me.uid, "certificates"), orderBy("date", "desc"));
  certUnsub = onSnapshot(
    ref,
    (snap) => {
      certs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderStudent();
    },
    (err) => {
      console.error("Certificates listener error:", err);
      if ($("certGrid")) {
        $("certGrid").innerHTML =
          '<p class="empty">Could not load certificates right now. Check your connection or Firestore rules.</p>';
      }
    }
  );
}

function totalCreditsOf(list) {
  return list.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
}

function semesterCreditsOf(list) {
  const now = new Date();
  const curYear = now.getFullYear();
  const secondHalf = now.getMonth() >= 6; // Jul-Dec vs Jan-Jun
  return list.reduce((sum, c) => {
    if (!c.date) return sum + (Number(c.credits) || 0);
    const d = new Date(c.date + "T00:00:00");
    if (Number.isNaN(d.getTime())) return sum;
    const inSem = d.getFullYear() === curYear && (d.getMonth() >= 6) === secondHalf;
    return inSem ? sum + (Number(c.credits) || 0) : sum;
  }, 0);
}

function lastMonthCreditsOf(list) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 35);
  return list.reduce((sum, c) => {
    if (!c.date) return sum;
    const d = new Date(c.date + "T00:00:00");
    if (Number.isNaN(d.getTime())) return sum;
    return d >= cutoff ? sum + (Number(c.credits) || 0) : sum;
  }, 0);
}

function renderStudent() {
  if (!me || isAdmin) return;

  const totalCredits = totalCreditsOf(certs);

  // --- 1. MY CERTIFICATES VIEW ---
  if ($("certTotalCredits")) $("certTotalCredits").textContent = String(totalCredits);

  const filteredCerts = certs.filter((c) => {
    if (!searchQuery) return true;
    return `${c.title || ""} ${c.club || ""} ${c.cat || ""}`.toLowerCase().includes(searchQuery);
  });

  const gridEl = $("certGrid");
  if (gridEl) {
    if (!filteredCerts.length) {
      const msg =
        certs.length === 0
          ? "No certificates or credits have been issued to your account yet. Participate in campus events and workshops to earn certificates!"
          : "No certificates match your search.";
      gridEl.innerHTML = `<p class="empty">${esc(msg)}</p>`;
    } else {
      gridEl.innerHTML = filteredCerts.map(certificateCardHTML).join("");
    }
  }

  // Recent Activity rail (alternates certificate issued & credits added entries from real records)
  const recentEl = $("certRecentList");
  if (recentEl) {
    if (!certs.length) {
      recentEl.innerHTML = '<li class="ev-up-empty">Your issued certificates and earned credits will appear here.</li>';
    } else {
      const activities = certs.slice(0, 4).map((c) => ({
        id: c.id,
        kind: c.badgeType === "credits" ? "credit" : "cert",
        title: c.title || c.eventTitle || "Campus Event",
        date: c.date
      }));
      recentEl.innerHTML = activities.map(certActivityItemHTML).join("");
    }
  }

  // --- 2. MY CREDITS VIEW ---
  if ($("crStatTotal")) $("crStatTotal").textContent = String(totalCredits);
  if ($("crStatSemester")) $("crStatSemester").textContent = String(semesterCreditsOf(certs));
  if ($("crStatMonth")) $("crStatMonth").textContent = String(lastMonthCreditsOf(certs));

  // Category breakdown (Technical, Cultural, Sports, Social)
  const buckets = { technical: 0, cultural: 0, sports: 0, social: 0 };
  certs.forEach((c) => {
    const b = creditBucket(c);
    buckets[b] = (buckets[b] || 0) + (Number(c.credits) || 0);
  });
  const fmtCr = (n) => `${n} ${n === 1 ? "Credit" : "Credits"}`;
  if ($("crCatTech")) $("crCatTech").textContent = fmtCr(buckets.technical);
  if ($("crCatCult")) $("crCatCult").textContent = fmtCr(buckets.cultural);
  if ($("crCatSport")) $("crCatSport").textContent = fmtCr(buckets.sports);
  if ($("crCatSocial")) $("crCatSocial").textContent = fmtCr(buckets.social);

  document.querySelectorAll("[data-cr-cat]").forEach((tile) => {
    tile.classList.toggle("active", tile.dataset.crCat === creditCatFilter);
  });

  const filterTag = $("crCategoryFilterTag");
  const filterLbl = $("crCategoryFilterLabel");
  if (filterTag && filterLbl) {
    if (creditCatFilter) {
      filterLbl.textContent = creditCatFilter.charAt(0).toUpperCase() + creditCatFilter.slice(1);
      filterTag.hidden = false;
    } else {
      filterTag.hidden = true;
    }
  }

  const historyRows = certs.filter((c) => {
    if (creditCatFilter && creditBucket(c) !== creditCatFilter) return false;
    if (searchQuery && !`${c.title || ""} ${c.club || ""} ${c.cat || ""}`.toLowerCase().includes(searchQuery)) {
      return false;
    }
    return true;
  });

  const tbody = $("creditHistoryBody");
  if (tbody) {
    if (!historyRows.length) {
      const emptyTxt =
        certs.length === 0
          ? "No credits recorded yet. Participate in club events and workshops to start earning credits!"
          : "No credit history entries match this filter.";
      tbody.innerHTML = `<tr><td colspan="4" class="cr-empty-cell">${esc(emptyTxt)}</td></tr>`;
    } else {
      tbody.innerHTML = historyRows.map(creditHistoryRowHTML).join("");
    }
  }

  renderNotifications();
  refreshIcons();
}

function renderNotifications() {
  const badgeEl = $("evNotifBadge");
  const listEl = $("evNotifList");
  if (!badgeEl || !listEl) return;

  const recent = certs.slice(0, 3);
  const unread = notifAllRead ? 0 : recent.length;
  badgeEl.textContent = String(unread);
  badgeEl.hidden = unread === 0;

  if (!recent.length) {
    listEl.innerHTML = '<li class="ev-notif-empty">No new certificate alerts yet.</li>';
    return;
  }

  listEl.innerHTML = recent
    .map(
      (c) => `
      <li>
        <a href="#" data-notif-cert="${esc(c.id)}">
          <span class="ev-notif-dot"></span>
          <div>
            <b>Certificate issued: ${esc(c.title || "Campus Event")}</b>
            <small>${esc(c.club || "Campus Club")}${c.credits ? ` · +${Number(c.credits)} Credits` : ""}</small>
          </div>
        </a>
      </li>`
    )
    .join("");
}

/* ---------- Certificate Preview & PNG Download ---------- */

function openCertViewer(certId) {
  const cert = certs.find((c) => c.id === certId);
  if (!cert) return;
  activePreviewCert = cert;

  const dataUrl = renderCertificateDataUrl(cert, cert.studentName || studentFullName);
  if ($("certViewerTitle")) $("certViewerTitle").textContent = cert.title || "Participation Certificate";
  if ($("certViewerSub")) {
    $("certViewerSub").textContent = `${cert.club || "MITS Gwalior"} • ${cert.date ? fmtShortDate(cert.date) : "Verified"}`;
  }
  if ($("certPreviewImg")) $("certPreviewImg").src = dataUrl;

  const extLink = $("certExternalLink");
  const validExt = safeHttpUrl(cert.certificateUrl || "");
  if (extLink) {
    if (validExt) {
      extLink.href = validExt;
      extLink.hidden = false;
    } else {
      extLink.hidden = true;
    }
  }

  if ($("certViewerModal")) $("certViewerModal").hidden = false;
  refreshIcons();
}

function downloadCertPng(cert) {
  if (!cert) return;
  const dataUrl = renderCertificateDataUrl(cert, cert.studentName || studentFullName);
  const slug = String(cert.title || "certificate")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${slug || "mitsconnect"}-certificate.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Certificate downloaded!");
}

/* ---------- Student UI Event Listeners ---------- */

document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest("[data-cc-tab]");
  if (tabBtn) {
    e.preventDefault();
    switchStudentTab(tabBtn.dataset.ccTab);
    return;
  }

  const viewBtn = e.target.closest("[data-view-cert]");
  if (viewBtn) {
    openCertViewer(viewBtn.dataset.viewCert);
    return;
  }

  const actBtn = e.target.closest("[data-act-cert]");
  if (actBtn && actBtn.dataset.actCert) {
    openCertViewer(actBtn.dataset.actCert);
    return;
  }

  const notifCert = e.target.closest("[data-notif-cert]");
  if (notifCert) {
    e.preventDefault();
    closeTopMenus();
    openCertViewer(notifCert.dataset.notifCert);
    return;
  }

  const dlBtn = e.target.closest("[data-dl-cert]");
  if (dlBtn) {
    const cert = certs.find((c) => c.id === dlBtn.dataset.dlCert);
    downloadCertPng(cert);
    return;
  }

  const catTile = e.target.closest("[data-cr-cat]");
  if (catTile) {
    const chosen = catTile.dataset.crCat;
    creditCatFilter = creditCatFilter === chosen ? "" : chosen;
    renderStudent();
    return;
  }

  const cs = e.target.closest("[data-coming-soon]");
  if (cs) {
    e.preventDefault();
    toast(`${cs.dataset.comingSoon} page is coming soon.`);
  }
});

$("certViewHistoryBtn")?.addEventListener("click", () => switchStudentTab("credits"));
$("crShowAllCats")?.addEventListener("click", () => {
  creditCatFilter = "";
  renderStudent();
});
$("crClearCatFilter")?.addEventListener("click", () => {
  creditCatFilter = "";
  renderStudent();
});

$("certSearch")?.addEventListener("input", (e) => {
  searchQuery = e.target.value.toLowerCase().trim();
  renderStudent();
});

$("closeCertViewer")?.addEventListener("click", () => {
  if ($("certViewerModal")) $("certViewerModal").hidden = true;
});
$("certViewerModal")?.addEventListener("click", (e) => {
  if (e.target === $("certViewerModal")) $("certViewerModal").hidden = true;
});
$("modalDownloadBtn")?.addEventListener("click", () => {
  if (activePreviewCert) downloadCertPng(activePreviewCert);
});

/* Topbar menus + drawer + logout */
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
});

$("evMarkRead")?.addEventListener("click", (e) => {
  e.stopPropagation();
  notifAllRead = true;
  renderNotifications();
  toast("Notifications marked as read.");
});

$("evUserBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("evUserMenu");
  if (!menu) return;
  const open = menu.hidden;
  closeTopMenus();
  menu.hidden = !open;
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".ev-notif-wrap") && !e.target.closest(".ev-user-wrap")) {
    closeTopMenus();
  }
});

function setDrawer(open) {
  $("sidebar")?.classList.toggle("open", open);
  $("sidebarBackdrop")?.classList.toggle("show", open);
  $("menuBtn")?.setAttribute("aria-expanded", String(open));
}
$("menuBtn")?.addEventListener("click", () => setDrawer(!$("sidebar")?.classList.contains("open")));
$("sidebarBackdrop")?.addEventListener("click", () => setDrawer(false));

async function logout() {
  cleanup();
  try { await signOut(auth); } catch { /* ignore */ }
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  window.location.replace("index.html");
}
$("studentLogout")?.addEventListener("click", logout);
$("adminLogout")?.addEventListener("click", logout);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setDrawer(false);
    closeTopMenus();
    if ($("certViewerModal")) $("certViewerModal").hidden = true;
    if ($("issueModal")) $("issueModal").hidden = true;
  }
});

/* ======================================================================
   ADMIN / MENTOR VIEW — Issue Certificates & Credits to Students
   ====================================================================== */

async function startAdminData() {
  try {
    const [profilesMap, eventsSnap] = await Promise.all([
      loadStudentProfiles(),
      getDocs(query(collection(db, "events"), orderBy("date", "desc"))).catch(() => null)
    ]);

    adminStudents = [...profilesMap.byUid.values()]
      .filter((p) => p.uid)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    adminEvents = eventsSnap ? eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];

    populateAdminDropdowns();
  } catch (err) {
    console.warn("Could not preload student/event lists:", err);
  }

  certUnsub = onSnapshot(
    collectionGroup(db, "certificates"),
    (snap) => {
      certs = snap.docs
        .map((d) => ({
          id: d.id,
          uid: d.ref.parent?.parent?.id || "",
          ...d.data()
        }))
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      renderAdminList();
    },
    (err) => {
      console.error("Admin certificates read error:", err);
      if ($("adminCertList")) {
        $("adminCertList").innerHTML =
          '<p class="empty">Ensure Firestore rules allow collectionGroup("certificates") reads for admins, or issue a new certificate above.</p>';
      }
    }
  );
}

function populateAdminDropdowns() {
  const studentSel = $("studentSelect");
  if (studentSel) {
    studentSel.innerHTML =
      '<option value="">Select a registered student…</option>' +
      adminStudents
        .map(
          (s) =>
            `<option value="${esc(s.uid)}">${esc(s.name || s.email)} (${esc(s.rollNo || s.email || s.uid)})</option>`
        )
        .join("");
  }

  const eventSel = $("eventSelect");
  if (eventSel) {
    eventSel.innerHTML =
      '<option value="">Custom workshop / club activity</option>' +
      adminEvents
        .map((ev) => `<option value="${esc(ev.id)}">${esc(ev.title)} · ${esc(ev.club || "General")}</option>`)
        .join("");
  }
}

$("eventSelect")?.addEventListener("change", (e) => {
  const ev = adminEvents.find((x) => x.id === e.target.value);
  if (!ev || !$("issueForm")) return;
  const f = $("issueForm").elements;
  f.title.value = ev.title || "";
  f.club.value = ev.club || "General";
  if (ev.cat) f.cat.value = ev.cat;
  if (ev.date) f.date.value = ev.date;
});

function renderAdminList() {
  const listEl = $("adminCertList");
  if (!listEl) return;

  const totalCredits = totalCreditsOf(certs);
  const uniqueStudents = new Set(certs.map((c) => c.uid).filter(Boolean)).size;

  if ($("admCertCount")) $("admCertCount").textContent = String(certs.length);
  if ($("admCreditSum")) $("admCreditSum").textContent = String(totalCredits);
  if ($("admStudentCount")) $("admStudentCount").textContent = String(uniqueStudents);

  if (!certs.length) {
    listEl.innerHTML =
      '<p class="empty">No certificates issued yet. Click “+ Issue certificate / credits” above to award the first one.</p>';
    return;
  }

  listEl.innerHTML = certs
    .map(
      (c) => `
      <article class="card">
        <div class="row">
          <div class="info">
            <span class="club">${esc(c.club || c.cat || "General")}</span>
            <h3>${esc(c.title || "Certificate")}</h3>
            <div class="meta">
              Awarded to <b>${esc(c.studentName || c.studentEmail || c.uid)}</b>
              · ${esc(c.date ? fmtShortDate(c.date) : "Date N/A")}
              · <b>${Number(c.credits) || 0} Credits</b>
            </div>
          </div>
          <button class="btn danger sm" type="button" data-revoke-uid="${esc(c.uid)}" data-revoke-id="${esc(c.id)}">
            Revoke
          </button>
        </div>
      </article>`
    )
    .join("");
}

$("issueCertBtn")?.addEventListener("click", () => {
  const form = $("issueForm");
  if (form) {
    form.reset();
    form.elements.date.value = todayStr();
    form.elements.credits.value = "2";
  }
  if ($("issueModal")) $("issueModal").hidden = false;
});

$("issueModal")?.addEventListener("click", (e) => {
  if (e.target === $("issueModal") || e.target.closest("[data-close-issue]")) {
    $("issueModal").hidden = true;
  }
});

async function syncUserTotals(uid) {
  try {
    const snap = await getDocs(collection(db, "users", uid, "certificates"));
    let certTotal = snap.size;
    let creditTotal = 0;
    snap.forEach((d) => {
      creditTotal += Number(d.data().credits) || 0;
    });
    await updateDoc(doc(db, "users", uid), {
      certificates: certTotal,
      credits: creditTotal,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn("Could not sync summary counters on user doc:", err);
  }
}

$("issueForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const uid = f.uid.value.trim();
  const title = f.title.value.trim();
  const club = f.club.value.trim();
  const cat = f.cat.value || "Technical";
  const date = f.date.value;
  const credits = Math.max(0, parseInt(f.credits.value, 10) || 0);
  const badgeType = f.badgeType.value === "credits" ? "credits" : "issued";
  const rawUrl = f.certificateUrl.value.trim();

  if (!uid || !title || !club || !date) {
    toast("Please fill in student, title, club, and date.");
    return;
  }
  if (rawUrl && !safeHttpUrl(rawUrl)) {
    toast("External URL must start with http:// or https://");
    return;
  }

  const studentObj = adminStudents.find((s) => s.uid === uid) || {};
  let studentName = studentObj.name || "";
  if (!studentName) {
    const uSnap = await getDoc(doc(db, "users", uid)).catch(() => null);
    if (uSnap?.exists()) studentName = uSnap.data().name || uSnap.data().email || "Student";
  }

  const saveBtn = $("issueSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    await addDoc(collection(db, "users", uid, "certificates"), {
      title,
      club,
      cat,
      date,
      credits,
      badgeType,
      certificateUrl: rawUrl ? safeHttpUrl(rawUrl) : "",
      eventId: f.eventId.value || "",
      studentName: studentName || "Student",
      studentEmail: studentObj.email || "",
      issuedBy: me.uid,
      issuedByName: me.displayName || me.email || "Coordinator",
      createdAt: serverTimestamp()
    });

    await syncUserTotals(uid);
    $("issueModal").hidden = true;
    toast(`Issued certificate & ${credits} credits to ${studentName || "student"}!`);
  } catch (err) {
    console.error("Issue certificate error:", err);
    toast("Could not issue certificate. Check Firestore rules.");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
});

$("adminCertList")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-revoke-id]");
  if (!btn) return;
  if (!window.confirm("Revoke this certificate and deduct its credits from the student?")) return;

  const uid = btn.dataset.revokeUid;
  const id = btn.dataset.revokeId;
  btn.disabled = true;

  try {
    await deleteDoc(doc(db, "users", uid, "certificates", id));
    await syncUserTotals(uid);
    toast("Certificate revoked.");
  } catch (err) {
    console.error("Revoke error:", err);
    toast("Could not revoke certificate.");
    btn.disabled = false;
  }
});
