// Run: npx tsx lib/mailFilter.test.ts
// The envelope filter decides what the poller never opens. Every case below is
// a real envelope from this mailbox — the sale ones taken from the messages
// that produced actual rows, the noise from whatever was flooding that week.

import { shouldOpen, senderDomain } from "./mailFilter";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nsenderDomain()");
check("plain address", senderDomain("sales@seatiks.com"), "seatiks.com");
check("subdomain kept", senderDomain("automated@orders.viagogo.com"), "orders.viagogo.com");
check("case folded", senderDomain("Sales@SEATIKS.com"), "seatiks.com");
check("nothing to read", senderDomain(""), "");
check("no @ at all", senderDomain("weird"), "");

console.log("\nthe real sale mail — must always be opened");
check("seatiks sale confirmation",
  shouldOpen({ from: "sales@seatiks.com", subject: "Sale confirmation #D859A975" }), true);
check("viagogo, any subject at all",
  shouldOpen({ from: "automated@orders.viagogo.com", subject: "Tell us how we did!" }), true);
check("viagogo transfer request",
  shouldOpen({ from: "automated@orders.viagogo.com", subject: "ACTION REQUIRED: We Need You to Transfer Your Ticket" }), true);
check("a viagogo national domain",
  shouldOpen({ from: "x@orders.viagogo.co.uk", subject: "anything" }), true);

console.log("\nsale-shaped subjects, whatever the sender");
// This is the escape hatch that keeps the allow-list from being a trap: a
// forwarded or relayed sale still gets opened on its subject alone.
check("forwarded sale confirmation",
  shouldOpen({ from: "catchall@thevortex.beauty", subject: "Fwd: Sale confirmation #7DC559DA" }), true);
check("you sold", shouldOpen({ from: "someone@unknown.tld", subject: "etr, you sold 1 ticket!" }), true);
check("please send your tickets",
  shouldOpen({ from: "someone@unknown.tld", subject: "Please send your tickets 649481835" }), true);
check("payment notice",
  shouldOpen({ from: "someone@unknown.tld", subject: "viagogo payment 66726239 - You have just been paid" }), true);
check("order number", shouldOpen({ from: "x@y.tld", subject: "viagogo customer support update Order - 651889083" }), true);

console.log("\nthe flood — not opened");
check("Confirm your RSVP (2,397 of a 3,000 sample)",
  shouldOpen({ from: "noreply@owsla.com", subject: "Confirm your RSVP" }), false);
check("Welcome to Ticketmaster", shouldOpen({ from: "x@icloud.com", subject: "Welcome to Ticketmaster!" }), false);
check("authentication code", shouldOpen({ from: "x@icloud.com", subject: "Your single-use code" }), false);
check("Microsoft security", shouldOpen({ from: "x@accountprotection.microsoft.com", subject: "Microsoft account security info was added" }), false);
check("no sender, no subject", shouldOpen({}), false);

console.log("\nand the phrase that must NOT be a single word");
// "sale" alone would open every newsletter in the mailbox; "on sale" is a
// marketing subject and viagogo sends plenty of them.
check("'now on sale' from an unknown sender stays shut",
  shouldOpen({ from: "news@someticketsite.com", subject: "Your Bad Bunny tickets are now on sale" }), false);
check("but the same subject FROM viagogo is opened (sender wins)",
  shouldOpen({ from: "automated@orders.viagogo.com", subject: "Your Bad Bunny tickets are now on sale" }), true);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
