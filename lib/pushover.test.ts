// Run: npx tsx lib/pushover.test.ts
// The Pushover → Discord rendering. Pure function, so it's the part that can be
// pinned without a live account.

import { pushoverEmbed, type PushoverMessage } from "./pushover";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const base: PushoverMessage = {
  id: 42, app: "Ticket Bot", title: "Drop detected",
  message: "Bad Bunny — 4 tickets available in Golden Circle",
  date: 1_785_000_000, priority: 0,
};
const embed = (m: Partial<PushoverMessage>, role?: string) =>
  (pushoverEmbed({ ...base, ...m }, role) as { embeds: Record<string, any>[] }).embeds[0];
const field = (m: Partial<PushoverMessage>, name: string) =>
  embed(m).fields.find((f: { name: string }) => f.name === name)?.value;

console.log("\nthe message itself");
check("title from the message", embed({}).title, "Drop detected");
check("body in the description", embed({}).description,
  "Bad Bunny — 4 tickets available in Golden Circle");
check("the sending app is always named", field({}, "App"), "Ticket Bot");
check("unix date becomes an ISO timestamp", embed({}).timestamp, new Date(1_785_000_000_000).toISOString());

console.log("\nwhen a message has no title");
// An empty heading looks broken, so the app name carries it instead.
check("falls back to the app name", embed({ title: "" }).title, "Ticket Bot");
check("and to a literal when there's no app either",
  embed({ title: "", app: "" }).title, "Pushover");

console.log("\npriority");
check("normal priority isn't stated — it's the default", field({}, "Priority"), undefined);
check("high is", field({ priority: 1 }, "Priority"), "high");
check("emergency is", field({ priority: 2 }, "Priority"), "emergency");
check("low is", field({ priority: -1 }, "Priority"), "low");
check("emergency is red", embed({ priority: 2 }).color, 0xd03b3b);
check("normal is blue", embed({ priority: 0 }).color, 0x3987e5);
check("an unknown priority falls back to normal, not to nothing",
  embed({ priority: 7 as number }).color, 0x3987e5);

console.log("\nlinks");
check("no url, no link field", field({}, "Link"), undefined);
check("url becomes the embed url", embed({ url: "https://example.com/x" }).url, "https://example.com/x");
check("and a field under its own title",
  field({ url: "https://example.com/x", url_title: "Open listing" }, "Open listing"),
  "https://example.com/x");

console.log("\nrole ping");
const pinged = pushoverEmbed(base, "999") as { content: string; allowed_mentions: { parse: []; roles: string[] } };
check("role syntax, not user syntax", pinged.content, "<@&999>");
check("allowed_mentions permits only that role", pinged.allowed_mentions, { parse: [], roles: ["999"] });
check("no role configured → no content field",
  "content" in (pushoverEmbed(base) as Record<string, unknown>), false);

console.log("\nDiscord's limits");
// An over-long title is a 400 from Discord and therefore no alert at all.
const long = embed({ title: "Bad Bunny Most Wanted Tour drop alert ".repeat(20) });
check("title clamped", (long.title as string).length <= 256, true);
check("and marked as cut", (long.title as string).endsWith("…"), true);
check("body clamped too", ((embed({ message: "x".repeat(5000) }).description as string).length <= 4096), true);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
