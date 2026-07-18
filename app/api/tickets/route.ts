import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Columns the client must never write: `profit` is a generated column (Postgres
// rejects any write with 428C9, failing the whole PATCH), and the timestamps /
// key are managed by the DB. The Edit modal sends the whole row back, so strip
// these before insert/update or every edit silently fails and reverts.
const READONLY = ["profit", "id", "created_at", "updated_at"];
function clean<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out = { ...body };
  for (const k of READONLY) delete out[k];
  return out;
}

export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("tickets")
    .select("*")
    .order("event_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const db = supabaseAdmin();
  const body = await req.json();
  const { data, error } = await db.from("tickets").insert(clean(body)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const db = supabaseAdmin();
  const { id, ...patch } = await req.json();
  const { data, error } = await db.from("tickets").update(clean(patch)).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const db = supabaseAdmin();
  const { id } = await req.json();
  const { error } = await db.from("tickets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
