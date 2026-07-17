import { Parser, ParsedSale, RawEmail } from "./types";
import { parseViagogo } from "./viagogo";
import { parseSeatix } from "./seatix";
import { classify, MailKind } from "./classify";

const parsers: Parser[] = [parseViagogo, parseSeatix];

export type ClassifiedResult =
  | { action: "insert"; sale: ParsedSale; needsReview: false }
  | { action: "review"; sale: ParsedSale | null; needsReview: true; kind: MailKind }
  | { action: "skip"; kind: MailKind };

// Full pipeline: classify the mail, then decide what to do with it.
//  - sale       → parse; if a parser succeeds, insert. If parse fails, review.
//  - unknown    → try parsers anyway; success → review (not silent insert),
//                 failure → skip. Unknown never silently becomes a clean row.
//  - everything else (marketing, payout, transfer_pending, listing, security)
//                 → skip. Recognised noise.
export function processEmail(email: RawEmail): ClassifiedResult {
  const kind = classify(email);

  if (kind === "sale") {
    const sale = runParsers(email);
    if (sale) return { action: "insert", sale, needsReview: false };
    // Looked like a sale but no parser could read it → flag for a human.
    return { action: "review", sale: null, needsReview: true, kind };
  }

  if (kind === "unknown") {
    const sale = runParsers(email);
    if (sale) return { action: "review", sale, needsReview: true, kind };
    return { action: "skip", kind };
  }

  // Recognised non-sale mail → drop it.
  return { action: "skip", kind };
}

function runParsers(email: RawEmail): ParsedSale | null {
  for (const p of parsers) {
    const r = p(email);
    if (r) return r;
  }
  return null;
}

// Kept for the test harness / direct use.
export function parseEmail(email: RawEmail): ParsedSale | null {
  return runParsers(email);
}

export type { ParsedSale, RawEmail };
export { classify };
