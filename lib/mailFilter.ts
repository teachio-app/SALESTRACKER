// ─────────────────────────────────────────────────────────────
// Which messages are worth opening?
//
// Bodies cost ~0.4s each and only a few dozen fit in a run; envelopes come back
// at ~450/second. So the envelope decides, and it has to decide well: this
// mailbox takes thousands of messages a day and almost none of them are sales.
//
// This replaced a DENY-list, and the reason is worth recording. The deny-list
// was chosen on the belief — stated in the README — that Seatix mail arrives
// forwarded through the catch-all, so an allow-list on sender could drop real
// sales. Measuring the mailbox showed otherwise: sales arrive straight from
// their own domains,
//
//     automated@orders.viagogo.com   "Your Bad Bunny tickets are now on sale"
//     sales@seatiks.com              "Sale confirmation #D859A975"
//
// while the noise is whatever is flooding this week — 2,397 "Confirm your RSVP"
// in a 3,000-message sample, from a domain that had never appeared before. A
// deny-list has to be taught every new flood and is silently useless until it
// is; an allow-list only has to know the handful of places money comes from.
//
// The risk of an allow-list is the mirror image: a sale from somewhere
// unexpected is skipped, and skipping is invisible. Two things answer that —
// a subject test that opens sale-shaped mail whatever the sender, and
// `skippedDomains`, which the poller reports so an unfamiliar sender shows up
// in the cron response instead of nowhere.
// ─────────────────────────────────────────────────────────────

export type Envelope = { from?: string | null; subject?: string | null };

/** Where money actually comes from. Sender domains, matched on the domain part. */
const PLATFORM_DOMAIN =
  /(^|\.)(viagogo\.[a-z.]+|seatiks\.com|seatix\.com|gigsberg\.[a-z.]+|stubhub\.[a-z.]+|ticombo\.[a-z.]+|tickpick\.com|vividseats\.com)$/i;

/**
 * Subjects that are sale-shaped whoever sent them, so a forwarded or relayed
 * sale is still opened. Deliberately phrases, not single words: "sale" alone
 * matches every "tickets are now on sale" newsletter ever written.
 */
// The order-number form is written every which way in the wild — "Order #
// 159627734", "Order - 651889083", "Order ID: 649481835" — so the separator is
// optional. The 5-digit floor is what keeps it from matching prose.
const SALE_SUBJECT =
  /(sale\s*confirmation|you\s+sold|sold\s+your|your\s+sale|payout|total\s+proceeds|you\s+have\s+just\s+been\s+paid|order\s*(id)?\s*[#:–—-]?\s*\d{5,}|transfer\s+your\s+ticket|send\s+your\s+tickets)/i;

export function senderDomain(from: string | null | undefined): string {
  const at = (from ?? "").toLowerCase().trim();
  const i = at.lastIndexOf("@");
  return i === -1 ? "" : at.slice(i + 1);
}

/**
 * Open this message's body?
 *
 * True for anything from a ticket platform, or anything whose subject is
 * shaped like a sale. Everything else is left unopened — and counted, never
 * just dropped.
 */
export function shouldOpen(env: Envelope): boolean {
  const domain = senderDomain(env.from);
  if (domain && PLATFORM_DOMAIN.test(domain)) return true;
  return SALE_SUBJECT.test((env.subject ?? "").trim());
}
