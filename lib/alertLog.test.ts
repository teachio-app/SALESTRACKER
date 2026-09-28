// Run: npx tsx lib/alertLog.test.ts
// The alerters' duplicate guard.
//
// What this protects: Seatix delivers every sale confirmation to the mailbox
// TWICE — same second, same confirmation number, consecutive UIDs. The tracker
// never showed a double because tickets.external_id is unique; the standalone
// alerter, which writes no rows, pinged Discord twice for months.
//
// Two things have to hold for the fix to work, and both are tested here:
//   1. the two copies must produce the SAME key, or there is nothing to dedupe;
//   2. only a unique-violation may count as "already announced" — read anything
//      else that way and a real sale goes silent.

import { classifyClaim, isMissingTable } from "./alertLog";
import { parseSeatix } from "./parsers/seatix";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

// A real Seatix confirmation, trimmed to the fields the parser reads.
const seatixMail = (confirmation: string) => ({
  from: '"Seatiks" <sales@seatiks.com>',
  subject: `Sale confirmation #${confirmation}`,
  text: [
    "Seatiks", "Sale Confirmation", "",
    "Event\tNations League - Denmark vs Portugal",
    "Date\t01/10/2026 20:45",
    "Venue\tParken Stadium",
    "Quantity\t2",
    "Section\tTribune A A10", "Row\t4", "Seats\t238-239",
    "Platform\tViagogo",
    "Price per ticket\t220.00€",
    "Payout\t440.00€",
    "Total face value\t300.00€",
  ].join("\n"),
  html: "",
  date: new Date("2026-09-26T15:03:00Z"),
});

console.log("\nthe two delivered copies collapse to one key");
{
  // The real pair, uid 174687 and 174688 — Seatix reuses the confirmation
  // number, so both copies are byte-identical where it counts.
  const a = parseSeatix(seatixMail("EC6DC23D") as never);
  const b = parseSeatix(seatixMail("EC6DC23D") as never);
  check("both copies parse", [!!a, !!b], [true, true]);
  check("same externalId", a!.externalId === b!.externalId, true);
  check("key is the seat identity", a!.externalId, "seatix:pbi99y");

  // A different seat in the same event must NOT collide, or the second genuine
  // sale of the evening would be swallowed as a duplicate.
  const other = { ...seatixMail("8F91339A"), text: seatixMail("8F91339A").text.replace("Seats\t238-239", "Seats\t230-231") };
  const c = parseSeatix(other as never);
  check("a different seat gets a different key", c!.externalId !== a!.externalId, true);
}

console.log("\nonly a unique violation means 'already announced'");
{
  check("insert succeeded → post it", classifyClaim(null), { ok: true });
  check("23505 → duplicate", classifyClaim({ code: "23505", message: "duplicate key value" }),
    { ok: false, reason: "duplicate" });

  // The table not existing yet is the state right after deploy, before the
  // migration is run. It must not read as a duplicate.
  const missing = classifyClaim({ code: "42P01", message: 'relation "alert_log" does not exist' });
  check("42P01 → unavailable, not duplicate", missing.ok === false && (missing as never as { reason: string }).reason, "unavailable");
  check("42P01 is recognised as the migration being unrun", isMissingTable(missing), true);

  // Anything unexpected also has to fall on the "post it anyway" side.
  const odd = classifyClaim({ code: null, message: "fetch failed" });
  check("no code → unavailable", odd.ok === false && (odd as never as { reason: string }).reason, "unavailable");
  check("detail carries the cause", (odd as never as { detail: string }).detail, "?: fetch failed");
  check("a network error is not the missing table", isMissingTable(odd), false);
  check("a duplicate is not the missing table",
    isMissingTable({ ok: false, reason: "duplicate" }), false);
}

console.log(failed === 0 ? "\nAll alert-log tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
