// Run: npx tsx lib/discordRelay.test.ts
// Snowflake arithmetic and the forwarded payload. Both are places where being
// slightly wrong is silent: a cursor that can't represent an id skips messages,
// and a payload that forwards someone else's text unguarded can fire @everyone
// in your own server.

import {
  snowflakeFromMs, msFromSnowflake, relayPayload, isEmpty, type RelayMessage,
} from "./discordRelay";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nsnowflakes");
// Id 1234567890123456789 encodes 2024-04-29T18:12:02.167Z — verified against
// (id >> 22) + 1420070400000 by hand, not assumed. Round-tripping it through a
// JS number would corrupt it, which is why ids stay strings and only the
// millisecond is ever stored.
const realId = "1234567890123456789";
check("id survives as a string", String(BigInt(realId)), realId);
check("Number() would corrupt it (this is why it isn't stored)",
  String(Number(realId)) === realId, false);
const ms = msFromSnowflake(realId);
check("timestamp extracted", new Date(ms).toISOString(), "2024-04-29T18:12:02.167Z");
check("ms → snowflake → ms round-trips", msFromSnowflake(snowflakeFromMs(ms)), ms);
// The rebuilt cursor must sit at or below the original id, never above, or the
// message after it would be skipped.
check("rebuilt cursor never overshoots the original id",
  BigInt(snowflakeFromMs(ms)) <= BigInt(realId), true);
check("a time before Discord existed clamps to 0", snowflakeFromMs(0), "0");

console.log("\nempty messages (the missing-intent symptom)");
const base: RelayMessage = { id: realId, timestamp: "2024-07-06T00:00:00Z", author: { username: "bot" } };
check("no content, no embeds, no attachments → empty", isEmpty(base), true);
check("whitespace only is still empty", isEmpty({ ...base, content: "   " }), true);
check("an embed alone is not empty", isEmpty({ ...base, embeds: [{ title: "x" }] }), false);
check("content alone is not empty", isEmpty({ ...base, content: "hi" }), false);

console.log("\nforwarded payload");
const msg: RelayMessage = {
  ...base,
  content: "Drop detected",
  embeds: [{ title: "Bad Bunny", description: "4 tickets", color: 123, type: "rich", provider: { name: "x" } }],
  attachments: [{ url: "https://cdn.example/x.png" }],
};
const p = relayPayload(msg) as Record<string, any>;
check("content forwarded", p.content, "Drop detected\nhttps://cdn.example/x.png");
check("embed kept", p.embeds[0].title, "Bad Bunny");
// The API returns keys the webhook endpoint rejects; a rejected post is a lost
// alert, so only known-good keys go back out.
check("API-only keys stripped", "type" in p.embeds[0] || "provider" in p.embeds[0], false);
check("author name kept, marked as a relay", p.username, "bot (relay)");

console.log("\nmentions are contained");
// This forwards text written by someone else, in a channel nobody here controls.
const evil = relayPayload({ ...base, content: "@everyone GO" }) as Record<string, any>;
check("@everyone in the source cannot ping your server", evil.allowed_mentions, { parse: [] });
const withRole = relayPayload({ ...base, content: "x" }, "555") as Record<string, any>;
check("only the configured role may ping", withRole.allowed_mentions, { parse: [], roles: ["555"] });
check("and it is pinged with the role syntax", withRole.content.startsWith("<@&555>"), true);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
