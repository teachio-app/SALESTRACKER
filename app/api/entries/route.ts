import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Cash entries — manual money in / money out, with or without a ticket behind it.
// Same shape as /api/tickets: service-role client, no client-side DB access.
// The login gate in middleware.ts covers this route (everything but /api/cron
// and /api/login needs the session cookie).

// The DB owns these; the edit modal sends the whole row back, so strip them or
// the update fails on a read-only column.
const READONLY = ["id", "created_at", "updated_at"];

function clean<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out = { ...body };
  for (const k of READONLY) delete out[k];

  // `amount` is stored positive and `kind` carries the sign (schema.sql). A
  // pasted "-40" must not sneak a second minus in — that would flip a cost back
  // into income on every SUM.
  if ("amount" in out) {
    const n = Number(out.amount);
    (out as Record<string, unknown>).amount = Number.isFinite(n) ? Math.abs(n) : 0;
  }
  // Anything that isn't literally 'expense' is income — the CHECK constraint
  // rejects a third value outright, so normalise rather than hand Postgres a typo.
  if ("kind" in out) {
    (out as Record<string, unknown>).kind = out.kind === "expense" ? "expense" : "income";
  }
  // "" from an empty <select> is not a uuid; Postgres would reject the insert.
  if (out.ticket_id === "") (out as Record<string, unknown>).ticket_id = null;
  return out;
}

export async function GET() {
  const db = supabaseAdmin();
  // Newest first: a ledger is read from today backwards, unlike the events table
  // (sorted by event date, which is mostly in the future).
  const { data, error } = await db
    .from("entries")
    .select("*")
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const db = supabaseAdmin();
  const body = clean(await req.json());
  // description is NOT NULL in the schema; catch it here so the user gets a
  // sentence instead of a Postgres constraint name.
  if (!String(body.description ?? "").trim()) {
    return NextResponse.json({ error: "Description is required." }, { status: 400 });
  }
  const { data, error } = await db.from("entries").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const db = supabaseAdmin();
  const { id, ...patch } = await req.json();
  const { data, error } = await db.from("entries").update(clean(patch)).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const db = supabaseAdmin();
  const { id } = await req.json();
  const { error } = await db.from("entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
