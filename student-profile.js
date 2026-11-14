// CampusConnect – one-time compulsory student profile gate.
//
// Usage (from any page that requires a completed profile):
//
//   import { ensureStudentProfile } from "./student-profile.js";
//   await ensureStudentProfile(user, { isAdmin });
//
// Behaviour
//  • Reads users/{uid}.studentProfileComplete.
//  • If true  → resolves immediately (the form never appears again).
//  • If false → shows a blocking modal, saves to Firestore, then resolves.
//  • Admins are skipped (pass isAdmin: true).
//  • If Firestore is unreachable/permission-denied on *read*, the gate fails
//    open so the app never locks a student out because of a rules mistake.
//    A write failure keeps the modal open with an inline retry message.

// Firebase is imported lazily so this module (and its demo mode) works even when
// the Firestore SDK cannot be reached — e.g. inside a restricted preview iframe.
const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

async function firestore() {
  const [sdk, init] = await Promise.all([
    import(FIRESTORE_URL),
    import("./firebase-init.js")
  ]);
  return { ...sdk, db: init.db };
}

export const ALLOWED_DOMAIN = "mitsgwl.ac.in";

export const BRANCHES = [
  { value: "CSE", label: "CSE – Computer Science" },
  { value: "IT", label: "IT – Information Technology" },
  { value: "AIML", label: "AIML – AI & ML" },
  { value: "DS", label: "DS – Data Science" },
  { value: "ECE", label: "ECE – Electronics & Comm." },
  { value: "EE", label: "EE – Electrical" },
  { value: "ME", label: "ME – Mechanical" },
  { value: "CE", label: "CE – Civil" }
];

export const BRANCH_LABEL = BRANCHES.reduce((map, b) => {
  map[b.value] = b.value;
  return map;
}, {});

export const YEARS = [
  { value: "1", label: "1st year" },
  { value: "2", label: "2nd year" },
  { value: "3", label: "3rd year" },
  { value: "4", label: "4th year" }
];

export const YEAR_LABEL = { 1: "1st year", 2: "2nd year", 3: "3rd year", 4: "4th year" };

const EMAIL_RE = /^[a-z0-9._%+-]+@mitsgwl\.ac\.in$/i;
const PHONE_RE = /^[6-9]\d{9}$/;

/**
 * Demo bypass for previews/screenshots that have no Firebase sign-in.
 * Used by profile-demo.html only — the real pages never pass { demo: true }.
 */
export async function runDemoGate(options = {}) {
  if (options.completed) return null;
  return showModal({ user: { uid: "demo", email: "", displayName: "" }, existing: {}, demo: true });
}

let inFlightGate = null;

/**
 * Resolves once the student has a completed profile document
 * (or immediately when it is already complete / the user is an admin).
 */
export function ensureStudentProfile(user, options = {}) {
  if (!user) return Promise.resolve(null);
  if (options.isAdmin) return Promise.resolve(null);
  if (options.demo && options.completed) return Promise.resolve(null); // demo: treat as already done
  if (inFlightGate) return inFlightGate;

  inFlightGate = runGate(user, options).catch((error) => {
    console.error("Student profile gate failed:", error);
    return null;
  }).finally(() => {
    inFlightGate = null;
  });

  return inFlightGate;
}

async function runGate(user, options) {
  if (options.demo) {
    return showModal({ user, existing: {}, demo: true });
  }

  let existing = {};
  try {
    const { doc: docRef, getDoc, db } = await firestore();
    const snap = await getDoc(docRef(db, "users", user.uid));
    existing = snap.exists() ? snap.data() : {};
  } catch (error) {
    // Never brick the portal because of a read/permission problem.
    console.warn("Could not read student profile, allowing access:", error);
    return null;
  }

  if (existing.studentProfileComplete === true) return normalize(existing);

  const saved = await showModal({ user, existing, demo: false });

  try {
    const { doc: docRef, setDoc, serverTimestamp, db } = await firestore();
    await setDoc(
      docRef(db, "users", user.uid),
      {
        uid: user.uid,
        name: saved.name,
        studentName: saved.name,
        email: (user.email || saved.collegeEmail).toLowerCase(),
        collegeEmail: saved.collegeEmail,
        rollNo: saved.rollNo,
        year: saved.year,
        branch: saved.branch,
        phone: saved.phone,
        photoURL: user.photoURL || "",
        studentProfileComplete: true,
        profileCompletedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Saving student profile failed:", error);
    // Re-open the modal so the student can retry instead of silently losing data.
    return showModal({ user, existing: saved, demo: false, previousError: error });
  }

  return saved;
}

function normalize(data) {
  return {
    name: data.studentName || data.name || "",
    collegeEmail: data.collegeEmail || data.email || "",
    rollNo: data.rollNo || "",
    year: data.year || "",
    branch: data.branch || "",
    phone: data.phone || ""
  };
}

/* ------------------------------------------------------------------ styles */

const CSS = `
.sp-overlay{
  position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:18px;
  background:rgba(8,10,32,.82);backdrop-filter:blur(7px);
  font-family:'Inter',system-ui,-apple-system,sans-serif;color:#e8ecff;
  overflow-y:auto;
}
.sp-card{
  width:100%;max-width:520px;background:linear-gradient(180deg,#1c2263,#161b52);
  border:1px solid rgba(99,102,241,.45);border-radius:20px;padding:26px 24px 22px;
  box-shadow:0 24px 70px rgba(0,0,0,.55);position:relative;max-height:calc(100vh - 36px);
  overflow-y:auto;
}
.sp-card::before{
  content:"";position:absolute;inset:0 0 auto 0;height:5px;border-radius:20px 20px 0 0;
  background:linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4);
}
.sp-head{display:flex;gap:13px;align-items:flex-start;margin-bottom:18px}
.sp-ico{
  width:44px;height:44px;border-radius:13px;flex:none;display:grid;place-items:center;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 8px 20px rgba(99,102,241,.45)
}
.sp-ico svg{width:22px;height:22px}
.sp-head h2{font-family:'Outfit',sans-serif;font-size:21px;margin:0 0 4px;line-height:1.25}
.sp-head p{margin:0;font-size:13px;color:#9aa6d6;line-height:1.5}
.sp-badge{
  display:inline-block;margin-top:8px;font-size:11px;font-weight:700;letter-spacing:.5px;
  text-transform:uppercase;color:#9ef2cd;background:rgba(16,185,129,.16);
  border:1px solid rgba(16,185,129,.4);padding:3px 9px;border-radius:999px
}
.sp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sp-field{margin-bottom:13px}
.sp-field.sp-full{grid-column:1/-1}
.sp-field label{display:block;font-size:12.5px;font-weight:600;color:#c7d0f5;margin-bottom:6px}
.sp-field label i{color:#ef4444;font-style:normal}
.sp-field input,.sp-field select{
  width:100%;font:inherit;font-size:13.5px;color:#e8ecff;background:rgba(9,14,44,.7);
  border:1px solid rgba(99,102,241,.4);border-radius:11px;padding:11px 12px;outline:none;
  transition:border-color .15s,box-shadow .15s
}
.sp-field input::placeholder{color:#6f7cb5}
.sp-field input:focus,.sp-field select:focus{
  border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.25)
}
.sp-field input[readonly]{opacity:.75;cursor:not-allowed}
.sp-field select{
  appearance:none;cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,#8b96cc 50%),linear-gradient(135deg,#8b96cc 50%,transparent 50%);
  background-position:calc(100% - 18px) 50%,calc(100% - 13px) 50%;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat
}
.sp-field select option{background:#141a4c;color:#e8ecff}
.sp-field input.sp-bad,.sp-field select.sp-bad{border-color:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.16)}
.sp-err{display:block;font-size:11.5px;color:#ff9b9b;margin-top:5px;min-height:0}
.sp-err:empty{display:none}
.sp-hint{display:block;font-size:11px;color:#7b87bb;margin-top:5px}
.sp-hint b{color:#9fb2ff}
.sp-actions{display:flex;gap:10px;margin-top:6px}
.sp-btn{
  flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;
  font:inherit;font-weight:700;font-size:14px;padding:12px 16px;border-radius:12px;
  border:0;cursor:pointer;color:#fff;
  background:linear-gradient(135deg,#6366f1,#8b5cf6);
  box-shadow:0 10px 24px rgba(99,102,241,.42);transition:opacity .15s,transform .15s
}
.sp-btn:hover{opacity:.94}
.sp-btn:active{transform:scale(.99)}
.sp-btn[disabled]{opacity:.6;cursor:wait}
.sp-note{font-size:11px;color:#7b87bb;margin-top:12px;line-height:1.5;text-align:center}
.sp-alert{
  margin-bottom:14px;padding:10px 12px;border-radius:10px;font-size:12.5px;
  background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.45);color:#ffb3b3
}
.sp-success{text-align:center;padding:10px 0 4px}
.sp-success b{display:block;font-size:17px;margin-bottom:6px}
.sp-success p{font-size:13px;color:#9aa6d6;margin:0 0 16px}
@media (max-width:520px){
  .sp-grid{grid-template-columns:1fr}
  .sp-card{padding:22px 18px 18px}
  .sp-head h2{font-size:19px}
}
`;

function injectStyles() {
  if (document.getElementById("spStyles")) return;
  const style = document.createElement("style");
  style.id = "spStyles";
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------- modal */

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function showModal({ user, existing = {}, demo = false, previousError = null }) {
  injectStyles();

  return new Promise((resolve) => {
    const suggestedName = existing.name || user.displayName || "";
    const suggestedEmail = (existing.collegeEmail || user.email || "").toLowerCase();

    const branchOptions = BRANCHES
      .map((b) => `<option value="${esc(b.value)}">${esc(b.label)}</option>`)
      .join("");
    const yearOptions = YEARS
      .map((y) => `<option value="${esc(y.value)}">${esc(y.label)}</option>`)
      .join("");

    const overlay = document.createElement("div");
    overlay.className = "sp-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "spTitle");

    overlay.innerHTML = `
      <div class="sp-card">
        <div class="sp-head">
          <span class="sp-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8">
              <circle cx="12" cy="8" r="3.6"/>
              <path d="M4.5 20c0-4 3.4-6.6 7.5-6.6s7.5 2.6 7.5 6.6"/>
            </svg>
          </span>
          <div>
            <h2 id="spTitle">Complete your student profile</h2>
            <p>One-time setup so clubs and events can reach you. This is required before you continue.</p>
            <span class="sp-badge">Required · asked only once</span>
          </div>
        </div>

        <form id="spForm" novalidate autocomplete="off">
          <div id="spAlert" ${previousError ? "" : "hidden"} class="sp-alert">
            ${previousError ? "We couldn't save your details. Check your connection and press save again." : ""}
          </div>

          <div class="sp-field">
            <label for="spName">Full name <i>*</i></label>
            <input id="spName" type="text" maxlength="60" placeholder="e.g. Aarav Sharma" value="${esc(suggestedName)}">
            <small class="sp-err" id="spErrName"></small>
          </div>

          <div class="sp-field">
            <label for="spRoll">Enrollment / roll no. <i>*</i></label>
            <input id="spRoll" type="text" maxlength="20" placeholder="e.g. 0901CS221034" value="${esc(existing.rollNo || "")}">
            <small class="sp-err" id="spErrRoll"></small>
          </div>

          <div class="sp-grid">
            <div class="sp-field">
              <label for="spYear">Year <i>*</i></label>
              <select id="spYear">
                <option value="" disabled ${existing.year ? "" : "selected"}>Select year</option>
                ${yearOptions}
              </select>
              <small class="sp-err" id="spErrYear"></small>
            </div>

            <div class="sp-field">
              <label for="spBranch">Branch <i>*</i></label>
              <select id="spBranch">
                <option value="" disabled ${existing.branch ? "" : "selected"}>Select branch</option>
                ${branchOptions}
              </select>
              <small class="sp-err" id="spErrBranch"></small>
            </div>
          </div>

          <div class="sp-field">
            <label for="spEmail">College email <i>*</i></label>
            <input id="spEmail" type="email" maxlength="80" placeholder="yourname@${ALLOWED_DOMAIN}" value="${esc(suggestedEmail)}">
            <small class="sp-hint">Use your <b>@${ALLOWED_DOMAIN}</b> address</small>
            <small class="sp-err" id="spErrEmail"></small>
          </div>

          <div class="sp-field">
            <label for="spPhone">Mobile (optional)</label>
            <input id="spPhone" type="tel" maxlength="10" inputmode="numeric" placeholder="10-digit mobile number" value="${esc(existing.phone || "")}">
            <small class="sp-err" id="spErrPhone"></small>
          </div>

          <div class="sp-actions">
            <button type="submit" class="sp-btn" id="spSave">Save &amp; continue</button>
          </div>
          <p class="sp-note">Your details are stored in the college portal and are visible to club admins only if you join a club or register for an event.</p>
        </form>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    const form = overlay.querySelector("#spForm");
    const alertBox = overlay.querySelector("#spAlert");
    const saveBtn = overlay.querySelector("#spSave");
    const fields = ["Name", "Roll", "Year", "Branch", "Email", "Phone"];

    if (existing.year) overlay.querySelector("#spYear").value = String(existing.year);
    if (existing.branch) overlay.querySelector("#spBranch").value = String(existing.branch);

    // Compulsory: block Escape and backdrop dismissal.
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") e.preventDefault();
    });

    function setError(field, message) {
      const input = overlay.querySelector("#sp" + field);
      const err = overlay.querySelector("#spErr" + field);
      if (input) input.classList.toggle("sp-bad", Boolean(message));
      if (err) err.textContent = message || "";
    }

    function clearErrors() {
      fields.forEach((f) => setError(f, ""));
    }

    fields.forEach((f) => {
      const input = overlay.querySelector("#sp" + f);
      if (!input) return;
      const handler = () => setError(f, "");
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });

    function read() {
      return {
        name: overlay.querySelector("#spName").value.trim().replace(/\s+/g, " "),
        rollNo: overlay.querySelector("#spRoll").value.trim().toUpperCase(),
        year: Number(overlay.querySelector("#spYear").value) || 0,
        branch: overlay.querySelector("#spBranch").value,
        collegeEmail: overlay.querySelector("#spEmail").value.trim().toLowerCase(),
        phone: overlay.querySelector("#spPhone").value.trim()
      };
    }

    function validate(d) {
      clearErrors();
      let ok = true;

      if (!d.name) { setError("Name", "Name is required."); ok = false; }
      else if (d.name.length < 3) { setError("Name", "Enter at least 3 characters."); ok = false; }
      else if (!/^[A-Za-z][A-Za-z .'-]*$/.test(d.name)) { setError("Name", "Letters, spaces, dot, hyphen or apostrophe only."); ok = false; }

      if (!d.rollNo) { setError("Roll", "Roll number is required."); ok = false; }
      else if (!/^[A-Z0-9/-]{4,20}$/.test(d.rollNo)) { setError("Roll", "4–20 letters/digits, e.g. 0901CS221034."); ok = false; }

      if (!d.year) { setError("Year", "Select your year."); ok = false; }
      if (!d.branch) { setError("Branch", "Select your branch."); ok = false; }

      if (!d.collegeEmail) { setError("Email", "College email is required."); ok = false; }
      else if (!EMAIL_RE.test(d.collegeEmail)) { setError("Email", `Must be a valid @${ALLOWED_DOMAIN} address.`); ok = false; }

      if (d.phone && !PHONE_RE.test(d.phone)) { setError("Phone", "Enter a valid 10-digit Indian mobile number."); ok = false; }

      return ok;
    }

    function finish(data) {
      document.body.style.overflow = "";
      overlay.remove();
      resolve(data);
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = read();

      if (!validate(data)) {
        const bad = overlay.querySelector(".sp-bad");
        if (bad) bad.focus();
        return;
      }

      if (demo) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        setTimeout(() => {
          overlay.querySelector(".sp-card").innerHTML = `
            <div class="sp-success">
              <span class="sp-ico" style="margin:0 auto 12px" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="m5 13 4 4L19 7"/></svg>
              </span>
              <b>Profile saved</b>
              <p><strong>${esc(data.name)}</strong> · ${esc(determineYearLabel(data.year))} · ${esc(data.branch)}<br>
              ${esc(data.collegeEmail)}</p>
              <p style="color:#7b87bb">Demo only — nothing was written to Firestore.</p>
              <button type="button" class="sp-btn" id="spReset">Run the demo again</button>
            </div>`;
          overlay.querySelector("#spReset").addEventListener("click", () => {
            document.body.style.overflow = "";
            overlay.remove();
            resolve(data);
            setTimeout(() => showModal({ user, existing: {}, demo: true }), 60);
          });
        }, 550);
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      finish(data);
    });

    setTimeout(() => {
      const first = overlay.querySelector("#spName");
      if (first) first.focus();
    }, 60);
  });
}

function determineYearLabel(year) {
  return YEAR_LABEL[Number(year)] || "";
}
