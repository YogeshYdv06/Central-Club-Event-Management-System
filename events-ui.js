// Shared event markup & helpers for the student events page.
import { esc, safeHttpUrl, parts, fmtShortDate, fmtTime } from "./utils.js";

const CATEGORIES = {
  technical: {
    label: "Technical",
    icon: "code-2",
    theme: "technical",
    tagline: ["Code", "Build", "Innovate"],
    cover: "assets/events/technical.jpg"
  },
  cultural: {
    label: "Cultural",
    icon: "music",
    theme: "cultural",
    tagline: ["Speak", "Perform", "Inspire"],
    cover: "assets/events/cultural.jpg"
  },
  sports: {
    label: "Sports",
    icon: "dribbble",
    theme: "sports",
    tagline: ["Play", "Compete", "Win"],
    cover: "assets/events/sports.jpg"
  },
  literary: {
    label: "Literary",
    icon: "book-open",
    theme: "literary",
    tagline: ["Write", "Express", "Inspire"],
    cover: "assets/events/literary.jpg"
  },
  social: {
    label: "Social",
    icon: "users",
    theme: "social",
    tagline: ["Donate Blood", "Save Lives"],
    cover: "assets/events/social.jpg"
  },
  general: {
    label: "General",
    icon: "sparkles",
    theme: "general",
    tagline: ["Connect", "Learn", "Grow"],
    cover: "assets/events/technical.jpg"
  },
  all: {
    label: "All Events",
    icon: "layout-grid",
    theme: "all",
    tagline: ["Explore", "Join", "Celebrate"],
    cover: "assets/events/technical.jpg"
  }
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
  if (/cultur|music|dance|drama|sing|theatre|art\b|open mic|fusion|fest/.test(hay)) return "cultural";
  if (/sport|football|cricket|basket|athlet|tournament|match|marathon/.test(hay)) return "sports";
  if (/liter|book|poet|debate|writ|word|quiz|spell/.test(hay)) return "literary";
  if (/social|blood|donat|volunt|environment|awareness|camp|green|charity/.test(hay)) return "social";
  return "general";
}

export function eventHref(ev) {
  return `event-details.html?id=${encodeURIComponent(ev.id)}`;
}

/** Picks an explicit image URL if present, otherwise a themed campus illustration. */
function resolveCoverImage(ev, cat) {
  const explicit = safeHttpUrl(ev?.image || ev?.cover || ev?.banner || ev?.imageUrl || "");
  if (explicit) return explicit;
  const local = String(ev?.localCover || "").trim();
  if (local && /^assets\/events\/[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(local)) {
    return local;
  }
  const hay = `${ev?.title || ""} ${ev?.description || ""}`.toLowerCase();
  if (cat === "cultural" && /dance|fusion|dj|concert|rhythm|fest|night/i.test(hay) && !/mic|poet|comedy/i.test(hay)) {
    return "assets/events/fusion.jpg";
  }
  return (CATEGORIES[cat] || CATEGORIES.general).cover;
}

/** Picks the card colour variant (matches the reference design's 6 distinct gradients). */
function resolveCardVariant(ev, cat) {
  if (ev?.variant) return ev.variant;
  const hay = `${ev?.title || ""} ${ev?.description || ""}`.toLowerCase();
  if (cat === "cultural" && /dance|fusion|dj|concert|rhythm/i.test(hay) && !/mic/i.test(hay)) {
    return "cultural-blue";
  }
  if (cat === "social" && !/blood|donat/i.test(hay)) {
    return "social";
  }
  return catMeta(cat).theme;
}

/** Builds the 2–3 word tagline row under the event title (e.g. "Code • Build • Innovate"). */
function resolveTaglineParts(ev, cat) {
  if (Array.isArray(ev?.tags) && ev.tags.length) {
    return ev.tags.slice(0, 3).map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof ev?.tagline === "string" && ev.tagline.trim()) {
    return ev.tagline
      .split(/[•·,|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  const hay = `${ev?.title || ""} ${ev?.description || ""}`.toLowerCase();
  if (/fusion|dance/i.test(hay)) return ["Dance", "Music", "Vibes"];
  if (/blood|donat/i.test(hay)) return ["Donate Blood", "Save Lives"];
  if (/social|volunt|green|camp/i.test(hay) && cat === "social") return ["Serve", "Connect", "Impact"];
  if (ev?.club && !CATEGORIES[cat]) return [ev.club];
  return catMeta(cat).tagline;
}

/**
 * One event card for the student grid.
 * opts: { going, capacity, mine, past, busy }
 */
export function eventCardHTML(ev, opts = {}) {
  const { going = 0, capacity = 0, mine = false, past = false, busy = false } = opts;

  const cat = eventCategory(ev);
  const meta = catMeta(cat);
  const variant = resolveCardVariant(ev, cat);
  const img = resolveCoverImage(ev, cat);
  const href = eventHref(ev);
  const title = ev.title || "Campus Event";
  const cap = Number(capacity) || 0;
  const full = cap > 0 && going >= cap && !mine;
  const tagParts = resolveTaglineParts(ev, cat);
  const taglineHTML = tagParts.map((w) => `<span>${esc(w)}</span>`).join('<i class="dot-sep">•</i>');
  const desc = ev.description || (ev.club ? `Hosted by ${ev.club}. Join fellow students for an unforgettable experience!` : "Join fellow students at MITS for this campus event.");

  let action;
  if (past) {
    action = '<span class="ev-btn off">Ended</span>';
  } else if (mine) {
    action = `<button class="ev-btn on" type="button" data-rsvp="${esc(ev.id)}" ${busy ? "disabled" : ""} title="Click to cancel registration">
        <i data-lucide="check"></i> Registered
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
      ? '<span class="ev-flag">Going ✓</span>'
      : "";

  const dateText = ev.date ? fmtShortDate(ev.date) : "Date TBA";
  const timeText = ev.time ? fmtTime(ev.time) : "Time TBA";
  const locText = ev.location || "MITS Campus";

  return `
    <article class="ev-card ${esc(variant)}" data-ev="${esc(ev.id)}">
      <div class="ev-cover has-img">
        <img src="${esc(img)}" alt="${esc(title)}" loading="lazy">
        <span class="ev-badge"><i data-lucide="${meta.icon}"></i>${esc(meta.label)}</span>
        ${flag}
        <button class="ev-more" type="button" data-card-menu="${esc(ev.id)}" aria-label="Event options" title="Event options">
          <i data-lucide="more-vertical"></i>
        </button>
        <div class="ev-card-dd" data-card-dd="${esc(ev.id)}" hidden>
          <a href="${href}"><i data-lucide="external-link"></i>View Event Details</a>
          <button type="button" data-share-ev="${esc(ev.id)}"><i data-lucide="share-2"></i>Copy Event Link</button>
        </div>
      </div>
      <div class="ev-body">
        <h3 class="ev-title"><a href="${href}">${esc(title)}</a></h3>
        <div class="ev-tagline">${taglineHTML}</div>
        <p class="ev-desc">${esc(desc)}</p>
        <div class="ev-meta">
          <div class="ev-meta-row">
            <span><i data-lucide="calendar"></i>${esc(dateText)}</span>
            <span><i data-lucide="clock"></i>${esc(timeText)}</span>
          </div>
          <div class="ev-meta-row">
            <span><i data-lucide="map-pin"></i>${esc(locText)}</span>
          </div>
        </div>
        <div class="ev-foot">
          <span class="ev-going">
            <i data-lucide="users"></i><b>${going}</b> Going
          </span>
          ${action}
        </div>
      </div>
    </article>`;
}

/** Compact row for the "Upcoming Events" rail. */
export function upcomingItemHTML(ev, index = 0) {
  const p = parts(ev.date);
  const cat = eventCategory(ev);
  const clubLabel = ev.club || `${catMeta(cat).label} Club`;
  const sub = [clubLabel, ev.time ? fmtTime(ev.time) : ""].filter(Boolean).join("  •  ");
  const tones = ["tone-blue", "tone-amber", "tone-purple", "tone-pink"];
  const tone = tones[index % tones.length];

  return `
    <li>
      <a href="${eventHref(ev)}">
        <span class="ev-date2 ${tone}"><b>${esc(p.day)}</b><small>${esc(p.month)}</small></span>
        <span class="ev-up-info">
          <b>${esc(ev.title || "Campus Event")}</b>
          <small>${esc(sub || "Details coming soon")}</small>
        </span>
        <i data-lucide="chevron-right" class="go"></i>
      </a>
    </li>`;
}

/** Tile in the "Event Categories" 3x2 panel. */
export function categoryTileHTML(key, count = 0, active = false) {
  const meta = catMeta(key);
  return `
    <button class="ev-cat cat-${esc(key)}${active ? " active" : ""}" type="button" data-cat="${esc(key)}" title="${esc(meta.label)} (${count})">
      <span class="ev-cat-ic"><i data-lucide="${meta.icon}"></i></span>
      <span class="ev-cat-lbl">${esc(meta.label)}</span>
    </button>`;
}
