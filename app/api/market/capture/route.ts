import { NextResponse } from "next/server";
import { storeCapture, StoreError } from "@/lib/market/store";
import type { Capture } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ─────────────────────────────────────────────────────────────
// Store a capture the Market page just read from the sales tracker.
//
// Behind the login middleware like every dashboard route. The browser helper
// hands what it read to the Market page, and the PAGE posts it here with the
// session it already has — so the helper holds no secret and there is no
// unauthenticated write endpoint anywhere. (The route this replaced took posts
// straight from the extension and needed its own token and a CORS exemption.)
// ─────────────────────────────────────────────────────────────

const VGG_ID = /^\d{5,}$/;

export async function POST(req: Request) {
  let body: { capture?: Capture; vggEventId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (!body?.capture) return NextResponse.json({ error: "capture is required" }, { status: 400 });

  const vggEventId = body.vggEventId && VGG_ID.test(body.vggEventId) ? body.vggEventId : null;
  try {
    return NextResponse.json({ ok: true, ...(await storeCapture(body.capture, { vggEventId })) });
  } catch (e) {
    if (e instanceof StoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
