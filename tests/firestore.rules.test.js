// Security-rules tests for the Cloud-Function-free, transaction-based RSVP flow.
//
// Run with:  npm run test:rules
// (spins up the Firestore emulator, so Java must be installed)
//
// The helpers below mirror rsvp-client.js exactly: one transaction that writes
// the caller's RSVP document and the event's `rsvpCount` counter together.
const { readFileSync } = require('node:fs');
const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  writeBatch,
  serverTimestamp
} = require('firebase/firestore');

const projectId = 'mitsconnect-rules-test';
const EVENT_ID = 'event-1';
const STUDENT = { uid: 'student-1', email: 'student@mitsgwl.ac.in' };
const OTHER_STUDENT = { uid: 'student-2', email: 'student2@mitsgwl.ac.in' };
const ADMIN = { uid: 'organizer', email: 'mentor@mitsgwl.ac.in' };

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('events/event-1').set({
      title: 'Test event',
      date: '2099-01-01',
      location: 'Campus',
      capacity: 2,
      rsvpCount: 0,
      createdBy: ADMIN.uid
    });
    await db.doc(`organizers/${ADMIN.email}`).set({ addedBy: ADMIN.uid });
  });
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function asUser(user) {
  return env
    .authenticatedContext(user.uid, { email: user.email, email_verified: true })
    .firestore();
}

function asOutsider() {
  return env.authenticatedContext('outsider', { email: 'outsider@example.com', email_verified: true }).firestore();
}

function rsvpPayload(user) {
  return {
    uid: user.uid,
    name: 'Test Student',
    email: user.email,
    photo: '',
    createdAt: serverTimestamp()
  };
}

/** Mirrors rsvp-client.js: RSVP document + rsvpCount move in one transaction. */
function toggleRsvp(db, eventId, user) {
  const eventRef = doc(db, 'events', eventId);
  const rsvpRef = doc(db, 'events', eventId, 'rsvps', user.uid);

  return runTransaction(db, async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw new Error('missing-event');
    const event = eventSnap.data();

    const rsvpSnap = await tx.get(rsvpRef);
    const hasCounter = typeof event.rsvpCount === 'number';
    const count = hasCounter
      ? Math.max(0, event.rsvpCount)
      : (await tx.get(collection(db, 'events', eventId, 'rsvps'))).size;

    if (rsvpSnap.exists()) {
      const next = Math.max(0, count - 1);
      tx.delete(rsvpRef);
      if (hasCounter) tx.update(eventRef, { rsvpCount: next });
      return { going: false, count: next };
    }

    const capacity = Number(event.capacity) || 0;
    if (capacity > 0 && count >= capacity) throw new Error('full');

    tx.set(rsvpRef, rsvpPayload(user));
    tx.update(eventRef, { rsvpCount: count + 1 });
    return { going: true, count: count + 1 };
  });
}

/** Batched (non-transactional) variant used to attempt rule bypasses. */
function pairedJoin(db, eventId, user, newCount, overrides = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'events', eventId, 'rsvps', user.uid), {
    ...rsvpPayload(user),
    ...overrides.rsvp
  });
  batch.update(doc(db, 'events', eventId), { rsvpCount: newCount, ...overrides.event });
  return batch.commit();
}

/* ------------------------------------------------------------------ */
/* happy path                                                          */
/* ------------------------------------------------------------------ */

test('college student joins with one transaction that pairs the RSVP and the counter', async () => {
  const db = asUser(STUDENT);

  const result = await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));
  assert.deepEqual(result, { going: true, count: 1 });

  const rsvp = await assertSucceeds(getDoc(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid)));
  assert.ok(rsvp.exists());
  assert.equal(rsvp.data().uid, STUDENT.uid);

  const event = await assertSucceeds(getDoc(doc(db, 'events', EVENT_ID)));
  assert.equal(event.data().rsvpCount, 1);
});

test('a second student fills the last seat (capacity 2)', async () => {
  const first = asUser(STUDENT);
  const second = asUser(OTHER_STUDENT);

  await assertSucceeds(toggleRsvp(first, EVENT_ID, STUDENT));
  await assertSucceeds(toggleRsvp(second, EVENT_ID, OTHER_STUDENT));

  const event = await assertSucceeds(getDoc(doc(first, 'events', EVENT_ID)));
  assert.equal(event.data().rsvpCount, 2);
});

test('cancelling releases the seat and decrements the counter', async () => {
  const db = asUser(STUDENT);

  await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));
  const result = await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));

  assert.deepEqual(result, { going: false, count: 0 });
  const rsvp = await assertSucceeds(getDoc(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid)));
  assert.equal(rsvp.exists(), false);
  const event = await assertSucceeds(getDoc(doc(db, 'events', EVENT_ID)));
  assert.equal(event.data().rsvpCount, 0);
});

/* ------------------------------------------------------------------ */
/* capacity is enforced by the rules, not the UI                        */
/* ------------------------------------------------------------------ */

test('rules reject a third RSVP once capacity is reached', async () => {
  const db = asUser(STUDENT);
  await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));
  await assertSucceeds(toggleRsvp(asUser(OTHER_STUDENT), EVENT_ID, OTHER_STUDENT));

  const late = asUser({ uid: 'student-3', email: 'student3@mitsgwl.ac.in' });
  // Client-side guard: the transaction refuses to write at all.
  await assert.rejects(toggleRsvp(late, EVENT_ID, { uid: 'student-3', email: 'student3@mitsgwl.ac.in' }), /full/);

  // Rules-side guard: even a hand-rolled paired write cannot exceed capacity.
  await assertFails(pairedJoin(late, EVENT_ID, { uid: 'student-3', email: 'student3@mitsgwl.ac.in' }, 3));
});

/* ------------------------------------------------------------------ */
/* the counter cannot be forged                                        */
/* ------------------------------------------------------------------ */

test('student cannot bump the counter without creating their RSVP', async () => {
  const db = asUser(STUDENT);
  await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { rsvpCount: 1 }));
});

test('student cannot create an RSVP without bumping the counter', async () => {
  const db = asUser(STUDENT);
  await assertFails(setDoc(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid), rsvpPayload(STUDENT)));
});

test('student cannot inflate the counter by more than one', async () => {
  const db = asUser(STUDENT);
  await assertFails(pairedJoin(db, EVENT_ID, STUDENT, 2));
});

test('student cannot touch any other event field', async () => {
  const db = asUser(STUDENT);

  const batch = writeBatch(db);
  batch.set(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid), rsvpPayload(STUDENT));
  batch.update(doc(db, 'events', EVENT_ID), { rsvpCount: 1, title: 'Hijacked' });
  await assertFails(batch.commit());

  await assertFails(updateDoc(doc(db, 'events', EVENT_ID), { title: 'Hijacked' }));
  await assertFails(deleteDoc(doc(db, 'events', EVENT_ID)));
});

test('student cannot RSVP on behalf of somebody else', async () => {
  const db = asUser(STUDENT);
  const batch = writeBatch(db);
  batch.set(doc(db, 'events', EVENT_ID, 'rsvps', OTHER_STUDENT.uid), rsvpPayload(OTHER_STUDENT));
  batch.update(doc(db, 'events', EVENT_ID), { rsvpCount: 1 });
  await assertFails(batch.commit());
});

test('student cannot spoof the email on their RSVP', async () => {
  const db = asUser(STUDENT);
  await assertFails(
    pairedJoin(db, EVENT_ID, STUDENT, 1, { rsvp: { email: 'someone.else@mitsgwl.ac.in' } })
  );
});

test('student cannot attach extra fields to an RSVP document', async () => {
  const db = asUser(STUDENT);
  await assertFails(
    pairedJoin(db, EVENT_ID, STUDENT, 1, { rsvp: { isAdmin: true } })
  );
});

test('student cannot delete their RSVP without releasing the seat', async () => {
  const db = asUser(STUDENT);
  await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));
  await assertFails(deleteDoc(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid)));
});

test('counter can never drop below zero', async () => {
  const db = asUser(STUDENT);
  await assertSucceeds(toggleRsvp(db, EVENT_ID, STUDENT));

  const batch = writeBatch(db);
  batch.delete(doc(db, 'events', EVENT_ID, 'rsvps', STUDENT.uid));
  batch.update(doc(db, 'events', EVENT_ID), { rsvpCount: -1 });
  await assertFails(batch.commit());
});

/* ------------------------------------------------------------------ */
/* legacy events without a counter                                     */
/* ------------------------------------------------------------------ */

test('legacy event without a counter is seeded by the first RSVP', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc('events/legacy-1').set({
      title: 'Old event',
      date: '2099-01-01',
      location: 'Campus',
      capacity: 3,
      createdBy: ADMIN.uid
    });
    await db.doc('events/legacy-1/rsvps/other').set({
      uid: 'other',
      name: 'Other',
      email: 'other@mitsgwl.ac.in',
      photo: ''
    });
  });

  const db = asUser(STUDENT);
  const result = await assertSucceeds(toggleRsvp(db, 'legacy-1', STUDENT));
  assert.deepEqual(result, { going: true, count: 2 });

  const event = await assertSucceeds(getDoc(doc(db, 'events/legacy-1')));
  assert.equal(event.data().rsvpCount, 2);
});

/* ------------------------------------------------------------------ */
/* admin & read access                                                 */
/* ------------------------------------------------------------------ */

test('non-college account cannot read campus events', async () => {
  await assertFails(getDoc(doc(asOutsider(), 'events', EVENT_ID)));
});

test('organizer can post an event with a zeroed counter, but not a pre-filled one', async () => {
  const db = asUser(ADMIN);
  const base = {
    title: 'New event',
    date: '2099-02-02',
    location: 'Auditorium',
    capacity: 50,
    createdBy: ADMIN.uid
  };

  await assertSucceeds(setDoc(doc(db, 'events/new-ok'), { ...base, rsvpCount: 0 }));
  await assertFails(setDoc(doc(db, 'events/new-bad'), { ...base, rsvpCount: 10 }));
});

test('organizer can edit their event and moderate attendee documents', async () => {
  const admin = asUser(ADMIN);
  await assertSucceeds(toggleRsvp(asUser(STUDENT), EVENT_ID, STUDENT));

  await assertSucceeds(updateDoc(doc(admin, 'events', EVENT_ID), { capacity: 40, title: 'Updated' }));
  await assertSucceeds(deleteDoc(doc(admin, 'events', EVENT_ID, 'rsvps', STUDENT.uid)));
});

test('outsider cannot read RSVP documents', async () => {
  const outsider = asOutsider();
  await assertFails(getDoc(doc(outsider, 'events', EVENT_ID, 'rsvps', STUDENT.uid)));
});
