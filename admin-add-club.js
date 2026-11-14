// Admin page to create a new campus club with validation and duplicate protection.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { isValidClubId, safeHttpUrl, refreshIcons, showToast } from "./utils.js";

const authLoading = document.getElementById("authLoading");
const pageContent = document.getElementById("pageContent");
const toastEl = document.getElementById("toast");

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
  if (pageContent) pageContent.hidden = false;
  refreshIcons();
});

document.getElementById("createClubForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("submitBtn");
  const rawId = document.getElementById("clubId").value.trim().toLowerCase();

  if (!isValidClubId(rawId)) {
    showToast(
      toastEl,
      "Club ID must be 2–49 characters: lowercase letters, numbers, hyphens, or underscores only."
    );
    return;
  }

  const rawWa = document.getElementById("whatsappUrl").value.trim();
  if (rawWa && !safeHttpUrl(rawWa)) {
    showToast(toastEl, "WhatsApp invite link must start with http:// or https://");
    return;
  }

  btn.textContent = "Publishing...";
  btn.disabled = true;

  try {
    const clubRef = doc(db, "clubs", rawId);
    const existing = await getDoc(clubRef);
    if (existing.exists()) {
      showToast(toastEl, `A club with ID "${rawId}" already exists. Choose a different ID.`);
      btn.textContent = "Publish Club to Student Portal";
      btn.disabled = false;
      return;
    }

    const clubData = {
      id: rawId,
      name: document.getElementById("clubName").value.trim(),
      cat: document.getElementById("clubCat").value,
      theme: document.getElementById("clubTheme").value,
      icon: document.getElementById("clubIcon").value.trim().toLowerCase(),
      desc: document.getElementById("clubDesc").value.trim(),
      members: 0,
      membersCount: 0,
      leader: {
        name: document.getElementById("leaderName").value.trim(),
        email: document.getElementById("leaderEmail").value.trim()
      },
      contactPhone: document.getElementById("contactPhone").value.trim(),
      whatsappUrl: rawWa ? safeHttpUrl(rawWa) : "",
      createdAt: serverTimestamp()
    };

    await setDoc(clubRef, clubData);
    showToast(toastEl, "Club published! Redirecting to clubs directory...");
    setTimeout(() => {
      window.location.href = "clubs.html";
    }, 1000);
  } catch (error) {
    console.error("Error creating club:", error);
    showToast(toastEl, "Failed to publish club. Check console or Firestore rules.");
    btn.textContent = "Publish Club to Student Portal";
    btn.disabled = false;
  }
});
