import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────
// A short login gate in front of the whole app — HTTP Basic Auth, so the
// browser shows its native username/password prompt and remembers it for the
// session. No login page, no cookies, no session store.
//
// What it protects: the dashboard (/) and the data API (/api/tickets), which
// are otherwise wide open — anyone with the URL could read and rewrite the
// inventory.
//
// What it deliberately does NOT touch: /api/cron/poll-mail. That endpoint has
// its own auth (CRON_SECRET, sent as `Authorization: Bearer …` by Vercel and by
// the external pinger). Basic Auth and Bearer both live in the Authorization
// header, so gating the cron path here would reject the pinger's Bearer token.
// The matcher below excludes it; the two auth schemes never collide.
// ─────────────────────────────────────────────────────────────

export const config = {
  // Everything except the cron endpoint and Next's static assets.
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};

// Length-independent compare so a wrong password can't be timed out char by char.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const prompt = () =>
  new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TicketDesk", charset="UTF-8"' },
  });

export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASSWORD;

  // Fail CLOSED. If the login isn't configured, deny rather than silently expose
  // the whole dashboard — the point of this gate is to keep the data private.
  if (!user || !pass) {
    return new NextResponse(
      "Login is not configured. Set APP_USER and APP_PASSWORD in the environment.",
      { status: 503 }
    );
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    // atob is Latin1 — fine for ASCII credentials. Split on the FIRST colon so a
    // password may contain colons.
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    if (safeEqual(u, user) && safeEqual(p, pass)) return NextResponse.next();
  }

  return prompt();
}
