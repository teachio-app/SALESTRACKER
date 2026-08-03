// ─────────────────────────────────────────────────────────────
// Bulk noise, recognised from the ENVELOPE alone (sender + subject), so the
// poller can skip it without paying for the body.
//
// Why this exists: this catch-all mailbox receives roughly a thousand messages
// an hour, and a 2,000-message sample contained 1,731 of exactly two things —
// "Your Authentication Code" and "Welkom bij Ticketmaster!", both relayed
// through icloud.com — against ONE message from a ticket platform. Downloading
// and parsing every body meant the poller managed 180 messages an hour against
// ~1,000 arriving, so it fell permanently behind and sales were never reached.
//
// A DENY-list, not an allow-list, and that direction is the whole design.
// An allow-list ("only mail from viagogo.com") fails silently in the worst
// possible way: a sale arrives from an address we didn't predict — and Seatix
// mail does arrive forwarded through the catch-all, not from its own domain —
// and it is dropped with nobody the wiser. A deny-list can only ever cost an
// unnecessary body fetch. Given this poller has already lost ten days of
// notifications once, "wastes a fetch" beats "misses a sale" every time.
//
// So: everything is a candidate unless it is one of the specific, high-volume
// things below.
// ─────────────────────────────────────────────────────────────

/** Sender domains that must NEVER be filtered, whatever the subject says. */
const PLATFORM_DOMAIN = /viagogo|seatik|gigsberg|stubhub|ticombo|tickpick|vividseats/i;

/** Subjects arriving in bulk that cannot be a sale. Keep each one specific. */
const NOISE_SUBJECT: RegExp[] = [
  /^\s*your authentication code\s*$/i,
  /\bauthentication code\b/i,
  /\b(verification|security) code\b/i,
  /^\s*welkom bij ticketmaster/i,
  /^\s*welcome to ticketmaster/i,
  /^\s*(bevestig|confirm) (je|your) (e-?mail|account)/i,
];

export type Envelope = { from?: string | null; subject?: string | null };

/**
 * Can this message be skipped without opening it?
 *
 * Only for mail that is unmistakably bulk noise. Anything uncertain returns
 * false and gets read properly — that is the intended bias.
 */
export function isBulkNoise(env: Envelope): boolean {
  const from = (env.from ?? "").toLowerCase();
  // A platform is never noise, no matter what its subject line says.
  if (PLATFORM_DOMAIN.test(from)) return false;

  const subject = (env.subject ?? "").trim();
  if (!subject) return false; // no subject to judge by → read it
  return NOISE_SUBJECT.some((re) => re.test(subject));
}
