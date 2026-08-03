// Run: npx tsx lib/mailNoise.test.ts
// The envelope filter decides what the poller never opens, so the asymmetry
// matters more than the accuracy: skipping a sale is invisible and permanent,
// opening a newsletter costs two seconds. Every "uncertain" case below must
// come back false.

import { isBulkNoise } from "./mailNoise";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nthe flood this was written for");
// 1,731 of a 2,000-message sample were these two, all relayed via icloud.com.
check("Your Authentication Code",
  isBulkNoise({ from: "abc123@icloud.com", subject: "Your Authentication Code" }), true);
check("Welkom bij Ticketmaster!",
  isBulkNoise({ from: "abc123@icloud.com", subject: "Welkom bij Ticketmaster!" }), true);
check("verification code, any wording",
  isBulkNoise({ from: "noreply@example.com", subject: "Your verification code is 481920" }), true);

console.log("\nnever skipped: anything from a platform");
check("viagogo sale", isBulkNoise({ from: "automated@orders.viagogo.com", subject: "You sold 1 ticket!" }), false);
check("seatiks delivery", isBulkNoise({ from: "delivery@seatiks.com", subject: "Sale Confirmation" }), false);
// The safety net that matters: a platform's own security mail still gets read
// rather than filtered on its subject. classify() drops it a step later, where
// the full body is there to judge by.
check("even a platform's own authentication code",
  isBulkNoise({ from: "security@viagogo.com", subject: "Your Authentication Code" }), false);

console.log("\nnever skipped: anything uncertain");
check("a forwarded Seatix sale, sender is the catch-all",
  isBulkNoise({ from: "catchall@thevortex.beauty", subject: "Sale Confirmation" }), false);
check("an unfamiliar sender and subject",
  isBulkNoise({ from: "someone@unknown.tld", subject: "Your tickets have sold" }), false);
check("no subject at all → read it", isBulkNoise({ from: "x@y.z", subject: "" }), false);
check("no envelope fields at all → read it", isBulkNoise({}), false);
check("a newsletter isn't on the deny-list — cheap to open, safe to keep",
  isBulkNoise({ from: "news@ticketmaster.com", subject: "This week's top events" }), false);
// The deny-list is anchored where it can be: a sale mail merely MENTIONING a
// code in its subject must survive.
check("'code' inside a longer sale subject",
  isBulkNoise({ from: "x@y.z", subject: "Sale #65028776 — discount code applied" }), false);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
