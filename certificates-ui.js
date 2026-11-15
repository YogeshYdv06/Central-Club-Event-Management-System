// Shared markup, category theming & certificate generator for CampusConnect Certificates / Credits.
import { esc, fmtShortDate } from "./utils.js";

const CERT_THEMES = {
  technical: {
    label: "Technical",
    icon: "code-2",
    theme: "technical"
  },
  art: {
    label: "Cultural",
    icon: "palette",
    theme: "art"
  },
  cultural: {
    label: "Cultural",
    icon: "music",
    theme: "cultural"
  },
  sports: {
    label: "Sports",
    icon: "dribbble",
    theme: "sports"
  },
  literary: {
    label: "Literary",
    icon: "book-open",
    theme: "literary"
  },
  social: {
    label: "Social",
    icon: "users",
    theme: "social"
  },
  environment: {
    label: "Social",
    icon: "leaf",
    theme: "environment"
  },
  general: {
    label: "General",
    icon: "award",
    theme: "technical"
  }
};

/** Determines visual category theme from certificate/event metadata. */
export function certThemeKey(item) {
  const raw = String(item?.theme || item?.cat || item?.category || "").toLowerCase().trim();
  const hay = `${item?.title || item?.eventTitle || ""} ${item?.club || ""}`.toLowerCase();

  if (/environ|green|eco|nature|tree|clean/.test(hay)) return "environment";
  if (/art\b|design|paint|sketch|photo|poster/.test(hay)) return "art";
  if (CERT_THEMES[raw]) return raw;
  if (/tech|coding|code|web|hack|robot|ai\b|data|cyber/.test(hay)) return "technical";
  if (/cultur|music|dance|drama|sing|mic|fusion|fest/.test(hay)) return "cultural";
  if (/sport|football|cricket|basket|athlet|tournament|match|marathon/.test(hay)) return "sports";
  if (/liter|book|poet|debate|writ|word|quiz/.test(hay)) return "literary";
  if (/social|blood|donat|volunt|impact|awareness|camp|charity/.test(hay)) return "social";
  return "general";
}

/** Canonical 4-bucket credit category for the "Credit Categories" right-rail panel. */
export function creditBucket(item) {
  const k = certThemeKey(item);
  if (k === "technical") return "technical";
  if (k === "cultural" || k === "art" || k === "literary") return "cultural";
  if (k === "sports") return "sports";
  if (k === "social" || k === "environment") return "social";
  return "technical";
}

export function certMeta(item) {
  return CERT_THEMES[certThemeKey(item)] || CERT_THEMES.general;
}

/**
 * Renders one certificate card matching the Student Portal "My Certificates" 3x2 grid.
 */
export function certificateCardHTML(cert) {
  const meta = certMeta(cert);
  const id = cert.id || "";
  const title = cert.title || cert.eventTitle || "Campus Event";
  const club = cert.club || `${meta.label} Club`;
  const dateLabel = cert.date ? fmtShortDate(cert.date) : "Issued";
  const credits = Number(cert.credits) || 0;
  const badgeStyle = cert.badgeType === "credits" && credits > 0 ? "credits" : "issued";

  const statusPill =
    badgeStyle === "credits"
      ? `<span class="cc-status credits"><i data-lucide="star"></i>${credits} ${credits === 1 ? "Credit" : "Credits"} Earned</span>`
      : `<span class="cc-status issued"><i data-lucide="check-circle-2"></i>Certificate Issued</span>`;

  return `
    <article class="cc-card theme-${esc(meta.theme)}" data-cert-id="${esc(id)}">
      <div class="cc-card-top">
        <span class="cc-orb"><i data-lucide="${meta.icon}"></i></span>
        ${statusPill}
      </div>
      <h3 class="cc-title">${esc(title)}</h3>
      <div class="cc-meta">
        <span><i data-lucide="users"></i>${esc(club)}</span>
        <span><i data-lucide="calendar"></i>${esc(dateLabel)}</span>
      </div>
      <div class="cc-actions">
        <button class="cc-btn primary" type="button" data-view-cert="${esc(id)}">
          <i data-lucide="eye"></i>View Certificate
        </button>
        <button class="cc-btn ghost" type="button" data-dl-cert="${esc(id)}">
          <i data-lucide="download"></i>Download
        </button>
      </div>
    </article>`;
}

/**
 * Renders one row in the "Recent Activity" right-rail panel on the My Certificates tab.
 */
export function certActivityItemHTML(act) {
  const isCredit = act.kind === "credit";
  const icon = isCredit ? "star" : "award";
  const heading = isCredit ? "Credits added" : "Certificate issued";
  const dateLabel = act.date ? fmtShortDate(act.date) : "";

  return `
    <li>
      <button type="button" class="cc-act-row" data-act-cert="${esc(act.id || "")}">
        <span class="cc-act-ic ${isCredit ? "credit" : "cert"}">
          <i data-lucide="${icon}"></i>
        </span>
        <span class="cc-act-body">
          <b>${esc(heading)}</b>
          <span>${esc(act.title || "Campus Event")}</span>
          ${dateLabel ? `<small>${esc(dateLabel)}</small>` : ""}
        </span>
      </button>
    </li>`;
}

/**
 * Renders one row in the "Credit History" table on the My Credits view.
 */
export function creditHistoryRowHTML(cert) {
  const dateLabel = cert.date ? fmtShortDate(cert.date) : "—";
  const title = cert.title || cert.eventTitle || "Campus Event";
  const club = cert.club || "Campus Club";
  const credits = Math.max(1, Number(cert.credits) || 1);

  return `
    <tr>
      <td class="ch-date">${esc(dateLabel)}</td>
      <td class="ch-event">${esc(title)}</td>
      <td class="ch-club">${esc(club)}</td>
      <td class="ch-pts"><span class="ch-star"><i data-lucide="star"></i><b>${credits}</b></span></td>
    </tr>`;
}

/**
 * Generates a high-resolution official MITS CampusConnect Certificate on an HTML5 <canvas>
 * and returns its PNG data URL (used for both "View Certificate" preview and 1-click "Download").
 */
export function renderCertificateDataUrl(cert, studentName = "Student") {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 980;
  const ctx = canvas.getContext("2d");

  // Deep royal navy background
  const bg = ctx.createLinearGradient(0, 0, 1400, 980);
  bg.addColorStop(0, "#090d38");
  bg.addColorStop(0.55, "#11175c");
  bg.addColorStop(1, "#1e1568");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1400, 980);

  // Subtle decorative glow orbs
  const glow1 = ctx.createRadialGradient(220, 180, 20, 220, 180, 380);
  glow1.addColorStop(0, "rgba(99, 102, 241, 0.28)");
  glow1.addColorStop(1, "rgba(99, 102, 241, 0)");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, 1400, 980);

  const glow2 = ctx.createRadialGradient(1180, 800, 20, 1180, 800, 420);
  glow2.addColorStop(0, "rgba(168, 85, 247, 0.28)");
  glow2.addColorStop(1, "rgba(168, 85, 247, 0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, 1400, 980);

  // Outer & inner ornate borders
  const borderGrad = ctx.createLinearGradient(0, 0, 1400, 980);
  borderGrad.addColorStop(0, "#6f7bf7");
  borderGrad.addColorStop(0.5, "#c084fc");
  borderGrad.addColorStop(1, "#38bdf8");

  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 6;
  ctx.strokeRect(42, 42, 1316, 896);

  ctx.strokeStyle = "rgba(199, 210, 254, 0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(62, 62, 1276, 856);

  // Header institution line
  ctx.textAlign = "center";
  ctx.fillStyle = "#a5b4fc";
  ctx.font = "600 22px Poppins, Outfit, sans-serif";
  ctx.fillText("MADHAV INSTITUTE OF TECHNOLOGY & SCIENCE, GWALIOR", 700, 155);

  ctx.fillStyle = "#e0e7ff";
  ctx.font = "500 18px Poppins, sans-serif";
  ctx.fillText("CAMPUSCONNECT  •  CENTRAL CLUB & EVENT PORTAL", 700, 192);

  // Main heading
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 62px Outfit, Poppins, sans-serif";
  ctx.fillText("CERTIFICATE OF PARTICIPATION", 700, 295);

  // Accent divider
  const lineGrad = ctx.createLinearGradient(440, 0, 960, 0);
  lineGrad.addColorStop(0, "rgba(99,102,241,0)");
  lineGrad.addColorStop(0.5, "#a855f7");
  lineGrad.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = lineGrad;
  ctx.fillRect(440, 322, 520, 4);

  // Subtitle
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "400 24px Poppins, sans-serif";
  ctx.fillText("This certificate is proudly presented to", 700, 392);

  // Recipient Name
  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 56px Outfit, Poppins, sans-serif";
  ctx.fillText(String(studentName || "Student").toUpperCase(), 700, 475);

  ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(370, 498);
  ctx.lineTo(1030, 498);
  ctx.stroke();

  // Event & Club recognition paragraph
  const eventTitle = cert.title || cert.eventTitle || "Campus Event";
  const clubName = cert.club || "Campus Club";
  const credits = Number(cert.credits) || 0;
  const dateText = cert.date ? fmtShortDate(cert.date) : "2026";

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "400 24px Poppins, sans-serif";
  ctx.fillText("for active participation and commendable contribution in", 700, 560);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 38px Poppins, sans-serif";
  ctx.fillText(eventTitle, 700, 622);

  ctx.fillStyle = "#a5b4fc";
  ctx.font = "500 23px Poppins, sans-serif";
  const creditSuffix = credits > 0 ? `  •  ${credits} Activity ${credits === 1 ? "Credit" : "Credits"} Awarded` : "";
  ctx.fillText(`Organized by ${clubName}${creditSuffix}`, 700, 670);

  // Center gold-violet seal
  ctx.save();
  ctx.translate(700, 790);
  const sealGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, 64);
  sealGrad.addColorStop(0, "#a855f7");
  sealGrad.addColorStop(1, "#4f46e5");
  ctx.fillStyle = sealGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 16px Poppins, sans-serif";
  ctx.fillText("VERIFIED", 0, -4);
  ctx.fillStyle = "#fde68a";
  ctx.font = "600 13px Poppins, sans-serif";
  ctx.fillText("MITS PORTAL", 0, 18);
  ctx.restore();

  // Left signature block (Date & Certificate ID)
  ctx.textAlign = "left";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "600 21px Poppins, sans-serif";
  ctx.fillText(dateText, 150, 795);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(150, 810);
  ctx.lineTo(420, 810);
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 16px Poppins, sans-serif";
  ctx.fillText("Date of Issue", 150, 838);

  // Right signature block (Coordinator)
  ctx.textAlign = "right";
  ctx.fillStyle = "#f8fafc";
  ctx.font = "600 21px Poppins, sans-serif";
  ctx.fillText(cert.issuedByName || `${clubName} Coordinator`, 1250, 795);
  ctx.beginPath();
  ctx.moveTo(980, 810);
  ctx.lineTo(1250, 810);
  ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 16px Poppins, sans-serif";
  ctx.fillText("Authorized Signatory", 1250, 838);

  // Certificate verification ID footer
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(165, 180, 252, 0.65)";
  ctx.font = "500 14px monospace";
  const code = String(cert.certCode || cert.id || "MITS-CC").toUpperCase().slice(0, 18);
  ctx.fillText(`Certificate ID: CC-${code}`, 700, 892);

  return canvas.toDataURL("image/png");
}
