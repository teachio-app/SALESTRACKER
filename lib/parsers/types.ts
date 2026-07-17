// What every platform parser must return when it recognises a sale email.
export type ParsedSale = {
  source: "viagogo" | "seatix";
  externalId: string;      // stable dedupe key, e.g. "viagogo:647501669"
  orderRef: string | null; // human-readable order number
  eventName: string;
  eventDate: string | null; // ISO date "2026-07-31"
  location: string | null;  // "Mercedes-Benz Stadium, Atlanta"
  // Seat identity stays in three fields, the way the emails state it and the
  // way the form edits it. These used to be joined into one "512 / Row 20 /
  // 335-343" string at parse time — throwing away structure the parser had
  // already recovered, which nothing downstream could get back.
  section: string | null;   // "216"
  seatRow: string | null;   // "5"
  seats: string | null;     // "24 - 24"
  qty: number;
  sellPrice: number;        // total payout for this sale, in `currency`
  currency: string;         // "EUR"
  faceValue?: number;       // face value if the email states it (Seatix does, Viagogo doesn't).
                            // Deliberately NOT a buy price — see poll-mail/route.ts.
};

export type RawEmail = {
  from: string;
  subject: string;
  text: string;   // plain-text body
  html: string;   // html body (fallback if text is empty)
  date: Date;
};

// A parser returns null if the email isn't a sale it understands.
export type Parser = (email: RawEmail) => ParsedSale | null;
