import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import {
  ANALYSIS_SCHEMA, ANALYST_SYSTEM, MODEL, RESEARCH_SYSTEM,
  analysisPrompt, clampAnalysis, researchPrompt,
  type Analysis, type AnalysisInput, type Research, type ResearchSource,
} from "@/lib/market/analysis";

export const dynamic = "force-dynamic";
// Web research plus an analysis at high effort takes one to three minutes.
// 300 s is the Hobby ceiling with fluid compute (the default).
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────
// AI market analysis. Behind the login middleware like every dashboard route.
//
// The page posts the event, its tiles and the computed features; this runs the
// research step (web search) and the analysis step (strict JSON), and streams
// progress back as newline-delimited JSON so the panel can show what is
// happening during a wait that can run past a minute:
//
//   {"type":"stage","stage":"research"|"analysis","message":…}
//   {"type":"progress","message":"Searching: …"}
//   {"type":"research","research":{notes,sources,searches}}
//   {"type":"result","analysis":{…},"model":…}
//   {"type":"error","message":…}
//   {"type":"heartbeat"}             every 10 s, so no proxy drops a quiet line
//
// REFUSAL FALLBACK is on: `fallbacks: "default"` under the
// server-side-fallback-2026-07-01 beta. If the model's safety classifiers
// decline a request, the API re-runs it on the recommended fallback model
// inside the same call rather than returning an empty refusal.
// ─────────────────────────────────────────────────────────────

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** A web-search turn can pause after the server's own tool loop; resume a few times at most. */
const MAX_CONTINUATIONS = 3;

class ModelDeclined extends Error {}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Create a key at console.anthropic.com and add it in Vercel → Settings → Environment Variables, then redeploy." },
      { status: 503 }
    );
  }

  let input: AnalysisInput;
  try {
    input = (await req.json()) as AnalysisInput;
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (!input?.event?.name || !input?.stats || !input?.features) {
    return NextResponse.json({ error: "event, stats and features are required" }, { status: 400 });
  }
  input.recentSales = Array.isArray(input.recentSales) ? input.recentSales.slice(0, 40) : [];

  const client = new Anthropic();
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      const beat = setInterval(() => send({ type: "heartbeat" }), 10_000);
      try {
        let research: Research | null = null;
        if (!input.skipResearch) {
          send({ type: "stage", stage: "research", message: "Researching the event on the web…" });
          research = await runResearch(client, input, (message) => send({ type: "progress", message }));
          send({ type: "research", research });
        }
        send({ type: "stage", stage: "analysis", message: "Weighing demand, supply, price and timing…" });
        const { analysis, model } = await runAnalysis(client, input, research);
        send({ type: "result", analysis, model });
      } catch (e) {
        console.error("market analyze failed:", e);
        send({ type: "error", message: explain(e) });
      } finally {
        clearInterval(beat);
        open = false;
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Step 1: web research. Streams so each search query can be reported as it is
 * made, and resumes a paused turn (the server's own search loop can pause a
 * long turn) by sending the assistant content back — no extra user message.
 */
async function runResearch(client: Anthropic, input: AnalysisInput, progress: (m: string) => void): Promise<Research> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: researchPrompt(input.event) }];
  const searches: string[] = [];
  const texts: string[] = [];
  const sources = new Map<string, ResearchSource>();

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: RESEARCH_SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
    });

    // A search's query streams in as partial JSON; report it once complete.
    const queries = new Map<number, string>();
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") {
        queries.set(ev.index, "");
      } else if (ev.type === "content_block_delta" && ev.delta.type === "input_json_delta" && queries.has(ev.index)) {
        queries.set(ev.index, queries.get(ev.index)! + ev.delta.partial_json);
      } else if (ev.type === "content_block_stop" && queries.has(ev.index)) {
        try {
          const q = (JSON.parse(queries.get(ev.index) || "{}") as { query?: string }).query;
          if (q) { searches.push(q); progress(`Searching: ${q}`); }
        } catch { /* a malformed partial is only a progress line */ }
        queries.delete(ev.index);
      }
    }

    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new ModelDeclined("The model declined the research step.");

    for (const block of msg.content) {
      if (block.type === "text") {
        texts.push(block.text);
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location" && c.url) sources.set(c.url, { title: c.title ?? c.url, url: c.url });
        }
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        // A successful search's content is a list; an error's is an object.
        for (const r of block.content) {
          if (r.type === "web_search_result" && !sources.has(r.url)) sources.set(r.url, { title: r.title, url: r.url });
        }
      }
    }

    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
    progress("Continuing the research…");
  }

  return { notes: texts.join("").trim(), sources: [...sources.values()].slice(0, 12), searches };
}

/** Step 2: the analysis, as schema-guaranteed JSON. */
async function runAnalysis(client: Anthropic, input: AnalysisInput, research: Research | null): Promise<{ analysis: Analysis; model: string }> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
    system: ANALYST_SYSTEM,
    messages: [{ role: "user", content: analysisPrompt(input, research) }],
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new ModelDeclined("The model declined to analyse this event.");
  if (msg.stop_reason === "max_tokens") throw new Error("The analysis ran out of room before it finished — try again.");

  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const analysis = clampAnalysis(JSON.parse(text) as Analysis);
  return { analysis, model: msg.model };
}

/** A failure in words the person pressing the button can act on. */
function explain(e: unknown): string {
  if (e instanceof ModelDeclined) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "The ANTHROPIC_API_KEY was rejected — check it in Vercel's environment variables.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to do that (model or web search access). Check the key's workspace in the Anthropic Console.";
  if (e instanceof Anthropic.RateLimitError) return "The Claude API is rate-limiting this key — wait a minute and try again.";
  if (e instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API — try again.";
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ""}: ${e.message}`;
  if (e instanceof SyntaxError) return "The analysis came back malformed — try again.";
  return e instanceof Error ? e.message : String(e);
}
