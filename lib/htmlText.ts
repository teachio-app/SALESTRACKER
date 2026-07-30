// HTML → text for mail bodies. Lives apart from scanner.ts so the parsers (and
// their tests) can use it without dragging in the IMAP client.

// Block boundaries become NEWLINES, not spaces. Order confirmations are nested
// tables; collapsing every tag to a space put "Order number: 391532671 Order
// date: …" and a whole price table on one endless line, which no line-based
// extractor can read. Phrase matching is unaffected — the scanner's loose()
// collapses whitespace anyway.
const BLOCK_TAG = /<\/?(?:tr|td|th|table|thead|tbody|div|p|br|li|ul|ol|h[1-6]|hr|section|header|footer)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(times);/gi, "×")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|rsquo|lsquo|#39);/gi, "'")
    // Squeeze runs of blank lines, but keep the line structure itself.
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// Extraction must read ONE body part, never text+html concatenated: both parts
// carry the same order, and a doubled "8 × $40.00" would be read as 16 tickets.
// Pick whichever part actually looks like the order; on a tie, the longer one.
export function pickExtractSource(text: string, html: string): string {
  const score = (s: string) =>
    (/order\s*details/i.test(s) ? 2 : 0) + (/order\s*(number|total)/i.test(s) ? 1 : 0);
  const st = score(text);
  const sh = score(html);
  if (st !== sh) return st > sh ? text : html;
  return text.length >= html.length ? text : html;
}
