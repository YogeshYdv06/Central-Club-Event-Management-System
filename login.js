
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

// Configuration
const DASHBOARD_URL = "Dashboard.html";
const ALLOWED_DOMAIN = "mitsgwl.ac.in";

const auth = getAuth(initializeApp(firebaseConfig));

const USER_KEY = "campushub_user";
const THEME_KEY = "campushub_theme";

const root = document.documentElement;
const tabs = document.querySelectorAll(".tab");
const toast = document.getElementById("toast");
const googleBtn = document.getElementById("google");
const headSignin = document.getElementById("headSignin");

let role = "student";

// Local storage
const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error("Storage error:", error);
  }
};

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
};

// Theme toggle
const savedTheme = read(THEME_KEY);

if (savedTheme) {
  root.dataset.theme = savedTheme;
}

document.getElementById("theme").addEventListener("click", () => {
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;

  root.dataset.theme = dark ? "light" : "dark";
  store(THEME_KEY, root.dataset.theme);
});

// Student / Mentor tabs
const notes = {
  student: "Secure sign-in with Google. Use your college email address.",
  mentor: "Secure sign-in with Google. Use the email your institute registered for you."
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.setAttribute("aria-selected", t === tab);
    });

    role = tab.dataset.role;

    document.getElementById("noteText").textContent = notes[role];
    toast.textContent = "";
  });
});

// Authentication error messages
const errors = {
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/popup-blocked": "Please allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "This address is not allowed. Add it in Firebase Authorized domains.",
  "auth/network-request-failed": "Network error. Check your internet connection.",
  "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase."
};

// Google sign-in function
async function signIn() {

  const provider = new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account",
    hd: ALLOWED_DOMAIN
  });

  googleBtn.disabled = true;
  headSignin.disabled = true;

  toast.textContent = "Opening Google...";

  try {

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const email = (user.email || "").toLowerCase();

    // College email verification
    if (!email.endsWith("@" + ALLOWED_DOMAIN)) {

      await signOut(auth);

      toast.textContent =
        "Please sign in with your college email (@" +
        ALLOWED_DOMAIN + ").";

      return;
    }

    // Store authenticated user information
    store(USER_KEY, JSON.stringify({
      name: user.displayName || user.email,
      email: user.email,
      photo: user.photoURL || "",
      uid: user.uid,
      role: role === "mentor" ? "Mentor" : "Student"
    }));

    // Redirect to dashboard
    window.location.href = DASHBOARD_URL;

  } catch (error) {

    console.error("Firebase authentication error:", error);

    toast.textContent =
      errors[error.code] ||
      "Sign-in failed: " + error.message;

  } finally {

    googleBtn.disabled = false;
    headSignin.disabled = false;

  }
}

// Login card Google button
googleBtn.addEventListener("click", signIn);

// Header Sign In button
headSignin.addEventListener("click", signIn);
