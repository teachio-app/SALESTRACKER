import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { summarise, type SummarySnapshot } from "@/lib/market/summary";
import { parseVggLink, matchByName } from "@/lib/market/vgg";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Market events for the Market page. Behind the login middleware like every
// other dashboard route — only /api/market/ingest is exempt.
//
//   GET                → every captured event with its summary, for the list
//   GET ?link=<url>    → which captured event a pasted viagogo link is about
//
// The list is summarised from each event's two latest snapshots only: enough
// for the headline numbers and "since your last look", without dragging every
// captured sale row of every event into one response. The detail route has the
// sales.
// ─────────────────────────────────────────────────────────────

const EVENT_COLS = "id,name,event_date,venue,city,country,url,vgg_event_id,tier,first_seen_at,last_captured_at";

export async function GET(req: Request) {
  const link = new URL(req.url).searchParams.get("link");
  return link != null ? resolve(link) : list();
}

async function list() {
  const db = supabaseAdmin();
  const { data: events, error } = await db
    .from("market_events").select(EVENT_COLS).order("event_date", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!events?.length) return NextResponse.json([]);

  // Newest first, so the first two seen per event are its latest two. One query
  // for all events rather than one per event: the list is the page's first
  // paint, and N round-trips is what makes a dashboard feel slow.
  const { data: snaps, error: snapErr } = await db
    .from("market_snapshots")
    .select("event_id,captured_at,total_sales,total_tickets,average_price,floor_price,sales_24h,first_sale,listings,tickets_available,currency")
    .in("event_id", events.map((e) => e.id))
    .order("captured_at", { ascending: false })
    .limit(5000);
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });

  const latestTwo = new Map<string, SummarySnapshot[]>();
  for (const s of snaps ?? []) {
    const list = latestTwo.get(s.event_id) ?? [];
    if (list.length < 2) list.push(s as SummarySnapshot);
    latestTwo.set(s.event_id, list);
  }

  const now = new Date();
  return NextResponse.json(
    events.map((e) => ({
      ...e,
      captures: latestTwo.get(e.id)?.length ?? 0,
      summary: summarise(e, latestTwo.get(e.id) ?? [], [], now),
    }))
  );
}

/**
 * A pasted link → an event id, and how confidently it was found.
 *
 * Returned as a small verdict rather than the event itself so the page can say
 * exactly what happened: found by id, found by name (check it), not captured
 * yet, or not a link it can read.
 */
async function resolve(input: string) {
  const ref = parseVggLink(input);
  if (!ref) return NextResponse.json({ result: "unreadable" });

  const db = supabaseAdmin();
  if (ref.eventId) {
    const { data, error } = await db
      .from("market_events").select("id").eq("vgg_event_id", ref.eventId).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data) return NextResponse.json({ result: "found", id: data.id, matchedBy: "id" });
  }

  const { data: all, error } = await db.from("market_events").select("id,name,event_date").limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const hit = matchByName(ref.words, all ?? [], now());
  if (hit) return NextResponse.json({ result: "found", id: hit.event.id, matchedBy: "name" });

  return NextResponse.json({ result: "not_captured", eventId: ref.eventId, url: ref.url });
}

const now = () => new Date().toISOString().slice(0, 10);
