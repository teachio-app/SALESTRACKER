// Real sale emails, pasted verbatim by the account owner (2026-07-17).
// These are the ground truth the parsers are tested against — if you change a
// regex, run `npx tsx lib/parsers/parsers.test.ts` and keep these passing.

export const SEATIX_SALE = `Sale Confirmation
Your sale has been confirmed

Event	France vs England - World Cup - Match 103 (Bronze Final)
Date	18/07/2026 17:00
Venue	Hard Rock Stadium
Quantity	1
Section	Section 122
Row	30
Seats	10
Format	External Transfer
Platform	Gigsberg
Financial Summary
Price per ticket	675.00€
Total proceeds	675.00€
Commission (0% - Level 1)	-0.00€
Payout	675.00€
Total face value	1500.00€
Profit	-825.00€
ROI	-55.0%
Thank you for using our platform!`;

export const VIAGOGO_SALE = `etr, you sold 1 ticket!
Congrats, you sold 1 ticket!

Please make sure your ticket transfer is pending out to harry.young@readylinktrading.com on the FIFA website.
If you cancelled the transfer, re-transfer to harry.young@readylinktrading.com on the FIFA website immediately.
We'll follow up to confirm successful delivery or reach out if any action is needed.

You'll typically receive payment 5-8 business days after the event. This timeline ensures there are no issues with the ticket and includes bank processing time.

England vs Argentina - World Cup - Semi Finals (Match 102)
Wednesday, July 15, 2026 - 03:00 pm

Mercedes-Benz Stadium, Atlanta

Sale #648690186

Qty
1
Section
216
Row
5
Seats
24 - 24
Payout details
Payout option	IBAN (Envoy - Euro)
Account	Wise **************89
Sale #	648690186
Sale date
Ticket qty	1
€3,691.80
Questions about your payout? Learn more`;

// Synthetic, but the same Viagogo layout with a concert at an arena instead of
// a match at a stadium. Regression guard: the old keyword regexes (/World Cup|vs/,
// /Stadium/) parsed this into eventName "Congrats, you sold 2 tickets!" + no venue.
export const VIAGOGO_CONCERT = `etr, you sold 2 tickets!
Congrats, you sold 2 tickets!

Please make sure your ticket transfer is pending out to buyer@example.com.

Coldplay - Music of the Spheres Tour
Friday, August 21, 2026 - 08:00 pm

O2 Arena, London

Sale #700123456

Qty
2
Section
B
Row
12
Seats
5 - 6
Payout details
Payout option	IBAN (Envoy - Euro)
Account	Wise **************89
Sale #	700123456
Sale date
Ticket qty	2
€480.00
Questions about your payout? Learn more`;

export function asEmail(text: string, subject = "") {
  return { from: "catchall@thevortex.beauty", subject, text, html: "", date: new Date() };
}
