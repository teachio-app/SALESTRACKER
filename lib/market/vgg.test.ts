// Run: npx tsx lib/market/vgg.test.ts
//
// Turning a pasted viagogo link into the event id the Market page reads by.

import { parseVggLink } from "./vgg";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const NBA_LINK = "https://www.viagogo.com/gb/Sports-Tickets/Basketball/NBA/New-Orleans-Pelicans-Tickets/E-158123456";

console.log("\nreading the id");
{
  check("an event page", parseVggLink(NBA_LINK)?.eventId, "158123456");
  check("with a query string", parseVggLink(`${NBA_LINK}?quantity=2`)?.eventId, "158123456");
  check("with a trailing slash", parseVggLink(`${NBA_LINK}/`)?.eventId, "158123456");
  check("without a scheme", parseVggLink("viagogo.co.uk/Concert-Tickets/Coldplay-Tickets/E-151000001")?.eventId, "151000001");
  check("another country's domain", parseVggLink("https://www.viagogo.de/Konzert-Tickets/E-150000123")?.eventId, "150000123");
  // A link copied out of a chat app often arrives wrapped in <>.
  check("wrapped in angle brackets", parseVggLink(`<${NBA_LINK}>`)?.eventId, "158123456");
  check("an eventId parameter", parseVggLink("https://www.viagogo.com/secure/buy?eventId=158999999")?.eventId, "158999999");
  check("a bare id", parseVggLink("158123456")?.eventId, "158123456");
  check("a bare E-id", parseVggLink("E-158123456")?.eventId, "158123456");
}

console.log("\nreading the name words");
{
  const w = parseVggLink(NBA_LINK)!.words;
  check("the event's own words survive", ["nba", "new", "orleans", "pelicans"].every((x) => w.includes(x)), true);
  // Catalogue words say nothing about WHICH event and would match everything.
  check("catalogue words are dropped", ["tickets", "sports", "gb"].some((x) => w.includes(x)), false);
  check("the id is not a word", w.includes("158123456"), false);

  const noId = parseVggLink("https://www.viagogo.com/Concert-Tickets/Rock-and-Pop/Coldplay-Tickets");
  check("a link without an id still parses", noId?.eventId, null);
  check("…and keeps its name", noId?.words, ["coldplay"]);
}

console.log("\nwhat is not a viagogo link");
{
  check("another site", parseVggLink("https://www.stubhub.com/event/158123456"), null);
  check("a look-alike host", parseVggLink("https://viagogo.com.evil.example/E-158123456"), null);
  check("plain text", parseVggLink("pelicans spurs"), null);
  check("empty", parseVggLink(""), null);
  check("nothing", parseVggLink(null), null);
  check("a too-short number is not an id", parseVggLink("12345"), null);
}

console.log(failed === 0 ? "\nAll viagogo-link tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
