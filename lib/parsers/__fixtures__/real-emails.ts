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

// The same layout as SEATIX_SALE but with the two things the real mail has and
// the fixture didn't: the sender address in the body (which contains the letters
// "seat"), and a section whose name is words rather than a number.
//
// Unanchored, `/Seats?\s*\n?\s*([^\n]+)/` matched inside "sales@seatiks.com" —
// first() takes the earliest match in the whole body — and a live alert went out
// reading "Seats iks sales@seatiks.com". This fixture is why the labels are now
// line-anchored and word-bounded.
export const SEATIX_SALE_TRAP = `Sale Confirmation
From: iks sales@seatiks.com
Your sale has been confirmed

Event	Bad Bunny - Most Wanted Tour
Date	14/09/2026 20:00
Venue	Estadio Metropolitano
Quantity	2
Section	Section Golden Circle 2 Links
Row	1
Seats	14 - 15
Format	External Transfer
Platform	Gigsberg
Financial Summary
Price per ticket	410.00€
Total proceeds	820.00€
Payout	820.00€
Total face value	560.00€
Questions? Reply to iks sales@seatiks.com`;

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

// Viagogo's NEW sale format (2026-07) — real email, "Sale Info" block layout.
export const VIAGOGO_SALE_V2_SUBJECT = "You sold your ticket for Bad Bunny - Order# 649272626";
export const VIAGOGO_SALE_V2 = `viagogo
Hello Petr,
Congratulations, you've sold your tickets!

You're all set as long as all your tickets have been sent to
petulka.pech-13424297724@ticketpreupload.com already.

Payment Info
Subtotal   €219.75
Service fee - €0.00
Payment Total   €219.75
Payment option:
We'll send your payment directly to:
IBAN (Envoy - Euro): **************89

Sale Info Bad Bunny
Wednesday, July 22, 2026 | 19:00 King Baudouin Stadium, Brussels, BE OrderID # 649272626
1 Ticket(s)
Section: 3 A Row 21 | Seat(s) 19 - 19

Copyright © 2026 viagogo. All rights reserved`;

// Viagogo "Please send your tickets" — a transfer reminder that carries the
// full sale (real email, 2026-07).
export const VIAGOGO_SALE_V3_SUBJECT = "Please send your tickets 649481835";
// Hard-wrapped exactly like the real plain-text part — labels split across line
// breaks ("Total\nProceeds", "Section\n326", "San Siro Date:"). This is the shape
// that broke the first attempt, so keep it wrapped.
export const VIAGOGO_SALE_V3 = `Petr: Thank you for confirming your sale of The Weeknd tickets.
We expect you to transfer your tickets via Mobile Transfer as soon as possible.
Failure to transfer tickets by Saturday, 25 July 2026 15:15 (W. Europe Standard
Time) may result in cancellation. Order
Order ID: 649481835 Delivery Method: Mobile Ticket Transfer Ticket(s): Section
326, Row 11, (2 Ticket(s)) Event: The Weeknd Listing Note(s): Under 16s
accompanied by an adult, Limited or Obstructed View (printed on ticket) Venue:
San Siro Date: Saturday, July 25, 2026 | 19:15 Must Ship by Date: Saturday, July
25, 2026 | 13:15 UTC
Ticket Holder # 1 Full Name: Ines Ali Date of Birth: 1997-09-20
Number of Tickets: 2 Price per Ticket: €61.53 Shipping Refund: €0.00 Total
Proceeds: €123.06
Copyright © 2026 viagogo. All rights reserved`;

// A viagogo payout email — money actually paid, covering several orders.
export const VIAGOGO_PAYMENT_SUBJECT = "viagogo payment 66726239 - You have just been paid";
export const VIAGOGO_PAYMENT = `Hello Petr,

We processed your payment on Friday, 17 July 2026.

View Payment Info

Payment reference # 66726239
Paid to: IBAN (Envoy - Euro): **************89

Depending on your payment provider, it may take up to 8 business days for the funds to appear in your account.

If you selected PayPal as your payment method, you'll need to log in to your PayPal account to accept the payment.

Payment ID	Order ID	Order Date	Payment	Ticket(s)
Bad Bunny
66726239	643845545	21-May-26 05:42 PM	€472.90
2
Norway vs England - World Cup - Quarter-Finals (Match 99)
66726239	648353121	11-Jul-26 02:22 AM	€2,004.12
1
Norway vs England - World Cup - Quarter-Finals (Match 99)
66726239	648390697	11-Jul-26 04:32 PM	€1,687.68
1
Payment:	€4,164.70
If you see a charge listed and believe it's incorrect, submit a dispute.

Copyright © 2026 viagogo. All rights reserved`;


// ── Delivery confirmation, NOT a sale ─────────────────────────────────
// Arrives after the tickets are handed over, and carries the same three marks
// the 2026 sale format is recognised by — "Sale Info", "Payment Total",
// "OrderID #" — which is exactly why it used to classify as a sale and try to
// insert the order a second time. Pasted from the real mail (order 652748632).
export const VIAGOGO_DELIVERED_SUBJECT =
  "Your tickets were delivered for order# 652748632 - US Open Tennis: Day Grounds Pass";
export const VIAGOGO_DELIVERED = `viagogo
Sports Concerts Theatre

Petr:
Thank you for delivering the tickets for order 652748632.
When will you get paid?

You'll be paid 5 to 8 business days after the event takes place to make sure the buyer had no problems with the tickets.
You will be notified by email when your payment has been processed.
Payment Info

Subtotal	  €615.30
Service fee	- €0.00
Payment Total	  €615.30

Payment option:
We'll send your payment directly to:
IBAN (Envoy - Euro): **************89

Sale Info
US Open Tennis: Day Grounds Pass
Saturday, September 05, 2026 | 10:55
USTA Billie Jean King National Tennis Center - Complex, Flushing, US
OrderID # 652748632
2 Ticket(s)
Section: Grounds Pass
Row | Seat(s) -

Copyright © 2026 viagogo. All rights reserved`;

export function asEmail(text: string, subject = "") {
  return { from: "catchall@thevortex.beauty", subject, text, html: "", date: new Date() };
}

// ── LA28 order confirmations (purchases, read by the Scanner) ──────────
// There are ~50 of these in the mailbox and every one is a different sport,
// price and ticket count, so the fixtures below deliberately vary all three.
// Nothing about a sport, an amount or a quantity may be hard-coded in la28.ts —
// these exist to prove that.
//
// LA28_CRICKET is the real mail, flattened the way scanner.ts's htmlToText()
// renders its nested tables: every table cell on its own line, so a label and
// its value end up on CONSECUTIVE lines.
export const LA28_CRICKET_SUBJECT = "LA28 - Olympic Tickets Order Confirmation - 391532671";
export const LA28_CRICKET = `LA28
Thank you for your purchase. It's official—your ticket order for the LA28 Olympic Games is confirmed.
We'll send you detailed instructions on how to access your tickets digitally as we get closer to the Games.
YOUR ORDER
Order number:
391532671
Billing address:
Pablo Beatty
Postmaster
Orland Indiana 46776-9564
United States of America
Order date:
07.29.2026
Order total:
$396.88
Ticket delivery method:
Digital
Payment method:
VISA
ORDER DETAILS
CKT27 Cricket Men's Bronze Medal
Date:
Fri, 07.28.2028, 09:00 Local Time (24-hour)
Venue:
Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA 91768
Category D, Standard
8 × $40.00
$320.00
Service fee
8 × $9.61
$76.88
Subtotal
$396.88
TOTAL
Digital delivery fee
$0.00
Total
$396.88`;

// The same order as HTML, laid out the way the real mail is: nested tables, the
// label and its value in SEPARATE cells, the event title also sitting in an
// <img alt>, and "×" as the &times; entity. This is the fixture that proves the
// production path works — htmlToText() feeds the parser, not hand-written text.
export const LA28_CRICKET_HTML = `<html><body>
<table><tr><td><img src="cid:logo" alt="LA28"></td></tr>
<tr><td><p>Thank you for your purchase. It's official&mdash;your ticket order for the LA28 Olympic Games is confirmed.</p></td></tr></table>
<h3>YOUR ORDER</h3>
<table>
  <tr>
    <td><span>Order number:</span><br><strong>391532671</strong></td>
    <td><span>Billing address:</span><br><strong>Pablo Beatty<br>Postmaster<br>Orland Indiana 46776-9564</strong></td>
  </tr>
  <tr><td><span>Order date:</span><br><strong>07.29.2026</strong></td></tr>
  <tr><td><span>Order total:</span><br><strong>$396.88</strong></td></tr>
  <tr><td><span>Ticket delivery method:</span><br><strong>Digital</strong></td></tr>
  <tr><td><span>Payment method:</span><br><strong>VISA</strong></td></tr>
</table>
<h3>ORDER DETAILS</h3>
<table>
  <tr>
    <td><img src="cid:evt" alt="CKT27 Cricket Men&apos;s Bronze Medal"></td>
    <td>
      <div><strong>CKT27 Cricket Men&apos;s Bronze Medal</strong></div>
      <table>
        <tr><td>Date:</td><td>Fri, 07.28.2028, 09:00 Local Time (24-hour)</td></tr>
        <tr><td>Venue:</td><td>Fairgrounds Cricket Stadium, 1101 W McKinley Ave,<br>POMONA, CA 91768</td></tr>
      </table>
    </td>
  </tr>
  <tr><td>Category D, Standard</td><td>8 &times; $40.00</td><td>$320.00</td></tr>
  <tr><td>Service fee</td><td>8 &times; $9.61</td><td>$76.88</td></tr>
  <tr><td><strong>Subtotal</strong></td><td></td><td><strong>$396.88</strong></td></tr>
</table>
<h3>TOTAL</h3>
<table>
  <tr><td>Digital delivery fee</td><td>$0.00</td></tr>
  <tr><td><strong>Total</strong></td><td><strong>$396.88</strong></td></tr>
</table>
</body></html>`;

// A different sport, price and quantity — and the plain-text variant, where each
// label sits on the SAME line as its value. Both layouts must parse.
export const LA28_ATHLETICS_SUBJECT = "LA28 - Olympic Tickets Order Confirmation - 402118934";
export const LA28_ATHLETICS = `LA28
Thank you for your purchase.
YOUR ORDER
Order number: 402118934
Order date: 08.03.2026
Order total: $1,240.50
Payment method: VISA
ORDER DETAILS
ATH14 Athletics Women's 100m Final
Date: Sat, 08.05.2028, 19:30 Local Time (24-hour)
Venue: Los Angeles Memorial Coliseum, 3911 S Figueroa St, LOS ANGELES, CA 90037
Category A, Standard   2 × $575.00   $1,150.00
Service fee            2 × $45.25    $90.50
Subtotal                             $1,240.50
TOTAL
Total   $1,240.50`;

// One order, two events and two price categories: qty must be 6 (4 + 2), not 12
// — the service-fee lines repeat the same counts.
export const LA28_MULTI_SUBJECT = "LA28 - Olympic Tickets Order Confirmation - 415900277";
export const LA28_MULTI = `LA28
YOUR ORDER
Order number:
415900277
Order date:
08.11.2026
Order total:
$2,013.00
ORDER DETAILS
SWM03 Swimming Men's 200m Butterfly Final
Date:
Mon, 07.24.2028, 10:15 Local Time (24-hour)
Venue:
SoFi Stadium, 1001 Stadium Dr, INGLEWOOD, CA 90301
Category B, Standard
4 × $310.00
$1,240.00
Service fee
4 × $28.00
$112.00
Subtotal
$1,352.00
BSK09 Basketball Women's Quarterfinal
Date:
Tue, 07.25.2028, 21:00 Local Time (24-hour)
Venue:
Intuit Dome, 3930 W Century Blvd, INGLEWOOD, CA 90303
Category C, Standard
2 × $300.00
$600.00
Service fee
2 × $30.50
$61.00
Subtotal
$661.00
TOTAL
Digital delivery fee
$0.00
Total
$2,013.00`;
