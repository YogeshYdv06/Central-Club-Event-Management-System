// Shared profile lookup for admin views (event attendees, club members, directory).
//
// Loads users/{uid} once and exposes helpers so admin pages can show
// "name · 2nd year · CSE" instead of a bare email.

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { db } from "./firebase-init.js";

export const YEAR_LABELS = { 1: "1st year", 2: "2nd year", 3: "3rd year", 4: "4th year" };

export function yearLabel(year) {
  return YEAR_LABELS[Number(year)] || "";
}

/**
 * Returns { byUid: Map<uid, profile>, byEmail: Map<lowercased email, profile> }.
 * Never throws — a permission problem just yields empty maps so admin pages
 * still render names/emails from the RSVP / membership documents themselves.
 */
export async function loadStudentProfiles() {
  const byUid = new Map();
  const byEmail = new Map();

  try {
    const snap = await getDocs(collection(db, "users"));
    snap.forEach((d) => {
      const data = d.data() || {};
      const profile = {
        uid: d.id,
        name: data.studentName || data.name || "",
        email: (data.collegeEmail || data.email || "").toLowerCase(),
        rollNo: data.rollNo || "",
        year: Number(data.year) || 0,
        branch: data.branch || "",
        complete: data.studentProfileComplete === true
      };
      byUid.set(d.id, profile);
      if (profile.email) byEmail.set(profile.email, profile);
    });
  } catch (error) {
    console.warn("Student profiles unavailable:", error);
  }

  return { byUid, byEmail };
}

/** Finds a profile by uid first, then by email. */
export function findProfile(profiles, uid, email) {
  if (!profiles) return null;
  if (uid && profiles.byUid.has(uid)) return profiles.byUid.get(uid);
  const key = (email || "").toLowerCase();
  if (key && profiles.byEmail.has(key)) return profiles.byEmail.get(key);
  return null;
}

/** "2nd year · CSE" — empty string when nothing is known. */
export function profileLine(profile) {
  if (!profile) return "";
  return [yearLabel(profile.year), profile.branch].filter(Boolean).join(" · ");
}
