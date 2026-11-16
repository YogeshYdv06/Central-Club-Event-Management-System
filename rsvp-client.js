import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js";
import { app } from "./firebase-init.js";

const toggleCallable = httpsCallable(getFunctions(app, "asia-south1"), "toggleEventRsvp");

/** Server-validated and transactionally capacity-limited RSVP toggle. */
export async function toggleEventRsvp(eventId) {
  const result = await toggleCallable({ eventId });
  return result.data;
}
