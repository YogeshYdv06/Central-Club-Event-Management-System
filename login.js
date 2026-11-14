import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import { auth, ALLOWED_DOMAIN, checkIsAdmin } from "./firebase-init.js";
import { USER_KEY, initThemeToggle } from "./utils.js";
import { demoRole, setDemoRole, clearDemoRole } from "./demo-session.js";

const DASHBOARD_URL = "Dashboard.html";
const ROLE_SESSION_KEY = "campushub_pending_role";

const tabs = document.querySelectorAll(".tab");
const toast = document.getElementById("toast");
const googleBtn = document.getElementById("google");
const headSignin = document.getElementById("headSignin");
const noteText = document.getElementById("noteText");
const resumeLink = document.getElementById("resumeLink");

let role = "student";

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error("Storage error:", error);
  }
}

// Theme toggle
initThemeToggle("theme");

const resumeText = document.getElementById("resumeText");
const exitPreviewLink = document.getElementById("exitPreviewLink");

/**
 * Keeps the "continue" shortcuts in sync:
 *  • signed in        → open the dashboard
 *  • preview session  → continue the preview in clubs.html
 *  • neither          → hide both links
 */
function paintSessionLinks(user) {
  const role = demoRole();

  if (user) {
    if (resumeLink) {
      resumeLink.hidden = false;
      resumeLink.href = "Dashboard.html";
    }
    if (resumeText) resumeText.textContent = "Already signed in? Open Dashboard →";
  } else if (role) {
    if (resumeLink) {
      resumeLink.hidden = false;
      resumeLink.href = "clubs.html";
    }
    if (resumeText) {
      resumeText.textContent = `Continue ${role === "admin" ? "admin" : "student"} preview →`;
    }
  } else if (resumeLink) {
    resumeLink.hidden = true;
  }

  if (exitPreviewLink) exitPreviewLink.hidden = !role;
}

// Show quick shortcut only if already authenticated (or in preview mode)
onAuthStateChanged(auth, (user) => paintSessionLinks(user));
paintSessionLinks(null);

/* ---------- preview bypass (temporary) ----------
   Google pop-ups are blocked inside embedded preview iframes, so let people
   open the portal with sample data. Remove this block once sign-in works. */
function openPreview(role) {
  setDemoRole(role);
  window.location.href = "clubs.html";
}

document.getElementById("previewStudent")?.addEventListener("click", () => openPreview("student"));
document.getElementById("previewAdmin")?.addEventListener("click", () => openPreview("admin"));

exitPreviewLink?.addEventListener("click", (event) => {
  event.preventDefault();
  clearDemoRole();
  paintSessionLinks(auth.currentUser);
  if (toast) toast.textContent = "Preview mode ended.";
});

// Student / Mentor tabs
const notes = {
  student: `Secure sign-in with Google. Use your college email address (@${ALLOWED_DOMAIN}).`,
  mentor: "Secure sign-in with Google. Use an authorized mentor / organizer email address."
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", String(t === tab));
    });

    role = tab.dataset.role;
    if (noteText) noteText.textContent = notes[role];
    if (toast) toast.textContent = "";
  });
});

// Authentication error messages
const errors = {
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/popup-blocked":
    "Pop-up was blocked. Allow pop-ups in your browser address bar, or open the site in a separate browser tab.",
  "auth/unauthorized-domain":
    "This domain is not authorized in Firebase Console (Authentication → Settings → Authorized domains).",
  "auth/network-request-failed": "Network error. Check your internet connection.",
  "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase."
};

async function finalizeAuthenticatedUser(user, chosenRole) {
  const email = (user.email || "").toLowerCase().trim();

  if (chosenRole === "mentor") {
    const authorized = await checkIsAdmin(user);
    if (!authorized) {
      await signOut(auth);
      if (toast) toast.textContent = "Access Denied: This email is not authorized for Mentor login.";
      return;
    }
  } else if (!email.endsWith("@" + ALLOWED_DOMAIN)) {
    await signOut(auth);
    if (toast) {
      toast.textContent = `Please sign in with your college email (@${ALLOWED_DOMAIN}).`;
    }
    return;
  }

  store(
    USER_KEY,
    JSON.stringify({
      name: user.displayName || user.email,
      email: user.email,
      photo: user.photoURL || "",
      uid: user.uid,
      role: chosenRole === "mentor" ? "Mentor" : "Student"
    })
  );

  window.location.href = DASHBOARD_URL;
}

// Handle redirect sign-in completion (used as fallback when pop-ups are blocked on top-level tabs)
(async () => {
  try {
    const redirectResult = await getRedirectResult(auth);
    if (redirectResult && redirectResult.user) {
      let pendingRole = "student";
      try {
        pendingRole = sessionStorage.getItem(ROLE_SESSION_KEY) || "student";
        sessionStorage.removeItem(ROLE_SESSION_KEY);
      } catch { /* ignore */ }
      await finalizeAuthenticatedUser(redirectResult.user, pendingRole);
    }
  } catch (error) {
    console.error("Redirect authentication error:", error);
    if (toast) {
      toast.textContent = errors[error.code] || `Sign-in failed: ${error.message}`;
    }
  }
})();

async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: "select_account",
    hd: ALLOWED_DOMAIN
  });

  if (googleBtn) googleBtn.disabled = true;
  if (headSignin) headSignin.disabled = true;
  if (toast) toast.textContent = "Opening Google...";

  try {
    const result = await signInWithPopup(auth, provider);
    await finalizeAuthenticatedUser(result.user, role);
  } catch (error) {
    console.error("Firebase authentication error:", error);

    const inIframe = window.self !== window.top;

    // On a normal top-level tab, fall back to redirect sign-in if pop-ups are blocked.
    if (error.code === "auth/popup-blocked" && !inIframe) {
      try {
        sessionStorage.setItem(ROLE_SESSION_KEY, role);
      } catch { /* ignore */ }
      if (toast) toast.textContent = "Pop-up blocked — redirecting to Google Sign-In...";
      await signInWithRedirect(auth, provider);
      return;
    }

    if (toast) {
      if (error.code === "auth/popup-blocked" && inIframe) {
        toast.textContent =
          "Pop-ups are blocked in the embedded preview iframe. Allow pop-ups in your browser address bar, or test from a direct tab/deployment.";
      } else {
        toast.textContent = errors[error.code] || `Sign-in failed: ${error.message}`;
      }
    }
  } finally {
    if (googleBtn) googleBtn.disabled = false;
    if (headSignin) headSignin.disabled = false;
  }
}

googleBtn?.addEventListener("click", signIn);
headSignin?.addEventListener("click", signIn);
