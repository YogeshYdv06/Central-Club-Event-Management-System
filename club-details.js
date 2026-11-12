import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentClubId = null;

const $ = s => document.querySelector(s);

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { if (t) t.style.opacity = '0'; }, 2500);
}

const urlParams = new URLSearchParams(window.location.search);
currentClubId = urlParams.get('id');

if (!currentClubId) {
  alert("No club specified.");
  location.replace('clubs.html');
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace('index.html');
    return;
  }
  currentUser = user;
  await fetchClubDetails();
});

async function fetchClubDetails() {
  try {
    const clubDocRef = doc(db, "clubs", currentClubId);
    const clubSnap = await getDoc(clubDocRef);

    if (!clubSnap.exists()) {
      alert("Club not found.");
      location.replace('clubs.html');
      return;
    }

    const club = clubSnap.data();

    if ($('#clubCat')) $('#clubCat').textContent = club.cat || 'General';
    if ($('#clubName')) $('#clubName').textContent = club.name;
    if ($('#clubDesc')) $('#clubDesc').textContent = club.desc || 'No description provided.';
    
    const leadershipListEl = $('#leadershipList');
    if (leadershipListEl) {
      leadershipListEl.innerHTML = `
        <li><strong>Club Leader:</strong> <span>${club.leader?.name || 'Not Assigned'} (${club.leader?.email || 'N/E'})</span></li>
        <li><strong>Contact Phone:</strong> <span>${club.contactPhone || 'N/A'}</span></li>
        <li><strong>Members Count:</strong> <span>${club.members || 0} Active</span></li>
      `;
    }

    const waUrl = club.whatsappUrl || '#';
    if ($('#whatsappLink')) $('#whatsappLink').href = waUrl;
    
    const qrContainer = $('#qrContainer');
    if (qrContainer) {
      if (waUrl !== '#' && waUrl.trim() !== '') {
        const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(waUrl)}`;
        qrContainer.innerHTML = `<img src="${qrApi}" alt="WhatsApp QR Code">`;
      } else {
        qrContainer.innerHTML = `<p style="font-size:12px; color:#94a3b8; padding:30px 0;">No WhatsApp link available.</p>`;
      }
    }

    if ($('#clubMetaGrid')) $('#clubMetaGrid').style.display = 'grid';

    await checkUserMembershipStatus();

    if (window.lucide) lucide.createIcons();
  } catch (error) {
    console.error("Error loading club details:", error);
    toast("Failed to load club details.");
  }
}

async function checkUserMembershipStatus() {
  const btn = $('#joinRequestBtn');
  if (!btn) return;
  
  try {
    // 1. Check if already an approved member
    const memberSnap = await getDoc(doc(db, "clubs", currentClubId, "members", currentUser.uid));
    if (memberSnap.exists()) {
      btn.textContent = "✓ Member of this Club";
      btn.className = "btn-action btn-joined";
      btn.disabled = true;
      return;
    }

    // 2. Check if a join request is pending
    const reqSnap = await getDoc(doc(db, "clubs", currentClubId, "joinRequests", currentUser.uid));
    if (reqSnap.exists()) {
      btn.textContent = "Join Request Pending Approval...";
      btn.className = "btn-action btn-pending";
      btn.disabled = true;
      return;
    }

    // 3. Allow student to submit request
    btn.textContent = "Request to Join Club";
    btn.className = "btn-action";
    btn.disabled = false;
    btn.onclick = submitJoinRequest;
  } catch (e) {
    console.error("Error checking membership status:", e);
  }
}

async function submitJoinRequest() {
  const btn = $('#joinRequestBtn');
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

    toast("Join request sent successfully! Awaiting leader approval.");
    await checkUserMembershipStatus();
  } catch (error) {
    console.error("Error submitting join request:", error);
    toast("Could not submit request. Check Firestore rules.");
    btn.textContent = "Request to Join Club";
    btn.disabled = false;
  }
}