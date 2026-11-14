// CampusConnect Club Details: safely displays club metadata, WhatsApp QR, and join request flow.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { auth, db } from "./firebase-init.js";
import { demoRole } from "./demo-session.js";
import {
  esc,
  safeHttpUrl,
  refreshIcons,
  showToast,
  getClubMemberCount,
  isUserInLegacyMembers
} from "./utils.js";

const $ = (s) => document.querySelector(s);
const toastEl = $("#toast");

let currentUser = null;
let currentClubData = null;

const urlParams = new URLSearchParams(window.location.search);
const currentClubId = (urlParams.get("id") || "").trim();

function showNotFound(message) {
  const content = $("#clubContent");
  const meta = $("#clubMetaGrid");
  const nf = $("#notFoundState");
  const nfMsg = $("#notFoundMsg");
  if (content) content.hidden = true;
  if (meta) meta.hidden = true;
  if (nfMsg && message) nfMsg.textContent = message;
  if (nf) nf.hidden = false;
  refreshIcons();
}

if (!currentClubId) {
  window.location.replace("clubs.html");
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      // Preview mode has no Firebase session — keep the visitor inside the preview.
      window.location.replace(demoRole() ? "clubs.html" : "index.html");
      return;
    }
    currentUser = user;
    await fetchClubDetails();
  });
}

async function fetchClubDetails() {
  try {
    const clubDocRef = doc(db, "clubs", currentClubId);
    const clubSnap = await getDoc(clubDocRef);

    // Never auto-create clubs from student visits; show a clean not-found page.
    if (!clubSnap.exists()) {
      showNotFound("We couldn't find a club with that ID. It may have been removed.");
      return;
    }

    const club = { id: clubSnap.id, ...clubSnap.data() };
    currentClubData = club;

    // Determine accurate member count (prefer live subcollection count if readable)
    let memberCount = getClubMemberCount(club);
    try {
      const membersSnap = await getDocs(collection(db, "clubs", currentClubId, "members"));
      if (membersSnap.size > memberCount) {
        memberCount = membersSnap.size;
      }
    } catch {
      // Fallback to stored member count if subcollection read is restricted
    }

    if ($("#clubCat")) $("#clubCat").textContent = club.cat || club.category || "General";
    if ($("#clubName")) $("#clubName").textContent = club.name || club.title || "Campus Club";
    if ($("#clubDesc")) $("#clubDesc").textContent = club.desc || club.description || "No description provided.";

    const leaderName = club.leader?.name || "Not Assigned";
    const leaderEmail = club.leader?.email || "N/A";
    const contactPhone = club.contactPhone || "N/A";

    const leadershipListEl = $("#leadershipList");
    if (leadershipListEl) {
      leadershipListEl.innerHTML = `
        <li><strong>Club Leader:</strong> <span>${esc(leaderName)} (${esc(leaderEmail)})</span></li>
        <li><strong>Contact Phone:</strong> <span>${esc(contactPhone)}</span></li>
        <li><strong>Members Count:</strong> <span>${memberCount} Active</span></li>
      `;
    }

    const validWaUrl = safeHttpUrl(club.whatsappUrl);
    const waLinkEl = $("#whatsappLink");
    const qrContainer = $("#qrContainer");

    if (validWaUrl) {
      if (waLinkEl) {
        waLinkEl.href = validWaUrl;
        waLinkEl.hidden = false;
      }
      if (qrContainer) {
        const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(validWaUrl)}`;
        qrContainer.innerHTML = `<img src="${esc(qrApi)}" alt="WhatsApp QR Code">`;
      }
    } else {
      if (waLinkEl) waLinkEl.hidden = true;
      if (qrContainer) {
        qrContainer.innerHTML = `<p style="font-size:13px; color:#94a3b8; padding:24px 0;">No WhatsApp invite link available yet.</p>`;
      }
    }

    const metaGrid = $("#clubMetaGrid");
    if (metaGrid) metaGrid.hidden = false;

    await checkUserMembershipStatus();
    refreshIcons();
  } catch (error) {
    console.error("Error loading club details:", error);
    showToast(toastEl, "Failed to load club details.");
    showNotFound("Could not load this club right now. Please try again later.");
  }
}

async function checkUserMembershipStatus() {
  const btn = $("#joinRequestBtn");
  const cancelBtn = $("#cancelRequestBtn");
  if (!btn) return;
  if (cancelBtn) cancelBtn.hidden = true;

  try {
    // 1. Check approved membership via subcollection, user's joinedClubs, or legacy array
    const [memberSnap, userJoinedSnap] = await Promise.all([
      getDoc(doc(db, "clubs", currentClubId, "members", currentUser.uid)).catch(() => null),
      getDoc(doc(db, "users", currentUser.uid, "joinedClubs", currentClubId)).catch(() => null)
    ]);

    if (
      memberSnap?.exists() ||
      userJoinedSnap?.exists() ||
      isUserInLegacyMembers(currentClubData, currentUser)
    ) {
      btn.textContent = "✓ Member of this Club";
      btn.className = "btn-action btn-joined";
      btn.disabled = true;
      btn.onclick = null;
      return;
    }

    // 2. Check pending join request
    const reqSnap = await getDoc(doc(db, "clubs", currentClubId, "joinRequests", currentUser.uid));
    if (reqSnap.exists()) {
      btn.textContent = "Join Request Pending Approval...";
      btn.className = "btn-action btn-pending";
      btn.disabled = true;
      btn.onclick = null;
      if (cancelBtn) {
        cancelBtn.hidden = false;
        cancelBtn.disabled = false;
        cancelBtn.onclick = cancelJoinRequest;
      }
      return;
    }

    // 3. Allow student to request membership
    btn.textContent = "Request to Join Club";
    btn.className = "btn-action";
    btn.disabled = false;
    btn.onclick = submitJoinRequest;
  } catch (error) {
    console.error("Error checking membership status:", error);
    btn.textContent = "Unable to load status";
    btn.disabled = true;
  }
}

async function submitJoinRequest() {
  const btn = $("#joinRequestBtn");
  if (!btn) return;

  btn.textContent = "Sending Request...";
  btn.disabled = true;

  try {
    const reqRef = doc(db, "clubs", currentClubId, "joinRequests", currentUser.uid);
    await setDoc(reqRef, {
      userId: currentUser.uid,
      userName: currentUser.displayName || currentUser.email,
      userEmail: currentUser.email,
      status: "pending",
      requestedAt: serverTimestamp()
    });

    showToast(toastEl, "Join request sent! Awaiting admin approval.");
    await checkUserMembershipStatus();
  } catch (error) {
    console.error("Error submitting join request:", error);
    showToast(toastEl, "Could not submit request. Check Firestore permissions.");
    btn.textContent = "Request to Join Club";
    btn.disabled = false;
  }
}

async function cancelJoinRequest() {
  const cancelBtn = $("#cancelRequestBtn");
  if (!cancelBtn) return;

  cancelBtn.disabled = true;
  cancelBtn.textContent = "Cancelling...";

  try {
    await deleteDoc(doc(db, "clubs", currentClubId, "joinRequests", currentUser.uid));
    showToast(toastEl, "Join request cancelled.");
    await checkUserMembershipStatus();
  } catch (error) {
    console.error("Error cancelling join request:", error);
    showToast(toastEl, "Could not cancel request.");
  } finally {
    cancelBtn.textContent = "Cancel Request";
    cancelBtn.disabled = false;
  }
}
