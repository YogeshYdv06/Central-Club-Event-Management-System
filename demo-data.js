// Sample records for the built-in preview mode (?demo=1).
//
// The real pages only ever read Firestore. When `?demo=1` is present the page
// renders these records instead and disables every write action, so the layout
// can be reviewed (or screenshotted) without signing in.
//
//   clubs.html?demo=1                 → student view
//   clubs.html?demo=1&role=admin      → admin view
//   events.html?demo=1                → student view
//   events.html?demo=1&role=admin     → admin view

function iso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

export const DEMO_CLUBS = [
  {
    id: "techcore",
    name: "TechCore",
    cat: "Technical",
    theme: "blue",
    icon: "code",
    desc: "A club for tech enthusiasts to learn, build and innovate together. We organize workshops, hackathons and coding sessions.",
    membersCount: 124,
    leader: { name: "Aarav Sharma", email: "aarav.sharma@mitsgwl.ac.in" },
    contactPhone: "9876543210"
  },
  {
    id: "art-culture",
    name: "Art & Culture Club",
    cat: "Cultural",
    theme: "purple",
    icon: "palette",
    desc: "Express. Create. Celebrate. Join us for art, music, dance and cultural events throughout the year.",
    membersCount: 98,
    leader: { name: "Ishita Verma", email: "ishita.verma@mitsgwl.ac.in" }
  },
  {
    id: "sports-club",
    name: "Sports Club",
    cat: "Sports",
    theme: "green",
    icon: "trophy",
    desc: "Play. Compete. Grow. We organise tournaments, fitness sessions and sports events for all.",
    membersCount: 152,
    leader: { name: "Rohan Patel", email: "rohan.patel@mitsgwl.ac.in" }
  },
  {
    id: "literary-club",
    name: "Literary Club",
    cat: "Literary",
    theme: "orange",
    icon: "book-open",
    desc: "For the dreamers, writers and thinkers. Join us for debates, book discussions, poetry slams and more.",
    membersCount: 76,
    leader: { name: "Sneha Rao", email: "sneha.rao@mitsgwl.ac.in" }
  },
  {
    id: "social-impact",
    name: "Social Impact Club",
    cat: "Social",
    theme: "pink",
    icon: "users",
    desc: "Small steps. Big change. Work on social initiatives, volunteer and make a difference.",
    membersCount: 65,
    leader: { name: "Karan Mehta", email: "karan.mehta@mitsgwl.ac.in" }
  },
  {
    id: "environment-club",
    name: "Environment Club",
    cat: "Social",
    theme: "teal",
    icon: "leaf",
    desc: "For a greener tomorrow. Join us in creating awareness and taking action for a sustainable planet.",
    membersCount: 54,
    leader: { name: "Tanya Singh", email: "tanya.singh@mitsgwl.ac.in" }
  }
];

export const DEMO_JOINED_CLUB_IDS = ["techcore", "sports-club", "art-culture"];

export const DEMO_EVENTS = [
  {
    id: "hackathon-2025",
    title: "Hackathon 2025",
    club: "TechCore",
    cat: "Technical",
    date: iso(3),
    time: "09:00",
    location: "Seminar Hall, MITS",
    capacity: 120,
    description: "A 24-hour coding challenge to solve real-world problems and showcase your skills.",
    createdByName: "TechCore"
  },
  {
    id: "open-mic-night",
    title: "Open Mic Night",
    club: "Art & Culture Club",
    cat: "Cultural",
    date: iso(7),
    time: "17:00",
    location: "Auditorium, MITS",
    capacity: 90,
    description: "Show your talent, share your thoughts and be heard. Poetry, music, comedy — all welcome!",
    createdByName: "Art & Culture Club"
  },
  {
    id: "football-tournament",
    title: "Inter-Branch Football Tournament",
    club: "Sports Club",
    cat: "Sports",
    date: iso(11),
    time: "08:00",
    location: "Sports Ground, MITS",
    capacity: 160,
    description: "Join the biggest football showdown of the year. Show your team spirit!",
    createdByName: "Sports Club"
  },
  {
    id: "wordsmith",
    title: "WordSmith — Creative Writing Contest",
    club: "Literary Club",
    cat: "Literary",
    date: iso(15),
    time: "11:00",
    location: "Library, MITS",
    capacity: 60,
    description: "Let your words create magic. Open for all literature lovers!",
    createdByName: "Literary Club"
  },
  {
    id: "blood-donation",
    title: "Blood Donation Camp",
    club: "Social Impact Club",
    cat: "Social",
    date: iso(19),
    time: "10:00",
    location: "Medical Block, MITS",
    capacity: 100,
    description: "Donate blood, save lives. Be a hero and help someone in need.",
    createdByName: "Social Impact Club"
  },
  {
    id: "fusion-night",
    title: "Fusion Night",
    club: "Art & Culture Club",
    cat: "Cultural",
    date: iso(24),
    time: "18:00",
    location: "Open Air Theatre, MITS",
    capacity: 0,
    description: "A night full of rhythm, energy and incredible performances by our talented students.",
    createdByName: "Art & Culture Club"
  }
];

/** RSVPs keyed by event id — demo counts only (never written back). */
export const DEMO_RSVP_COUNTS = {
  "hackathon-2025": 98,
  "open-mic-night": 62,
  "football-tournament": 134,
  wordsmith: 42,
  "blood-donation": 76,
  "fusion-night": 120
};

export const DEMO_MY_RSVP_IDS = ["hackathon-2025"];

/** Pending join requests, keyed by club id (admin view only). */
export const DEMO_PENDING_REQUESTS = {
  techcore: 2,
  "literary-club": 1
};
