// Shared auth token used by the login route (Node) and the middleware (Edge).
// Both runtimes have Web Crypto (`crypto.subtle`) and neither has `Buffer`, so
// the token is HMAC-SHA256 hex — no Node-only APIs.
//
// The cookie value is HMAC(password, constant). Computing it needs APP_PASSWORD,
// which lives only on the server, so the cookie can't be forged; and it's tied
// to the password, so changing the password invalidates every existing session.

export const AUTH_COOKIE = "td_auth";

const enc = new TextEncoder();

export async function authToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("ticketdesk-authed-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent compare so a token can't be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
