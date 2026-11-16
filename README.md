# MITSConnect — Central Club & Event Management System

A Firebase-backed student portal for MITS Gwalior: browse clubs, request
membership, discover events and RSVP. Admins manage everything from the same
two pages — there is no separate admin panel.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Sign-in (Student / Mentor tabs, Google auth) |
| `Dashboard.html` | Personal dashboard: quick stats, upcoming events, activity |
| `clubs.html` | Club directory — **student** card grid, or **admin** grid + management tools |
| `club-details.html` | Single club: info, WhatsApp invite/QR, join request |
| `events.html` | Event directory — **student** hero/grid/rail layout, or **admin** directory + management tools |
| `event-details.html` | Single event: full details and RSVP |
| `admin-students.html` | Student directory (admins): engaged students, CSV export |

## What each role sees

**Student**

- `clubs.html` — hero banner, category chips, club cards (icon, tag, member
  count), "My Clubs" rail, club statistics, join CTA.
- `events.html` — hero banner, category chips and search, event cards with
  cover art, date/time/venue, attendee count and a Register button, plus an
  "Upcoming Events" rail and "Event Categories" tiles.

**Admin / organizer**

- `clubs.html` — keeps the classic club grid and adds inline management:
  *Create club*, *Join requests* (approve/reject), per-card *Edit club*,
  *View members* (with CSV export) and *Delete club*, plus the student
  directory link.
- `events.html` — keeps the classic event directory and adds inline
  management: *Post event*, *Edit* / *Delete* on your own events,
  *View attendees* and *Download CSV*, together with event statistics.

Attendance and membership lists resolve full student details (roll number,
year, branch) from `users/{uid}` through `student-lookup.js`.

## Live data only — no sample content

The portal ships **no demo clubs or events**. Both sections read straight from
Firestore and render whatever is stored there:

| Page | Read | Cards come from |
| --- | --- | --- |
| `clubs.html` | `collection(db, "clubs")` | one card per club document |
| `events.html` (student) | `query(collection(db, "events"), orderBy("date"))` | one card per event document |
| `events.html` (admin) | same query, live `onSnapshot` | one row per event document |

So the first time you sign in as an admin there is nothing to show but the
empty state ("No campus clubs yet. Use *Create club* above to add the first
one."). Create a club in **Clubs → Create club**, or post an event in
**Events → + Post event**, and the new document appears immediately as a card
in the same layout — the page even clears any active filters and spotlights the
card it just created. Students see the same card on their side as soon as the
document exists.

Fields the cards use (all optional except the ones the form requires):

- **Club**: `id`, `name`, `cat`, `desc`, `theme` (card colour), `icon` (Lucide
  name), `membersCount` / `members`, `leader`, `contactPhone`, `whatsappUrl`.
- **Event**: `title`, `club`, `cat`, `date`, `time`, `location`, `capacity`,
  `description`, `createdBy`, `createdByName`; attendees come from
  `events/{id}/rsvps`.

Every page still requires a real Google sign-in — there is no bypass.

`preview-server.py` only maps friendly URLs to the real pages:

```bash
python3 preview-server.py 8000
# /              -> index.html (sign in)
# /clubs         -> clubs.html
# /clubs-admin   -> clubs.html (admin tools appear for admin accounts)
# /events        -> events.html
# /events-admin  -> events.html
```

## Setup

1. Create a Firebase project, enable **Google** sign-in under Authentication
   and add your deployment/preview hostname to *Authorized domains*.
2. Put the web app config in `firebase-config.js`.
3. Deploy the rules in `firestore.rules` (Firestore → Rules).
4. Add organizer emails to the `organizers` collection to grant admin access
   (the address in `firebase-init.js` is always an admin).

## Layout of the stylesheets

| File | Contents |
| --- | --- |
| `shell.css` | Shared student chrome: sidebar, top bar, hero, chips, right-rail panels, buttons, toast |
| `clubs.css` | Club cards, My Clubs list, admin toolbar/modals |
| `student-events.css` | Event cards, covers, upcoming rail, category tiles |
| `events.css` + `admin.css` | Classic event directory used by the admin view and the admin-only pages |
| `style.css` | Dashboard, club details |
