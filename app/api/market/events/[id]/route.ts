import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { summarise, type SummarySale, type SummarySnapshot } from "@/lib/market/summary";

export const dynamic = "force-dynamic";

// One event in full: its whole snapshot history (the time series the chart is
// drawn from), its captured sales, and a summary computed over all of it.
// Behind the login middleware.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // Checked up front: a malformed id would otherwise reach Postgres and come
  // back as a 500 about uuid syntax instead of a plain "not found".
  if (!UUID.test(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = supabaseAdmin();
  const { data: event, error } = await db
    .from("market_events")
    .select("id,name,event_date,venue,city,country,url,vgg_event_id,tier,first_seen_at,last_captured_at")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [snaps, sales] = await Promise.all([
    db.from("market_snapshots")
      .select("captured_at,total_sales,total_tickets,average_price,floor_price,sales_24h,first_sale,listings,tickets_available,currency")
      .eq("event_id", event.id)
      .order("captured_at", { ascending: true })
      .limit(1000),
    db.from("market_sales")
      .select("price,qty,currency,section,seat_row,seats,sold_at_approx,precision,first_seen_at")
      .eq("event_id", event.id)
      .order("sold_at_approx", { ascending: false, nullsFirst: false })
      .limit(3000),
  ]);
  if (snaps.error) return NextResponse.json({ error: snaps.error.message }, { status: 500 });
  if (sales.error) return NextResponse.json({ error: sales.error.message }, { status: 500 });

  const snapshots = (snaps.data ?? []) as SummarySnapshot[];
  const saleRows = (sales.data ?? []) as (SummarySale & Record<string, unknown>)[];

  return NextResponse.json({
    event,
    snapshots,
    sales: saleRows,
    summary: summarise(event, snapshots, saleRows, new Date()),
  });
}
