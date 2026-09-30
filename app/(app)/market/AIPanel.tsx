"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Analysis, AnalysisInput, Research } from "@/lib/market/analysis";
import { int, money, num1, pct } from "./format";
import type { MarketView } from "./model";
import { Icon, Pill, ScoreBar } from "./ui";

// ─────────────────────────────────────────────────────────────
// The A.I analysis, in a panel that slides in from the right.
//
// It posts this read's measurements to /api/market/analyze and renders the
// stream: the searches as they happen, then the verdict. Nothing is stored —
// closing the panel keeps the result for this read; a new Find starts over.
//
// The panel speaks Czech because the analysis does. Its verdicts carry a word
// and a glyph as well as a colour, and every number it leans on is repeated in
// "Data za verdiktem" underneath, so the reasoning can be checked.
// ─────────────────────────────────────────────────────────────

type Run =
  | { status: "idle" }
  | { status: "running"; stage: "research" | "analysis"; searches: string[]; started: number; research: Research | null }
  | { status: "done"; analysis: Analysis; research: Research | null; model: string; seconds: number; withResearch: boolean }
  | { status: "error"; message: string; setup: boolean };

const VERDICT: Record<Analysis["verdict"], { hue: string; glyph: string }> = {
  thriving: { hue: "#0ca30c", glyph: "▲▲" },
  healthy: { hue: "#3ecf8e", glyph: "▲" },
  stable: { hue: "#3987e5", glyph: "●" },
  cooling: { hue: "#d9a441", glyph: "▼" },
  oversaturated: { hue: "#d03b3b", glyph: "▼▼" },
};
const DIRECTION = {
  up: { word: "Cena nahoru", glyph: "↗", tone: "up" as const },
  flat: { word: "Cena beze změny", glyph: "→", tone: "neutral" as const },
  down: { word: "Cena dolů", glyph: "↘", tone: "down" as const },
};
const CONF = { low: "nízká jistota", medium: "střední jistota", high: "vysoká jistota" };
const VIEW = { hot: { word: "žádaná", tone: "up" as const }, fair: { word: "v normě", tone: "neutral" as const }, weak: { word: "slabá", tone: "down" as const } };

export default function AIPanel({ view, open, onClose }: { view: MarketView; open: boolean; onClose: () => void }) {
  const [run, setRun] = useState<Run>({ status: "idle" });
  const [withResearch, setWithResearch] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const forRead = useRef(view.capturedAt);

  // A new read is a new market: forget the old analysis.
  useEffect(() => {
    if (forRead.current !== view.capturedAt) {
      forRead.current = view.capturedAt;
      setRun({ status: "idle" });
    }
  }, [view.capturedAt]);

  const start = useCallback(async (research: boolean) => {
    const started = Date.now();
    setRun({ status: "running", stage: research ? "research" : "analysis", searches: [], started, research: null });
    const input: AnalysisInput = {
      event: {
        name: view.event.name, date: view.event.date, venue: view.event.venue,
        city: view.event.city, country: view.event.country, vggEventId: view.vggId,
      },
      stats: view.stats,
      features: view.features,
      recentSales: view.sales.slice(0, 40).map((s) => ({ at: s.at, price: s.price, qty: s.qty, section: s.section })),
      skipResearch: !research,
    };
    try {
      const res = await fetch("/api/market/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setRun({ status: "error", message: j.error || `HTTP ${res.status}`, setup: res.status === 503 });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let researchOut: Research | null = null;
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.type === "stage") {
            setRun((r) => (r.status === "running" ? { ...r, stage: m.stage } : r));
          } else if (m.type === "progress" && typeof m.message === "string" && m.message.startsWith("Searching: ")) {
            const q = m.message.slice("Searching: ".length);
            setRun((r) => (r.status === "running" ? { ...r, searches: [...r.searches, q] } : r));
          } else if (m.type === "research") {
            researchOut = m.research;
            setRun((r) => (r.status === "running" ? { ...r, research: m.research } : r));
          } else if (m.type === "result") {
            finished = true;
            setRun({ status: "done", analysis: m.analysis, research: researchOut, model: m.model, seconds: Math.round((Date.now() - started) / 1000), withResearch: research });
          } else if (m.type === "error") {
            finished = true;
            setRun({ status: "error", message: m.message, setup: false });
          }
        }
      }
      if (!finished) setRun({ status: "error", message: "The analysis stopped before it finished (the server may have hit its time limit). Try again, or without web research.", setup: false });
    } catch (e) {
      setRun({ status: "error", message: e instanceof Error ? e.message : String(e), setup: false });
    }
  }, [view]);

  // Opening the panel for a read that hasn't been analysed starts the analysis.
  useEffect(() => {
    if (open && run.status === "idle") start(withResearch);
  }, [open, run.status, start, withResearch]);

  // A ticking clock while it runs — a minute of silence reads as broken.
  useEffect(() => {
    if (run.status !== "running") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - run.started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [run]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  return (
    <>
      <div className={"ai-backdrop" + (open ? " is-open" : "")} onClick={onClose} aria-hidden />
      <aside className={"ai-panel" + (open ? " is-open" : "")} aria-label="A.I analýza" aria-hidden={!open}>
        <header className="ai-head">
          <div>
            <div className="ai-kicker">{Icon.sparkle} A.I analýza trhu</div>
            <div className="ai-event">{view.event.name}</div>
          </div>
          <button className="ai-close" onClick={onClose} aria-label="Zavřít">{Icon.close}</button>
        </header>

        <div className="ai-body">
          {run.status === "running" && <Running run={run} elapsed={elapsed} />}
          {run.status === "error" && (
            <div className="ai-error">
              <strong>Analýza se nepovedla.</strong> {run.message}
              {run.setup && (
                <ol className="ai-setup">
                  <li>Na <code>console.anthropic.com</code> → API Keys vytvoř klíč (a nastav platbu).</li>
                  <li>Vercel → projekt → Settings → Environment Variables → <code>ANTHROPIC_API_KEY</code> = klíč.</li>
                  <li>Redeploy, pak znovu klikni na A.I.</li>
                </ol>
              )}
              <div className="ai-actions">
                <button className="btn btn-primary btn-sm" onClick={() => start(withResearch)}>Zkusit znovu</button>
                {withResearch && <button className="btn btn-ghost btn-sm" onClick={() => { setWithResearch(false); start(false); }}>Bez rešerše (rychlejší)</button>}
              </div>
            </div>
          )}
          {run.status === "done" && <Result a={run.analysis} research={run.research} view={view} />}
        </div>

        <footer className="ai-foot">
          {run.status === "done" ? (
            <span>{run.model} · {run.seconds} s{run.withResearch ? " · s rešerší" : " · bez rešerše"}</span>
          ) : <span>Claude · Opus 5</span>}
          <label className="ai-toggle">
            <input type="checkbox" checked={withResearch} onChange={(e) => setWithResearch(e.target.checked)} /> rešerše na webu
          </label>
          <button className="btn btn-ghost btn-sm" disabled={run.status === "running"} onClick={() => start(withResearch)}>
            {Icon.refresh} Spustit znovu
          </button>
        </footer>
      </aside>
    </>
  );
}

function Running({ run, elapsed }: { run: Extract<Run, { status: "running" }>; elapsed: number }) {
  const researching = run.stage === "research";
  return (
    <div className="ai-running">
      <div className="ai-steps">
        <div className={"ai-step" + (researching ? " is-now" : " is-done")}>
          <span className="ai-step-dot">{researching ? <span className="market-spinner" /> : "✓"}</span>
          <div>
            <strong>Rešerše na webu</strong>
            <div className="ai-step-sub">interpret, turné, kapacita, primární prodej, novinky</div>
            {run.searches.length > 0 && (
              <ul className="ai-searches">
                {run.searches.map((q, i) => <li key={i}>{Icon.globe} {q}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className={"ai-step" + (researching ? "" : " is-now")}>
          <span className="ai-step-dot">{researching ? "2" : <span className="market-spinner" />}</span>
          <div>
            <strong>Rozbor trhu</strong>
            <div className="ai-step-sub">poptávka, nabídka, cena, načasování</div>
          </div>
        </div>
      </div>
      <div className="ai-elapsed">{elapsed} s · obvykle 1–3 minuty</div>
    </div>
  );
}

function Result({ a, research, view }: { a: Analysis; research: Research | null; view: MarketView }) {
  const v = VERDICT[a.verdict];
  const d = DIRECTION[a.price_outlook.direction];
  return (
    <div className="ai-result">
      {/* ── verdict and outlook ── */}
      <section className="ai-verdict" style={{ ["--vh" as string]: v.hue }}>
        <Gauge score={a.heat_score} hue={v.hue} />
        <div className="ai-verdict-text">
          <div className="ai-verdict-label"><span aria-hidden>{v.glyph}</span> {a.verdict_label}</div>
          <div className="ai-verdict-sub">index žhavosti trhu {a.heat_score}/100</div>
        </div>
      </section>

      <section className={`ai-outlook is-${d.tone}`}>
        <div className="ai-outlook-arrow" aria-hidden>{d.glyph}</div>
        <div className="ai-outlook-main">
          <div className="ai-outlook-word">{d.word} <span className="ai-outlook-move">{a.price_outlook.expected_move}</span></div>
          <div className="ai-outlook-meta">
            {a.price_outlook.horizon} · <Pill tone={a.price_outlook.confidence === "high" ? "up" : a.price_outlook.confidence === "low" ? "warn" : "neutral"}>{CONF[a.price_outlook.confidence]}</Pill>
          </div>
          <p>{a.price_outlook.reasoning}</p>
        </div>
      </section>

      <p className="ai-headline">{a.headline}</p>
      <p className="ai-summary">{a.summary}</p>

      <section className="ai-block">
        <h4>Skóre</h4>
        <ScoreBar label="Poptávka" value={a.scores.demand} hue="#3987e5" />
        <ScoreBar label="Nabídka (vzácnost)" value={a.scores.supply} hue="#d95926" />
        <ScoreBar label="Cenová dynamika" value={a.scores.price_momentum} hue="#199e70" />
        <ScoreBar label="Načasování" value={a.scores.timing} hue="#9085e9" />
        <ScoreBar label="Kontext" value={a.scores.context} hue="#d55181" />
      </section>

      {a.key_numbers.length > 0 && (
        <section className="ai-block">
          <h4>Klíčová čísla</h4>
          <div className="ai-keys">
            {a.key_numbers.map((k, i) => (
              <div key={i} className="ai-key">
                <div className="ai-key-value">{k.value}</div>
                <div className="ai-key-label">{k.label}</div>
                <div className="ai-key-why">{k.why}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ai-block">
        <h4>Rozbor</h4>
        <PillarCard title="Poptávka" hue="#3987e5" p={a.pillars.demand} />
        <PillarCard title="Nabídka" hue="#d95926" p={a.pillars.supply} />
        <PillarCard title="Ceny" hue="#199e70" p={a.pillars.pricing} />
        <PillarCard title="Načasování" hue="#9085e9" p={a.pillars.timing} />
        <PillarCard title="Kontext z webu" hue="#d55181" p={a.pillars.context} />
      </section>

      {a.sections.length > 0 && (
        <section className="ai-block">
          <h4>Sekce</h4>
          <div className="ai-sections">
            {a.sections.map((s, i) => (
              <div key={i} className="ai-section-row">
                <span className="tk-sec">{s.section}</span>
                <Pill tone={VIEW[s.view].tone}>{VIEW[s.view].word}</Pill>
                <span className="ai-section-note">{s.note}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="ai-lists">
        <ListBlock title="Příležitosti" tone="up" items={a.opportunities} />
        <ListBlock title="Rizika" tone="down" items={a.risks} />
        <ListBlock title="Co sledovat" tone="neutral" items={a.watch} />
      </div>

      {research && (research.notes || research.sources.length > 0) && (
        <details className="ai-block ai-research">
          <summary><h4>Rešerše z webu{research.sources.length ? ` · ${research.sources.length} zdrojů` : ""}</h4></summary>
          <Notes text={research.notes} />
          {research.sources.length > 0 && (
            <ul className="ai-sources">
              {research.sources.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>
              ))}
            </ul>
          )}
        </details>
      )}

      {a.data_caveats.length > 0 && (
        <section className="ai-block ai-caveats">
          <h4>Omezení dat</h4>
          <ul>{a.data_caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}

      <details className="ai-block ai-data">
        <summary><h4>Data za verdiktem</h4></summary>
        <FeatureTable view={view} />
      </details>

      <p className="ai-disclaimer">A.I se může mýlit — opírá se o čísla výše, ověř si je, než podle toho nakoupíš nebo prodáš.</p>
    </div>
  );
}

/** A half-ring from 0 to 100, filled to the score. */
function Gauge({ score, hue }: { score: number; hue: string }) {
  const r = 42;
  const len = Math.PI * r;
  const f = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg viewBox="0 0 100 58" width="118" height="68" role="img" aria-label={`Index ${score} ze 100`} className="ai-gauge">
      <path d="M8 52 A42 42 0 0 1 92 52" fill="none" stroke="#2a2a2a" strokeWidth="9" strokeLinecap="round" />
      <path d="M8 52 A42 42 0 0 1 92 52" fill="none" stroke={hue} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${len * f} ${len}`} />
      <text x="50" y="50" textAnchor="middle" fill="#f2f2f2" fontSize="22" fontWeight="700">{score}</text>
    </svg>
  );
}

function PillarCard({ title, hue, p }: { title: string; hue: string; p: { assessment: string; evidence: string[] } }) {
  return (
    <div className="ai-pillar" style={{ ["--ph" as string]: hue }}>
      <div className="ai-pillar-title">{title}</div>
      <p>{p.assessment}</p>
      {p.evidence.length > 0 && <ul>{p.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}

function ListBlock({ title, tone, items }: { title: string; tone: "up" | "down" | "neutral"; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className={`ai-list is-${tone}`}>
      <h4>{title}</h4>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
  );
}

/** Research notes are markdown-ish bullets; render lists and **bold** without injecting HTML. */
function Notes({ text }: { text: string }) {
  const bold = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list}</ul>); list = []; } };
  lines.forEach((l, i) => {
    const m = l.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (m) list.push(<li key={i}>{bold(m[2])}</li>);
    else { flush(); out.push(<p key={i}>{bold(l.replace(/^#+\s*/, ""))}</p>); }
  });
  flush();
  return <div className="ai-notes">{out}</div>;
}

/** The measurements the analysis was given, in one table — so any claim can be checked. */
function FeatureTable({ view }: { view: MarketView }) {
  const f = view.features;
  const cur = view.stats.currency;
  const rows: [string, string][] = [
    ["Pokrytí dat", `${f.coverage.salesSource === "full" ? "celá historie prodejů" : "jen první stránka"} · ${int(f.coverage.salesRows)} řádků${f.coverage.coveragePct != null ? ` (${num1(f.coverage.coveragePct)} %)` : ""}`],
    ["Prodáno celkem", `${int(f.volume.totalTickets)} lístků v ${int(f.volume.totalSales)} prodejích`],
    ["Lístky 24 h / 7 d / předchozích 7 d / 30 d", `${num1(f.velocity.tickets24h)} / ${int(f.velocity.tickets7d)} / ${int(f.velocity.ticketsPrev7d)} / ${int(f.velocity.tickets30d)}`],
    ["Týden proti týdnu", pct(f.velocity.weekOverWeekPct, true)],
    ["Tempo za den: 7 d / 30 d / celkově", `${num1(f.velocity.perDay7d)} / ${num1(f.velocity.perDay30d)} / ${num1(f.velocity.perDayAllTime)}`],
    ["Sklon denních prodejů (14 d)", f.trend.slope14d == null ? "—" : `${f.trend.slope14d > 0 ? "+" : ""}${f.trend.slope14d} lístku/den za den`],
    ["Vrchol", f.trend.peakDay ? `${f.trend.peakDay} · ${int(f.trend.peakTickets)} lístků · před ${f.trend.daysSincePeak} dny` : "—"],
    ["Medián ceny 7 d / předtím", `${money(f.price.median7d, cur)} / ${money(f.price.medianPrev, cur)} (${pct(f.price.change7dVsPrevPct, true)})`],
    ["Ceny p25 / medián / p75", `${money(f.price.p25, cur)} / ${money(f.price.median, cur)} / ${money(f.price.p75, cur)}`],
    ["Floor / medián", f.price.floorOverMedian == null ? "—" : `${money(f.price.floor, cur)} · ${num1(f.price.floorOverMedian * 100)} % mediánu`],
    ["K dispozici / listingy", `${int(f.supply.available)} lístků v ${int(f.supply.listings)} listinzích`],
    ["Zásoba ve dnech / dní do eventu", `${num1(f.supply.daysOfSupply)} / ${f.timing.daysToEvent ?? "—"}${f.supply.daysOfSupplyOverDaysLeft != null ? ` (poměr ${f.supply.daysOfSupplyOverDaysLeft})` : ""}`],
    ["Nabídky proti prodejům", f.supply.askOverSoldPct == null ? "—" : `${pct(f.supply.askOverSoldPct, true)} (medián nabídek ${money(f.supply.listingPriceMedian, cur)})`],
    ["Sell-through", pct(f.supply.sellThroughPct)],
    ["Uplynulo z prodejního okna", f.timing.windowElapsed == null ? "—" : `${Math.round(f.timing.windowElapsed * 100)} %`],
    ["Objednávky 1 / 2 / 3 / 4+", `${f.orderSizes.onePct} / ${f.orderSizes.twoPct} / ${f.orderSizes.threePct} / ${f.orderSizes.fourPlusPct} %`],
  ];
  return (
    <table className="ai-table">
      <tbody>{rows.map(([k, val]) => <tr key={k}><th>{k}</th><td>{val}</td></tr>)}</tbody>
    </table>
  );
}
