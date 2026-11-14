// Admin Student Directory: lists only students who are part of a club, an event, or both.
//
// Sources merged by uid:
//   • users/{uid}                          → profile (name, roll, year, branch, email)
//   • clubs/{clubId}/members/{uid}         → club membership
//   • clubs/{clubId}.members (legacy array) → club membership
//   • events/{eventId}/rsvps/{uid}         → event registration
//
// A student appears only if they have at least one club or event link.

import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection, collectionGroup, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import {
  USER_KEY, esc, initThemeToggle, showToast, sanitizeCsvCell
} from "./utils.js";
import { YEAR_LABELS } from "./student-lookup.js";
import { demoRole } from "./demo-session.js";

const $ = (id) => document.getElementById(id);
const toastEl = $("toast");
const toast = (message) => showToast(toastEl, message);

const PROFILE_FIELDS = ["name", "rollNo", "year", "branch", "collegeEmail"];

let me = null;
let records = [];          // merged, engagement-only student records
let hiddenCount = 0;       // students with a profile but no club/event
let loadError = "";

initThemeToggle("theme");

/* ---------------------------------------------------------------- auth */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Preview mode has no Firebase session — keep the visitor inside the preview.
    window.location.replace(demoRole() ? "clubs.html" : "index.html");
    return;
  }
  me = user;

  const name = user.displayName || user.email || "Admin";
  if ($("uname")) $("uname").textContent = name;
  if ($("av")) $("av").textContent = name.charAt(0).toUpperCase();

  const isAdmin = await checkIsAdmin(user);
  if (!isAdmin) {
    $("authLoading").textContent = "This page is only for admins. Redirecting…";
    setTimeout(() => window.location.replace("Dashboard.html"), 1600);
    return;
  }

  $("authLoading").hidden = true;
  $("page").hidden = false;
  await loadDirectory();
});

$("logout")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch { /* ignore */ }
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  window.location.replace("index.html");
});

$("refreshBtn")?.addEventListener("click", () => {
  toast("Refreshing directory…");
  loadDirectory(true);
});

/* ---------------------------------------------------------------- data */

async function loadDirectory(isRefresh = false) {
  if (!isRefresh) $("list").innerHTML = '<p class="empty">Loading student directory…</p>';
  loadError = "";

  try {
    const engagement = new Map(); // uid -> { clubs:Set, events:Set }
    const emailToUid = new Map();

    // Profiles (may be larger than the directory; only used for lookup + counts)
    const usersSnap = await getDocs(collection(db, "users")).catch(() => null);
    const profiles = new Map();
    if (usersSnap) {
      usersSnap.forEach((d) => {
        const data = d.data() || {};
        profiles.set(d.id, data);
        const email = (data.email || data.collegeEmail || "").toLowerCase();
        if (email) emailToUid.set(email, d.id);
      });
    } else {
      loadError = "Couldn't read the users collection. Deploy the updated firestore.rules so admins can list students.";
    }

    function link(uid, email, kind, label) {
      let key = uid || (email ? emailToUid.get(email.toLowerCase()) : null);
      if (!key && email) key = "email:" + email.toLowerCase(); // unresolved participant
      if (!key) return;

      if (!engagement.has(key)) engagement.set(key, { clubs: new Set(), events: new Set(), email });
      const entry = engagement.get(key);
      entry[kind].add(label);
      if (email) entry.email = email;
    }

    // Clubs + their members
    const clubsSnap = await getDocs(collection(db, "clubs")).catch(() => null);
    if (clubsSnap) {
      const clubDocs = clubsSnap.docs;
      const memberSnaps = await Promise.all(
        clubDocs.map((c) => getDocs(collection(db, "clubs", c.id, "members")).catch(() => null))
      );

      clubDocs.forEach((clubDoc, index) => {
        const data = clubDoc.data() || {};
        const clubName = data.name || data.title || clubDoc.id;

        const membersSnap = memberSnaps[index];
        if (membersSnap) {
          membersSnap.forEach((m) => {
            const md = m.data() || {};
            link(m.id, md.email || md.userEmail || "", "clubs", clubName);
          });
        }

        // Legacy array-based membership (uids or emails)
        ["members", "memberIds", "joined"].forEach((field) => {
          if (!Array.isArray(data[field])) return;
          data[field].forEach((value) => {
            if (typeof value !== "string") return;
            if (value.includes("@")) link(null, value, "clubs", clubName);
            else link(value, "", "clubs", clubName);
          });
        });
      });
    } else if (!loadError) {
      loadError = "Couldn't read clubs. Check that firestore.rules allows admins to read clubs.";
    }

    // Event registrations (collection group)
    const rsvpSnap = await getDocs(collectionGroup(db, "rsvps")).catch(() => null);
    if (rsvpSnap) {
      const eventNames = new Map();
      const eventIds = new Set();
      rsvpSnap.forEach((d) => {
        const eid = d.ref.parent?.parent?.id;
        if (eid) eventIds.add(eid);
      });

      await Promise.all(
        [...eventIds].map(async (eid) => {
          const ev = await getDoc(doc(db, "events", eid)).catch(() => null);
          if (ev && ev.exists()) {
            const data = ev.data() || {};
            eventNames.set(eid, data.title || data.name || eid);
          } else {
            eventNames.set(eid, eid);
          }
        })
      );

      rsvpSnap.forEach((d) => {
        const eid = d.ref.parent?.parent?.id;
        const data = d.data() || {};
        link(d.id, data.email || data.userEmail || "", "events", eventNames.get(eid) || eid || "Event");
      });
    }

    // Merge engagement with profile data
    const list = [];
    const seenProfiles = new Set();

    engagement.forEach((entry, key) => {
      const uid = key.startsWith("email:") ? null : key;
      const email = (entry.email || (uid && profiles.get(uid)?.email) || "").toLowerCase();
      const profile = (uid && profiles.get(uid)) || {};

      if (uid) seenProfiles.add(uid);

      const name =
        profile.studentName ||
        profile.name ||
        (email ? email.split("@")[0].replace(/[._-]+/g, " ") : "Unknown student");

      list.push({
        uid: uid || "",
        name,
        email: profile.collegeEmail || profile.email || email,
        rollNo: profile.rollNo || "",
        year: Number(profile.year) || 0,
        branch: profile.branch || "",
        complete: profile.studentProfileComplete === true,
        clubs: [...entry.clubs].sort(),
        events: [...entry.events].sort()
      });
    });

    // Students with a profile but no club/event link (counted, never listed)
    hiddenCount = 0;
    profiles.forEach((data, uid) => {
      if (seenProfiles.has(uid)) return;
      if (data.studentProfileComplete === true) hiddenCount += 1;
    });

    records = list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Student directory load failed:", error);
    loadError = "Couldn't load the student directory. Check your Firestore rules and connection.";
    records = [];
  }

  renderBranchFilter();
  render();
  if (isRefresh) toast("Directory refreshed.");
}

/* ---------------------------------------------------------------- render */

function filtered() {
  const q = $("search").value.trim().toLowerCase();
  const role = $("filterRole").value;
  const branch = $("filterBranch").value;
  const year = $("filterYear").value;

  return records.filter((s) => {
    const hasClub = s.clubs.length > 0;
    const hasEvent = s.events.length > 0;

    if (role === "club" && !hasClub) return false;
    if (role === "event" && !hasEvent) return false;
    if (role === "both" && !(hasClub && hasEvent)) return false;

    if (branch && s.branch !== branch) return false;
    if (year && String(s.year) !== year) return false;

    if (!q) return true;
    return [s.name, s.rollNo, s.email, s.branch, YEAR_LABELS[s.year] || "", ...s.clubs, ...s.events]
      .join(" ").toLowerCase().includes(q);
  });
}

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2)
    .map((w) => w.charAt(0)).join("").toUpperCase() || "?";
}

function cardHtml(s) {
  const clubPills = s.clubs.slice(0, 3)
    .map((c) => `<span class="pill-tag club">${esc(c)}</span>`).join("");
  const moreClubs = s.clubs.length > 3
    ? `<span class="pill-tag club">+${s.clubs.length - 3} more</span>` : "";
  const eventPills = s.events.slice(0, 3)
    .map((e) => `<span class="pill-tag event">${esc(e)}</span>`).join("");
  const moreEvents = s.events.length > 3
    ? `<span class="pill-tag event">+${s.events.length - 3} more</span>` : "";

  return `
    <article class="sd-card">
      <span class="sd-avatar">${esc(initials(s.name))}</span>
      <div class="sd-body">
        <div class="sd-top">
          <h3>${esc(s.name)}</h3>
          ${s.branch ? `<span class="pill-tag branch">${esc(s.branch)}</span>` : ""}
          ${s.year ? `<span class="pill-tag year">${esc(YEAR_LABELS[s.year] || "")}</span>` : ""}
          ${s.complete ? "" : '<span class="pill-tag incomplete">Profile incomplete</span>'}
        </div>

        <div class="sd-meta">
          ${s.rollNo
            ? `<span><i data-lucide="hash"></i>${esc(s.rollNo)}</span>`
            : `<span><i data-lucide="hash"></i>Roll no. not provided</span>`}
          ${s.email
            ? `<span><i data-lucide="mail"></i><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></span>`
            : ""}
        </div>

        <div class="pill-row">
          ${clubPills}${moreClubs}${eventPills}${moreEvents}
        </div>
      </div>
    </article>`;
}

function render() {
  const list = filtered();

  if (loadError) {
    $("list").innerHTML = `<p class="sd-empty">${esc(loadError)}</p>`;
  } else if (!records.length) {
    $("list").innerHTML = `
      <p class="sd-empty">
        <b>No students to show yet</b>
        This list fills up when students join a club or register for an event.
        Students who completed the profile form but never joined anything are hidden.
      </p>`;
  } else if (!list.length) {
    $("list").innerHTML = `
      <p class="sd-empty">
        <b>No students match these filters</b>
        Try clearing the search or switching the involvement filter.
      </p>`;
  } else {
    $("list").innerHTML = list.map(cardHtml).join("");
  }

  // stats
  $("sEngaged").textContent = records.length;
  $("sMembers").textContent = records.filter((s) => s.clubs.length).length;
  $("sParticipants").textContent = records.filter((s) => s.events.length).length;
  $("sBranches").textContent = new Set(records.map((s) => s.branch).filter(Boolean)).size;

  $("countLine").textContent = records.length
    ? `Showing ${list.length} of ${records.length} engaged student${records.length === 1 ? "" : "s"}`
    : "";

  $("note").innerHTML = hiddenCount
    ? `<b>${hiddenCount}</b> student${hiddenCount === 1 ? "" : "s"} completed the profile form but are not in any club or event — hidden from this list.`
    : "";

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

function renderBranchFilter() {
  const sel = $("filterBranch");
  const current = sel.value;
  const present = [...new Set(records.map((s) => s.branch).filter(Boolean))].sort();

  sel.innerHTML = '<option value="">All branches</option>' + present
    .map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");

  sel.value = present.includes(current) ? current : "";
}

/* ---------------------------------------------------------------- export */

function exportCsv() {
  const list = filtered();
  if (!list.length) { toast("Nothing to export."); return; }

  const header = ["Name", "Roll No", "Year", "Branch", "College Email", "Clubs", "Events", "Profile complete"];
  const rows = [header.map(sanitizeCsvCell).join(",")];

  list.forEach((s) => {
    rows.push([
      s.name,
      s.rollNo,
      YEAR_LABELS[s.year] || "",
      s.branch,
      s.email,
      s.clubs.join("; "),
      s.events.join("; "),
      s.complete ? "Yes" : "No"
    ].map(sanitizeCsvCell).join(","));
  });

  const csv = "\uFEFF" + rows.join("\r\n");
  const a = document.createElement("a");
  try {
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  }
  a.download = `engaged-students-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast(`Exported ${list.length} student${list.length === 1 ? "" : "s"}.`);
}

/* ---------------------------------------------------------------- events */

["search", "filterRole", "filterBranch", "filterYear"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener(id === "search" ? "input" : "change", render);
});

$("exportBtn")?.addEventListener("click", exportCsv);
