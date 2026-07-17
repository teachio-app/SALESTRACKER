import { NextResponse } from "next/server";
import { fetchNewEmails } from "@/lib/mail";
import { processEmail } from "@/lib/parsers";
import { supabaseAdmin } from "@/lib/supabase";
import { notifyDiscord } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { emails, commit, info } = await fetchNewEmails();
  const db = supabaseAdmin();

  const stats = { processed: emails.length, inserted: 0, duplicate: 0, review: 0, skipped: 0, info };
  let failed = false;

  for (const email of emails) {
    const result = processEmail(email);

    if (result.action === "skip") {
      stats.skipped++;
      continue;
    }

    // Both "insert" and "review" write a row; review rows carry a flag and,
    // when the parser couldn't read the mail at all, a minimal placeholder.
    const needsReview = result.action === "review";
    const sale = result.sale;

    if (!sale) {
      // Looked like a sale but unreadable — store a stub for manual fixup.
      await db.from("tickets").insert({
        event_name: email.subject || "(unparsed sale email)",
        status: "not_listed",
        source: "unknown",
        needs_review: true,
        external_id: `review:${hashSubject(email)}`,
      });
      stats.review++;
      continue;
    }

    // The poller owns the SELL side only — buy_price is left at the column
    // default (0) for the owner to enter by hand.
    //
    // Seatix does print a "Total face value", and an earlier version wrote it
    // straight into buy_price. That's wrong: face value is what's printed on the
    // ticket, not what we paid for it — buying under or over face is the whole
    // trade. `sale.faceValue` is still parsed, but deliberately unused here.
    // Plain insert, not upsert-with-onConflict. `tickets_external_id_uniq` is a
    // PARTIAL index (`where external_id is not null`), and Postgres will not
    // accept a partial index as an ON CONFLICT target unless the statement
    // repeats its predicate — which PostgREST's upsert never emits. So every
    // insert died on 42P10 and the poller could not store a single sale.
    //
    // The index itself is right: it enforces uniqueness and skips the nulls that
    // manual rows carry. A duplicate simply raises 23505, which is the outcome
    // we wanted from ignoreDuplicates anyway — a re-read sale is not an error.
    const { error } = await db.from("tickets").insert(
      {
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
        needs_review: needsReview,
        sold_at: email.date.toISOString(),
      }
    );

    // 23505 = unique violation: we've already stored this sale. Expected on any
    // re-read, and not a failure — it must not hold the watermark.
    if (error && error.code === "23505") {
      stats.duplicate++;
      continue;
    }
    if (error) {
      console.error("Insert failed:", error);
      failed = true;
      continue;
    }

    if (needsReview) stats.review++;
    else {
      stats.inserted++;
      await notifyDiscord(sale);
    }
  }

  // Advance the watermark only on a clean run. If anything failed to store, we
  // re-read the same range next time and let external_id swallow the repeats —
  // at-least-once, because losing a sale is worse than parsing one twice.
  if (!failed) await commit();
  else console.warn("Insert failures this run — watermark held; the batch will be retried.");

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
