// Real sale emails from the sneaker side, pasted by the account owner
// (2026-09-23). Only these two kinds are sales — both platforms send plenty of
// other mail, which is why the parsers check for the sale wording and not just
// the sender.

export const HYPEBOOST_SALE_SUBJECT =
  "Congratulations! Your item has been sold: Nike Moon Shoe SP Jacquemus Soft Pearl (Women's)";
export const HYPEBOOST_SALE = `HypeBoost B.V.
Your item is sold!

Dear Petr,

Congratulations, your item is sold!

Ship by: 16-06-2026

Put the original box in a shipping box. Note: only original packaging!
Stick the printed label on the shipping box.

Now what?

Step 1: Ship the package with FEDEX no later than 16-06-2026.
Step 2: The item arrives at our shop and is checked and authenticated.
Step 3: We send the item to the buyer.
Step 4: We pay you!

Nike Moon Shoe SP Jacquemus Soft Pearl (Women's)
Size: 41
SKU: HV8547-002
Advertisement number: 4062561
Payout: € 202,77

Print your shipping label`;

export const STOCKX_SALE_SUBJECT = "✅ You Sold Your Jordan 11 Retro Gamma Blue (2025)";
export const STOCKX_SALE = `StockX
Time to Ship Your Item
Jordan 11 Retro Gamma Blue (2025)
Ship by
September 15, 2026
Print Shipping Label
Jordan 11 Retro Gamma Blue (2025)
Jordan 11 Retro Gamma Blue (2025)
CT8012-047 Size: US M 8.5 New
Order number: 04-KS7SCGSDFT
Sale Price:	€221.00
Transaction Fee (8.0%):	-€17.68
Payment Proc. (3%):	-€6.63
Shipping:	-€8.00
Total Payout	€188.69
View Order
Congrats on your sale!
Ship your item by September 15, 2026 to avoid penalties.`;

export function asMail(text: string, subject = "", from = "") {
  return { from, subject, text, html: "" };
}
