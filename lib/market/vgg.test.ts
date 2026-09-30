// Run: npx tsx lib/market/vgg.test.ts
//
// Turning a pasted viagogo link into an event. The id path is exact; the name
// path is a guess, and most of these tests are about making sure it refuses to
// guess when the link doesn't actually say which event it means.

import { parseVggLink, matchByName } from "./vgg";

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

console.log("\nmatching by name");
{
  const events = [
    { id: "nba", name: "NBA Manchester: New Orleans Pelicans vs San Antonio Spurs", event_date: "2027-01-17" },
    { id: "mufc", name: "Manchester United vs Arsenal", event_date: "2026-12-01" },
    { id: "celine", name: "Céline Dion", event_date: "2026-10-05" },
  ];
  const today = "2026-09-30";

  check("the NBA link finds the NBA game",
    matchByName(parseVggLink(NBA_LINK)!.words, events, today)?.event.id, "nba");
  check("…with its score", matchByName(parseVggLink(NBA_LINK)!.words, events, today)?.score, 4);

  // One shared word is how "Manchester United" gets matched to "NBA Manchester".
  check("one word in common is not enough", matchByName(["manchester"], events, today), null);

  // Diacritics are folded both ways.
  check("celine finds Céline", matchByName(["celine", "dion"], events, today)?.event.id, "celine");

  // Two events equally matched: the link doesn't say which, so neither.
  const twoNights = [
    { id: "n1", name: "Coldplay Wembley Stadium", event_date: "2027-06-01" },
    { id: "n2", name: "Coldplay Wembley Stadium", event_date: "2027-06-02" },
  ];
  check("a tie is refused", matchByName(["coldplay", "wembley"], twoNights, today), null);

  // Same tour, same city, a year apart: prefer the one still to come.
  const yearApart = [
    { id: "last", name: "Coldplay Wembley", event_date: "2025-06-01" },
    { id: "next", name: "Coldplay Wembley", event_date: "2027-06-01" },
  ];
  check("upcoming beats past", matchByName(["coldplay", "wembley"], yearApart, today)?.event.id, "next");

  check("no words, no match", matchByName([], events, today), null);
  check("no events, no match", matchByName(["nba", "pelicans"], [], today), null);
}

console.log(failed === 0 ? "\nAll viagogo-link tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
