import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
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
  setTimeout(() => { if (t) t.style.opacity = '0'; }, 2500);
}

onAuthStateChanged(auth, async user => {
  if (!user || user.email !== ADMIN_EMAIL) {
    alert("Unauthorized access. Admin domain only.");
    location.replace('index.html');
    return;
  }
  
  // Bind form submission
  const form = $('#eventForm');
  if (form) {
    form.addEventListener('submit', handleCreateEvent);
  }
  
  await loadAdminEvents();
});

async function handleCreateEvent(e) {
  e.preventDefault();
  
  const title = $('#eventTitle').value.trim();
  const date = $('#eventDate').value;
  const location = $('#eventLocation').value.trim();
  const capacity = parseInt($('#eventCapacity').value, 10);

  if (!title || !date || !location || isNaN(capacity)) {
    toast("Please fill out all fields correctly.");
    return;
  }

  try {
    // Matches your Firestore rule validation: title (<=80 chars), date, location, capacity, createdBy
    await addDoc(collection(db, "events"), {
      title,
      date,
      location,
      capacity,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });

    toast("Event created successfully!");
    $('#eventForm').reset();
    await loadAdminEvents();
  } catch (error) {
    console.error("Error creating event:", error);
    toast("Failed to create event. Check Firestore rules.");
  }
}

async function loadAdminEvents() {
  const listEl = $('#eventsList');
  if (!listEl) return;

  try {
    const snap = await getDocs(collection(db, "events"));
    if (snap.empty) {
      listEl.innerHTML = `<p style="color: #94a3b8;">No events created yet.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs.map(d => {
      const ev = d.data();
      return `
        <div style="background: #1e1b4b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h4 style="margin: 0 0 6px 0; color: #818cf8; font-size: 16px;">${ev.title}</h4>
            <p style="margin: 0; font-size: 13px; color: #cbd5e1;">📅 ${ev.date} | 📍 ${ev.location} | 👥 Cap: ${ev.capacity}</p>
          </div>
          <button onclick="window.deleteEvent('${d.id}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">Delete</button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error("Error loading events:", error);
    listEl.innerHTML = `<p style="color: #ef4444;">Failed to load events.</p>`;
  }
}

window.deleteEvent = async function(eventId) {
  if (!confirm("Are you sure you want to delete this event?")) return;
  try {
    await deleteDoc(doc(db, "events", eventId));
    toast("Event deleted.");
    await loadAdminEvents();
  } catch (error) {
    console.error("Error deleting event:", error);
    toast("Failed to delete event.");
  }
};