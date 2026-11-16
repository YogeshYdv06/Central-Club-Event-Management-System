// CampusConnect Dashboard: authentication, live events, live clubs, RSVPs, stats, and interactivity.
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  collectionGroup,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";
import { toggleEventRsvp, rsvpErrorMessage } from "./rsvp-client.js?v=20261116c";
import {
  USER_KEY,
  esc,
  todayStr,
  parts,
  fmtTime,
  refreshIcons,
  getClubMemberCount,
  isUserInLegacyMembers,
  isSignedInAsStudent
} from "./utils.js";

const loading = document.getElementById("authLoading");
const dashboard = document.getElementById("dashboardContent");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("dashboardSearch");
const bellBtn = document.getElementById("bellBtn");
const bellMenu = document.getElementById("bellMenu");
const notifBadge = document.getElementById("notifBadge");
const markAllReadBtn = document.getElementById("markAllReadBtn");
const toastBox = document.getElementById("toastBox");

let me = null;
let events = [];
let clubs = [];
let rsvps = {}; // { eventId: [uid, ...] }
let joinedClubIds = new Set();
let notifications = [];
const readNotifIds = new Set();
const inFlightRsvps = new Set();
let unsubs = [];

/**
 * Attendance counts come from the transactional `rsvpCount` counter on the
 * event document (kept in sync by rsvp-client.js). Events that predate the
 * counter fall back to the live RSVP subcollection.
 */
function goingCountFor(event) {
  if (event && typeof event.rsvpCount === "number") return Math.max(0, event.rsvpCount);
  return (rsvps[event?.id] || []).length;
}

function isGoingTo(event) {
  return Boolean(me) && (rsvps[event?.id] || []).includes(me.uid);
}

const MAX_CREDITS = 20;
const YEAR_LABELS = { 1: "1st year", 2: "2nd year", 3: "3rd year", 4: "4th year" };

/* ---------- helpers ---------- */

function notify(msg, type = "info") {
  if (!toastBox) return;
  const el = document.createElement("div");
  el.className = `toast-item ${type}`;
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

function updateGreetingPrefix() {
  const h = new Date().getHours();
  const text = h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  const prefixEl = document.getElementById("greetingPrefix");
  if (prefixEl) prefixEl.textContent = text;
}

function themeFor(club) {
  const c = (club || "").toLowerCase();
  if (/sport|football|cricket|athlet|game/.test(c)) {
    return { thumb: "th-sport", tag: "tag-green", btn: "btn-green" };
  }
  if (/music|dance|cultur|drama|photo|art|film/.test(c)) {
    return { thumb: "th-cult", tag: "tag-purple", btn: "btn-purple" };
  }
  return { thumb: "th-tech", tag: "tag-blue", btn: "btn-primary" };
}

function clubGradient(theme, cat) {
  const key = (theme || cat || "").toLowerCase();
  if (key.includes("green") || key.includes("cultur")) return "linear-gradient(135deg,#10b981,#047857)";
  if (key.includes("orange") || key.includes("sport")) return "linear-gradient(135deg,#f59e0b,#b45309)";
  if (key.includes("purple") || key.includes("liter")) return "linear-gradient(135deg,#8b5cf6,#6d28d9)";
  if (key.includes("pink") || key.includes("social")) return "linear-gradient(135deg,#ec4899,#be185d)";
  if (key.includes("teal")) return "linear-gradient(135deg,#06b6d4,#0e7490)";
  return "linear-gradient(135deg,#6366f1,#4f46e5)";
}

function stopLiveData() {
  unsubs.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
  unsubs = [];
}

/* ---------- authentication ---------- */

updateGreetingPrefix();

onAuthStateChanged(auth, async (user) => {
  stopLiveData();

  if (!user) {
    window.location.replace("index.html");
    return;
  }

  me = user;

  try {
    const uid = user.uid;
    const isAdmin = isSignedInAsStudent(user) ? false : await checkIsAdmin(user);
    const role = isAdmin ? "Admin" : "Student";

    const userRef = doc(db, "users", uid);
    const userSnapshot = await getDoc(userRef);
    const existingData = userSnapshot.exists() ? userSnapshot.data() : {};

    const userData = {
      uid,
      name: user.displayName || user.email || role,
      email: user.email || "",
      photoURL: user.photoURL || "",
      role,
      updatedAt: serverTimestamp()
    };

    if (!userSnapshot.exists()) {
      userData.createdAt = serverTimestamp();
    }

    await setDoc(userRef, userData, { merge: true });

    const nameEl = document.getElementById("profileName");
    const emailEl = document.getElementById("profileEmail");
    const photoEl = document.getElementById("profilePhoto");
    const greetingNameEl = document.getElementById("greetingName");
    const portalLabel = document.getElementById("portalRoleLabel");
    const badgePill = document.getElementById("userBadgePill");

    if (nameEl) nameEl.textContent = userData.name;
    if (emailEl) emailEl.textContent = userData.email;
    if (greetingNameEl) greetingNameEl.textContent = userData.name.split(" ")[0];
    if (portalLabel) portalLabel.textContent = `${role} Portal`;
    if (badgePill) badgePill.textContent = `MITS Gwalior • ${role}`;

    if (photoEl) {
      photoEl.src =
        userData.photoURL ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=6366f1&color=fff`;
      photoEl.alt = `${userData.name} profile photo`;
    }

    // Compulsory one-time student profile. The dashboard stays hidden behind the
    // loading state until this resolves, so the form cannot be skipped.
    const profile = await ensureStudentProfile(user, { isAdmin });

    if (profile && profile.name) {
      if (nameEl) nameEl.textContent = profile.name;
      if (greetingNameEl) greetingNameEl.textContent = profile.name.split(" ")[0];
      if (photoEl) {
        photoEl.alt = `${profile.name} profile photo`;
      }
      const badgeParts = ["MITS Gwalior", role];
      if (profile.branch) badgeParts.push(profile.branch);
      if (profile.year) badgeParts.push(YEAR_LABELS[profile.year] || "");
      if (badgePill) badgePill.textContent = badgeParts.filter(Boolean).join(" • ");
    }

    // Credits & certificates from user document (defaults to 0)
    const credits = Number(existingData.credits) || 0;
    const certs = Number(existingData.certificates) || 0;
    updateCreditsAndCerts(credits, certs);

  } catch (error) {
    console.error("Firestore profile error:", error);
    notify("Some profile details could not be loaded.", "error");
  } finally {
    if (loading) loading.hidden = true;
    if (dashboard) dashboard.hidden = false;
    refreshIcons();
    startLiveData();
  }
});

function updateCreditsAndCerts(credits, certs) {
  const creditsEl = document.getElementById("creditsCount");
  const certsEl = document.getElementById("certsCount");
  const barEl = document.getElementById("creditsProgressBar");
  const textEl = document.getElementById("creditsProgressText");

  if (creditsEl) creditsEl.textContent = String(credits).padStart(2, "0");
  if (certsEl) certsEl.textContent = String(certs).padStart(2, "0");
  if (textEl) textEl.textContent = `${credits} / ${MAX_CREDITS}`;
  if (barEl) {
    const pct = Math.min(100, Math.round((credits / MAX_CREDITS) * 100));
    barEl.style.width = `${pct}%`;
  }
}

/* ---------- live data ---------- */

function startLiveData() {
  if (!me) return;

  // 1. Live events
  unsubs.push(
    onSnapshot(
      query(collection(db, "events"), orderBy("date")),
      (snap) => {
        events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderAll();
      },
      (err) => {
        console.warn("Events read notice:", err);
        renderAll();
      }
    )
  );

  // 2. Live RSVPs
  unsubs.push(
    onSnapshot(
      collectionGroup(db, "rsvps"),
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const eid = d.ref.parent?.parent?.id;
          if (!eid) return;
          (map[eid] = map[eid] || []).push(d.id);
        });
        rsvps = map;
        renderAll();
      },
      (err) => console.warn("RSVP notice:", err)
    )
  );

  // 3. Live clubs
  unsubs.push(
    onSnapshot(
      collection(db, "clubs"),
      (snap) => {
        clubs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderAll();
      },
      (err) => {
        console.warn("Clubs read notice:", err);
        renderAll();
      }
    )
  );

  // 4. Current user's joinedClubs subcollection
  unsubs.push(
    onSnapshot(
      collection(db, "users", me.uid, "joinedClubs"),
      (snap) => {
        joinedClubIds = new Set(snap.docs.map((d) => d.id));
        renderAll();
      },
      (err) => console.warn("Joined clubs listener warning:", err)
    )
  );

  // 5. Current user's live certificates & credits
  unsubs.push(
    onSnapshot(
      collection(db, "users", me.uid, "certificates"),
      (snap) => {
        if (snap.empty) return;
        let creditSum = 0;
        snap.forEach((d) => {
          creditSum += Number(d.data().credits) || 0;
        });
        updateCreditsAndCerts(creditSum, snap.size);
      },
      (err) => console.warn("Certificates listener warning:", err)
    )
  );
}

function getEffectiveJoinedClubs() {
  if (!me) return [];
  return clubs.filter(
    (c) => joinedClubIds.has(c.id) || isUserInLegacyMembers(c, me)
  );
}

function renderAll() {
  if (!me) return;
  const today = todayStr();
  const upcoming = events
    .filter((e) => (e.date || "") >= today)
    .sort((a, b) =>
      (a.date + " " + (a.time || "")) < (b.date + " " + (b.time || "")) ? -1 : 1
    );

  renderCards(upcoming.slice(0, 3));
  renderCampusClubs(clubs.slice(0, 4));
  renderStats();
  renderRecentActivity(upcoming);
  renderNotifications(upcoming);
  runSearch();
  refreshIcons();
}

function renderCards(list) {
  const grid = document.getElementById("upcomingEventsGrid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = '<p class="empty-state-msg">No upcoming events yet. Check back soon.</p>';
    return;
  }

  grid.innerHTML = list
    .map((e) => {
      const going = goingCountFor(e);
      const mine = isGoingTo(e);
      const cap = Number(e.capacity) || 0;
      const full = cap > 0 && going >= cap && !mine;
      const busy = inFlightRsvps.has(e.id);
      const t = themeFor(e.club);
      const p = parts(e.date);

      let btn;
      if (mine) {
        btn = `<button class="btn btn-green" type="button" data-rsvp="${esc(e.id)}" ${busy ? "disabled" : ""} title="Click to cancel your RSVP">Registered ✓</button>`;
      } else if (full) {
        btn = `<button class="btn" type="button" disabled>Event Full</button>`;
      } else {
        btn = `<button class="btn ${t.btn}" type="button" data-rsvp="${esc(e.id)}" ${busy ? "disabled" : ""}>Register Now <i data-lucide="arrow-right"></i></button>`;
      }

      const detailsUrl = `event-details.html?id=${encodeURIComponent(e.id)}`;

      return `
        <article class="event">
          <div class="thumb ${t.thumb}">
            <span class="tag ${t.tag}">${esc(e.club || "General")}</span>
          </div>
          <h4><a href="${detailsUrl}">${esc(e.title)}</a></h4>
          <p><i data-lucide="calendar"></i>${esc(`${p.day} ${p.month} ${p.year}`.trim())}</p>
          <p><i data-lucide="clock"></i>${esc(fmtTime(e.time) || "Time TBA")}</p>
          <p><i data-lucide="map-pin"></i>${esc(e.location || "Venue TBA")}</p>
          <p><i data-lucide="users"></i>${going}${cap > 0 ? " / " + cap : ""} going</p>
          ${btn}
        </article>`;
    })
    .join("");
}

function renderCampusClubs(list) {
  const ul = document.getElementById("campusClubsList");
  if (!ul) return;

  if (!list.length) {
    ul.innerHTML = '<li class="empty-state-msg">No clubs published yet.</li>';
    return;
  }

  ul.innerHTML = list
    .map((club) => {
      const name = club.name || club.title || "Campus Club";
      const cat = club.cat || club.category || "General";
      const count = getClubMemberCount(club);
      const bg = clubGradient(club.theme, cat);
      const url = `club-details.html?id=${encodeURIComponent(club.id)}`;

      return `
        <li>
          <a class="club-mini-item" href="${url}">
            <div class="club-mini-icon" style="background:${bg}">
              ${esc(name.charAt(0).toUpperCase())}
            </div>
            <div class="club-mini-info">
              <strong>${esc(name)}</strong>
              <small>${esc(cat)} · ${count} ${count === 1 ? "Member" : "Members"}</small>
            </div>
            <i data-lucide="arrow-right" class="club-mini-arrow"></i>
          </a>
        </li>`;
    })
    .join("");
}

function renderStats() {
  const regEl = document.getElementById("registeredCount");
  const joinedEl = document.getElementById("joinedCount");

  if (regEl) {
    const existing = new Set(events.map((e) => e.id));
    const regCount = Object.keys(rsvps).filter(
      (eid) => existing.has(eid) && rsvps[eid].includes(me.uid)
    ).length;
    regEl.textContent = String(regCount).padStart(2, "0");
  }

  if (joinedEl) {
    const effective = getEffectiveJoinedClubs();
    const totalJoined = Math.max(effective.length, joinedClubIds.size);
    joinedEl.textContent = String(totalJoined).padStart(2, "0");
  }
}

function renderRecentActivity(upcoming) {
  const ul = document.getElementById("recentActivityList");
  if (!ul) return;

  const items = [];

  // User's RSVP'd events
  events.forEach((e) => {
    if ((rsvps[e.id] || []).includes(me.uid)) {
      const p = parts(e.date);
      items.push({
        icon: "calendar-check",
        color: "c-cyan",
        text: `Registered for ${e.title}`,
        time: `${p.day} ${p.month}`.trim() || "Upcoming",
        href: `event-details.html?id=${encodeURIComponent(e.id)}`
      });
    }
  });

  // User's joined clubs
  getEffectiveJoinedClubs().forEach((c) => {
    items.push({
      icon: "user-plus",
      color: "c-green",
      text: `Member of ${c.name || c.title || c.id}`,
      time: c.cat || "Club",
      href: `club-details.html?id=${encodeURIComponent(c.id)}`
    });
  });

  if (!items.length) {
    const hint = upcoming.length
      ? "Register for an upcoming event or join a club to see your activity here."
      : "No recent activity yet. Explore clubs and events to get started!";
    ul.innerHTML = `<li class="empty-state-msg">${esc(hint)}</li>`;
    return;
  }

  ul.innerHTML = items
    .slice(0, 5)
    .map(
      (item) => `
      <li>
        <a href="${item.href}" style="display:flex;align-items:center;gap:12px;width:100%;">
          <span class="ico ${item.color}"><i data-lucide="${item.icon}"></i></span>
          <span>${esc(item.text)}</span>
          <time>${esc(item.time)}</time>
          <i data-lucide="chevron-right"></i>
        </a>
      </li>`
    )
    .join("");
}

function renderNotifications(upcoming) {
  const next = [];

  upcoming.slice(0, 3).forEach((e) => {
    const p = parts(e.date);
    next.push({
      id: `ev-${e.id}`,
      text: `${e.title} registration is open!`,
      sub: `${p.day} ${p.month} ${p.year}`.trim(),
      color: "#f472b6"
    });
  });

  getEffectiveJoinedClubs()
    .slice(0, 2)
    .forEach((c) => {
      next.push({
        id: `cl-${c.id}`,
        text: `You are an active member of ${c.name || c.title}`,
        sub: c.cat || "Campus Club",
        color: "#10b981"
      });
    });

  notifications = next;
  const unreadCount = notifications.filter((n) => !readNotifIds.has(n.id)).length;

  if (notifBadge) {
    notifBadge.textContent = String(unreadCount);
    notifBadge.hidden = unreadCount === 0;
  }

  const cardList = document.getElementById("notificationsList");
  if (cardList) {
    cardList.innerHTML = notifications.length
      ? notifications
          .map(
            (n) => `
          <li>
            <i class="dot" style="--c:${n.color}"></i>
            <div>
              <strong>${esc(n.text)}</strong>
              <small>${esc(n.sub)}</small>
            </div>
          </li>`
          )
          .join("")
      : '<li class="empty-state-msg">No notifications yet.</li>';
  }

  const ddNotes = document.getElementById("ddNotes");
  if (ddNotes) {
    ddNotes.innerHTML = notifications.length
      ? notifications
          .map(
            (n) => `
          <div class="dd-note ${readNotifIds.has(n.id) ? "" : "unread"}">
            <i class="dot" style="--c:${n.color}"></i>
            <div>
              <strong>${esc(n.text)}</strong><br>
              <small>${esc(n.sub)}</small>
            </div>
          </div>`
          )
          .join("")
      : '<div class="dd-empty">No notifications</div>';
  }
}

/* ---------- live search ---------- */

function runSearch() {
  if (!searchInput) return;
  const q = searchInput.value.trim().toLowerCase();

  const sections = [
    { itemSel: "#upcomingEventsGrid .event", parentId: "upcomingEventsGrid" },
    { itemSel: "#campusClubsList > li:not(.empty-state-msg)", parentId: "campusClubsList" },
    { itemSel: "#recentActivityList > li:not(.empty-state-msg)", parentId: "recentActivityList" }
  ];

  sections.forEach(({ itemSel, parentId }) => {
    const parent = document.getElementById(parentId);
    if (!parent) return;

    const items = [...document.querySelectorAll(itemSel)];
    let shown = 0;

    items.forEach((el) => {
      const match = !q || el.textContent.toLowerCase().includes(q);
      el.hidden = !match;
      if (match) shown++;
    });

    const existingMsg = parent.querySelector(":scope > .no-results");
    if (q && items.length > 0 && shown === 0) {
      if (!existingMsg) {
        const msg = document.createElement(parent.tagName === "UL" ? "li" : "p");
        msg.className = "no-results";
        msg.textContent = "No matches found";
        parent.appendChild(msg);
      }
    } else if (existingMsg) {
      existingMsg.remove();
    }
  });
}

let searchTimer;
searchInput?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});

searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    searchInput.value = "";
    runSearch();
    searchInput.blur();
  }
});

document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    document.activeElement &&
    !/input|textarea|select/i.test(document.activeElement.tagName)
  ) {
    e.preventDefault();
    searchInput?.focus();
  }
  if (e.key === "Escape" && bellMenu && !bellMenu.hidden) {
    bellMenu.hidden = true;
    bellBtn?.setAttribute("aria-expanded", "false");
  }
});

/* ---------- bell dropdown ---------- */

bellBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!bellMenu) return;
  const nextHidden = !bellMenu.hidden;
  bellMenu.hidden = nextHidden;
  bellBtn.setAttribute("aria-expanded", String(!nextHidden));
});

markAllReadBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  notifications.forEach((n) => readNotifIds.add(n.id));
  renderAll();
  notify("All notifications marked as read", "success");
});

document.addEventListener("click", (e) => {
  if (bellMenu && !bellMenu.hidden && !e.target.closest("#bellMenu") && !e.target.closest("#bellBtn")) {
    bellMenu.hidden = true;
    bellBtn?.setAttribute("aria-expanded", "false");
  }
});

/* ---------- delegated clicks (RSVP & coming soon) ---------- */

document.addEventListener("click", async (ev) => {
  const comingSoon = ev.target.closest("[data-coming-soon]");
  if (comingSoon) {
    ev.preventDefault();
    notify(`${comingSoon.dataset.comingSoon} page is coming soon.`);
    return;
  }

  const rsvpBtn = ev.target.closest("button[data-rsvp]");
  if (!rsvpBtn || !me) return;

  const id = rsvpBtn.dataset.rsvp;
  if (inFlightRsvps.has(id)) return;

  const eventObj = events.find((e) => e.id === id);
  const going = isGoingTo(eventObj);
  const cap = Number(eventObj?.capacity) || 0;

  if (!going && cap > 0 && goingCountFor(eventObj) >= cap) {
    notify("Sorry, this event is now full.", "error");
    return;
  }

  inFlightRsvps.add(id);
  rsvpBtn.disabled = true;

  try {
    const result = await toggleEventRsvp(id);
    notify(result.going ? `Registered for ${eventObj?.title || "event"}!` : `RSVP cancelled for ${eventObj?.title || "event"}.`, "success");
  } catch (error) {
    console.error("RSVP error:", error);
    notify(rsvpErrorMessage(error), "error");
  } finally {
    inFlightRsvps.delete(id);
    if (rsvpBtn.isConnected) rsvpBtn.disabled = false;
  }
});

/* ---------- logout ---------- */

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  stopLiveData();
  try {
    await signOut(auth);
    localStorage.removeItem(USER_KEY);
    window.location.replace("index.html");
  } catch (error) {
    console.error("Logout error:", error);
    notify("Unable to log out. Please try again.", "error");
    logoutBtn.disabled = false;
  }
});
