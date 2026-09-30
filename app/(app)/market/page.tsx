"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { parseVggLink } from "@/lib/market/vgg";
import EventDetail from "./EventDetail";
import EventList from "./EventList";
import type { Detail, MarketEvent } from "./format";
import { readFromTikey, saveCapture, useTikeyHelper, ReadError, type ReadDiag } from "./tikey";

// ─────────────────────────────────────────────────────────────
// Market — what the resale market is doing for an event.
//
// Paste a viagogo link and press Find: the "DeskTracker × Tikey" extension opens
// that event's Sales Tracker page in a background tab of your own browser, reads
// it, and the numbers land here — stored in your own tables, so every Find adds
// a point to the event's history. Without the extension, the page still shows
// everything read before.
//
// The page reads; it does not advise. Every figure is either a number off the
// Tikey page or a derivation from those numbers whose working is shown, and
// the Reading section says what the data shows rather than what to do about it.
//
// This file holds the state and the Find flow. The list is EventList.tsx, one
// event is EventDetail.tsx, the shared visual pieces are ui.tsx.
//
// It fetches its own data rather than going through DashContext: market data is
// only needed here, and loading it for every page would slow the whole
// dashboard's first paint for the sake of one tab.
// ─────────────────────────────────────────────────────────────

type Found = { result: "found"; id: string; matchedBy: "id" | "name" };
type Resolve = Found | { result: "not_captured"; eventId: string | null; url: string } | { result: "unreadable" };

/** A read that worked but found the page short of something — kept to show and to copy. */
type ReadGaps = { vggId: string; name: string; missing: string[]; outline: string[] };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}
const isMissingTables = (msg: string | null) => !!msg && /schema cache|market_events|market_snapshots/i.test(msg);

export default function MarketPage() {
  const [events, setEvents] = useState<MarketEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [matchedBy, setMatchedBy] = useState<"id" | "name" | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [link, setLink] = useState("");
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<ReactNode>(null);

  const helper = useTikeyHelper();
  // The progress line while the extension reads; null when idle.
  const [reading, setReading] = useState<string | null>(null);
  // Bumped after a refresh so the open event reloads with its new snapshot.
  const [version, setVersion] = useState(0);
  const [partial, setPartial] = useState<ReadGaps | null>(null);

  const loadList = useCallback(() => {
    getJson<MarketEvent[]>("/api/market/events")
      .then((list) => { setEvents(list); setError(null); })
      .catch((e: Error) => { setEvents([]); setError(e.message); });
  }, []);

  useEffect(() => {
    // An ?id= in the address opens that event directly, so a detail view can
    // be bookmarked or reopened from history.
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelected(id);
    loadList();
  }, [loadList]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("id", selected);
    else url.searchParams.delete("id");
    window.history.replaceState(null, "", url.toString());

    if (!selected) { setDetail(null); setDetailError(null); return; }
    let live = true;
    setDetailError(null);
    getJson<Detail>(`/api/market/events/${selected}`)
      .then((d) => { if (live) setDetail(d); })
      .catch((e: Error) => { if (live) setDetailError(e.message); });
    return () => { live = false; };
  }, [selected, version]);

  function open(id: string, how: "id" | "name" | null = null) {
    if (id !== selected) setDetail(null);
    setMatchedBy(how);
    setSelected(id);
    window.scrollTo({ top: 0 });
  }

  /**
   * Read one event from Tikey through the extension, store it, open it.
   * Returns false (and says why) if the read didn't happen.
   */
  async function readAndStore(vggId: string): Promise<boolean> {
    setReading("Asking the extension…");
    setPartial(null);
    try {
      const { capture, missing, outline } = await readFromTikey(vggId, setReading);
      setReading("Saving…");
      const id = await saveCapture(capture, vggId);
      if (missing.length) setPartial({ vggId, name: capture.event.name, missing, outline: outline ?? [] });
      open(id, "id");
      setVersion((v) => v + 1);
      loadList();
      return true;
    } catch (err) {
      setFindMsg(<ReadFailed error={err} />);
      return false;
    } finally {
      setReading(null);
    }
  }

  async function find(e: FormEvent) {
    e.preventDefault();
    const q = link.trim();
    if (!q) return;
    setFinding(true);
    setFindMsg(null);
    try {
      const ref = parseVggLink(q);
      if (!ref) {
        setFindMsg(
          <>
            <strong>That isn’t a viagogo event link I can read.</strong> Expected something like{" "}
            <code>https://www.viagogo.com/…/E-151234567</code>.
          </>
        );
        return;
      }

      // With the extension and an event id: always read fresh — that is what
      // Find is for, and each read adds a point to the history.
      if (ref.eventId && canRead) {
        if (await readAndStore(ref.eventId)) setLink("");
        else {
          // The read failed, but an earlier read is still worth showing.
          const r = await getJson<Resolve>(`/api/market/events?link=${encodeURIComponent(q)}`);
          if (r.result === "found") open(r.id, r.matchedBy);
        }
        return;
      }

      // Otherwise: whatever has been read before.
      const r = await getJson<Resolve>(`/api/market/events?link=${encodeURIComponent(q)}`);
      if (r.result === "found") {
        open(r.id, r.matchedBy);
        setLink("");
      } else if (!ref.eventId) {
        setFindMsg(
          <>
            <strong>This link has no viagogo event id.</strong> Paste the event’s own page link — the one
            ending in <code>/E-</code> and a number.
          </>
        );
      } else {
        setFindMsg(<HelperMissing />);
      }
    } catch (err) {
      setFindMsg(<><strong>Search failed.</strong> {(err as Error).message}</>);
    } finally {
      setFinding(false);
    }
  }

  const canRead = helper !== "missing" && helper !== "checking";
  const busy = finding || reading != null;

  return (
    <>
      <div className="toolbar market-toolbar">
        <h1>Market</h1>
        <span className={"helper-state" + (canRead ? " is-on" : helper === "missing" ? " is-off" : "")}
              title={canRead ? `DeskTracker × Tikey extension v${helper}` : "Extension not detected in this browser"}>
          <span className="helper-dot" aria-hidden /> {canRead ? "Tikey reader ready" : helper === "missing" ? "Tikey reader not installed" : "…"}
        </span>
        <form className="market-find" onSubmit={find}>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a viagogo event link…"
            aria-label="viagogo event link"
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={busy || !link.trim()}>
            {reading ? "Reading…" : finding ? "Finding…" : "Find"}
          </button>
        </form>
      </div>

      {reading && (
        <div className="market-reading" role="status" aria-live="polite">
          <span className="market-spinner" aria-hidden />
          <span><strong>Reading Tikey</strong> — {reading}</span>
        </div>
      )}
      {findMsg && !reading && <div className="chart-notice market-msg">{findMsg}</div>}
      {partial && !reading && selected && <PartialRead p={partial} onClose={() => setPartial(null)} />}

      {isMissingTables(error) ? (
        <div className="chart-notice">
          <strong>The market tables don’t exist yet.</strong> Run <code>supabase/schema.sql</code> in the
          Supabase SQL editor once — it creates <code>market_events</code>, <code>market_snapshots</code> and{" "}
          <code>market_sales</code> — then reload this page.
        </div>
      ) : error ? (
        <div className="error-banner"><strong>Couldn’t load market data.</strong> {error}</div>
      ) : null}

      {selected ? (
        <EventDetail
          detail={detail}
          error={detailError}
          matchedBy={matchedBy}
          onBack={() => { setSelected(null); setMatchedBy(null); setFindMsg(null); setPartial(null); }}
          onRefresh={canRead && !busy ? (vggId) => { setFindMsg(null); readAndStore(vggId); } : null}
        />
      ) : events == null ? (
        <div className="empty">Loading…</div>
      ) : !error && events.length === 0 ? (
        <NothingYet helper={helper} />
      ) : events.length > 0 ? (
        <EventList events={events} onOpen={(id) => open(id)} />
      ) : null}
    </>
  );
}

function NothingYet({ helper }: { helper: string }) {
  return (
    <div className="chart-card market-empty">
      <h2>No events yet</h2>
      {helper === "missing" ? (
        <>
          <p className="market-empty-lead">
            Install the <strong>DeskTracker × Tikey</strong> extension once, then paste a viagogo event link above.
          </p>
          <HelperSteps />
        </>
      ) : (
        <p className="market-empty-lead">
          Paste a viagogo event link above and press <strong>Find</strong>. The extension reads the event from
          Tikey in a background tab of this browser and it appears here — every later read adds a point to its
          history.
        </p>
      )}
      <p className="hint">
        This data has no archive: a tracker’s history starts the day it begins watching. The sooner an event is
        read, the more there is to compare later.
      </p>
    </div>
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
      <strong>Not read yet — the DeskTracker × Tikey extension isn’t installed in this browser.</strong> It is
      what opens the event on Tikey for you. One-time setup:
      <HelperSteps />
    </>
  );
}

/**
 * A failed read, said plainly — and, when the extension reached the page, what
 * it found there. That detail is what it takes to fix the reader if Tikey
 * changes its layout, so it is shown rather than logged somewhere nobody looks.
 */
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
 * The read worked, but some fields weren't where the reader looked. Says which,
 * and puts everything needed to fix the reader one click from the clipboard —
 * the missing fields and the page's text in order — so the fix doesn't start
 * with someone opening DevTools.
 */
function PartialRead({ p, onClose }: { p: ReadGaps; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const report = [
      `DeskTracker × Tikey — partial read`,
      `event: ${p.name} (viagogo E-${p.vggId})`,
      `missing: ${p.missing.join(", ")}`,
      ``,
      `page text, in order:`,
      ...p.outline,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="chart-notice market-msg market-partial">
      <div>
        <strong>Read from Tikey — but some things weren’t found on the page:</strong> {p.missing.join(", ")}.
        The rest is saved. To get these fixed, copy the details and send them over.
      </div>
      <div className="market-partial-actions">
        <button className="btn btn-sm btn-flag" onClick={copy}>{copied ? "Copied ✓" : "Copy details for the fix"}</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Dismiss</button>
      </div>
    </div>
  );
}
