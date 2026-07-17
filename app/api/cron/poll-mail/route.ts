import { NextResponse } from "next/server";
import { fetchNewEmails } from "@/lib/mail";
import { processEmail, type ParsedSale } from "@/lib/parsers";
import { isViagogoPayment, parseViagogoPayment } from "@/lib/parsers/viagogoPayment";
import { supabaseAdmin, saleTotals, type SaleFill, type Ticket } from "@/lib/supabase";
import { notifyDiscord, notifyPayment } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Db = ReturnType<typeof supabaseAdmin>;

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-");

const seatKey = (r: { section: string | null; seat_row: string | null; seats: string | null }) =>
  `${norm(r.section)}|${norm(r.seat_row)}|${norm(r.seats)}`;

type MatchResult =
  | { kind: "duplicate" }
  | { kind: "match"; row: Ticket }
  | { kind: "none" };

/**
 * Link a sale to the purchase it belongs to by SEAT + event date — the event
 * name is ignored (the owner names events in slang, and platforms name them
 * differently). Matches only when the seat identity is exact and unambiguous;
 * anything else falls through to the review queue for manual linking.
 */
async function findMatch(db: Db, sale: ParsedSale): Promise<MatchResult> {
  // Already processed (inserted or matched before)? external_id is unique.
  const { data: dup } = await db
    .from("tickets").select("id").eq("external_id", sale.externalId).maybeSingle();
  if (dup) return { kind: "duplicate" };

  const key = `${norm(sale.section)}|${norm(sale.seatRow)}|${norm(sale.seats)}`;
  const hasSeat = norm(sale.section) !== "" || norm(sale.seats) !== "";
  if (!hasSeat || !sale.eventDate) return { kind: "none" }; // GA / no date → review

  const { data: cands } = await db
    .from("tickets").select("*").eq("event_date", sale.eventDate).neq("status", "sold");
  const matches = ((cands ?? []) as Ticket[]).filter(
    (r) => r.qty_sold < r.qty_total && seatKey(r) === key && (norm(r.section) !== "" || norm(r.seats) !== "")
  );
  return matches.length === 1 ? { kind: "match", row: matches[0] } : { kind: "none" };
}

/** Build the fill for a parsed sale. */
function fillFrom(sale: ParsedSale, at: string): SaleFill {
  return { qty: sale.qty, amount: sale.sellPrice, at, ext: sale.externalId, source: sale.source };
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { emails, commit, info } = await fetchNewEmails();
  const db = supabaseAdmin();
  const stats = { processed: emails.length, matched: 0, review: 0, duplicate: 0, paid: 0, skipped: 0, info };
  let failed = false;

  for (const email of emails) {
    // Viagogo payout email → notify only, no ticket row.
    if (isViagogoPayment(email)) {
      const payment = parseViagogoPayment(email);
      if (payment) { await notifyPayment(payment); stats.paid++; } else stats.skipped++;
      continue;
    }

    const result = processEmail(email);
    if (result.action === "skip") { stats.skipped++; continue; }
    const sale = result.sale;

    if (!sale) {
      // Looked like a sale but unreadable — store a stub for manual fixup.
      await db.from("tickets").insert({
        event_name: email.subject || "(unparsed sale email)",
        status: "not_listed", source: "unknown", needs_review: true,
        external_id: `review:${hashSubject(email)}`,
      });
      stats.review++;
      continue;
    }

    const m = await findMatch(db, sale);
    if (m.kind === "duplicate") { stats.duplicate++; continue; }

    const at = email.date.toISOString().slice(0, 10);

    if (m.kind === "match") {
      // APPEND this sale as a fill onto the purchase — so a batch selling in
      // parts accumulates instead of overwriting. Per-fill ext dedups reprocesses.
      const existing: SaleFill[] = Array.isArray(m.row.sales) ? m.row.sales : [];
      if (existing.some((f) => f.ext === sale.externalId)) { stats.duplicate++; continue; }
      const fills = [...existing, fillFrom(sale, at)];
      const t = saleTotals(fills);
      const { error } = await db.from("tickets").update({
        sales: fills,
        qty_sold: Math.min(m.row.qty_total, t.qty),
        sell_price: t.amount,
        status: "sold",
        currency: sale.currency,
        sold_at: email.date.toISOString(),
        order_ref: sale.orderRef ?? m.row.order_ref,
        external_id: m.row.external_id ?? sale.externalId, // stamp once for dedup
      }).eq("id", m.row.id);
      if (error) { console.error("Match update failed:", error); failed = true; continue; }
      stats.matched++;
      await notifyDiscord(sale);
      continue;
    }

    // No confident match → record the sale but flag it so it lands in the
    // review queue, where it can be linked to a purchase by hand.
    const { error } = await db.from("tickets").insert({
      event_name: sale.eventName,
      event_date: sale.eventDate,
      location: sale.location,
      section: sale.section,
      seat_row: sale.seatRow,
      seats: sale.seats,
      qty_total: sale.qty,
      qty_sold: sale.qty,
      status: "sold",
      sell_price: sale.sellPrice,
      currency: sale.currency,
      order_ref: sale.orderRef,
      source: sale.source,
      external_id: sale.externalId,
      needs_review: true,
      sold_at: email.date.toISOString(),
      sales: [fillFrom(sale, at)],
    });
    if (error && error.code === "23505") { stats.duplicate++; continue; }
    if (error) { console.error("Insert failed:", error); failed = true; continue; }
    stats.review++;
    await notifyDiscord(sale);
  }

  // Advance the watermark only on a clean run; otherwise re-read next time and
  // let external_id / the sold-status guard swallow the repeats.
  if (!failed) await commit();
  else console.warn("Failures this run — watermark held; the batch will be retried.");

  return NextResponse.json({ ...stats, committed: !failed });
}

function hashSubject(email: { subject: string; date: Date }): string {
  const s = `${email.subject}|${email.date.toISOString().slice(0, 10)}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
