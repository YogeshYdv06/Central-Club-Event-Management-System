const { readFileSync } = require('node:fs');
const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const projectId = 'mitsconnect-rules-test';
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
    await context.firestore().doc('events/event-1').set({
      title: 'Test event', date: '2099-01-01', location: 'Campus', capacity: 1,
      createdBy: 'organizer'
    });
  });
});

test('college student can read event but cannot bypass capacity service with direct RSVP writes', async () => {
  const db = env.authenticatedContext('student-1', {
    email: 'student@mitsgwl.ac.in', email_verified: true
  }).firestore();
  await assertSucceeds(getDoc(doc(db, 'events/event-1')));
  await assertFails(setDoc(doc(db, 'events/event-1/rsvps/student-1'), {
    name: 'Student', email: 'student@mitsgwl.ac.in'
  }));
});

test('non-college account cannot read campus events', async () => {
  const db = env.authenticatedContext('outsider', {
    email: 'outsider@example.com', email_verified: true
  }).firestore();
  await assertFails(getDoc(doc(db, 'events/event-1')));
});
