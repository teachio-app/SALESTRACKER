// Run: npx tsx lib/discord.test.ts
// The Seatix alert payload. Worth pinning because both halves of a role ping
// fail SILENTLY when wrong: `<@id>` instead of `<@&id>` renders a dead grey
// mention that notifies nobody, and a missing allowed_mentions turns any text
// that lands in an event name into an @everyone the webhook happily fires.

import { seatixAlertPayload } from "./discord";
import { parseSeatix } from "./parsers/seatix";
import { SEATIX_SALE, asEmail } from "./parsers/__fixtures__/real-emails";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

const sale = parseSeatix(asEmail(SEATIX_SALE))!;
const p = seatixAlertPayload(sale, "1234567890") as {
  content: string;
  allowed_mentions: { parse: string[]; roles: string[] };
  embeds: { title: string; description?: string; fields: { name: string; value: string }[] }[];
};

console.log("\nseatixAlertPayload() — the role ping");
check("role syntax is <@&id>, not the user's <@id>", p.content, "<@&1234567890>");
check("allowed_mentions permits that role", p.allowed_mentions.roles, ["1234567890"]);
check("and blocks everything else (@everyone, stray mentions)", p.allowed_mentions.parse, []);

console.log("\nseatixAlertPayload() — the content");
const field = (n: string) => p.embeds[0].fields.find((f) => f.name === n)?.value;
check("titled with the event", p.embeds[0].title,
  "🎟️ Seatix — France vs England - World Cup - Match 103 (Bronze Final)");
check("when and where, then the seat, in the description", p.embeds[0].description,
  "2026-07-18  ·  Hard Rock Stadium\nSection **122**  ·  Row **30**  ·  Seat **10**");
check("payout", field("Payout"), "**675.00 EUR**");
check("tickets", field("Tickets"), "1");
check("face value when the mail states one", field("Face value"), "1500.00 EUR");
check("three money/count columns, nothing ragged", p.embeds[0].fields.length, 3);

console.log("\nseatixAlertPayload() — nothing gets severed");
// Discord 400s on an over-long title rather than trimming it, so no alert at all.
const long = seatixAlertPayload(
  { ...sale, eventName: "Wolverhampton Wanderers versus Brighton and Hove Albion ".repeat(8) },
  "1"
) as { embeds: { title: string }[] };
check("title clamped under Discord's limit", long.embeds[0].title.length <= 256, true);
check("and cut at a word, not mid-word", /\s\S*…$|[^\s]…$/.test(long.embeds[0].title), true);
check("ellipsis marks the cut", long.embeds[0].title.endsWith("…"), true);

console.log("\nseatixAlertPayload() — a sale with no seat detail");
const bare = seatixAlertPayload(
  { ...sale, section: null, seatRow: null, seats: null, location: null, eventDate: null, faceValue: undefined },
  "1"
) as { embeds: { description?: string; fields: { name: string; value: string }[] }[] };
check("no empty seat line", bare.embeds[0].description, undefined);
check("face value falls back to a dash, not 'undefined'",
  bare.embeds[0].fields.find((f) => f.name === "Face value")?.value, "—");

console.log("\nseatixAlertPayload() — no role configured");
const noRole = seatixAlertPayload(sale) as Record<string, unknown>;
check("no content field at all", "content" in noRole, false);
check("no allowed_mentions either", "allowed_mentions" in noRole, false);
check("but the alert still goes out", Array.isArray(noRole.embeds), true);

console.log("\nOnly Seatix mail is this module's business");
check("a viagogo sale isn't parsed as Seatix",
  parseSeatix(asEmail("Congrats, you sold 1 ticket! viagogo")), null);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
