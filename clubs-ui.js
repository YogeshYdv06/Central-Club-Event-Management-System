// Shared club card markup used by the Clubs directory (clubs.js).
// Keeping it here means the live page and any preview render exactly the same card.

import { esc, getClubMemberCount } from "./utils.js";

const VALID_THEMES = new Set(["blue", "purple", "green", "orange", "pink", "teal"]);

const ICON_MAP = {
  code: "code",
  palette: "palette",
  ball: "trophy",
  sports: "trophy",
  book: "book-open",
  users: "users",
  leaf: "leaf",
  music: "music",
  cpu: "cpu",
  flask: "flask-conical",
  camera: "camera",
  mic: "mic"
};

export function themeForClub(club) {
  const t = (club?.theme || "").toLowerCase();
  if (VALID_THEMES.has(t)) return t;
  const cat = (club?.cat || club?.category || "").toLowerCase();
  if (cat.includes("cultur")) return "purple";
  if (cat.includes("sport")) return "green";
  if (cat.includes("liter")) return "orange";
  if (cat.includes("social")) return "pink";
  return "blue";
}

export function iconForClub(club) {
  const raw = (club?.icon || "").toLowerCase().trim();
  if (ICON_MAP[raw]) return ICON_MAP[raw];
  const cat = (club?.cat || club?.category || "").toLowerCase();
  if (cat.includes("tech")) return "code";
  if (cat.includes("cultur")) return "music";
  if (cat.includes("sport")) return "trophy";
  if (cat.includes("liter")) return "book-open";
  if (cat.includes("social")) return "users";
  return "sparkles";
}

export function clubDetailsHref(club) {
  return `club-details.html?id=${encodeURIComponent(club.id)}`;
}

/**
 * One club card.
 * opts: { joined, isAdmin, pending }
 */
export function clubCardHTML(club, opts = {}) {
  const { joined = false, isAdmin = false, pending = 0 } = opts;
  const name = club.name || club.title || "Campus Club";
  const desc = club.desc || club.description || "Explore activities and events with us.";
  const cat = club.cat || club.category || "General";
  const count = getClubMemberCount(club);
  const theme = themeForClub(club);
  const icon = iconForClub(club);
  const href = clubDetailsHref(club);

  const pendingChip =
    isAdmin && pending > 0
      ? `<span class="pending-chip"><i data-lucide="clock"></i>${pending} pending</span>`
      : "";

  const action = isAdmin
    ? `<div class="manage">
         <button class="mi" type="button" data-edit-club="${esc(club.id)}" title="Edit club" aria-label="Edit club">
           <i data-lucide="pencil"></i>
         </button>
         <button class="mi" type="button" data-members-club="${esc(club.id)}" title="View members" aria-label="View members">
           <i data-lucide="users"></i>
         </button>
         <button class="mi danger" type="button" data-del-club="${esc(club.id)}" title="Delete club" aria-label="Delete club">
           <i data-lucide="trash-2"></i>
         </button>
       </div>`
    : joined
      ? `<a class="btn joined" href="${href}"><i data-lucide="check"></i> Joined · View</a>`
      : `<a class="btn" href="${href}">Join Club <i data-lucide="arrow-right"></i></a>`;

  return `
    <article class="card ${theme}" data-club="${esc(club.id)}">
      <div class="card-top">
        <div class="ico"><i data-lucide="${icon}"></i></div>
        <span class="tag">${esc(cat)}</span>
      </div>
      <h3><a href="${href}">${esc(name)}</a></h3>
      <p>${esc(desc)}</p>
      <div class="foot">
        <span class="members">
          <i data-lucide="users"></i> ${count} ${count === 1 ? "Member" : "Members"}
          ${pendingChip}
        </span>
        ${action}
      </div>
    </article>`;
}

/** Row for the "My Clubs" rail. */
export function myClubItemHTML(club) {
  const name = club.name || club.title || "Campus Club";
  const cat = club.cat || club.category || "General";
  const theme = themeForClub(club);
  const icon = iconForClub(club);
  return `
    <li>
      <a href="${clubDetailsHref(club)}">
        <span class="ico ${theme}"><i data-lucide="${icon}"></i></span>
        <span>
          <b>${esc(name)}</b>
          <small>${esc(cat)}</small>
        </span>
        <i data-lucide="chevron-right" class="go"></i>
      </a>
    </li>`;
}
