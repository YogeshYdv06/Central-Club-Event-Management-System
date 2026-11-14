// Admin club join-request approvals: safe escaping, event delegation, parallel queries, and member count sync.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  increment,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { esc, refreshIcons, showToast } from "./utils.js";

const authLoading = document.getElementById("authLoading");
const approvalsContent = document.getElementById("approvalsContent");
const requestsList = document.getElementById("requestsList");
const toastEl = document.getElementById("toast");

const pendingRequests = new Map(); // key -> { clubId, clubName, userId, userEmail, userName }

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  const isAdmin = await checkIsAdmin(user);
  if (!isAdmin) {
    if (authLoading) authLoading.textContent = "Unauthorized access. Redirecting...";
    setTimeout(() => window.location.replace("Dashboard.html"), 1500);
    return;
  }

  if (authLoading) authLoading.hidden = true;
  if (approvalsContent) approvalsContent.hidden = false;
  refreshIcons();

  await loadAllPendingRequests();
});

async function loadAllPendingRequests() {
  if (!requestsList) return;
  pendingRequests.clear();

  try {
    const clubsSnap = await getDocs(collection(db, "clubs"));

    // Fetch all clubs' joinRequests concurrently instead of sequentially
    const perClubResults = await Promise.all(
      clubsSnap.docs.map(async (clubDoc) => {
        const clubId = clubDoc.id;
        const clubData = clubDoc.data();
        const clubName = clubData.name || clubData.title || clubId;

        const reqSnap = await getDocs(collection(db, "clubs", clubId, "joinRequests"));
        const items = [];
        reqSnap.forEach((reqDoc) => {
          const data = reqDoc.data();
          if (data.status === "pending") {
            items.push({
              key: `${clubId}::${reqDoc.id}`,
              clubId,
              clubName,
              userId: reqDoc.id,
              userName: data.userName || "Student",
              userEmail: data.userEmail || "",
              requestedAt: data.requestedAt || null
            });
          }
        });
        return items;
      })
    );

    const allRequests = perClubResults.flat();

    if (allRequests.length === 0) {
      requestsList.innerHTML =
        '<div class="empty-state">No pending membership requests right now.</div>';
      return;
    }

    allRequests.forEach((r) => pendingRequests.set(r.key, r));

    requestsList.innerHTML = allRequests
      .map((req) => {
        const timeStr =
          req.requestedAt && typeof req.requestedAt.toDate === "function"
            ? req.requestedAt.toDate().toLocaleString("en-IN")
            : "Requested recently";

        return `
          <div class="request-card" data-req-key="${esc(req.key)}">
            <div class="request-info">
              <h3>
                ${esc(req.userName)}
                <span class="club-pill">${esc(req.clubName)}</span>
              </h3>
              <p><i data-lucide="mail" style="width:14px;height:14px;"></i> ${esc(req.userEmail || "No email")}</p>
              <p><i data-lucide="clock" style="width:14px;height:14px;"></i> ${esc(timeStr)}</p>
            </div>
            <div class="actions">
              <button class="btn-approve" type="button" data-action="approve" data-key="${esc(req.key)}">Approve</button>
              <button class="btn-reject" type="button" data-action="reject" data-key="${esc(req.key)}">Reject</button>
            </div>
          </div>`;
      })
      .join("");

    refreshIcons();
  } catch (error) {
    console.error("Error loading pending requests:", error);
    requestsList.innerHTML =
      '<div class="empty-state">Failed to load pending requests. Check Firestore rules.</div>';
  }
}

requestsList?.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;

  const key = btn.dataset.key;
  const req = pendingRequests.get(key);
  if (!req) return;

  const card = btn.closest(".request-card");
  const cardBtns = card ? [...card.querySelectorAll("button")] : [btn];
  cardBtns.forEach((b) => (b.disabled = true));

  try {
    if (btn.dataset.action === "approve") {
      await approveRequest(req);
      showToast(toastEl, `Approved membership for ${req.userName || req.userEmail}!`);
    } else {
      await deleteDoc(doc(db, "clubs", req.clubId, "joinRequests", req.userId));
      showToast(toastEl, "Join request rejected.");
    }

    pendingRequests.delete(key);
    card?.remove();

    if (requestsList.querySelectorAll(".request-card").length === 0) {
      requestsList.innerHTML =
        '<div class="empty-state">No pending membership requests right now.</div>';
    }
  } catch (error) {
    console.error("Error processing membership request:", error);
    showToast(toastEl, "Action failed. Check Firestore permissions.");
    cardBtns.forEach((b) => (b.disabled = false));
  }
});

async function approveRequest(req) {
  const { clubId, userId, userEmail, userName } = req;

  // 1. Check if already a member to avoid double-incrementing member count
  const memberRef = doc(db, "clubs", clubId, "members", userId);
  const existingMember = await getDoc(memberRef);

  // 2. Add to club's members subcollection and user's joinedClubs subcollection
  await Promise.all([
    setDoc(memberRef, {
      joinedAt: serverTimestamp(),
      email: userEmail,
      name: userName
    }),
    setDoc(doc(db, "users", userId, "joinedClubs", clubId), {
      clubId,
      joinedAt: serverTimestamp()
    })
  ]);

  // 3. Synchronize parent club document's member count (supports both numeric and legacy array schemas)
  if (!existingMember.exists()) {
    const clubRef = doc(db, "clubs", clubId);
    const clubSnap = await getDoc(clubRef);
    if (clubSnap.exists()) {
      const data = clubSnap.data();
      if (Array.isArray(data.members)) {
        await updateDoc(clubRef, {
          members: arrayUnion(userId),
          membersCount: increment(1)
        });
      } else {
        await updateDoc(clubRef, {
          members: increment(1),
          membersCount: increment(1)
        });
      }
    }
  }

  // 4. Delete pending join request
  await deleteDoc(doc(db, "clubs", clubId, "joinRequests", userId));
}
