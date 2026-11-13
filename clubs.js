import { db, auth } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

let allClubs = [];
let currentCategory = 'all';
let searchQuery = '';
let currentUser = null;

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Track auth state
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  console.log("CampusHub Auth User:", user ? user.email : "Not logged in");
  if (allClubs.length > 0) {
    renderMyClubs();
  }
});

async function loadStudentClubs() {
  let container = document.getElementById('clubsList') || document.getElementById('list') || document.querySelector('.list');
  
  if (!container) {
    container = document.createElement('div');
    container.id = 'clubsList';
    container.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; margin-top: 24px;';
    const mainArea = document.querySelector('main') || document.body;
    mainArea.appendChild(container);
  }

  container.innerHTML = `<p style="color: #cbd5e1; padding: 20px; text-align: center; grid-column: 1 / -1;">Loading campus clubs…</p>`;

  try {
    const snap = await getDocs(collection(db, "clubs"));
    if (snap.empty) {
      container.innerHTML = `<p style="color: #94a3b8; padding: 20px; text-align: center; grid-column: 1 / -1;">No clubs available right now.</p>`;
      return;
    }

    allClubs = snap.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    console.log("Loaded all clubs from Firestore:", allClubs);

    renderClubs();
    renderMyClubs();
    setupFiltersAndSearch();

  } catch (error) {
    console.error("Error loading clubs for students:", error);
    container.innerHTML = `<p style="color: #ef4444; padding: 20px; text-align: center; grid-column: 1 / -1;">Failed to load clubs. Check security rules.</p>`;
  }
}

// Render main club directory
function renderClubs() {
  const container = document.getElementById('clubsList') || document.getElementById('list') || document.querySelector('.list');
  if (!container) return;

  const filtered = allClubs.filter(club => {
    const name = (club.name || club.title || '').toLowerCase();
    const desc = (club.desc || club.description || '').toLowerCase();
    const cat = (club.cat || club.category || 'General').toLowerCase();

    const matchesSearch = name.includes(searchQuery) || desc.includes(searchQuery);
    const matchesCat = currentCategory === 'all' || cat === currentCategory.toLowerCase();

    return matchesSearch && matchesCat;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p style="color: #94a3b8; padding: 30px; text-align: center; grid-column: 1 / -1;">No matching clubs found.</p>`;
    return;
  }

  container.innerHTML = filtered.map(club => {
    const name = club.name || club.title || 'Campus Club';
    const desc = club.desc || club.description || 'Explore activities and events with us.';
    const cat = club.cat || club.category || 'General';
    const membersCount = club.membersCount || club.members?.length || '50+';

    return `
      <div style="background: linear-gradient(135deg, rgba(30, 27, 75, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 24px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div style="width: 48px; height: 48px; background: rgba(129, 140, 248, 0.15); border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #818cf8; font-weight: bold; font-size: 20px;">
              ${esc(name.charAt(0))}
            </div>
            <span style="font-size: 11px; background: rgba(129,140,248,0.15); color: #818cf8; padding: 4px 10px; border-radius: 8px; font-weight: 500; text-transform: uppercase;">${esc(cat)}</span>
          </div>
          <h3 style="margin: 0 0 8px 0; color: #fff; font-size: 20px; font-weight: 600;">${esc(name)}</h3>
          <p style="color: #94a3b8; font-size: 14px; margin-bottom: 24px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${esc(desc)}</p>
        </div>
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; font-size: 13px; color: #94a3b8;">
            <span>👥 ${membersCount} Members</span>
          </div>
          <button onclick="location.href='club-details.html?id=${club.id}'" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; border: none; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%;">View Club & Join →</button>
        </div>
      </div>
    `;
  }).join('');
}

// Render "My Clubs" widget with auto-injection fallback
function renderMyClubs() {
  let myContainer = document.getElementById('myClubsList') || document.querySelector('.my-clubs-container');
  
  if (!myContainer) {
    // Automatically find the "My Clubs" card box in the sidebar/top-right and insert container if missing
    const headings = Array.from(document.querySelectorAll('h2, h3, h4, div')).filter(el => el.textContent.trim() === 'My Clubs');
    if (headings.length > 0) {
      const parentCard = headings[0].closest('div') || headings[0].parentElement;
      myContainer = document.createElement('div');
      myContainer.id = 'myClubsList';
      parentCard.appendChild(myContainer);
    }
  }

  if (!myContainer) return;

  if (!currentUser) {
    myContainer.innerHTML = `<p style="color: #94a3b8; font-size: 13px; padding: 10px;">Please log in.</p>`;
    return;
  }

  // Check club members list (supports members, memberIds, or user email)
  const myClubs = allClubs.filter(club => {
    const members = club.members || club.memberIds || club.joined || [];
    return members.includes(currentUser.uid) || members.includes(currentUser.email);
  });

  console.log("Filtered My Clubs for user:", myClubs);

  if (myClubs.length === 0) {
    myContainer.innerHTML = `<p style="color: #94a3b8; font-size: 13px; padding: 10px;">You haven't joined any clubs yet.</p>`;
    return;
  }

  myContainer.innerHTML = myClubs.map(club => {
    const name = club.name || club.title || 'Campus Club';
    return `
      <div onclick="location.href='club-details.html?id=${club.id}'" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 10px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 32px; height: 32px; background: rgba(129, 140, 248, 0.15); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #818cf8; font-weight: bold; font-size: 14px;">
            ${esc(name.charAt(0))}
          </div>
          <span style="color: #fff; font-size: 14px; font-weight: 500;">${esc(name)}</span>
        </div>
        <span style="color: #818cf8; font-size: 12px;">→</span>
      </div>
    `;
  }).join('');
}

function setupFiltersAndSearch() {
  const chips = document.querySelectorAll('.chip, .filter-btn, [data-f], button');
  chips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      const text = e.target.textContent.trim().toLowerCase();
      if (['all clubs', 'technical', 'cultural', 'sports', 'literary', 'social'].includes(text)) {
        currentCategory = text === 'all clubs' ? 'all' : text;
        renderClubs();
      }
    });
  });

  const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"]');
  searchInputs.forEach(input => {
    input.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderClubs();
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadStudentClubs);
} else {
  loadStudentClubs();
}