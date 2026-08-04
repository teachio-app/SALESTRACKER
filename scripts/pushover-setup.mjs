// One-time Pushover bridge setup.
//
//   node scripts/pushover-setup.mjs you@example.com "your-password" [2fa-code]
//
// Logs in as an Open Client, registers a device, and prints the two values to
// paste into Vercel. The password is used for this one call and is never
// written anywhere — not to disk, not to the database, not to an env var.
//
// CRON_SECRET is read from .env.local so there is nothing to look up by hand.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = process.env.APP_URL || "https://ticket-tracker-two.vercel.app";

const [email, password, twofa] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node scripts/pushover-setup.mjs <email> <password> [2fa-code]");
  process.exit(1);
}

let env = {};
try {
  env = Object.fromEntries(
    readFileSync(join(root, ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );
} catch {
  console.error("Could not read .env.local — run this from the ticket-tracker folder.");
  process.exit(1);
}
if (!env.CRON_SECRET) {
  console.error("CRON_SECRET is missing from .env.local.");
  process.exit(1);
}

const url =
  `${APP_URL}/api/cron/pushover-bridge?setup=1` +
  `&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}` +
  (twofa ? `&twofa=${encodeURIComponent(twofa)}` : "");

const res = await fetch(url, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
const body = await res.json().catch(() => ({}));

if (!res.ok) {
  const msg = body.error ?? JSON.stringify(body);
  console.error(`\nSetup failed (HTTP ${res.status}): ${msg}`);
  const lower = String(msg).toLowerCase();
  if (lower.includes("twofa") || lower.includes("two-factor")) {
    console.error("→ Two-factor auth is on. Re-run with the 6-digit code as a third argument.");
  } else if (lower.includes("email") || lower.includes("password") || lower.includes("credential")) {
    console.error("→ Check the email and password — they're the ones you use to log in at pushover.net.");
  } else if (res.status === 401) {
    console.error("→ The app rejected CRON_SECRET. Make sure .env.local matches the value set in Vercel.");
  }
  process.exit(1);
}

console.log(`
Done. Now open Vercel → ticket-tracker → Settings → Environment Variables
and add these three (Production), then Redeploy:

  PUSHOVER_SECRET       ${body.PUSHOVER_SECRET}
  PUSHOVER_DEVICE_ID    ${body.PUSHOVER_DEVICE_ID}
  PUSHOVER_USER_KEY     ${body.PUSHOVER_USER_KEY}

PUSHOVER_WEBHOOK_URL is optional — leave it out and the alerts go to the same
Discord webhook the sale notifications already use.

${body.note}
`);
