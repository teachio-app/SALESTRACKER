// Run: npx tsx lib/market/analysis.test.ts
//
// The analysis call can't be exercised here without an API key, so what CAN be
// checked is checked: the output schema follows every rule structured outputs
// enforce (a violation would only surface as a 400 on the live call), the
// prompts carry what the model needs, and out-of-range model output is tamed
// before the page draws it.

import { ANALYSIS_SCHEMA, ANALYST_SYSTEM, analysisPrompt, clampAnalysis, researchPrompt, type Analysis } from "./analysis";
import { computeFeatures } from "./features";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

console.log("\nthe schema obeys structured-output rules");
{
  const problems: string[] = [];
  const UNSUPPORTED = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    for (const k of UNSUPPORTED) if (k in n) problems.push(`${path}: unsupported "${k}"`);
    if (n.type === "object") {
      if (n.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
      const props = Object.keys((n.properties as object) ?? {});
      const req = (n.required as string[]) ?? [];
      for (const p of props) if (!req.includes(p)) problems.push(`${path}.${p}: not in required`);
      for (const r of req) if (!props.includes(r)) problems.push(`${path}: required "${r}" has no property`);
      for (const [k, v] of Object.entries((n.properties as object) ?? {})) walk(v, `${path}.${k}`);
    }
    if (n.type === "array") {
      if (!n.items) problems.push(`${path}: array without items`);
      walk(n.items, `${path}[]`);
    }
  };
  walk(ANALYSIS_SCHEMA, "$");
  check("no rule violations", problems, []);
  check("verdict is an enum of five", (ANALYSIS_SCHEMA.properties.verdict.enum as readonly string[]).length, 5);
  check("price direction up / flat / down", [...ANALYSIS_SCHEMA.properties.price_outlook.properties.direction.enum], ["up", "flat", "down"]);
}

console.log("\nprompts");
{
  const event = { name: "Celine Dion", date: "2026-09-30", venue: "Paris La Defense Arena", city: "Nanterre", country: "France", vggEventId: "160790810" };
  const r = researchPrompt(event);
  check("research names the event", r.includes("Celine Dion") && r.includes("Paris La Defense Arena, Nanterre, France"), true);
  check("research asks about the tour selling out", /selling out/i.test(r), true);
  check("research asks about primary sales", /primary market/i.test(r), true);

  const stats = { total_sales: 1321, total_tickets: 2697, average_price: 476.93, floor_price: 2.42, sales_24h: 73, first_sale: "2026-04-07", listings: 103, tickets_available: 276, currency: "EUR" };
  const features = computeFeatures({ stats, eventDate: "2026-09-30", capturedAt: "2026-09-30T12:00:00.000Z", sales: null, screenSales: [], daily: null, listings: null });
  const a = analysisPrompt({ event, stats, features, recentSales: [] }, { notes: "- Tour sold out in Paris (2026-05)", sources: [], searches: [] });
  check("analysis carries the tiles", a.includes('"total_sales":1321'), true);
  check("…and the features", a.includes('"coverage"'), true);
  check("…and the research notes", a.includes("Tour sold out in Paris"), true);
  const noResearch = analysisPrompt({ event, stats, features, recentSales: [] }, null);
  check("without research it says so", /no web research/i.test(noResearch), true);
  check("the analyst writes in Czech", /Write all prose in Czech/.test(ANALYST_SYSTEM), true);
  check("the analyst is told not to invent numbers", /never invent a number/i.test(ANALYST_SYSTEM), true);
  check("…and that a floor can be junk", /junk/i.test(ANALYST_SYSTEM), true);
}

console.log("\nmodel output is tamed");
{
  const wild: Analysis = {
    verdict: "thriving", verdict_label: "Hoří", heat_score: 140, headline: "h", summary: "s",
    price_outlook: { direction: "up", confidence: "high", expected_move: "+20 %", horizon: "do eventu", reasoning: "r" },
    scores: { demand: 14, supply: -3, price_momentum: 7.6, timing: 5, context: NaN as unknown as number },
    pillars: {
      demand: { assessment: "", evidence: [] }, supply: { assessment: "", evidence: [] }, pricing: { assessment: "", evidence: [] },
      timing: { assessment: "", evidence: [] }, context: { assessment: "", evidence: [] },
    },
    key_numbers: Array.from({ length: 10 }, (_, i) => ({ label: `k${i}`, value: "1", why: "" })),
    sections: [], risks: Array.from({ length: 12 }, () => "r"), opportunities: [], watch: [], data_caveats: [],
  };
  const c = clampAnalysis(wild);
  check("heat score clamped to 100", c.heat_score, 100);
  check("scores clamped to 0–10 and rounded", c.scores, { demand: 10, supply: 0, price_momentum: 8, timing: 5, context: 0 });
  check("key numbers capped at 6", c.key_numbers.length, 6);
  check("risks capped at 6", c.risks.length, 6);
}

console.log(failed === 0 ? "\nAll analysis tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
