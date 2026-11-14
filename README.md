# CampusConnect — Central Club & Event Management System

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

## Preview mode (no sign-in needed)

Google sign-in opens a pop-up, which browsers block inside embedded previews.
The login page therefore offers **Student preview** / **Admin preview** buttons
that open the portal with sample data; no account, no pop-up.

- The chosen role is stored in `localStorage` (`campushub_demo_role`) so moving
  between Clubs and Events stays inside the preview.
- Every write action is disabled in preview ("Preview mode — sign in to change
  data") and links to pages that need a real session (dashboard, club/event
  details, student directory) show a hint instead of bouncing to the login page.
- The small bar in the corner switches roles and exits the preview.
- A real signed-in Firebase user always wins: the pages clear the preview
  session as soon as they see an authenticated user.

To remove the bypass later, delete the "preview without signing in" block in
`index.html` / `login.js` and the `demoRole()` guards become inert.

You can also append `?demo=1` (and `&role=admin`) to a page directly.

```
clubs.html?demo=1                 student club view
clubs.html?demo=1&role=admin      admin club view
events.html?demo=1                student events view
events.html?demo=1&role=admin     admin events view
```

`preview-server.py` maps friendly routes to those URLs:

```bash
python3 preview-server.py 8000
# /              -> clubs student view
# /clubs-admin   -> clubs admin view
# /events        -> events student view
# /events-admin  -> events admin view
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
