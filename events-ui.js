// Shared event markup & helpers for the student events page.
import { esc, safeHttpUrl, parts, fmtDate, fmtTime } from "./utils.js";

const CATEGORIES = {
  technical: { label: "Technical", icon: "code", theme: "technical" },
  cultural: { label: "Cultural", icon: "music", theme: "cultural" },
  sports: { label: "Sports", icon: "trophy", theme: "sports" },
  literary: { label: "Literary", icon: "book-open", theme: "literary" },
  social: { label: "Social", icon: "users", theme: "social" },
  general: { label: "General", icon: "sparkles", theme: "general" },
  all: { label: "All Events", icon: "layout-grid", theme: "general" }
};

export const FILTER_CATEGORIES = ["technical", "cultural", "sports", "literary", "social"];

export function catMeta(key) {
  return CATEGORIES[key] || CATEGORIES.general;
}

/** Works out a category from an explicit field, or from the club/title text. */
export function eventCategory(ev) {
  const raw = String(ev?.cat || ev?.category || "").toLowerCase().trim();
  if (CATEGORIES[raw] && raw !== "all") return raw;

  const hay = `${ev?.club || ""} ${ev?.title || ""} ${ev?.description || ""}`.toLowerCase();
  if (/tech|coding|code|hack|robot|program|circuit|ai\b/.test(hay)) return "technical";
  if (/cultur|music|dance|drama|sing|theatre|art\b|open mic|fest/.test(hay)) return "cultural";
  if (/sport|football|cricket|basket|athlet|tournament|match|marathon/.test(hay)) return "sports";
  if (/liter|book|poet|debate|writ|word|quiz|spell/.test(hay)) return "literary";
  if (/social|blood|donat|volunt|environment|awareness|camp|green|charity/.test(hay)) return "social";
  return "general";
}

export function eventHref(ev) {
  return `event-details.html?id=${encodeURIComponent(ev.id)}`;
}

function coverImage(ev) {
  return safeHttpUrl(ev?.image || ev?.cover || ev?.banner || ev?.imageUrl || "");
}

/**
 * One event card for the student grid.
 * opts: { going, capacity, mine, past, busy }
 */
export function eventCardHTML(ev, opts = {}) {
  const { going = 0, capacity = 0, mine = false, past = false, busy = false } = opts;

  const cat = eventCategory(ev);
  const meta = catMeta(cat);
  const img = coverImage(ev);
  const href = eventHref(ev);
  const title = ev.title || "Campus event";
  const cap = Number(capacity) || 0;
  const full = cap > 0 && going >= cap && !mine;

  let action;
  if (past) {
    action = '<span class="ev-btn off">Event ended</span>';
  } else if (mine) {
    action = `<button class="ev-btn on" type="button" data-rsvp="${esc(ev.id)}" ${busy ? "disabled" : ""}>
        <i data-lucide="check"></i> Registered · Cancel
      </button>`;
  } else if (full) {
    action = '<span class="ev-btn off">Full</span>';
  } else {
    action = `<button class="ev-btn" type="button" data-rsvp="${esc(ev.id)}" ${busy ? "disabled" : ""}>
        Register <i data-lucide="arrow-right"></i>
      </button>`;
  }

  const flag = past
    ? '<span class="ev-flag past">Ended</span>'
    : mine
      ? '<span class="ev-flag">Registered</span>'
      : "";

  const when = [
    ev.date ? `<li><i data-lucide="calendar"></i>${esc(fmtDate(ev.date))}</li>` : "",
    ev.time ? `<li><i data-lucide="clock"></i>${esc(fmtTime(ev.time))}</li>` : "",
    ev.location ? `<li><i data-lucide="map-pin"></i>${esc(ev.location)}</li>` : ""
  ]
    .filter(Boolean)
    .join("");

  return `
    <article class="ev-card ${meta.theme}" data-ev="${esc(ev.id)}">
      <div class="ev-cover${img ? " has-img" : ""}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}
        ${img ? "" : `<span class="ev-ic"><i data-lucide="${meta.icon}"></i></span>`}
        <span class="ev-badge"><i data-lucide="${meta.icon}"></i>${esc(meta.label)}</span>
        ${flag}
      </div>
      <div class="ev-body">
        <h3 class="ev-title"><a href="${href}">${esc(title)}</a></h3>
        ${ev.club ? `<span class="ev-club"><i data-lucide="users"></i>${esc(ev.club)}</span>` : ""}
        ${ev.description ? `<p class="ev-desc">${esc(ev.description)}</p>` : ""}
        <ul class="ev-meta">${when}</ul>
        <div class="ev-foot">
          <span class="ev-going">
            <i data-lucide="users"></i>${going} Going${cap > 0 ? ` <span style="color:#8f96d8">/ ${cap} spots</span>` : ""}
          </span>
          ${action}
        </div>
      </div>
    </article>`;
}

/** Compact row for the "Upcoming Events" rail. */
export function upcomingItemHTML(ev) {
  const p = parts(ev.date);
  const sub = [ev.club, ev.time ? fmtTime(ev.time) : ""].filter(Boolean).join(" · ");
  return `
    <li>
      <a href="${eventHref(ev)}">
        <span class="ev-date2"><b>${esc(p.day)}</b><small>${esc(p.month)}</small></span>
        <span class="ev-up-info">
          <b>${esc(ev.title || "Campus event")}</b>
          <small>${esc(sub || "Details coming soon")}</small>
        </span>
        <i data-lucide="chevron-right" class="go"></i>
      </a>
    </li>`;
}

/** Tile in the "Event Categories" panel. */
export function categoryTileHTML(key, count, active = false) {
  const meta = catMeta(key);
  return `
    <button class="ev-cat${active ? " active" : ""}" type="button" data-cat="${esc(key)}">
      <i data-lucide="${meta.icon}"></i>
      ${esc(meta.label)}
      <small>${count} event${count === 1 ? "" : "s"}</small>
    </button>`;
}
