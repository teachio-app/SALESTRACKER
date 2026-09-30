// ─────────────────────────────────────────────────────────────
// AI market analysis — the contract between the Market page and the model.
//
// Two steps, because the two jobs want different tools:
//   1. RESEARCH, with web search: what the numbers can't show — how big the act
//      is right now, whether the tour is selling out, the venue's size, primary
//      releases, news. Plain text, because web search answers come with
//      citations and citations can't be combined with a JSON schema.
//   2. ANALYSIS, with a strict JSON schema: the verdict, grounded in the
//      computed features (lib/market/features.ts) and the research notes. No
//      tools; the schema guarantees the page can render what comes back.
//
// The model is given measurements, not raw rows, and told to ground every
// claim in them, so what it says can be checked against the table the page
// shows under the verdict.
// ─────────────────────────────────────────────────────────────

import type { Features } from "./features";
import type { ParsedStats } from "./types";

export const MODEL = "claude-opus-5";

/** The language the analysis is written in. The page UI stays English. */
export const ANALYSIS_LANGUAGE = "Czech";

export type AnalysisEvent = {
  name: string;
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  vggEventId: string | null;
};

export type AnalysisInput = {
  event: AnalysisEvent;
  stats: ParsedStats;
  features: Features;
  /** A small sample of the most recent sales, for texture. */
  recentSales: { at: string | null; price: number | null; qty: number | null; section: string | null }[];
  /** Skip the web research step (faster, cheaper, no outside context). */
  skipResearch?: boolean;
};

export type Verdict = "thriving" | "healthy" | "stable" | "cooling" | "oversaturated";
export type Direction = "up" | "flat" | "down";
export type Confidence = "low" | "medium" | "high";

export type Analysis = {
  verdict: Verdict;
  verdict_label: string;
  heat_score: number;
  headline: string;
  summary: string;
  price_outlook: { direction: Direction; confidence: Confidence; expected_move: string; horizon: string; reasoning: string };
  scores: { demand: number; supply: number; price_momentum: number; timing: number; context: number };
  pillars: {
    demand: Pillar;
    supply: Pillar;
    pricing: Pillar;
    timing: Pillar;
    context: Pillar;
  };
  key_numbers: { label: string; value: string; why: string }[];
  sections: { section: string; view: "hot" | "fair" | "weak"; note: string }[];
  risks: string[];
  opportunities: string[];
  watch: string[];
  data_caveats: string[];
};
type Pillar = { assessment: string; evidence: string[] };

export type ResearchSource = { title: string; url: string };
export type Research = { notes: string; sources: ResearchSource[]; searches: string[] };

// ── the output schema ─────────────────────────────────────────────────
// Structured outputs accept no numeric ranges, so ranges live in descriptions
// and are enforced by clampAnalysis() below.

const pillar = {
  type: "object",
  additionalProperties: false,
  required: ["assessment", "evidence"],
  properties: {
    assessment: { type: "string", description: "2–4 sentences." },
    evidence: { type: "array", items: { type: "string" }, description: "2–5 bullets, each citing a number from the data or a research fact." },
  },
} as const;

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict", "verdict_label", "heat_score", "headline", "summary", "price_outlook", "scores",
    "pillars", "key_numbers", "sections", "risks", "opportunities", "watch", "data_caveats",
  ],
  properties: {
    verdict: {
      type: "string",
      enum: ["thriving", "healthy", "stable", "cooling", "oversaturated"],
      description: "thriving = demand clearly outrunning supply; oversaturated = supply clearly outrunning demand.",
    },
    verdict_label: { type: "string", description: "The verdict as a short phrase in the analysis language, 1–3 words." },
    heat_score: { type: "integer", description: "0–100. 50 = balanced; above 70 thriving; below 30 oversaturated." },
    headline: { type: "string", description: "One sentence: the single most important thing about this market right now." },
    summary: { type: "string", description: "3–5 sentences tying demand, supply, price and timing together." },
    price_outlook: {
      type: "object",
      additionalProperties: false,
      required: ["direction", "confidence", "expected_move", "horizon", "reasoning"],
      properties: {
        direction: { type: "string", enum: ["up", "flat", "down"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        expected_move: { type: "string", description: "A rough range for resale prices, e.g. \"+10 až +20 %\", or \"beze změny\"." },
        horizon: { type: "string", description: "The period the outlook covers, e.g. \"do eventu\" or \"příští 2 týdny\"." },
        reasoning: { type: "string", description: "2–4 sentences on why." },
      },
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["demand", "supply", "price_momentum", "timing", "context"],
      description: "Each 0–10, higher = better for someone holding tickets to sell.",
      properties: {
        demand: { type: "integer" },
        supply: { type: "integer", description: "10 = scarce supply, 0 = flooded." },
        price_momentum: { type: "integer" },
        timing: { type: "integer" },
        context: { type: "integer", description: "From the research: act popularity, tour status, news." },
      },
    },
    pillars: {
      type: "object",
      additionalProperties: false,
      required: ["demand", "supply", "pricing", "timing", "context"],
      properties: { demand: pillar, supply: pillar, pricing: pillar, timing: pillar, context: pillar },
    },
    key_numbers: {
      type: "array",
      description: "The 4–6 numbers the verdict rests on most.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "why"],
        properties: { label: { type: "string" }, value: { type: "string" }, why: { type: "string" } },
      },
    },
    sections: {
      type: "array",
      description: "Up to 6 sections worth calling out, from the section data.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "view", "note"],
        properties: {
          section: { type: "string" },
          view: { type: "string", enum: ["hot", "fair", "weak"] },
          note: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" }, description: "2–5 things that could make this go worse than the outlook." },
    opportunities: { type: "array", items: { type: "string" }, description: "2–5 concrete angles, e.g. sections or price points that look mispriced." },
    watch: { type: "array", items: { type: "string" }, description: "2–4 signals that would change the view, and in which direction." },
    data_caveats: { type: "array", items: { type: "string" }, description: "Limits of the data behind this analysis. Empty if none." },
  },
} as const;

// ── prompts ───────────────────────────────────────────────────────────

export const RESEARCH_SYSTEM = `You research live-event resale markets for a professional ticket reseller. For one event, use web search to find the facts that move resale demand and prices, then report them as tight notes.

Report only what you found. Give dates for time-sensitive facts. When something can't be found, say so in one line rather than guessing. Prefer recent, primary sources (the promoter, venue, artist, reputable press) over aggregators.`;

export function researchPrompt(e: AnalysisEvent): string {
  const where = [e.venue, e.city, e.country].filter(Boolean).join(", ");
  return `Event: ${e.name}
Date: ${e.date ?? "unknown"}
Venue: ${where || "unknown"}
${e.vggEventId ? `viagogo event id: E-${e.vggEventId}` : ""}

Find out:
1. The act (or teams): how popular right now and which way it's heading — recent releases, tour news, chart or streaming momentum; for sports, form, stakes, rivalry.
2. This tour or run: are other dates selling out? Were dates added? Is this a second night in the same city? Is it billed as a farewell or final tour?
3. This venue: capacity, and how this act usually does at venues this size.
4. The primary market: sold out, or tickets still on sale / being released, and at what price level.
5. Anything that shifts demand: cancellations, health, postponements, controversy, special guests, holidays, competing events nearby.
6. Any reporting on resale prices for this event.

Write up to 350 words of bullet points, in English, with dates. End with one line listing what you could not confirm.`;
}

export const ANALYST_SYSTEM = `You are the senior market analyst for a professional ticket reseller. From one read of a resale sales-tracker page — already turned into measurements — plus web research notes, you judge whether this event's resale market is thriving or saturated, and which way prices are likely to go before the event.

How to weigh the evidence:
- Demand is pace, and above all the CHANGE in pace: last 24h and 7 days against the 30-day and all-time rates, week over week, the slope of the daily curve, days since the peak. A market still near its peak or accelerating is different from one decaying from an on-sale spike.
- Supply is tickets available against the pace: days of supply over days left is the core ratio (below 1 = supply runs out before the event at this pace; well above 1 = more supply than buyers). Listing count, tickets per listing, and asking prices against recent sold prices add to it.
- Price is recent median against the prior weeks, the weekly-median trend, and dispersion. The floor can be a single junk or parking-style listing — check it against the median before leaning on it.
- Timing: how much of the selling window has gone. Strong events often accelerate in the final weeks; oversupplied ones slide into the event.
- Context from research: tour selling out, venue size, primary releases, news. Treat it as context, and say when it is thin.
- Coverage: when salesSource is "screen", the windows and price trends come from a few dozen recent rows. Say so, and lower your confidence.

Ground every claim in a number from the data or a fact from the research notes, and never invent a number. Where signals conflict, say which you weigh more and why. Keep confidence calibrated: "high" only when several independent signals agree and coverage is full.

Write all prose in ${ANALYSIS_LANGUAGE}. Keep section names as they appear in the data. Write money with its currency and percentages with %.`;

/** The analysis request's user message: the data, compact, with the notes last. */
export function analysisPrompt(input: AnalysisInput, research: Research | null): string {
  const data = {
    event: input.event,
    tiles: input.stats,
    features: input.features,
    recentSales: input.recentSales.slice(0, 40),
  };
  return `Market data for this event (JSON). "features" are computed from the page's data; "coverage" says how complete it is.

${JSON.stringify(data)}

Research notes:
${research?.notes?.trim() || "(no web research for this analysis — judge from the market data alone, and say so under data_caveats)"}

Give your analysis.`;
}

// ── output hygiene ────────────────────────────────────────────────────

const clamp = (n: unknown, lo: number, hi: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : lo;
  return Math.max(lo, Math.min(hi, v));
};

/**
 * Enforce what the schema can't: numeric ranges, and list lengths the page lays
 * out for. The schema already guarantees shape; this guarantees the page never
 * draws a score of 140 or a wall of forty risks.
 */
export function clampAnalysis(a: Analysis): Analysis {
  return {
    ...a,
    heat_score: clamp(a.heat_score, 0, 100),
    scores: {
      demand: clamp(a.scores.demand, 0, 10),
      supply: clamp(a.scores.supply, 0, 10),
      price_momentum: clamp(a.scores.price_momentum, 0, 10),
      timing: clamp(a.scores.timing, 0, 10),
      context: clamp(a.scores.context, 0, 10),
    },
    key_numbers: a.key_numbers.slice(0, 6),
    sections: a.sections.slice(0, 6),
    risks: a.risks.slice(0, 6),
    opportunities: a.opportunities.slice(0, 6),
    watch: a.watch.slice(0, 5),
    data_caveats: a.data_caveats.slice(0, 5),
  };
}
