// Run: npx tsx lib/parsers/parsers.test.ts
// Asserts the parsers against the real emails in __fixtures__/real-emails.ts.

import { parseViagogo } from "./viagogo";
import { parseSeatix } from "./seatix";
import { classify } from "./classify";
import { parseViagogoPayment, isViagogoPayment } from "./viagogoPayment";
import { parseLa28Order, isLa28Order, parseLa28Date } from "./la28";
import { htmlToText, pickExtractSource } from "../htmlText";
import {
  SEATIX_SALE, SEATIX_SALE_TRAP, VIAGOGO_SALE, VIAGOGO_CONCERT,
  VIAGOGO_SALE_V2, VIAGOGO_SALE_V2_SUBJECT,
  VIAGOGO_SALE_V3, VIAGOGO_SALE_V3_SUBJECT,
  VIAGOGO_PAYMENT, VIAGOGO_PAYMENT_SUBJECT, asEmail,
  LA28_CRICKET, LA28_CRICKET_SUBJECT, LA28_CRICKET_HTML,
  LA28_ATHLETICS, LA28_ATHLETICS_SUBJECT,
  LA28_MULTI, LA28_MULTI_SUBJECT,
} from "./__fixtures__/real-emails";

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

console.log("\nparseSeatix() — the sender address must not be read as a seat");
const st = parseSeatix(asEmail(SEATIX_SALE_TRAP));
check("recognised", st !== null, true);
check("seats is the seat, not 'iks sales@seatiks.com'", st?.seats, "14 - 15");
check("section keeps a worded name", st?.section, "Golden Circle 2 Links");
check("seatRow", st?.seatRow, "1");
check("eventName", st?.eventName, "Bad Bunny - Most Wanted Tour");
check("venue", st?.location, "Estadio Metropolitano");
check("qty", st?.qty, 2);
check("payout", st?.sellPrice, 820);
check("faceValue", st?.faceValue, 560);

console.log("\nparseViagogo() — concert at an arena (no 'World Cup', no 'Stadium')");
const c = parseViagogo(asEmail(VIAGOGO_CONCERT));
check("recognised", c !== null, true);
check("eventName is the event, not the headline", c?.eventName, "Coldplay - Music of the Spheres Tour");
check("location", c?.location, "O2 Arena, London");
check("eventDate", c?.eventDate, "2026-08-21");
check("qty", c?.qty, 2);
check("sellPrice", c?.sellPrice, 480);

console.log("\nparseViagogo() — NEW 2026 format (Sale Info block)");
const v2email = asEmail(VIAGOGO_SALE_V2, VIAGOGO_SALE_V2_SUBJECT);
check("classifies as sale", classify(v2email), "sale");
const v2 = parseViagogo(v2email);
check("recognised", v2 !== null, true);
check("orderRef", v2?.orderRef, "649272626");
check("eventName", v2?.eventName, "Bad Bunny");
check("eventDate", v2?.eventDate, "2026-07-22");
check("location", v2?.location, "King Baudouin Stadium, Brussels, BE");
check("section", v2?.section, "3 A");
check("seatRow", v2?.seatRow, "21");
check("seats", v2?.seats, "19 - 19");
check("qty", v2?.qty, 1);
check("sellPrice", v2?.sellPrice, 219.75);

console.log("\nparseViagogo() — 'Please send your tickets' format");
const v3email = asEmail(VIAGOGO_SALE_V3, VIAGOGO_SALE_V3_SUBJECT);
check("classifies as sale", classify(v3email), "sale");
const v3 = parseViagogo(v3email);
check("recognised", v3 !== null, true);
check("orderRef", v3?.orderRef, "649481835");
check("eventName", v3?.eventName, "The Weeknd");
check("eventDate (not the ship-by date)", v3?.eventDate, "2026-07-25");
check("location", v3?.location, "San Siro");
check("section", v3?.section, "326");
check("seatRow", v3?.seatRow, "11");
check("qty", v3?.qty, 2);
check("sellPrice (Total Proceeds)", v3?.sellPrice, 123.06);

console.log("\nparseViagogoPayment()");
const payEmail = asEmail(VIAGOGO_PAYMENT, VIAGOGO_PAYMENT_SUBJECT);
check("recognised as payment", isViagogoPayment(payEmail), true);
const pay = parseViagogoPayment(payEmail);
check("reference", pay?.reference, "66726239");
check("paidOn", pay?.paidOn, "2026-07-17");
check("total", pay?.total, 4164.7);
check("item count", pay?.items.length, 3);
check("item[0] orderId", pay?.items[0].orderId, "643845545");
check("item[0] event", pay?.items[0].eventName, "Bad Bunny");
check("item[0] amount", pay?.items[0].amount, 472.9);
check("item[0] qty", pay?.items[0].qty, 2);
check("item[1] orderId", pay?.items[1].orderId, "648353121");
check("item[1] event", pay?.items[1].eventName, "Norway vs England - World Cup - Quarter-Finals (Match 99)");
check("item[1] amount", pay?.items[1].amount, 2004.12);
check("item[2] amount", pay?.items[2].amount, 1687.68);
check("a sale email is NOT a payment", isViagogoPayment(asEmail(VIAGOGO_SALE)), false);

console.log("\nparseLa28Order() — table layout (label and value on separate lines)");
const la = parseLa28Order({ subject: LA28_CRICKET_SUBJECT, body: LA28_CRICKET });
check("recognised", la !== null, true);
check("orderRef", la?.orderRef, "391532671");
check("event", la?.event, "CKT27 Cricket Men's Bronze Medal");
check("qty (8, not 16 — the service fee repeats the count)", la?.qty, 8);
check("total (order total, not the 320.00 subtotal)", la?.total, 396.88);
check("currency", la?.currency, "USD");
check("eventDate (MM.DD.YYYY → ISO)", la?.eventDate, "2028-07-28");
check("venue", la?.venue, "Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA 91768");
check("items", la?.items, 1);

console.log("\nparseLa28Order() — different sport / price / qty, inline layout");
const lb = parseLa28Order({ subject: LA28_ATHLETICS_SUBJECT, body: LA28_ATHLETICS });
check("recognised", lb !== null, true);
check("orderRef", lb?.orderRef, "402118934");
check("event", lb?.event, "ATH14 Athletics Women's 100m Final");
check("qty", lb?.qty, 2);
check("total (thousands separator)", lb?.total, 1240.5);
check("eventDate", lb?.eventDate, "2028-08-05");
check("venue", lb?.venue, "Los Angeles Memorial Coliseum, 3911 S Figueroa St, LOS ANGELES, CA 90037");

console.log("\nparseLa28Order() — one order, two events, two categories");
const lc = parseLa28Order({ subject: LA28_MULTI_SUBJECT, body: LA28_MULTI });
check("both events", lc?.event, "SWM03 Swimming Men's 200m Butterfly Final + BSK09 Basketball Women's Quarterfinal");
check("items", lc?.items, 2);
check("qty summed across categories, fees excluded", lc?.qty, 6);
check("total", lc?.total, 2013);
check("eventDate is the first item's", lc?.eventDate, "2028-07-24");

console.log("\nparseLa28Order() — the production path: real HTML → htmlToText → parser");
const lh = parseLa28Order({
  subject: LA28_CRICKET_SUBJECT,
  body: pickExtractSource("", htmlToText(LA28_CRICKET_HTML)),
});
check("recognised", lh !== null, true);
check("orderRef", lh?.orderRef, "391532671");
check("event (not the duplicate in the img alt)", lh?.event, "CKT27 Cricket Men's Bronze Medal");
check("items (alt text must not count as a second event)", lh?.items, 1);
check("qty", lh?.qty, 8);
check("total", lh?.total, 396.88);
check("currency", lh?.currency, "USD");
check("eventDate", lh?.eventDate, "2028-07-28");
check("venue (rejoined across the <br>)", lh?.venue,
  "Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA 91768");
// Both parts present is the normal MIME case; extraction must read one of them.
check("text+html both present → still 8 tickets, not 16", parseLa28Order({
  subject: LA28_CRICKET_SUBJECT,
  body: pickExtractSource(LA28_CRICKET, htmlToText(LA28_CRICKET_HTML)),
})?.qty, 8);

console.log("\nparseLa28Order() — guards");
check("order # survives an image-only body", parseLa28Order({
  subject: LA28_CRICKET_SUBJECT,
  body: "LA28 Order number: Order details Venue: TBC",
})?.orderRef, "391532671");
check("a viagogo sale is not an LA28 order", parseLa28Order({ subject: "", body: VIAGOGO_SALE }), null);
check("isLa28Order on a seatix mail → false", isLa28Order("", SEATIX_SALE), false);
// 07.09.2028 is ambiguous: Jul 9 2028 is a Sunday, Sep 7 2028 is a Thursday.
check("month-first when the weekday agrees", parseLa28Date("Sun, 07.09.2028, 09:00"), "2028-07-09");
check("weekday overrides month-first when it disagrees", parseLa28Date("Thu, 07.09.2028"), "2028-09-07");
check("no weekday → month-first (US sender)", parseLa28Date("07.09.2028"), "2028-07-09");
check("day > 12 needs no weekday", parseLa28Date("07.28.2028"), "2028-07-28");

console.log("\nCross-parser: neither parser may claim the other's email");
check("viagogo parser on seatix mail → null", parseViagogo(asEmail(SEATIX_SALE)), null);
check("seatix parser on viagogo mail → null", parseSeatix(asEmail(VIAGOGO_SALE)), null);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
