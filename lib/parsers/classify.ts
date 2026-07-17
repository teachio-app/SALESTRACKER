import { RawEmail } from "./types";

// Every incoming email is one of these. Only "sale" (and "unknown") proceed
// to a parser; the rest are recognised noise and dropped.
export type MailKind =
  | "sale"             // a real sale confirmation → parse it
  | "transfer_pending" // "please transfer your tickets" reminder → ignore
  | "payout"           // "we've paid you" / payment sent → ignore
  | "marketing"        // newsletters, promos → ignore
  | "listing"          // listing live / price changed → ignore
  | "security"         // login alerts, password, 2FA → ignore
  | "unknown";         // matched nothing → treat cautiously (needs_review)

// Each rule: if `test` matches, the mail is `kind`. Order matters — the first
// match wins, so more specific / higher-risk kinds come first.
type Rule = { kind: MailKind; test: (e: RawEmail, body: string) => boolean };

const has = (body: string, re: RegExp) => re.test(body);

const RULES: Rule[] = [
  // ── Security first: never let a login alert look like anything else ──
  {
    kind: "security",
    test: (_e, b) =>
      has(b, /\b(log ?in|sign ?in|password|verification code|2fa|two-factor|new device|suspicious)\b/i) &&
      !has(b, /you sold|sale confirmation/i),
  },

  // ── Marketing / newsletters ──
  {
    kind: "marketing",
    test: (e, b) =>
      has(b, /unsubscribe|newsletter|% off|don'?t miss|trending events|recommended for you/i) &&
      !has(b, /you sold|sale confirmation|payout details/i),
  },

  // ── Payout / payment sent (money moving OUT to you, not a new sale) ──
  {
    kind: "payout",
    test: (_e, b) =>
      has(b, /payment sent|we'?ve paid you|payout (?:sent|completed|processed)|has been transferred to your/i) &&
      !has(b, /you sold|sale confirmation/i),
  },

  // ── Transfer-pending reminders (action needed on YOUR side) ──
  {
    kind: "transfer_pending",
    test: (_e, b) =>
      has(b, /transfer is pending|please (?:make sure|complete).{0,40}transfer|re-transfer|action (?:is )?needed/i) &&
      // A sale confirmation ALSO mentions transfer, so require the reminder to
      // NOT carry the sale-confirmation fingerprints.
      !has(b, /sale confirmation|financial summary|payout details|sale\s*#\s*\d{6,}/i),
  },

  // ── Listing events (went live, price changed) ──
  {
    kind: "listing",
    test: (_e, b) =>
      has(b, /your listing (?:is|went) live|price (?:updated|changed|drop)|listing (?:created|updated)/i) &&
      !has(b, /you sold|sale confirmation/i),
  },

  // ── Sale confirmations — the ones we actually want ──
  {
    kind: "sale",
    test: (e, b) =>
      // Viagogo fingerprint
      (has(b, /you sold\b/i) && has(b, /payout details|payout option|sale\s*#\s*\d{6,}/i)) ||
      // Seatix/Gigsberg fingerprint
      (has(b, /sale confirmation/i) && has(b, /financial summary|total face value/i)),
  },
];

export function classify(email: RawEmail): MailKind {
  const body = `${email.subject}\n${email.text || email.html || ""}`;
  for (const rule of RULES) {
    if (rule.test(email, body)) return rule.kind;
  }
  return "unknown";
}
