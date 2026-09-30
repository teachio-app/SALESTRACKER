// ─────────────────────────────────────────────────────────────
// Writing one capture of a sales-tracker page into the market tables.
//
// Kept apart from the route so the storage rules live in one place — they are
// the part worth getting right, and the route that calls this is a few lines of
// request handling.
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from "../supabase";
import { parseCapture } from "./parse";
import { parseVggLink } from "./vgg";
import type { Capture } from "./types";

export class StoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type StoreResult = {
  event: { id: string; name: string; date: string | null };
  snapshot: boolean;
  sales: { received: number; new: number; known: number };
};

/**
 * Upsert the event, add a snapshot, add any sales not seen before.
 *
 * `vggEventId` comes from the caller when it knows it — the tracker does, since
 * it built the page address from that id — and otherwise from a viagogo link
 * the page itself printed.
 */
export async function storeCapture(
  body: Capture,
  opts: { vggEventId?: string | null } = {}
): Promise<StoreResult> {
  const sourceEventId = body?.event?.sourceEventId?.trim();
  const name = body?.event?.name?.trim();
  if (!sourceEventId || !name) {
    // Without an id there is nothing to attach later captures to, and a capture
    // that can't be joined to its own history is worthless.
    throw new StoreError("event.sourceEventId and event.name are required", 400);
  }

  const parsed = parseCapture(body);
  const db = supabaseAdmin();
  const source = (body.source || "tikey").trim();
  // Written only when known. A later capture that doesn't know it must not wipe
  // an id an earlier one recorded.
  const vggEventId = opts.vggEventId ?? parseVggLink(body.event.vggUrl)?.eventId ?? null;

  // ── the event ──
  // Upsert on (source, source_event_id). `tier` is deliberately NOT written:
  // it is set by hand, and a routine refresh must not quietly demote an event
  // the owner marked as one they hold.
  const { data: event, error: eventErr } = await db
    .from("market_events")
    .upsert(
      {
        source,
        source_event_id: sourceEventId,
        url: body.event.url ?? null,
        name,
        event_date: parsed.eventDate,
        venue: body.event.venue?.trim() || null,
        city: body.event.city?.trim() || null,
        country: body.event.country?.trim() || null,
        last_captured_at: parsed.capturedAt,
        ...(vggEventId ? { vgg_event_id: vggEventId } : {}),
      },
      { onConflict: "source,source_event_id" }
    )
    .select("id")
    .single();
  if (eventErr || !event) {
    console.error("market store: event upsert failed:", eventErr);
    throw new StoreError(`event upsert failed: ${eventErr?.message ?? "no row returned"}`, 502);
  }

  // ── the snapshot ──
  // Skipped when the page was caught mid-load and carries no measure at all: a
  // row of nulls in the time series draws a collapse that never happened.
  let snapshot = false;
  if (parsed.useful) {
    const { error } = await db.from("market_snapshots").insert({
      event_id: event.id,
      captured_at: parsed.capturedAt,
      ...parsed.stats,
    });
    if (error) {
      console.error("market store: snapshot insert failed:", error);
      throw new StoreError(`snapshot insert failed: ${error.message}`, 502);
    }
    snapshot = true;
  }

  // ── the sales ──
  // ignoreDuplicates, because every refresh re-delivers the same history and
  // the point of the fingerprint is that the second delivery is free. An
  // upsert that OVERWROTE would rewrite first_seen_at on each visit and lose
  // the one thing worth knowing: when this sale was first observed.
  let inserted = 0;
  if (parsed.sales.length) {
    const rows = parsed.sales.map((s) => ({
      event_id: event.id,
      fingerprint: s.fingerprint,
      price: s.price,
      qty: s.qty,
      currency: s.currency,
      section: s.section,
      seat_row: s.seat_row,
      seats: s.seats,
      sold_at_approx: s.sold_at_approx,
      precision: s.precision,
      raw_update: s.raw_update,
    }));
    const { data, error } = await db
      .from("market_sales")
      .upsert(rows, { onConflict: "event_id,fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("market store: sales upsert failed:", error);
      throw new StoreError(`sales upsert failed: ${error.message}`, 502);
    }
    inserted = data?.length ?? 0;
  }

  return {
    event: { id: event.id, name, date: parsed.eventDate },
    snapshot,
    sales: { received: parsed.sales.length, new: inserted, known: parsed.sales.length - inserted },
  };
}
