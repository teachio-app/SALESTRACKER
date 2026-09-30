import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, safeEqual } from "@/lib/auth";

// ─────────────────────────────────────────────────────────────
// Login gate — cookie-based, not HTTP Basic Auth.
//
// Basic Auth caused Chrome to loop with ERR_TOO_MANY_RETRIES: once the browser
// cached a wrong password it kept retrying the 401 challenge instead of
// re-prompting, and eventually gave up. A cookie + login page has none of that —
// unauthenticated requests get a normal redirect to /login, never a 401 auth
// challenge the browser retries.
//
// Protects the dashboard and /api/tickets. Skips /api/cron/poll-mail (its own
// CRON_SECRET Bearer auth) and /login + /api/login (must be reachable logged-out).
//
// /api/market/ingest — and ONLY that route — is skipped for the same reason as
// /api/cron: it carries its own Bearer token and is called by the browser
// extension, which has no session cookie. It also needs its CORS preflight to
// get through: an OPTIONS request never carries credentials, so a matched
// preflight would 401 and the capture would fail before the POST was sent.
//
// It used to skip the whole /api/market prefix. That was harmless while ingest
// was the only route there, and a data leak the moment the Market page's own
// API was added beside it — every captured event readable without a login. The
// exclusion is now exact, so anything new under /api/market is gated by default.
// ─────────────────────────────────────────────────────────────

export const config = {
  // Also skip the app icon so the browser-tab favicon loads without a session
  // (otherwise /icon.svg redirects to /login and the tab shows no icon).
  matcher: ["/((?!api/cron|api/market/ingest|_next|favicon.ico|icon.svg).*)"],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The login screen and its submit endpoint are always open.
  if (pathname === "/login" || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  const pass = process.env.APP_PASSWORD;
  // Fail closed: no password configured → serve nothing rather than expose data.
  if (!pass) {
    return new NextResponse("Login is not configured. Set APP_PASSWORD.", { status: 503 });
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await authToken(pass))) {
    return NextResponse.next();
  }

  // Not logged in. API calls get a clean 401; page loads go to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}
