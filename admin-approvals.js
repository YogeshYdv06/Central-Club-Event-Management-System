import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_EMAIL = "26ir1yo77@mitsgwl.ac.in";
const $ = s => document.querySelector(s);

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

onAuthStateChanged(auth, async user => {
  if (!user || user.email !== ADMIN_EMAIL) {
    alert("Unauthorized access. Admin domain only.");
    location.replace('index.html');
    return;
  }
  await loadAllPendingRequests();
});

async function loadAllPendingRequests() {
  const container = $('#requestsList');
  try {
    // Fetch all clubs first
    const clubsSnap = await getDocs(collection(db, "clubs"));
    let allRequests = [];

    for (const clubDoc of clubsSnap.docs) {
      const clubId = clubDoc.id;
      const clubName = clubDoc.data().name || clubId;

      const reqSnap = await getDocs(collection(db, "clubs", clubId, "joinRequests"));
      reqSnap.forEach(reqDoc => {
        const data = reqDoc.data();
        if (data.status === "pending") {
          allRequests.push({
            clubId,
            clubName,
            userId: reqDoc.id,
            ...data
          });
        }
      });
    }

    if (allRequests.length === 0) {
      container.innerHTML = `<div class="empty-state">No pending membership requests right now.</div>`;
      return;
    }

    container.innerHTML = allRequests.map(req => `
      <div class="request-card" id="req-${req.clubId}-${req.userId}">
        <div class="request-info">
          <h3>${req.userName || 'Student'} <span style="font-size: 12px; font-weight: normal; color: #818cf8; background: rgba(129,140,248,0.1); padding: 2px 8px; border-radius: 4px; margin-left: 8px;">${req.clubName}</span></h3>
          <p><i data-lucide="mail" style="width: 14px; vertical-align: middle;"></i> ${req.userEmail}</p>
          <p><i data-lucide="clock" style="width: 14px; vertical-align: middle;"></i> Requested recently</p>
        </div>
        <div class="actions">
          <button class="btn-approve" onclick="handleApproval('${req.clubId}', '${req.userId}', '${req.userEmail}', '${req.userName}')">Approve</button>
          <button class="btn-reject" onclick="handleRejection('${req.clubId}', '${req.userId}')">Reject</button>
        </div>
      </div>
    `).join('');

    lucide.createIcons();
  } catch (error) {
    console.error("Error loading pending requests:", error);
    container.innerHTML = `<div class="empty-state">Failed to load pending requests. Check Firestore rules.</div>`;
  }
}

// Global scope bindings for inline onclick handlers
window.handleApproval = async function(clubId, userId, userEmail, userName) {
  try {
    // 1. Add user to club's official members subcollection
    await setDoc(doc(db, "clubs", clubId, "members", userId), {
      joinedAt: serverTimestamp(),
      email: userEmail,
      name: userName
    });

    // 2. Also record in user's profile joinedClubs collection so dashboard stats update
    await setDoc(doc(db, "users", userId, "joinedClubs", clubId), {
      clubId: clubId,
      joinedAt: serverTimestamp()
    });

    // 3. Remove/Delete the pending request document
    await deleteDoc(doc(db, "clubs", clubId, "joinRequests", userId));

    toast(`Approved membership for ${userName}!`);
    document.getElementById(`req-${clubId}-${userId}`).remove();

    if ($('#requestsList').children.length === 0) {
      $('#requestsList').innerHTML = `<div class="empty-state">No pending membership requests right now.</div>`;
    }
  } catch (error) {
    console.error("Error approving request:", error);
    toast("Failed to approve membership.");
  }
};

window.handleRejection = async function(clubId, userId) {
  try {
    // Delete the pending request document
    await deleteDoc(doc(db, "clubs", clubId, "joinRequests", userId));

    toast("Join request rejected.");
    document.getElementById(`req-${clubId}-${userId}`).remove();

    if ($('#requestsList').children.length === 0) {
      $('#requestsList').innerHTML = `<div class="empty-state">No pending membership requests right now.</div>`;
    }
  } catch (error) {
    console.error("Error rejecting request:", error);
    toast("Failed to reject request.");
  }
};