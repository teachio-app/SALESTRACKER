import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Notes for work still to be done. Same shape as /api/tickets and /api/entries:
// service-role client, behind the login middleware, nothing reachable from the
// browser directly.

// `done_at` is stamped by a trigger, and the rest belong to the DB.
const READONLY = ["id", "created_at", "updated_at", "done_at"];

function clean<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out = { ...body };
  for (const k of READONLY) delete out[k];
  // "" from an empty date input is not a date; Postgres would reject it.
  if (out.due === "") (out as Record<string, unknown>).due = null;
  if (typeof out.text === "string") (out as Record<string, unknown>).text = out.text.trim();
  return out;
}

export async function GET() {
  const db = supabaseAdmin();
  // Ordering is done properly in the UI (sortTodos), where "overdue first"
  // needs today's date. This is just a stable base order.
  const { data, error } = await db
    .from("todos").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const db = supabaseAdmin();
  const body = clean(await req.json());
  if (!String(body.text ?? "").trim()) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }
  const { data, error } = await db.from("todos").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const db = supabaseAdmin();
  const { id, ...patch } = await req.json();
  const { data, error } = await db.from("todos").update(clean(patch)).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const db = supabaseAdmin();
  const { id, doneOnly } = await req.json();
  // "Clear done" sends doneOnly instead of an id — one call rather than one per
  // row, so a long finished list doesn't mean twenty round trips.
  const q = doneOnly ? db.from("todos").delete().eq("done", true) : db.from("todos").delete().eq("id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
