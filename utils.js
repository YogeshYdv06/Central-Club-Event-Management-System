// Shared DOM, formatting, security, and UI utilities for CampusConnect.

export const THEME_KEY = "campushub_theme";
export const USER_KEY = "campushub_user";

/**
 * Reads the stored user session from localStorage (if any).
 */
export function getStoredSession() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the current authenticated user explicitly signed in via the
 * "Student" tab on index.html (as opposed to "Mentor").
 */
export function isSignedInAsStudent(user) {
  const saved = getStoredSession();
  if (!saved) return false;
  if (user?.uid && saved.uid && saved.uid !== user.uid) return false;
  return String(saved.role || "").toLowerCase() === "student";
}

export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/**
 * Validates that a URL uses an explicit http:// or https:// scheme.
 * Returns normalized href or empty string if invalid/unsafe.
 */
export function safeHttpUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "#") return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return "";
  }
  return "";
}

export function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export function parts(iso) {
  if (!iso || typeof iso !== "string") return { day: "--", month: "", year: "" };
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return { day: "--", month: "", year: "" };
  return {
    day: d.getDate(),
    month: d.toLocaleString("en-US", { month: "short" }),
    year: d.getFullYear()
  };
}

export function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "TBA";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function fmtShortDate(iso) {
  if (!iso || typeof iso !== "string") return "TBA";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "TBA";
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${mon} ${d.getFullYear()}`;
}

export function fmtTime(t) {
  if (!t || typeof t !== "string" || !t.includes(":")) return "";
  const [hh, mm] = t.split(":");
  const h = parseInt(hh, 10);
  if (Number.isNaN(h)) return "";
  const mins = (mm || "00").slice(0, 2).padStart(2, "0");
  return `${h % 12 || 12}:${mins} ${h < 12 ? "AM" : "PM"}`;
}

export function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

export function initThemeToggle(buttonId = "theme") {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      root.dataset.theme = saved;
    }
  } catch {
    // ignore storage errors
  }

  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const isDark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = isDark ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, root.dataset.theme);
    } catch {
      // ignore storage errors
    }
  });
}

const toastTimers = new WeakMap();

export function showToast(el, text, duration = 2600) {
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  const prev = toastTimers.get(el);
  if (prev) clearTimeout(prev);
  toastTimers.set(
    el,
    setTimeout(() => {
      el.classList.remove("show");
    }, duration)
  );
}

/**
 * Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) and quotes for CSV.
 */
export function sanitizeCsvCell(value) {
  let str = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Validates a Firestore-safe club ID slug: lowercase letters, digits, hyphens, underscores.
 */
export function isValidClubId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{1,48}$/.test(id);
}

/**
 * Safely extracts numeric member count from a club document regardless of schema shape.
 */
export function getClubMemberCount(club) {
  if (!club) return 0;
  if (typeof club.membersCount === "number" && club.membersCount >= 0) {
    return club.membersCount;
  }
  if (Array.isArray(club.members)) {
    return club.members.length;
  }
  if (typeof club.members === "number" && club.members >= 0) {
    return club.members;
  }
  return 0;
}

/**
 * Checks whether a user appears in legacy array-based club membership fields.
 */
export function isUserInLegacyMembers(club, user) {
  if (!club || !user) return false;
  const email = (user.email || "").toLowerCase();
  const candidates = [club.members, club.memberIds, club.joined];
  for (const list of candidates) {
    if (Array.isArray(list)) {
      if (
        list.includes(user.uid) ||
        (email && list.some((m) => typeof m === "string" && m.toLowerCase() === email))
      ) {
        return true;
      }
    }
  }
  return false;
}
