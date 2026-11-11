
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

// Check authentication
onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.replace("index.html");
    return;
  }

  try {

    // Unique ID of the logged-in student
    const uid = user.uid;

    // Reference to this student's Firestore document
    const userRef = doc(db, "users", uid);

    // Check whether the student's profile already exists
    const userSnapshot = await getDoc(userRef);

    // Prepare student profile data
    const studentData = {
      uid: uid,
      name: user.displayName || "Student",
      email: user.email || "",
      photoURL: user.photoURL || "",
      updatedAt: serverTimestamp()
    };

    // Create profile if this is the student's first login
    if (!userSnapshot.exists()) {
      studentData.createdAt = serverTimestamp();
    }

    // Save or update the student's profile
    await setDoc(userRef, studentData, { merge: true });

    console.log("Student profile saved successfully!");

    // Display student information
    const name = document.getElementById("profileName");
    const email = document.getElementById("profileEmail");
    const photo = document.getElementById("profilePhoto");
    const greetingName = document.getElementById("greetingName");

    if (name) {
      name.textContent = studentData.name;
    }

    if (email) {
      email.textContent = studentData.email;
    }

    if (photo) {
      photo.src = studentData.photoURL ||
        "https://ui-avatars.com/api/?name=Student";
      photo.alt = "Student profile photo";
    }

    if (greetingName) {
      greetingName.textContent = studentData.name.split(" ")[0];
    }

  } catch (error) {

    console.error("Firestore profile error:", error);

    alert("Unable to save your profile. Please check your internet connection and Firestore security rules.");

  } finally {

    // Show dashboard
    if (loading) loading.hidden = true;
    if (dashboard) dashboard.hidden = false;

  }

});

// Logout functionality
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
