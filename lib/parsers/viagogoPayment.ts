import { RawEmail } from "./types";

// ─────────────────────────────────────────────────────────────
// VIAGOGO PAYMENT ("You have just been paid") PARSER
//
// A different email from a sale confirmation: it means money has actually been
// paid out. It lists a payment reference, a total, and one row per order that
// the payout covers. We don't create a ticket from it — we fire a Discord
// notification (to a separate payout webhook) so the owner knows cash landed.
//
// Layout (tab/space separated, event name on its own line above each row):
//   Payment reference # 66726239
//   …
//   Payment ID  Order ID   Order Date            Payment    Ticket(s)
//   Bad Bunny
//   66726239    643845545  21-May-26 05:42 PM    €472.90
//   2
//   …
//   Payment:    €4,164.70
// ─────────────────────────────────────────────────────────────

export type PaymentItem = {
  orderId: string;
  eventName: string | null;
  amount: number;
  qty: number | null;
};

export type ViagogoPayment = {
  reference: string;
  paidOn: string | null; // ISO date
  total: number;
  currency: string;
  items: PaymentItem[];
};

function parseEuro(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export function isViagogoPayment(email: RawEmail): boolean {
  const hay = `${email.subject}\n${email.text || email.html || ""}`;
  return (
    /you have just been paid/i.test(hay) &&
    /payment reference\s*#\s*\d{5,}/i.test(hay) &&
    /viagogo/i.test(hay)
  );
}

// One order line: "<paymentRef> <orderId> <date …> €<amount>".
const ORDER_ROW = /^\d{5,}\s+(\d{5,})\s+.+?€\s*([\d.,]+)\s*$/;
// Lines that are chrome, never an event name.
const NOT_NAME =
  /payment reference|paid to|^hello\b|processed your payment|^depending|^if you|view payment|^payment id|^payment:|help centre|copyright|^\s*$/i;

export function parseViagogoPayment(email: RawEmail): ViagogoPayment | null {
  if (!isViagogoPayment(email)) return null;
  const body = email.text || email.html || "";

  const reference =
    body.match(/payment reference\s*#\s*(\d{5,})/i)?.[1] ??
    email.subject.match(/viagogo payment\s+(\d{5,})/i)?.[1];
  if (!reference) return null;

  // Total: the "Payment:" row (with colon) — not the "Payment" column header.
  const total = parseEuro(body.match(/Payment:\s*€\s*([\d.,]+)/i)?.[1] ?? null);
  if (total == null) return null;

  // "…on Friday, 17 July 2026" → "2026-07-17". Built from parts, not via Date(),
  // which would shift the day by the machine's timezone under toISOString().
  const dm = body.match(/processed your payment on[^0-9]*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const paidOn = dm
    ? (() => {
        const mi = MONTHS.indexOf(dm[2].toLowerCase());
        if (mi < 0) return null;
        return `${dm[3]}-${String(mi + 1).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
      })()
    : null;

  // Walk lines: remember the last plausible event-name line, attach it to the
  // order row that follows; the bare number on the next line is the qty.
  const lines = body.split("\n").map((l) => l.trim());
  const items: PaymentItem[] = [];
  let lastName: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ORDER_ROW);
    if (m) {
      const amount = parseEuro(m[2]);
      if (amount != null) {
        const qty = /^\d+$/.test(lines[i + 1] ?? "") ? parseInt(lines[i + 1], 10) : null;
        items.push({ orderId: m[1], eventName: lastName, amount, qty });
      }
    } else if (lines[i] && !NOT_NAME.test(lines[i]) && !/^\d+$/.test(lines[i])) {
      lastName = lines[i];
    }
  }

  return { reference, paidOn, total, currency: "EUR", items };
}
