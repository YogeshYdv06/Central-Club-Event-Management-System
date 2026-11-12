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
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
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
    const uid = user.uid;
    const storedUser = JSON.parse(localStorage.getItem("campushub_user") || "{}");
    const role = storedUser.role || "Student";

    // Reference to this user's Firestore document
    const userRef = doc(db, "users", uid);
    const userSnapshot = await getDoc(userRef);

    // Prepare user profile data
    const userData = {
      uid: uid,
      name: user.displayName || role,
      email: user.email || "",
      photoURL: user.photoURL || "",
      role: role,
      updatedAt: serverTimestamp()
    };

    // Create profile if first login
    if (!userSnapshot.exists()) {
      userData.createdAt = serverTimestamp();
    }

    // Save or update profile in Firestore
    await setDoc(userRef, userData, { merge: true });

    // Update UI elements
    const nameEl = document.getElementById("profileName");
    const emailEl = document.getElementById("profileEmail");
    const photoEl = document.getElementById("profilePhoto");
    const greetingNameEl = document.getElementById("greetingName");
    const portalLabel = document.querySelector(".sidebar .brand small");

    if (nameEl) nameEl.textContent = userData.name;
    if (emailEl) emailEl.textContent = userData.email;
    if (greetingNameEl) greetingNameEl.textContent = userData.name.split(" ")[0];
    if (portalLabel) portalLabel.textContent = `${role} Portal`;

    if (photoEl) {
      photoEl.src = userData.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}`;
      photoEl.alt = `${role} profile photo`;
    }

    // Load live mentor-created events into the dashboard sidebar
    loadDashboardEvents();

  } catch (error) {
    console.error("Firestore profile error:", error);
  } finally {
    if (loading) loading.hidden = true;
    if (dashboard) dashboard.hidden = false;
  }

});

// Fetch and display live events created by the mentor
function loadDashboardEvents() {
  const eventListEl = document.querySelector(".event-list");
  if (!eventListEl) return;

  const eventsQuery = query(collection(db, "events"), orderBy("date"), limit(4));

  onSnapshot(eventsQuery, (snapshot) => {
    if (snapshot.empty) {
      eventListEl.innerHTML = `<li style="color:#888; font-size:13px;">No upcoming events posted yet.</li>`;
      return;
    }

    eventListEl.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const ev = docSnap.data();
      const dateObj = new Date(ev.date + "T00:00:00");
      const day = isNaN(dateObj) ? "--" : dateObj.getDate();
      const month = isNaN(dateObj) ? "" : dateObj.toLocaleString("en-US", { month: "short" });

      const li = document.createElement("li");
      li.style.cursor = "pointer";
      li.onclick = () => (window.location.href = "events.html");
      li.innerHTML = `
        <div class="date"><b>${day}</b>${month}</div>
        <div>
          <strong>${ev.title}</strong>
          <small>${ev.time || ""} ${ev.location ? "· " + ev.location : ""}</small>
        </div>
        <i data-lucide="arrow-right" class="go"></i>
      `;
      eventListEl.appendChild(li);
    });

    // Re-render Lucide icons for newly injected elements
    if (window.lucide) {
      window.lucide.createIcons();
    }
  });
}

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