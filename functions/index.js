const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const DEFAULT_ADMIN_EMAIL = '26ir1yo77@mitsgwl.ac.in';
const COLLEGE_DOMAIN = '@mitsgwl.ac.in';

/**
 * Toggle the caller's RSVP atomically. Capacity is checked against the actual
 * RSVP collection inside the transaction, not a stale client-side count.
 */
exports.toggleEventRsvp = onCall({ region: 'asia-south1' }, async (request) => {
  const uid = request.auth?.uid;
  const email = String(request.auth?.token?.email || '').trim().toLowerCase();
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Sign in to register.');

  const eventId = request.data?.eventId;
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(eventId)) {
    throw new HttpsError('invalid-argument', 'A valid event ID is required.');
  }

  const organizer = email === DEFAULT_ADMIN_EMAIL ||
    (await db.doc(`organizers/${email}`).get()).exists;
  if (!organizer && !email.endsWith(COLLEGE_DOMAIN)) {
    throw new HttpsError('permission-denied', 'Use your college account to RSVP.');
  }

  const eventRef = db.doc(`events/${eventId}`);
  const rsvpRef = eventRef.collection('rsvps').doc(uid);
  return db.runTransaction(async (tx) => {
    const [eventSnap, rsvpSnap, attendeeSnap] = await Promise.all([
      tx.get(eventRef), tx.get(rsvpRef), tx.get(eventRef.collection('rsvps'))
    ]);
    if (!eventSnap.exists) throw new HttpsError('not-found', 'This event no longer exists.');
    const event = eventSnap.data();
    if ((event.date || '') < new Date().toISOString().slice(0, 10)) {
      throw new HttpsError('failed-precondition', 'This event has ended.');
    }

    if (rsvpSnap.exists) {
      tx.delete(rsvpRef);
      return { going: false, count: Math.max(0, attendeeSnap.size - 1) };
    }

    const capacity = Number(event.capacity) || 0;
    if (capacity > 0 && attendeeSnap.size >= capacity) {
      throw new HttpsError('resource-exhausted', 'This event is full.');
    }
    tx.create(rsvpRef, {
      name: String(request.auth.token.name || email),
      email,
      photo: String(request.auth.token.picture || ''),
      createdAt: FieldValue.serverTimestamp()
    });
    return { going: true, count: attendeeSnap.size + 1 };
  });
});
