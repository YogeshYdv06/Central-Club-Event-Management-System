// Firebase App
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
 
// Firebase Authentication
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
 
// Cloud Firestore
import {
  getFirestore,
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
 
// Firebase configuration
import { firebaseConfig } from "./firebase-config.js";
 
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
 
// Dashboard elements
const loading = document.getElementById("authLoading");
const dashboard = document.getElementById("dashboardContent");
const logoutBtn = document.getElementById("logoutBtn");
 
// Signed-in user, live events and RSVPs
let me = null;
let events = [];          // all events, live from Firestore
let rsvps = {};           // { eventId: [uid, uid, ...] }, live from Firestore
let liveStarted = false;
 
/* ---------- small helpers ---------- */
 
function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
 
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
 
function parts(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return { day: "--", month: "", year: "" };
  return { day: d.getDate(), month: d.toLocaleString("en-US", { month: "short" }), year: d.getFullYear() };
}
 
function fmtTime(t) {
  if (!t) return "";
  const h = parseInt(t.slice(0, 2), 10);
  return (h % 12 || 12) + ":" + t.slice(3, 5) + " " + (h < 12 ? "AM" : "PM");
}
 
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
 
// Pick a card colour from the club name (uses your existing th-/tag-/btn- classes)
function themeFor(club) {
  const c = (club || "").toLowerCase();
  if (/sport|football|cricket|athlet|game/.test(c)) return { thumb: "th-sport", tag: "tag-green", btn: "btn-green" };
  if (/music|dance|cultur|drama|photo|art|film/.test(c)) return { thumb: "th-cult", tag: "tag-purple", btn: "btn-purple" };
  return { thumb: "th-tech", tag: "tag-blue", btn: "btn-primary" };
}
 
/* ---------- authentication ---------- */
 
onAuthStateChanged(auth, async (user) => {
 
  if (!user) {
    window.location.replace("index.html");
    return;
  }
 
  me = user;
 
  try {
    const uid = user.uid;
 
    // Admin = this email has a document in the "organizers" collection
    let isAdmin = false;
    try {
      isAdmin = (await getDoc(doc(db, "organizers", (user.email || "").toLowerCase()))).exists();
    } catch (e) {
      isAdmin = false;
    }
    const role = isAdmin ? "Admin" : "Student";
 
    // Reference to this user's Firestore document
    const userRef = doc(db, "users", uid);
    const userSnapshot = await getDoc(userRef);
 
    // Prepare user profile data
    const userData = {
      uid: uid,
      name: user.displayName || user.email || role,
      email: user.email || "",
      photoURL: user.photoURL || "",
      role: role,
      updatedAt: serverTimestamp()
    };
 
    // Create profile if first login
    if (!userSnapshot.exists()) {
      userData.createdAt = serverTimestamp();
    }
 
    // Save or update profile in Firestore
    await setDoc(userRef, userData, { merge: true });
 
    // Update UI elements
    const nameEl = document.getElementById("profileName");
    const emailEl = document.getElementById("profileEmail");
    const photoEl = document.getElementById("profilePhoto");
    const greetingNameEl = document.getElementById("greetingName");
    const portalLabel = document.querySelector(".sidebar .brand small");
 
    if (nameEl) nameEl.textContent = userData.name;
    if (emailEl) emailEl.textContent = userData.email;
    if (greetingNameEl) greetingNameEl.textContent = userData.name.split(" ")[0];
    if (portalLabel) portalLabel.textContent = `${role} Portal`;
 
    if (photoEl) {
      photoEl.src = userData.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}`;
      photoEl.alt = `${role} profile photo`;
    }
 
    // Admin Panel link in the sidebar (admins only)
    if (isAdmin) addAdminLink();
 
  } catch (error) {
    console.error("Firestore profile error:", error);
  } finally {
    if (loading) loading.hidden = true;
    if (dashboard) dashboard.hidden = false;
    startLiveData();
  }
 
});
 
function addAdminLink() {
  const nav = document.querySelector(".sidebar nav");
  if (!nav || document.getElementById("adminNav")) return;
  const a = document.createElement("a");
  a.id = "adminNav";
  a.href = "admin.html";
  a.innerHTML = '<i data-lucide="shield-check"></i>Admin Panel';
  nav.appendChild(a);
  refreshIcons();
}
 
/* ---------- live events + RSVPs ---------- */
 
function startLiveData() {
  if (liveStarted) return;
  liveStarted = true;
 
  // All events, soonest first
  onSnapshot(query(collection(db, "events"), orderBy("date")), (snap) => {
    events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEvents();
  }, (err) => console.error("Events error:", err));
 
  // All RSVPs (the document id of each RSVP is the student's uid)
  onSnapshot(collectionGroup(db, "rsvps"), (snap) => {
    const map = {};
    snap.forEach((d) => {
      const eid = d.ref.parent.parent.id;
      (map[eid] = map[eid] || []).push(d.id);
    });
    rsvps = map;
    renderEvents();
  }, (err) => console.error("RSVP error:", err));
}
 
function renderEvents() {
  if (!me) return;
  const today = todayStr();
  const upcoming = events
    .filter((e) => e.date >= today)
    .sort((a, b) => ((a.date + " " + (a.time || "")) < (b.date + " " + (b.time || "")) ? -1 : 1));
 
  renderSidebar(upcoming.slice(0, 4));
  renderCards(upcoming.slice(0, 3));
  renderStats();
  refreshIcons();
}
 
// Right column: next 4 upcoming events
function renderSidebar(list) {
  const el = document.querySelector(".event-list");
  if (!el) return;
 
  if (!list.length) {
    el.innerHTML = '<li style="color:#888; font-size:13px;">No upcoming events posted yet.</li>';
    return;
  }
 
  el.innerHTML = list.map((e) => {
    const p = parts(e.date);
    const when = [fmtTime(e.time), e.location].filter(Boolean).join(" · ");
    return `
      <li style="cursor:pointer" data-go="events.html">
        <div class="date"><b>${p.day}</b>${p.month}</div>
        <div>
          <strong>${esc(e.title)}</strong>
          <small>${esc(when)}</small>
        </div>
        <i data-lucide="arrow-right" class="go"></i>
      </li>`;
  }).join("");
}
 
// Main area: next 3 upcoming events as cards with a real Register button
function renderCards(list) {
  const grid = document.querySelector(".events-cards .grid3");
  if (!grid) return;
 
  if (!list.length) {
    grid.innerHTML = '<p style="color:#888; font-size:14px;">No upcoming events yet. Check back soon.</p>';
    return;
  }
 
  grid.innerHTML = list.map((e) => {
    const going = rsvps[e.id] || [];
    const mine = going.includes(me.uid);
    const cap = e.capacity || 0;
    const full = cap > 0 && going.length >= cap && !mine;
    const t = themeFor(e.club);
    const p = parts(e.date);
 
    let btn;
    if (mine) btn = `<button class="btn btn-green" data-rsvp="${e.id}" title="Click to cancel your RSVP">Registered ✓</button>`;
    else if (full) btn = `<button class="btn" disabled>Event Full</button>`;
    else btn = `<button class="btn ${t.btn}" data-rsvp="${e.id}">Register Now <i data-lucide="arrow-right"></i></button>`;
 
    return `
      <article class="event">
        <div class="thumb ${t.thumb}">
          <span class="tag ${t.tag}">${esc(e.club || "General")}</span>
        </div>
        <h4>${esc(e.title)}</h4>
        <p><i data-lucide="calendar"></i>${p.day} ${p.month} ${p.year}</p>
        <p><i data-lucide="clock"></i>${esc(fmtTime(e.time) || "Time to be announced")}</p>
        <p><i data-lucide="map-pin"></i>${esc(e.location || "")}</p>
        <p><i data-lucide="users"></i>${going.length}${cap > 0 ? " / " + cap : ""} going</p>
        ${btn}
      </article>`;
  }).join("");
}
 
// Quick Stats: how many events this student has registered for
function renderStats() {
  let el = document.getElementById("registeredCount");
  if (!el) {
    const stat = Array.from(document.querySelectorAll(".stat")).find((s) => {
      const small = s.querySelector("small");
      return small && small.textContent.trim() === "Registered Events";
    });
    el = stat ? stat.querySelector("b") : null;
  }
  if (!el) return;
 
  const existing = new Set(events.map((e) => e.id));
  const count = Object.keys(rsvps).filter((eid) => existing.has(eid) && rsvps[eid].includes(me.uid)).length;
  el.textContent = String(count).padStart(2, "0");
}
 
/* ---------- clicks ---------- */
 
// Register / cancel from the dashboard cards
document.addEventListener("click", async (ev) => {
  const rsvpBtn = ev.target.closest("button[data-rsvp]");
  if (rsvpBtn && me) {
    const id = rsvpBtn.dataset.rsvp;
    const ref = doc(db, "events", id, "rsvps", me.uid);
    const going = (rsvps[id] || []).includes(me.uid);
    rsvpBtn.disabled = true;
    try {
      if (going) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, {
          name: me.displayName || me.email,
          email: me.email,
          photo: me.photoURL || "",
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error("RSVP error:", error);
      alert("Could not update your RSVP. Please try again.");
      rsvpBtn.disabled = false;
    }
    return;
  }
 
  // Click on an event in the right column -> open the events page
  const row = ev.target.closest("li[data-go]");
  if (row) window.location.href = row.dataset.go;
});
 
/* ---------- logout ---------- */
 
logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
 
  try {
    await signOut(auth);
    localStorage.removeItem("campushub_user");
    window.location.replace("index.html");
  } catch (error) {
    console.error("Logout error:", error);
    alert("Unable to log out. Please try again.");
    logoutBtn.disabled = false;
  }
});
 