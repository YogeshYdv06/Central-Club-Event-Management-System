import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_EMAIL = "26ir1yo77@mitsgwl.ac.in";

onAuthStateChanged(auth, user => {
  if (!user || user.email !== ADMIN_EMAIL) {
    alert("Unauthorized access. Admin domain only.");
    window.location.replace("index.html");
  }
});

document.getElementById('createClubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.textContent = "Publishing...";
  btn.disabled = true;

  const id = document.getElementById('clubId').value.trim().toLowerCase();

  const clubData = {
    id: id,
    name: document.getElementById('clubName').value.trim(),
    cat: document.getElementById('clubCat').value,
    theme: document.getElementById('clubTheme').value,
    icon: document.getElementById('clubIcon').value.trim(),
    desc: document.getElementById('clubDesc').value.trim(),
    members: 0, // Starts fresh
    leader: {
      name: document.getElementById('leaderName').value.trim(),
      email: document.getElementById('leaderEmail').value.trim(),
    },
    contactPhone: document.getElementById('contactPhone').value.trim(),
    whatsappUrl: document.getElementById('whatsappUrl').value.trim(),
    createdAt: new Date()
  };

  try {
    await setDoc(doc(db, "clubs", id), clubData);
    alert("Club successfully created and published to the student domain!");
    window.location.href = "clubs.html"; // Redirect to student view to verify
  } catch (error) {
    console.error("Error creating club:", error);
    alert("Failed to publish club. Check console/permissions.");
    btn.textContent = "Publish Club to Student Domain";
    btn.disabled = false;
  }
});