import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { auth, db, checkIsAdmin } from "./firebase-init.js";
import { ensureStudentProfile } from "./student-profile.js";

const $ = (id) => document.getElementById(id);
const loading = $("authLoading");
const app = $("settingsApp");
const form = $("profileForm");
const saveButton = $("saveButton");
const formAlert = $("formAlert");
const DOMAIN = "mitsgwl.ac.in";
let currentUser = null;
let toastTimer;

function showToast(message) {
  const toast = $("settingsToast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setAlert(message, type) {
  formAlert.textContent = message;
  formAlert.className = `form-alert ${type}`;
  formAlert.hidden = !message;
}

function setFieldError(name, message = "") {
  const input = $(name);
  const error = $(`${name}Error`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function populate(data, user) {
  $("name").value = data.studentName || data.name || user.displayName || "";
  $("rollNo").value = data.rollNo || "";
  $("collegeEmail").value = (data.collegeEmail || data.email || user.email || "").toLowerCase();
  $("phone").value = data.phone || "";
  $("year").value = data.year ? String(data.year) : "";
  $("branch").value = data.branch || "";
  $("bio").value = data.bio || "";
  $("interests").value = data.interests || "";
  $("linkedin").value = data.linkedin || "";
  $("portfolio").value = data.portfolio || data.github || "";
  $("bioCount").textContent = String($("bio").value.length);
}

function readValues() {
  return {
    name: $("name").value.trim().replace(/\s+/g, " "),
    rollNo: $("rollNo").value.trim().toUpperCase(),
    collegeEmail: $("collegeEmail").value.trim().toLowerCase(),
    phone: $("phone").value.trim(),
    year: Number($("year").value) || 0,
    branch: $("branch").value,
    bio: $("bio").value.trim(),
    interests: $("interests").value.trim(),
    linkedin: $("linkedin").value.trim(),
    portfolio: $("portfolio").value.trim()
  };
}

function validWebUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch { return false; }
}

function validate(data) {
  ["name", "rollNo", "collegeEmail", "phone", "year", "branch", "linkedin", "portfolio"].forEach((key) => setFieldError(key));
  let ok = true;
  const fail = (field, message) => { setFieldError(field, message); ok = false; };
  if (!data.name) fail("name", "Full name is required.");
  else if (data.name.length < 3) fail("name", "Enter at least 3 characters.");
  else if (!/^[\p{L}][\p{L} .'-]*$/u.test(data.name)) fail("name", "Use letters, spaces, dots, apostrophes or hyphens.");
  if (!data.rollNo) fail("rollNo", "Enrollment / roll number is required.");
  else if (!/^[A-Z0-9/-]{4,20}$/.test(data.rollNo)) fail("rollNo", "Use 4–20 letters, numbers, slashes or hyphens.");
  if (!data.collegeEmail) fail("collegeEmail", "College email is required.");
  else if (!new RegExp(`^[a-z0-9._%+-]+@${DOMAIN.replaceAll(".", "\\.")}$`, "i").test(data.collegeEmail)) fail("collegeEmail", `Enter a valid @${DOMAIN} address.`);
  if (data.phone && !/^[6-9]\d{9}$/.test(data.phone)) fail("phone", "Enter a valid 10-digit Indian mobile number.");
  if (![1, 2, 3, 4].includes(data.year)) fail("year", "Select your current year.");
  if (!["CSE", "IT", "AIML", "DS", "ECE", "EE", "ME", "CE"].includes(data.branch)) fail("branch", "Select your branch.");
  if (!validWebUrl(data.linkedin)) fail("linkedin", "Enter a full link beginning with https://.");
  if (!validWebUrl(data.portfolio)) fail("portfolio", "Enter a full link beginning with https://.");
  return ok;
}

async function loadProfile(user) {
  let profile = {};
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (snapshot.exists()) profile = snapshot.data();
  } catch (error) {
    console.warn("Could not load student settings:", error);
    setAlert("We couldn't load your saved profile. You can still enter your details and try saving.", "error");
  }
  populate(profile, user);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  currentUser = user;
  try {
    const isAdmin = await checkIsAdmin(user);
    $("portalRole").textContent = isAdmin ? "Organizer Portal" : "Student Portal";
    const accountEmail = user.email || "Google account";
    $("accountEmail").textContent = accountEmail;
    $("userName").textContent = user.displayName || accountEmail;
    $("userEmail").textContent = accountEmail;
    $("avatar").textContent = (user.displayName || accountEmail || "?").trim().charAt(0).toUpperCase();

    // Students who haven't completed the required details are guided through the existing form first.
    await ensureStudentProfile(user, { isAdmin });
    await loadProfile(user);
  } catch (error) {
    console.error("Settings initialization failed:", error);
    setAlert("Your settings could not be fully loaded. Please refresh and try again.", "error");
  } finally {
    loading.hidden = true;
    app.hidden = false;
    if (window.lucide) window.lucide.createIcons();
  }
});

form.addEventListener("input", (event) => {
  if (event.target.id === "bio") $("bioCount").textContent = String(event.target.value.length);
  if (event.target.id) setFieldError(event.target.id);
  if (!formAlert.hidden) setAlert("", "");
});
form.addEventListener("change", (event) => { if (event.target.id) setFieldError(event.target.id); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const data = readValues();
  if (!validate(data)) {
    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
    firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
    setAlert("Please check the highlighted fields and try again.", "error");
    return;
  }

  saveButton.disabled = true;
  saveButton.querySelector("span").textContent = "Saving...";
  setAlert("", "");
  try {
    await setDoc(doc(db, "users", currentUser.uid), {
      uid: currentUser.uid,
      name: data.name,
      studentName: data.name,
      // Keep the Google sign-in address as the canonical account email.
      email: (currentUser.email || data.collegeEmail).toLowerCase(),
      collegeEmail: data.collegeEmail,
      rollNo: data.rollNo,
      phone: data.phone,
      year: data.year,
      branch: data.branch,
      bio: data.bio,
      interests: data.interests,
      linkedin: data.linkedin,
      portfolio: data.portfolio,
      studentProfileComplete: true,
      updatedAt: serverTimestamp()
    }, { merge: true });
    setAlert("Your profile has been updated successfully.", "success");
    showToast("Profile changes saved");
    $("userName").textContent = data.name;
    $("avatar").textContent = data.name.charAt(0).toUpperCase();
  } catch (error) {
    console.error("Saving student settings failed:", error);
    setAlert("We couldn't save your changes. Check your connection and try again.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.querySelector("span").textContent = "Save changes";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  try { await signOut(auth); } catch (error) { console.error("Sign out failed:", error); }
});

const sidebar = $("sidebar");
const backdrop = $("sidebarBackdrop");
const menuButton = $("menuBtn");
function closeMenu() {
  sidebar?.classList.remove("open");
  backdrop?.classList.remove("show");
  menuButton?.setAttribute("aria-expanded", "false");
}
menuButton?.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open");
  backdrop.classList.toggle("show", open);
  menuButton.setAttribute("aria-expanded", String(open));
});
backdrop?.addEventListener("click", closeMenu);
document.querySelectorAll(".sidebar a").forEach((link) => link.addEventListener("click", closeMenu));
