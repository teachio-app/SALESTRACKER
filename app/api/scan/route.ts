import { NextResponse } from "next/server";
import { listFolders, scanChunk, type ScanFilter, type ScanCursor } from "@/lib/scanner";

// Protected by the login middleware like /api/tickets (only /api/cron + /api/login
// are open), so only a signed-in browser can drive a scan.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { action?: string; filter?: ScanFilter; cursor?: ScanCursor };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (body.action === "folders") {
      return NextResponse.json({ folders: await listFolders() });
    }
    if (body.action === "scan") {
      const chunk = await scanChunk(body.filter || {}, body.cursor ?? null);
      return NextResponse.json(chunk);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
