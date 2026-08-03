// Run: npx tsx lib/discord.test.ts
// The Seatix alert payload. Worth pinning because both halves of a role ping
// fail SILENTLY when wrong: `<@id>` instead of `<@&id>` renders a dead grey
// mention that notifies nobody, and a missing allowed_mentions turns any text
// that lands in an event name into an @everyone the webhook happily fires.

import { seatixAlertPayload, saleEmbed } from "./discord";
import { parseSeatix } from "./parsers/seatix";
import type { ParsedSale } from "./parsers/types";
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
check("titled like the main webhook's alert", p.embeds[0].title,
  "💰 Sold — France vs England - World Cup - Match 103 (Bronze Final)");
check("payout", field("Payout"), "675.00 EUR");
check("qty", field("Qty"), "1");
check("PLATFORM says where it sold", field("Platform"), "Seatix");
check("seat, joined for display", field("Seat"), "Section 122 · Row 30 · Seats 10");
check("location", field("Location"), "Hard Rock Stadium");
check("event date", field("Event date"), "2026-07-18");
check("face value when the mail states one", field("Face value"), "1500.00 EUR");

console.log("\nBoth webhooks must render the SAME embed");
// The two are meant to be visually identical; only the ping differs. Comparing
// the built embeds is what keeps that true as either one is edited.
const strip = (e: unknown) => JSON.stringify({ ...(e as Record<string, unknown>), timestamp: "" });
check("seatix alert embed === main webhook embed", strip(p.embeds[0]), strip(saleEmbed(sale)));

console.log("\nPlatform is read from the sale, not the webhook it goes to");
const platform = (s: Partial<ParsedSale>) =>
  ((saleEmbed({ ...sale, ...s } as ParsedSale) as { fields: { name: string; value: string }[] })
    .fields.find((f) => f.name === "Platform"))?.value;
check("a viagogo sale says viagogo", platform({ source: "viagogo" }), "viagogo");
check("a seatix sale says Seatix", platform({ source: "seatix" }), "Seatix");
check("an unknown source is admitted, not blank",
  platform({ source: null as unknown as ParsedSale["source"] }), "unknown");

console.log("\nseatixAlertPayload() — nothing gets severed");
// Discord 400s on an over-long title rather than trimming it, so no alert at all.
const long = seatixAlertPayload(
  { ...sale, eventName: "Wolverhampton Wanderers versus Brighton and Hove Albion ".repeat(8) },
  "1"
) as { embeds: { title: string }[] };
check("title clamped under Discord's limit", long.embeds[0].title.length <= 256, true);
check("and cut at a word, not mid-word", /\s\S*…$|[^\s]…$/.test(long.embeds[0].title), true);
check("ellipsis marks the cut", long.embeds[0].title.endsWith("…"), true);

console.log("\nA GA ticket with no seat and no face value");
const bare = seatixAlertPayload(
  { ...sale, section: null, seatRow: null, seats: null, location: null, eventDate: null, faceValue: undefined },
  "1"
) as { embeds: { fields: { name: string; value: string }[] }[] };
const names = bare.embeds[0].fields.map((f) => f.name);
check("no empty Seat / Location / Face value fields",
  names.filter((n) => ["Seat", "Location", "Face value"].includes(n)), []);
// No Order either: the Seatix layout carries no stable order number (see
// seatix.ts), so that field drops out too. Payout, Qty and Platform are the
// three that are always there.
check("the money and the platform always show", names, ["Payout", "Qty", "Platform"]);
check("a viagogo sale, which does have one, keeps its Order",
  (saleEmbed({ ...sale, source: "viagogo", orderRef: "648690186" }) as
    { fields: { name: string }[] }).fields.map((f) => f.name).includes("Order"), true);

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
