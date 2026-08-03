// Run: npx tsx lib/venueCountry.test.ts
// Every input below is a real location string from the live book or from a
// parsed email. The half that matters most is the bottom: the cases where the
// answer must be "I don't know", because a wrong flag on a sale alert gets
// believed.

import { venueCountry, venueWithCountry } from "./venueCountry";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}
const code = (s: string | null) => venueCountry(s)?.code ?? null;

console.log("\nstated outright");
check("USA", code("USA"), "US");
check("Belgium", code("Belgium"), "BE");
check("Germany", code("Germany"), "DE");
check("Netherlands", code("Netherlands"), "NL");
check("Mexico", code("Mexico"), "MX");
check("Cardiff - UK (country wins over the city, same answer)", code("Cardiff - UK"), "GB");
check("Czech spelling: Nemecko", code("Německo"), "DE");

console.log("\ntrailing ISO code, as viagogo writes it");
check("King Baudouin Stadium, Brussels, BE", code("King Baudouin Stadium, Brussels, BE"), "BE");

console.log("\nUS street address, as LA28 writes it");
check("Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA 91768",
  code("Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA 91768"), "US");
check("SoFi Stadium, 1001 Stadium Dr, INGLEWOOD, CA 90301",
  code("SoFi Stadium, 1001 Stadium Dr, INGLEWOOD, CA 90301"), "US");
// A bare trailing "CA" is a country code, not California — the ZIP is what
// tells the two apart.
check("a bare ', CA' is Canada, not California", code("Some Arena, CA"), "CA");

console.log("\nby city");
check("Mercedes-Benz Stadium, Atlanta", code("Mercedes-Benz Stadium, Atlanta"), "US");
check("O2 Arena, London", code("O2 Arena, London"), "GB");
check("Madrid", code("Madrid"), "ES");
check("Praha", code("Praha"), "CZ");
check("Bukurešť", code("Bukurešť"), "RO");
check("barcelona (lower case)", code("barcelona"), "ES");
check("Hard Rock Stadium - Complex, Miami", code("Hard Rock Stadium - Complex, Miami"), "US");
check("London - Wembley way", code("London - Wembley way"), "GB");
check("a city buried in a hand-typed note", code("Strawberry arena - stockholm myslim"), "SE");

console.log("\nby venue, when no city is given");
check("San Siro", code("San Siro"), "IT");
check("Hard Rock Stadium", code("Hard Rock Stadium"), "US");
check("Wembley Stadium", code("Wembley Stadium"), "GB");
check("Estadio Metropolitano", code("Estadio Metropolitano"), "ES");
check("Merkur Spiel Arena", code("Merkur Spiel Arena"), "DE");

console.log("\nand where it must NOT guess");
check("O2 Arena alone is ambiguous (London and Prague)", code("O2 Arena"), null);
check("junk", code("xx"), null);
check("empty", code(""), null);
check("null", code(null), null);
check("a venue we simply don't know", code("Some Regional Ice Rink"), null);
// Substring matching would ruin these two.
check("'Manchester' must not be found inside another word", code("Winchester Hall"), null);
check("a name containing 'America' is not the USA", code("America First Field"), null);

console.log("\nvenueWithCountry() — how it reads in the alert");
check("venue plus country", venueWithCountry("San Siro"), "San Siro · 🇮🇹 Italy");
check("city plus country", venueWithCountry("Madrid"), "Madrid · 🇪🇸 Spain");
check("when the location IS the country, don't say it twice",
  venueWithCountry("USA"), "🇺🇸 USA");
check("unknown location passes through untouched",
  venueWithCountry("Some Regional Ice Rink"), "Some Regional Ice Rink");
check("no location, nothing to show", venueWithCountry(null), null);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
