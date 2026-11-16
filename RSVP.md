# Cloud-Function-free, transaction-based RSVPs

How MITSConnect toggles an RSVP **without any Cloud Function**, while still
enforcing capacity atomically under concurrency.

The whole feature is three files:

| File | Role |
| --- | --- |
| `rsvp-client.js` | One `runTransaction()` that writes the RSVP **and** the counter |
| `firestore.rules` | Server-side authority: proves the two writes are paired and enforces `capacity` |
| `events.js` / `dashboard.js` / `event-details.html` | UI, reading `rsvpCount` and showing shared error copy |

The old `functions/` folder, `firebase-functions` dependency and the
`functions` block in `firebase.json` are gone. Nothing to deploy except rules.

---

## 0. The idea in one paragraph

Firestore has no server-side code anymore, so the **capacity lock has to live in
the data**. We keep a denormalised integer `rsvpCount` on every event document.
Joining = one transaction that (a) creates `events/{eventId}/rsvps/{uid}` and
(b) sets `rsvpCount = rsvpCount + 1` — both in the same commit. Firestore's
optimistic concurrency guarantees that two students racing for the last seat
cannot both commit: the loser's transaction retries, re-reads the new counter
and fails with “full”. Security rules make the pairing non-forgeable: a student
may only ever change `rsvpCount`, by exactly ±1, and only in the same commit as
their own RSVP document appearing/disappearing.

```
join  ─────────────┐
                   ├── ONE commit ──> rsvps/{uid} created   +   rsvpCount +1  (≤ capacity)
cancel ────────────┘                  rsvps/{uid} deleted   +   rsvpCount -1  (≥ 0)
```

---

## 1. Data model

| Path | Written by | Notes |
| --- | --- | --- |
| `events/{eventId}` | admin (create/edit/delete) | `capacity: int` (0 = unlimited), **`rsvpCount: int` (starts at 0)** |
| `events/{eventId}` | the RSVP-ing student | *only* the `rsvpCount` field, via transaction |
| `events/{eventId}/rsvps/{uid}` | the student, own doc only | `{ uid, name, email, photo, createdAt }` |

Invariant: `events/{id}.rsvpCount == number of docs in events/{id}/rsvps`.

---

## 2. Step-by-step implementation

### Step 1 — give every event a counter

New events are created with the counter at zero (`events.js`):

```js
const created = await addDoc(collection(db, "events"), {
  ...data,
  rsvpCount: 0,          // transactional attendee counter
  createdBy: me.uid,
  createdByName: me.displayName || me.email,
  createdAt: serverTimestamp()
});
```

The create rule enforces it, so no client can create an event with a
pre-filled counter:

```rules
allow create: if isAdmin()
  && ...
  && request.resource.data.rsvpCount is int
  && request.resource.data.rsvpCount == 0
  && request.resource.data.createdBy == request.auth.uid;
```

Events written before this change simply have no `rsvpCount`; step 6 covers the
automatic migration.

### Step 2 — write the toggle as one transaction

`rsvp-client.js` (abridged, see the file for the full version):

```js
export async function toggleEventRsvp(eventId) {
  const user = auth.currentUser;
  if (!user) throw rsvpError(RSVP_ERRORS.AUTH, "Sign in to register.");

  const eventRef  = doc(db, "events", eventId);
  const rsvpRef   = doc(db, "events", eventId, "rsvps", user.uid);
  const rsvpsRef  = collection(db, "events", eventId, "rsvps");

  return runTransaction(db, async (tx) => {
    // ---- 1. ALL reads first (Firestore requirement) ----
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists()) throw rsvpError(RSVP_ERRORS.MISSING, "...");
    const event = eventSnap.data();
    if (event.date && event.date < todayStr()) throw rsvpError(RSVP_ERRORS.ENDED, "...");

    const rsvpSnap = await tx.get(rsvpRef);

    // legacy events (no counter yet): count the subcollection once
    const hasCounter = typeof event.rsvpCount === "number";
    const count = hasCounter
      ? Math.max(0, event.rsvpCount)
      : (await tx.get(rsvpsRef)).size;

    // ---- 2. cancel ----
    if (rsvpSnap.exists()) {
      const next = Math.max(0, count - 1);
      tx.delete(rsvpRef);
      if (hasCounter) tx.update(eventRef, { rsvpCount: next });
      return { going: false, count: next };
    }

    // ---- 3. join ----
    const capacity = Number(event.capacity) || 0;
    if (capacity > 0 && count >= capacity) throw rsvpError(RSVP_ERRORS.FULL, "full");

    tx.set(rsvpRef, {
      uid: user.uid, name: ..., email: ..., photo: ..., createdAt: serverTimestamp()
    });
    tx.update(eventRef, { rsvpCount: count + 1 });
    return { going: true, count: count + 1 };
  });
}
```

Why this shape matters:

* **Reads before writes.** Firestore transactions reject a read that happens
  after a write. `tx.get(eventRef)` → `tx.get(rsvpRef)` → (maybe the collection)
  → then `tx.set` / `tx.delete` / `tx.update`.
* **Absolute values, not `increment()` / `arrayUnion()`.** The new `rsvpCount` is
  computed from the value the transaction just read, so when Firestore retries a
  contended transaction the client recomputes against the fresh count. It also
  keeps the rules simple: `newCount == oldCount ± 1` is checkable.
* **Idempotent toggle.** The transaction decides join-vs-cancel from the
  *server* state (`rsvpSnap.exists()`), so double clicks and stale tabs cannot
  create two RSVPs or double-decrement.
* **Typed errors.** `RSVP_ERRORS` (`rsvp/full`, `rsvp/ended`, `rsvp/not-found`,
  `rsvp/unauthenticated`) + `rsvpErrorMessage()` give every page the same copy,
  replacing the old `functions/resource-exhausted` handling.

### Step 3 — make the rules prove the pair (the important step)

Without this, a student could POST `rsvpCount: 1000` and block the event.
`firestore.rules` therefore allows a student exactly one kind of event write:

```rules
match /events/{eventId} {

  function myRsvpPath() {
    return /databases/$(database)/documents/events/$(eventId)/rsvps/$(request.auth.uid);
  }
  function capacityOf(ev) { return ev.data.get('capacity', 0); }

  function pairedCounterWrite() {
    return (isCollegeUser() || isAdmin())
      // …only the counter, never title/capacity/date/…
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['rsvpCount'])
      && request.resource.data.rsvpCount is int
      && request.resource.data.rsvpCount >= 0
      && (
        // legacy seed (see step 6)
        (!resource.data.keys().hasAny(['rsvpCount'])
          && existsAfter(myRsvpPath())
          && (capacityOf(resource) == 0 || request.resource.data.rsvpCount <= capacityOf(resource)))
        // JOIN: exactly +1, my RSVP exists after this commit, seat still free
        || (request.resource.data.rsvpCount == resource.data.get('rsvpCount', -1) + 1
            && existsAfter(myRsvpPath())
            && (capacityOf(resource) == 0 || request.resource.data.rsvpCount <= capacityOf(resource)))
        // CANCEL: exactly -1, my RSVP is gone after this commit
        || (request.resource.data.rsvpCount == resource.data.get('rsvpCount', 1) - 1
            && !existsAfter(myRsvpPath()))
      );
  }

  allow update: if (isAdmin() && resource.data.createdBy == request.auth.uid)
    || pairedCounterWrite();
```

and the mirrored check on the RSVP document itself:

```rules
  match /rsvps/{uid} {
    function eventBefore() { return get(/databases/$(database)/documents/events/$(eventId)); }
    function eventAfter()  { return getAfter(/databases/$(database)/documents/events/$(eventId)); }

    function counterMovedWithJoin() {
      return !eventBefore().data.keys().hasAny(['rsvpCount'])
        || eventAfter().data.get('rsvpCount', -1) == eventBefore().data.get('rsvpCount', -1) + 1;
    }
    function counterMovedWithLeave() {
      return !eventBefore().data.keys().hasAny(['rsvpCount'])
        || eventAfter().data.get('rsvpCount', 1) == eventBefore().data.get('rsvpCount', 1) - 1;
    }
    function seatsLeft() {
      return eventBefore().data.get('capacity', 0) == 0
        || eventBefore().data.get('rsvpCount', 0) + 1 <= eventBefore().data.get('capacity', 0);
    }

    allow read: if isCollegeUser() || isAdmin();
    allow create: if (isCollegeUser() || isAdmin())
      && uid == request.auth.uid
      && request.resource.data.keys().hasOnly(['uid', 'name', 'email', 'photo', 'createdAt'])
      && request.resource.data.uid == request.auth.uid
      && request.resource.data.email == userEmail()
      && seatsLeft()
      && counterMovedWithJoin();
    allow update: if isAdmin();
    allow delete: if isAdmin()
      || (isCollegeUser() && uid == request.auth.uid && counterMovedWithLeave());
  }
```

Key points:

* **`get()` = state before the commit, `getAfter()` = state after it.** For a
  transaction/batch, `getAfter()` sees the *other* write in the same commit.
  That is what lets the rules assert “my RSVP and the counter moved together”.
* Rules with **`||` short-circuit**, and the legacy branch is placed first so a
  document without `rsvpCount` never triggers a missing-field error.
* `data.get('rsvpCount', -1)` avoids missing-key evaluation errors, which would
  otherwise deny the request outright.
* `hasOnly(['uid','name','email','photo','createdAt'])` stops extra fields
  (e.g. a forged `isAdmin: true`) riding along on an RSVP document.
* Admin write paths stay untouched: admins can edit their events and delete any
  attendee document (event cleanup / moderation). Admins are trusted to keep the
  counter consistent — `updateDoc(event, { rsvpCount: n })` still works for them.

### Step 4 — point the UI at the counter

Counts now come from the event document, so the UI never has to count documents:

```js
// events.js
function goingFor(id) {
  const ev = events.find((e) => e.id === id);
  if (ev && typeof ev.rsvpCount === "number") return Math.max(0, ev.rsvpCount);
  return (rsvps[id] || []).length;   // legacy events only
}
```

* `events.js` — cards, “Most going” sort, admin meter/`Total RSVPs` all use
  `goingFor()`; the create form now sends `rsvpCount: 0`.
* `dashboard.js` — `goingCountFor(event)` / `isGoingTo(event)` replace raw
  `rsvps[id].length` reads.
* `event-details.html` — **two doc listeners instead of one collection
  listener**: `onSnapshot(doc(events/{id}))` gives details + counter, and
  `onSnapshot(doc(events/{id}/rsvps/{me}))` gives *my* status. No attendee list
  is downloaded to render the button, and the count updates live for everyone.
* All three call sites now show `rsvpErrorMessage(err)` instead of matching
  `functions/*` error codes.

### Step 5 — delete the Cloud Function

```bash
git rm -r functions                      # index.js, package.json, package-lock.json
# firebase.json: drop the "functions" block and the functions emulator entry
firebase deploy --only firestore:rules   # the only deploy left
```

`firebase.json` is now just rules + the auth/firestore emulators, and
`package.json` no longer needs `firebase-functions`.

### Step 6 — migrating events that predate the counter

Old events have no `rsvpCount`. Instead of breaking them, the transaction
counts the subcollection once and the rules allow that **one seeding write**
(branch 1 in `pairedCounterWrite()`). After the first RSVP, the event behaves
exactly like a new one.

Automatic option: as an admin (a college account), RSVP and cancel once for each
old event — the seed uses the real document count inside the transaction.

Explicit option (Admin SDK / Cloud Shell, run once):

```js
// npm i firebase-admin
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({ credential: applicationDefault() });
const db = getFirestore();

for (const ev of (await db.collection("events").get()).docs) {
  const snap = await ev.ref.collection("rsvps").count().get();
  await ev.ref.update({ rsvpCount: snap.data().count });
  console.log(ev.id, snap.data().count);
}
```

### Step 7 — test it

```bash
npm install
npm run test:rules      # Firestore emulator + @firebase/rules-unit-testing (needs Java)
```

`tests/firestore.rules.test.js` runs the same transaction the browser runs and
asserts the security properties:

| Test | Property |
| --- | --- |
| join / second join / cancel | RSVP **and** counter move together, count is right |
| third RSVP at capacity | rejected by both the client guard and the rules |
| counter update without an RSVP | denied |
| RSVP without a counter update | denied |
| `+2`, `-2`, negative | denied |
| `rsvpCount` + `title` in one commit | denied |
| RSVP for another uid / spoofed email / extra fields | denied |
| delete RSVP without `-1` | denied |
| legacy event without counter | seeded to the real count on the first RSVP |
| organizer posts with `rsvpCount: 0` | allowed; `rsvpCount: 10` denied |

Manual concurrency check (the thing a unit test cannot do): open an event with
**capacity 1** in two normal windows as two different students, leave both
`RSVP` buttons un-clicked until both pages have loaded, then click both within a
second. One gets “RSVP confirmed”, the other gets “This event is full”, and
`rsvpCount` ends at `1` with exactly one document in `rsvps`.

### Step 8 — deploy order

1. `firebase deploy --only firestore:rules` (rules first: they accept the new
   pairing immediately, and old events still self-migrate).
2. Publish the web files (`rsvp-client.js`, `events.js`, `dashboard.js`,
   `event-details.html`).
3. Delete the deployed `toggleEventRsvp` function in the Firebase console
   (`firebase functions:delete toggleEventRsvp --region asia-south1`) once no old
   tab is still using it.

Rolling rules out *after* the JS would leave old tabs writing RSVP docs without
a counter, which the new rules block — hence rules first.

---

## 3. Why it is still atomic (one seat, two students)

```
student A                        student B
tx.get(event)  -> count 0        tx.get(event)  -> count 0
tx.get(rsvpA)  -> missing        tx.get(rsvpB)  -> missing
capacity 1, ok                   capacity 1, ok
tx.set(rsvps/A)                  tx.set(rsvps/B)
tx.update(event, {count: 1})     tx.update(event, {count: 1})
commit ✔                         commit ✘ (event doc changed since read)
                                 runTransaction retries
                                 tx.get(event) -> count 1 -> 1 >= capacity -> "full"
```

Firestore transactions are optimistic: a commit fails if any document read
during the transaction changed. Both students read the same event document, so
only one commit can win; the loser retries and is re-checked against the new
counter. That is exactly the guarantee the deleted Cloud Function gave us, and
the rules keep it honest even for clients that skip `rsvp-client.js`.

---

## 4. Trade-offs / limits

* **Date/ended checks are client-side.** Rules cannot format `request.time` into
  `YYYY-MM-DD`, so a hand-rolled write could RSVP to a past event. Capacity,
  identity and counter integrity are enforced; “ended” is cosmetic (the button
  is disabled). If you need it enforced, add an admin-maintained
  `rsvpsOpen: bool` field and check `eventBefore().data.rsvpCount` +
  `rsvpsOpen == true` in the rules.
* **One counter document = a hot document.** Firestore sustains ~1 write/second
  per document (with short bursts higher). Fine for a college event (a few
  hundred RSVPs); if a single event ever draws thousands of simultaneous
  sign-ups, shard the counter (`rsvpCounter/{shardId}`) and sum the shards.
* **Admins are trusted.** Admin deletes of attendee docs do not touch the
  counter, so an admin cleanup can leave drift. Repair with
  `updateDoc(event, { rsvpCount: <true count> })` or re-run the step-6 script.
* **Rules cost reads.** Each toggle costs 1 document read per `get`/`getAfter`
  inside rules (well under the 20-per-transaction limit), plus the client's own
  reads.
* **Legacy seeding is a one-time trust window.** For an event without
  `rsvpCount`, the first joining student may seed any value ≤ capacity. It only
  applies to pre-migration events and disappears after that first write.

---

## 5. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Missing or insufficient permissions` on join | rules not deployed, or event has no `rsvpCount` *and* the client did not send one (old `rsvp-client.js` cached — bump the asset version query string) |
| `This event is full` though spots look free | counter drifted above reality (admin deletions). Re-sync `rsvpCount` |
| Counter stuck after cancel | client deleted the RSVP without the `-1` (e.g. an admin tool). Rules now block that for students, not for admins |
| Second tab says “already registered” | expected: the transaction reads the server state, so the toggle is idempotent |
| `firebase deploy` complains about `functions` | the `functions` block was removed from `firebase.json`; delete the deployed function by name instead |
