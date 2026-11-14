// Preview (demo) session — the "no sign-in" bypass.
//
// Google pop-ups are blocked inside embedded preview iframes, so the portal can
// be opened with sample data instead. The chosen role is stored in localStorage
// so links inside the preview (Clubs <-> Events, reload, back/forward) keep
// working without repeating ?demo=1.
//
// A real signed-in Firebase user always wins: the pages clear this session as
// soon as they see an authenticated user. To remove the bypass later, delete the
// preview block in index.html / login.js and the demoRole() checks will simply
// never match.

const KEY = "campushub_demo_role";

export function demoRole() {
  try {
    const value = localStorage.getItem(KEY);
    return value === "admin" || value === "student" ? value : "";
  } catch {
    return "";
  }
}

export function setDemoRole(role) {
  try {
    localStorage.setItem(KEY, role === "admin" ? "admin" : "student");
  } catch {
    /* storage unavailable — preview still works for this page load */
  }
}

export function clearDemoRole() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Reads ?demo=1[&role=admin] from the URL and remembers the role.
 * Returns "" when the current URL is not a preview URL.
 */
export function demoRoleFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (params.get("demo") !== "1") return "";
  const role = params.get("role") === "admin" ? "admin" : "student";
  setDemoRole(role);
  return role;
}
