// Run: npx tsx lib/sneakers.test.ts
// Hypeboost and StockX sale mails. The two write money in different
// conventions — "€ 202,77" and "€221.00" — which is the part worth pinning:
// read the wrong separator and a payout is out by a factor of a thousand.

import { parseHypeboost, parseStockx, parseSneakerSale, parseDashDate, parseLongDate } from "./parsers/sneakers";
import { parseAmount, currencyOf } from "./parsers/money";
import {
  HYPEBOOST_SALE, HYPEBOOST_SALE_SUBJECT, STOCKX_SALE, STOCKX_SALE_SUBJECT, asMail,
} from "./parsers/__fixtures__/sneaker-emails";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nparseAmount() — the separator is whichever comes last");
check("comma decimal, symbol first", parseAmount("€ 202,77"), 202.77);
check("dot decimal", parseAmount("€221.00"), 221);
check("negative fee reads as its size", parseAmount("-€17.68"), 17.68);
check("European thousands", parseAmount("€1.234,56"), 1234.56);
check("US thousands", parseAmount("€1,234.56"), 1234.56);
// The trap: a trailing group of three after a comma is thousands, not decimals.
check("'1,234' is a thousand, not 1.234", parseAmount("€1,234"), 1234);
check("no digits", parseAmount("Payout:"), null);
check("nothing", parseAmount(null), null);

console.log("\ncurrencyOf() — read, never assumed");
check("euro", currencyOf("€221.00"), "EUR");
check("dollar", currencyOf("548.32$"), "USD");
check("pound", currencyOf("£1,234.56"), "GBP");
check("first symbol wins", currencyOf(null, "£99", "€1"), "GBP");
// Falls back only when the mail says nothing at all.
check("nothing said → EUR", currencyOf(null, "Total Payout"), "EUR");

console.log("\ndates");
check("Hypeboost writes day-first", parseDashDate("16-06-2026"), "2026-06-16");
check("StockX writes it out", parseLongDate("September 15, 2026"), "2026-09-15");
check("a month it doesn't know", parseLongDate("Smarch 3, 2026"), null);

console.log("\nHypeboost");
const h = parseHypeboost(asMail(HYPEBOOST_SALE, HYPEBOOST_SALE_SUBJECT, "noreply@hypeboost.com"));
check("recognised", h !== null, true);
check("product", h?.product, "Nike Moon Shoe SP Jacquemus Soft Pearl (Women's)");
check("payout", h?.payout, 202.77);
check("currency", h?.currency, "EUR");
check("size", h?.size, "41");
check("sku", h?.sku, "HV8547-002");
check("order", h?.orderRef, "4062561");
check("externalId", h?.externalId, "hypeboost:4062561");
check("ship by", h?.shipBy, "2026-06-16");
// Hypeboost never states the gross, so it must not be guessed from the payout.
check("no gross stated → null, not invented", h?.salePrice, null);
check("and therefore no fee figure", h?.fees, null);

console.log("\nStockX");
const s = parseStockx(asMail(STOCKX_SALE, STOCKX_SALE_SUBJECT, "noreply@stockx.com"));
check("recognised", s !== null, true);
check("product", s?.product, "Jordan 11 Retro Gamma Blue (2025)");
check("sale price", s?.salePrice, 221);
check("payout", s?.payout, 188.69);
check("fees = gross − payout", s?.fees, 32.31);
check("currency", s?.currency, "EUR");
check("size", s?.size, "US M 8.5");
check("sku", s?.sku, "CT8012-047");
check("condition", s?.condition, "New");
check("order", s?.orderRef, "04-KS7SCGSDFT");
check("externalId", s?.externalId, "stockx:04-KS7SCGSDFT");
check("ship by", s?.shipBy, "2026-09-15");

console.log("\nneither parser may claim the other's mail, or anything else");
check("stockx parser on a hypeboost mail",
  parseStockx(asMail(HYPEBOOST_SALE, HYPEBOOST_SALE_SUBJECT, "noreply@hypeboost.com")), null);
check("hypeboost parser on a stockx mail",
  parseHypeboost(asMail(STOCKX_SALE, STOCKX_SALE_SUBJECT, "noreply@stockx.com")), null);
// Both platforms send plenty of mail that is not a sale.
check("a stockx shipping-reminder without the sale wording",
  parseSneakerSale(asMail("Your StockX order is on its way", "Shipping update", "noreply@stockx.com")), null);
check("a hypeboost newsletter",
  parseSneakerSale(asMail("Check out this week's drops at hypeboost", "New drops", "noreply@hypeboost.com")), null);
check("router picks hypeboost",
  parseSneakerSale(asMail(HYPEBOOST_SALE, HYPEBOOST_SALE_SUBJECT, "noreply@hypeboost.com"))?.platform, "hypeboost");
check("router picks stockx",
  parseSneakerSale(asMail(STOCKX_SALE, STOCKX_SALE_SUBJECT, "noreply@stockx.com"))?.platform, "stockx");

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
