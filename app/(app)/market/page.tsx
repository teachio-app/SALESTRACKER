"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { parseVggLink } from "@/lib/market/vgg";
import AIPanel from "./AIPanel";
import TikeyView from "./TikeyView";
import { buildView, type MarketView } from "./model";
import { readFromTikey, useTikeyHelper, ReadError, type ReadDiag } from "./tikey";

// ─────────────────────────────────────────────────────────────
// Market — one event's resale market, read live from Tikey.
//
// Paste a viagogo link and press Find: the "DeskTracker × Tikey" extension opens
// the event's Sales Tracker page in a background tab of your own browser, reads
// it — the tiles, and the page's own data behind them — and the event appears
// here laid out like Tikey's page, with the A.I analysis in the top-right corner.
//
// NOTHING IS STORED. A Find is a fresh read; the previous event is replaced.
//
// The parts: TikeyView (header, tiles, table, charts), AIPanel (the analysis),
// model.ts (turning a read into what's shown), tikey.ts (the extension).
// ─────────────────────────────────────────────────────────────

export default function MarketPage() {
  const helper = useTikeyHelper();
  const canRead = helper !== "missing" && helper !== "checking";

  const [link, setLink] = useState("");
  const [view, setView] = useState<MarketView | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [msg, setMsg] = useState<ReactNode>(null);
  const [aiOpen, setAiOpen] = useState(false);

  async function read(vggId: string) {
    setReading("Asking the extension…");
    setMsg(null);
    try {
      const r = await readFromTikey(vggId, setReading);
      setReading("Crunching the numbers…");
      const v = buildView(vggId, r.capture, r.deep, r.missing, r.outline ?? []);
      setView(v);
      setAiOpen(false);
      if (v.missing.length) setMsg(<PartialRead view={v} />);
    } catch (err) {
      setMsg(<ReadFailed error={err} />);
    } finally {
      setReading(null);
    }
  }

  function find(e: FormEvent) {
    e.preventDefault();
    const ref = parseVggLink(link.trim());
    if (!ref) {
      setMsg(<><strong>That isn’t a viagogo event link I can read.</strong> Expected something like <code>https://www.viagogo.com/…/E-151234567</code>.</>);
      return;
    }
    if (!ref.eventId) {
      setMsg(<><strong>This link has no viagogo event id.</strong> Paste the event’s own page link — the one ending in <code>/E-</code> and a number.</>);
      return;
    }
    if (!canRead) {
      setMsg(<HelperMissing />);
      return;
    }
    read(ref.eventId);
  }

  return (
    <>
      <div className="toolbar market-toolbar">
        <h1>Market</h1>
        <span className={"helper-state" + (canRead ? " is-on" : helper === "missing" ? " is-off" : "")}
              title={canRead ? `DeskTracker × Tikey extension v${helper}` : "Extension not detected in this browser"}>
          <span className="helper-dot" aria-hidden /> {canRead ? "Tikey reader ready" : helper === "missing" ? "Tikey reader not installed" : "…"}
        </span>
        <form className="market-find" onSubmit={find}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a viagogo event link…"
                 aria-label="viagogo event link" spellCheck={false} />
          <button className="btn btn-primary" disabled={reading != null || !link.trim()}>{reading ? "Reading…" : "Find"}</button>
        </form>
      </div>

      {reading && (
        <div className="market-reading" role="status" aria-live="polite">
          <span className="market-spinner" aria-hidden />
          <span><strong>Reading Tikey</strong> — {reading}</span>
        </div>
      )}
      {msg && !reading && <div className="chart-notice market-msg">{msg}</div>}

      {view ? (
        <>
          <TikeyView
            view={view}
            onAI={() => setAiOpen(true)}
            onRefresh={canRead ? () => read(view.vggId) : null}
            refreshing={reading != null}
          />
          <AIPanel view={view} open={aiOpen} onClose={() => setAiOpen(false)} />
        </>
      ) : !reading && (
        <div className="chart-card market-empty">
          <h2>Paste a viagogo event link</h2>
          {helper === "missing" ? (
            <>
              <p className="market-empty-lead">First, install the <strong>DeskTracker × Tikey</strong> extension once:</p>
              <HelperSteps />
            </>
          ) : (
            <p className="market-empty-lead">
              The extension reads the event from Tikey in a background tab of this browser — every sale, the listings
              and the daily curve — and lays it out here. Then press <strong>A.I analýza</strong> in the top-right corner
              for a verdict on where the market is heading.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** One-time install, in the words of the screens it happens on. */
function HelperSteps() {
  return (
    <ol className="market-steps">
      <li>Open <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>).</li>
      <li>Turn on <strong>Developer mode</strong>, top right.</li>
      <li><strong>Load unpacked</strong> → choose the <code>extension</code> folder inside the tracker’s project folder.</li>
      <li>Reload this page. Be signed in to Tikey in this same browser.</li>
    </ol>
  );
}

function HelperMissing() {
  return (
    <>
      <strong>The DeskTracker × Tikey extension isn’t installed in this browser.</strong> It is what opens the event on
      Tikey for you. One-time setup:
      <HelperSteps />
    </>
  );
}

/** A failed read, said plainly — with what the extension saw on the page, when it got that far. */
function ReadFailed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const diag: ReadDiag | undefined = error instanceof ReadError ? error.diag : undefined;
  return (
    <>
      <strong>Couldn’t read this event from Tikey.</strong> {message}
      {diag && (
        <details className="market-diag">
          <summary>What the extension saw</summary>
          <ul>
            <li>Page: <code>{diag.title || "—"}</code> <span className="market-where">{diag.path}</span></li>
            <li>Event name found: <code>{diag.heading || "none"}</code></li>
            <li>Number tiles: {diag.tilesLoaded ?? 0} loaded of {diag.tilesFound ?? 0} found (8 expected)</li>
            <li>Sale rows: {diag.saleRows ?? 0}</li>
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * The read worked but some things weren't found. Says which, and puts what it
 * takes to fix the reader one click from the clipboard: the missing fields, the
 * page's text, and a description of the data the page loaded.
 */
function PartialRead({ view }: { view: MarketView }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const report = [
      "DeskTracker × Tikey — partial read",
      `event: ${view.event.name} (viagogo E-${view.vggId})`,
      `missing: ${view.missing.join(", ")}`,
      "",
      ...view.report,
    ].join("\n");
    try { await navigator.clipboard.writeText(report); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="market-partial">
      <div>
        <strong>Read from Tikey — but some things weren’t found:</strong> {view.missing.join(", ")}. The rest is shown
        below. To get these fixed, copy the details and send them over.
      </div>
      <div className="market-partial-actions">
        <button className="btn btn-sm btn-flag" onClick={copy}>{copied ? "Copied ✓" : "Copy details for the fix"}</button>
      </div>
    </div>
  );
}
