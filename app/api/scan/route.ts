import { NextResponse } from "next/server";
import { listFolders, scanChunk, type ScanFilter, type ScanCursor } from "@/lib/scanner";
import { notifyScan } from "@/lib/discord";

// Protected by the login middleware like /api/tickets (only /api/cron + /api/login
// are open), so only a signed-in browser can drive a scan.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  action?: string;
  filter?: ScanFilter;
  cursor?: ScanCursor;
  // notify
  url?: string;
  mentionId?: string;
  matches?: number;
  scanned?: number;
  scope?: string;
  stopped?: boolean;
  csv?: string;
  csvName?: string;
};

export async function POST(req: Request) {
  let body: Body;
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
    if (body.action === "notify") {
      const r = await notifyScan({
        url: body.url || "",
        mentionId: body.mentionId?.trim() || undefined,
        matches: body.matches ?? 0,
        scanned: body.scanned ?? 0,
        account: process.env.IMAP_USER || "", // filled server-side, not trusted from the client
        scope: body.scope,
        stopped: body.stopped,
        csv: body.csv ? { name: body.csvName || "scan.csv", content: body.csv } : undefined,
      });
      return NextResponse.json(r, { status: r.ok ? 200 : 502 });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
