import { NextResponse } from "next/server";
import { parseCapture } from "@/lib/market/parse";
import { parseVggLink } from "@/lib/market/vgg";
import type { Capture } from "@/lib/market/types";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────
// MARKET INGEST — where the browser extension posts what it saw.
//
// Called from a page on someone else's origin, so unlike every other route here
// it needs CORS and it needs its own credential.
//
// ITS OWN TOKEN, NOT CRON_SECRET. This one lives in a browser extension, which
// is about the least private place a secret can live: anyone with the machine
// can read it out of extension storage. CRON_SECRET opens the mail poller, so
// the two must never be the same string — a token that leaks here should cost a
// polluted market table and nothing else.
//
// The route is deliberately thin: everything that could be got wrong lives in
// lib/market/parse.ts, where it is tested against fixtures copied off the real
// page. This file does storage and nothing else.
// ─────────────────────────────────────────────────────────────

/**
 * The extension runs inside the tracked site's page, so the POST is
 * cross-origin. Without these headers the browser blocks the response and the
 * capture fails silently — which, for a tool whose whole job is to accumulate
 * history in the background, would be indistinguishable from working.
 *
 * The origin is echoed rather than fixed: the site can be served from more than
 * one host, and a wildcard is wrong for something that takes a bearer token.
 */
function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get("origin"));

  const token = process.env.MARKET_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "MARKET_INGEST_TOKEN is not set — ingest is disabled." },
      { status: 503, headers }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  let body: Capture;
  try {
    body = (await req.json()) as Capture;
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400, headers });
  }

  const sourceEventId = body?.event?.sourceEventId?.trim();
  const name = body?.event?.name?.trim();
  if (!sourceEventId || !name) {
    // Without an id there is nothing to attach later captures to, and a capture
    // that can't be joined to its own history is worthless.
    return NextResponse.json(
      { error: "event.sourceEventId and event.name are required" },
      { status: 400, headers }
    );
  }

  const parsed = parseCapture(body);
  const db = supabaseAdmin();
  const source = (body.source || "tikey").trim();
  // Written only when this capture actually saw the link. A later capture whose
  // page rendered without it must not wipe an id an earlier one recorded.
  const vggEventId = parseVggLink(body.event.vggUrl)?.eventId ?? null;

  // ── the event ──
  // Upsert on (source, source_event_id). `tier` is deliberately NOT written:
  // it is set by hand, and a capture arriving from a routine page view must not
  // quietly demote an event the owner marked as one they hold.
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
    console.error("market ingest: event upsert failed:", eventErr);
    return NextResponse.json(
      { error: `event upsert failed: ${eventErr?.message ?? "no row returned"}` },
      { status: 502, headers }
    );
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
      console.error("market ingest: snapshot insert failed:", error);
      return NextResponse.json({ error: `snapshot insert failed: ${error.message}` }, { status: 502, headers });
    }
    snapshot = true;
  }

  // ── the sales ──
  // ignoreDuplicates, because every revisit re-delivers the same history and
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
      console.error("market ingest: sales upsert failed:", error);
      return NextResponse.json({ error: `sales upsert failed: ${error.message}` }, { status: 502, headers });
    }
    inserted = data?.length ?? 0;
  }

  return NextResponse.json(
    {
      ok: true,
      event: { id: event.id, name, date: parsed.eventDate },
      snapshot,
      sales: { received: parsed.sales.length, new: inserted, known: parsed.sales.length - inserted },
      stats: parsed.stats,
    },
    { headers }
  );
}
