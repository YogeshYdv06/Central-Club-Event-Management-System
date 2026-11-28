
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const ALLOWED_DOMAIN = "mitsgwl.ac.in";
export const DEFAULT_ADMIN_EMAIL = "26ir1yo77@mitsgwl.ac.in";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


export async function checkIsAdmin(user) {
  if (!user || !user.email) return false;
  const email = user.email.toLowerCase().trim();
  if (email === DEFAULT_ADMIN_EMAIL.toLowerCase()) return true;
  try {
    const snap = await getDoc(doc(db, "organizers", email));
    return snap.exists();
  } catch (error) {
    console.warn("Organizer check failed:", error);
    return false;
  }
}
