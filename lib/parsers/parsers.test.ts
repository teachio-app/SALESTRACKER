// Run: npx tsx lib/parsers/parsers.test.ts
// Asserts the parsers against the real emails in __fixtures__/real-emails.ts.

import { parseViagogo } from "./viagogo";
import { parseSeatix } from "./seatix";
import { classify } from "./classify";
import { SEATIX_SALE, VIAGOGO_SALE, VIAGOGO_CONCERT, asEmail } from "./__fixtures__/real-emails";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

console.log("\nclassify()");
check("viagogo → sale", classify(asEmail(VIAGOGO_SALE)), "sale");
check("seatix  → sale", classify(asEmail(SEATIX_SALE)), "sale");

console.log("\nparseViagogo()");
const v = parseViagogo(asEmail(VIAGOGO_SALE));
check("recognised", v !== null, true);
check("orderRef", v?.orderRef, "648690186");
check("externalId", v?.externalId, "viagogo:648690186");
check("eventName", v?.eventName, "England vs Argentina - World Cup - Semi Finals (Match 102)");
check("eventDate", v?.eventDate, "2026-07-15");
check("location", v?.location, "Mercedes-Benz Stadium, Atlanta");
check("section", v?.section, "216");
check("seatRow", v?.seatRow, "5");
check("seats", v?.seats, "24 - 24");
check("qty", v?.qty, 1);
check("sellPrice", v?.sellPrice, 3691.8);

console.log("\nparseSeatix()");
const s = parseSeatix(asEmail(SEATIX_SALE));
check("recognised", s !== null, true);
check("eventName", s?.eventName, "France vs England - World Cup - Match 103 (Bronze Final)");
check("eventDate", s?.eventDate, "2026-07-18");
check("location", s?.location, "Hard Rock Stadium");
check("section", s?.section, "122");
check("seatRow", s?.seatRow, "30");
check("seats", s?.seats, "10");
check("qty", s?.qty, 1);
check("sellPrice", s?.sellPrice, 675);
check("faceValue", s?.faceValue, 1500);

console.log("\nparseViagogo() — concert at an arena (no 'World Cup', no 'Stadium')");
const c = parseViagogo(asEmail(VIAGOGO_CONCERT));
check("recognised", c !== null, true);
check("eventName is the event, not the headline", c?.eventName, "Coldplay - Music of the Spheres Tour");
check("location", c?.location, "O2 Arena, London");
check("eventDate", c?.eventDate, "2026-08-21");
check("qty", c?.qty, 2);
check("sellPrice", c?.sellPrice, 480);

console.log("\nCross-parser: neither parser may claim the other's email");
check("viagogo parser on seatix mail → null", parseViagogo(asEmail(SEATIX_SALE)), null);
check("seatix parser on viagogo mail → null", parseSeatix(asEmail(VIAGOGO_SALE)), null);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
