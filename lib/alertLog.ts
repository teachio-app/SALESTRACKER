// ─────────────────────────────────────────────────────────────
// ALERT LOG — "have I already announced this one?"
//
// The standalone alerters (Seatix, sneakers) write nothing to `tickets` on
// purpose: they are notifiers, not bookkeepers. That independence cost them the
// one thing the sale poller gets for free — a memory.
//
// It showed up as every Seatix sale arriving in Discord twice. The cause was
// outside this app: a forwarding rule on the account was sending mail round in a
// loop, so every message was delivered twice — same second, same confirmation
// number, consecutive UIDs.
//
//     2026-09-26T15:03  uid 174687  Sale confirmation #EC6DC23D
//     2026-09-26T15:03  uid 174688  Sale confirmation #EC6DC23D
//
// All 12 sales in a 1,500-message window, without exception. (Worth recording
// how that looked from in here, because the reading was wrong at first: the
// duplication was measured correctly and then blamed on Seatix. It was the
// mailbox, and the forwarding has since been turned off.)
//
// The tracker never showed a double because `tickets.external_id` is unique, so
// the second copy landed in `duplicate` and stopped there. The alerter had no
// such guard and dutifully pinged twice.
//
// The loop is gone, so this is now insurance rather than a live fix — but it is
// insurance against something the forwarding rule only exposed. Any repeat read
// pings again: a watermark rewound by hand (which has happened), a mail
// redelivered, a platform that genuinely sends twice.
//
// And it is a DATABASE that enforces it, not a variable: two cron runs can
// overlap — nothing to do with forwarding — and then both hold the same message
// and both decide to post. A primary key is the only thing that settles
// that race — whichever run inserts first wins and the other gets 23505.
//
// CLAIM BEFORE POSTING, RELEASE ON FAILURE. Claiming after a successful post
// would leave the race open for the length of the HTTP call; claiming and never
// releasing would turn a Discord outage into a permanently lost alert.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";
/**
 * "That table doesn't exist" — the migration hasn't been run yet. TWO codes,
 * because the request never reaches Postgres: PostgREST answers from its own
 * schema cache with PGRST205 and a 404. Checking only for the Postgres code
 * 42P01 meant the "run supabase/schema.sql" hint — the entire point of telling
 * these two failures apart — never appeared for the case it was written for.
 */
const MISSING_TABLE = ["42P01", "PGRST205"];

export type ClaimResult =
  /** First time seen — go ahead and post. */
  | { ok: true }
  /** Already announced. Skip silently; this is the normal path for copy #2. */
  | { ok: false; reason: "duplicate" }
  /** The table is missing, so persistence is unavailable. Caller decides. */
  | { ok: false; reason: "unavailable"; detail: string };

/**
 * Stake a claim on announcing `key` in `channel`.
 *
 * `channel` namespaces the key so the Seatix and sneaker modules can't collide
 * (and so a future third alerter needs no new table).
 */
export async function claimAlert(channel: string, key: string): Promise<ClaimResult> {
  const { error } = await supabaseAdmin()
    .from("alert_log")
    .insert({ channel, key });
  return classifyClaim(error);
}

/**
 * Turn the insert's outcome into a decision. Separated from the call so the one
 * part that must not be got wrong is testable without a database.
 *
 * The distinction that matters: ONLY 23505 means "already announced". Every
 * other failure — missing table, dropped connection, bad key — must NOT be read
 * as a duplicate, because that would silently swallow a real sale, which is the
 * exact failure this module exists to prevent. When in doubt, ping twice.
 */
export function classifyClaim(
  error: { code?: string | null; message?: string } | null
): ClaimResult {
  if (!error) return { ok: true };
  if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
  return {
    ok: false,
    reason: "unavailable",
    detail: `${error.code ?? "?"}: ${error.message ?? "unknown error"}`,
  };
}

/** Hand the claim back, so a failed post is retried on the next run. */
export async function releaseAlert(channel: string, key: string): Promise<void> {
  await supabaseAdmin().from("alert_log").delete().eq("channel", channel).eq("key", key);
}

/** True when the failure means "run supabase/schema.sql", not "try again". */
export function isMissingTable(r: ClaimResult): boolean {
  if (r.ok || r.reason !== "unavailable") return false;
  return MISSING_TABLE.some((code) => r.detail.startsWith(`${code}:`));
}
