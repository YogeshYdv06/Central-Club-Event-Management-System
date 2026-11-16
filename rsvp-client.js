// Cloud-Function-free RSVP engine.
//
// Every RSVP toggle is ONE Firestore transaction that, in a single commit:
//
//   1. creates  events/{eventId}/rsvps/{uid}   (join)  or deletes it (cancel)
//   2. moves    events/{eventId}.rsvpCount     by exactly +1 / -1
//
// Because both writes land in the same commit, Firestore's optimistic
// concurrency turns `rsvpCount` into the capacity lock: two students racing for
// the last seat both read the same count, only one commit survives, the loser's
// transaction retries, re-reads the new count and is rejected as "full".
//
// firestore.rules is the server-side authority for this pair:
//   • a student may only change `rsvpCount` and never any other event field,
//   • the change must be exactly ±1 and paired (via getAfter/existsAfter) with
//     the caller's own RSVP document appearing / disappearing,
//   • the resulting count may never exceed `capacity` (0 = unlimited).
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { todayStr } from "./utils.js";

/** Stable error codes so every page can show the same message. */
export const RSVP_ERRORS = {
  FULL: "rsvp/full",
  ENDED: "rsvp/ended",
  MISSING: "rsvp/not-found",
  AUTH: "rsvp/unauthenticated",
  CONFLICT: "rsvp/conflict"
};

function rsvpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Maps a thrown error (ours or Firebase's) to user-facing copy. */
export function rsvpErrorMessage(error) {
  const code = error?.code || "";
  if (code === RSVP_ERRORS.FULL) return "This event is full.";
  if (code === RSVP_ERRORS.ENDED) return "This event has already ended.";
  if (code === RSVP_ERRORS.MISSING) return "This event no longer exists.";
  if (code === RSVP_ERRORS.AUTH) return "Sign in to register.";
  if (code === RSVP_ERRORS.CONFLICT) return "Your RSVP changed in another tab. Please try again.";
  if (code === "permission-denied") return "Only college accounts (@mitsgwl.ac.in) can RSVP to campus events.";
  if (code === "unavailable") return "You’re offline. Reconnect and try again.";
  return "Could not update your RSVP. Please try again.";
}

/**
 * Toggle the signed-in user's RSVP for an event.
 * @param {string} eventId
 * @returns {Promise<{ going: boolean, count: number }>}
 */
export async function toggleEventRsvp(eventId) {
  const user = auth.currentUser;
  if (!user) throw rsvpError(RSVP_ERRORS.AUTH, "Sign in to register.");
  if (typeof eventId !== "string" || !eventId) {
    throw rsvpError(RSVP_ERRORS.MISSING, "A valid event ID is required.");
  }

  const email = String(user.email || "").trim().toLowerCase();
  const eventRef = doc(db, "events", eventId);
  const rsvpRef = doc(db, "events", eventId, "rsvps", user.uid);
  const rsvpsRef = collection(db, "events", eventId, "rsvps");

  return runTransaction(db, async (tx) => {
    /* ---- all reads first (Firestore requirement), then all writes ---- */
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) {
      throw rsvpError(RSVP_ERRORS.MISSING, "This event no longer exists.");
    }
    const event = eventSnap.data() || {};
    const date = typeof event.date === "string" ? event.date : "";
    if (date && date < todayStr()) {
      throw rsvpError(RSVP_ERRORS.ENDED, "This event has already ended.");
    }

    const rsvpSnap = await tx.get(rsvpRef);

    // Events created before this feature have no counter. Derive the count from
    // the RSVP subcollection once; the first join seeds `rsvpCount` for good.
    const hasCounter = typeof event.rsvpCount === "number";
    const currentCount = hasCounter
      ? Math.max(0, event.rsvpCount)
      : (await tx.get(rsvpsRef)).size;

    /* ---- cancel: delete my RSVP, release the seat ---- */
    if (rsvpSnap.exists()) {
      const nextCount = Math.max(0, currentCount - 1);
      tx.delete(rsvpRef);
      // Legacy events simply have no counter to keep in sync yet.
      if (hasCounter) tx.update(eventRef, { rsvpCount: nextCount });
      return { going: false, count: nextCount };
    }

    /* ---- join: claim a seat, then write both documents ---- */
    const capacity = Number(event.capacity) || 0;
    if (capacity > 0 && currentCount >= capacity) {
      throw rsvpError(RSVP_ERRORS.FULL, "This event is full.");
    }

    tx.set(rsvpRef, {
      uid: user.uid,
      name: String(user.displayName || email || "Student"),
      email,
      photo: String(user.photoURL || ""),
      createdAt: serverTimestamp()
    });
    const nextCount = currentCount + 1;
    tx.update(eventRef, { rsvpCount: nextCount });
    return { going: true, count: nextCount };
  });
}
