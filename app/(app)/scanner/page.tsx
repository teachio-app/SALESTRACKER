"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { download } from "../exportRows";
import type { ScanHit, ScanCursor, FolderInfo } from "@/lib/scanner";

// The in-app mailbox scanner: set a filter, hit Scan, and it walks the mailbox in
// chunks (each chunk is one <60s serverless call) accumulating matches here in the
// browser. Read-only — nothing is marked read. Export the results to CSV.
type ScanChunk = {
  hits: ScanHit[];
  scanned: number;
  folder: string;
  foldersTotal: number;
  cursor: ScanCursor;
  done: boolean;
  error?: string;
};

const MAX_ROWS = 2000; // cap the DOM; the CSV still gets everything

/** Did the extractor get anything out of this hit? */
const extracted = (h: ScanHit) => h.event != null || h.qty != null || h.total != null;

export default function ScannerPage() {
  const [subject, setSubject] = useState("");
  const [phrases, setPhrases] = useState("");
  const [matchAll, setMatchAll] = useState(true);
  const [since, setSince] = useState("");
  // Opt-in: pull event / qty / total out of each LA28 order confirmation into
  // extra columns. Off by default because it forces a full body fetch per
  // subject match, which is the slow part of a scan.
  const [extractLa28, setExtractLa28] = useState(false);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [foldersBusy, setFoldersBusy] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [hits, setHits] = useState<ScanHit[]>([]);
  const [scanned, setScanned] = useState(0);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const stopRef = useRef(false);

  // Discord webhook — user-supplied and remembered in the browser (localStorage),
  // so a live webhook token never has to live in the repo.
  const [hookUrl, setHookUrl] = useState("");
  const [hookMention, setHookMention] = useState("");
  const [hookOnFinish, setHookOnFinish] = useState(true);
  const [hookAttachCsv, setHookAttachCsv] = useState(true);
  const [hookStatus, setHookStatus] = useState("");

  useEffect(() => {
    try {
      setHookUrl(localStorage.getItem("scan_hook_url") || "");
      setHookMention(localStorage.getItem("scan_hook_mention") || "");
      setHookOnFinish(localStorage.getItem("scan_hook_finish") !== "0");
      setHookAttachCsv(localStorage.getItem("scan_hook_csv") !== "0");
    } catch {
      /* localStorage blocked — just use defaults */
    }
  }, []);
  const persist = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  };

  function currentFilter() {
    return {
      subjectContains: subject.trim(),
      bodyPhrases: phrases.split("\n").map((s) => s.trim()).filter(Boolean),
      matchAll,
      since: since || undefined,
      folders: picked.size ? [...picked] : undefined,
      extract: extractLa28 ? ("la28" as const) : undefined,
    };
  }

  async function loadFolders() {
    setFoldersBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "folders" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFolders(data.folders || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setFoldersBusy(false);
  }

  async function runScan() {
    stopRef.current = false;
    setScanning(true);
    setHits([]);
    setScanned(0);
    setError(null);
    setProgress("Starting…");
    const filter = currentFilter();
    let cursor: ScanCursor = null;
    let total = 0;
    let stallGuard = 0;
    let errored = false;
    const collected: ScanHit[] = []; // local copy so the webhook has the full set

    try {
      while (!stopRef.current) {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "scan", filter, cursor }),
        });
        const chunk: ScanChunk = await res.json();
        if (!res.ok) throw new Error(chunk.error || `HTTP ${res.status}`);

        total += chunk.scanned;
        setScanned(total);
        if (chunk.hits.length) {
          collected.push(...chunk.hits);
          setHits((prev) => [...prev, ...chunk.hits]);
        }

        if (chunk.done) {
          setProgress("");
          break;
        }
        setProgress(`Scanning ${chunk.folder || "…"} · ${chunk.foldersTotal} folder(s) · ${total} checked`);

        // Bail if the cursor ever stops advancing, so a bug can't loop forever.
        const prev = cursor;
        cursor = chunk.cursor;
        if (prev && cursor && prev.folderIdx === cursor.folderIdx && prev.belowUid === cursor.belowUid) {
          if (++stallGuard > 2) throw new Error("scan stalled (cursor not advancing)");
        } else stallGuard = 0;
        if (!cursor) break;
      }
    } catch (e) {
      errored = true;
      setError(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
    if (stopRef.current) setProgress("Stopped.");

    // Fire the Discord webhook once the scan wraps up (finished or stopped), the
    // same "on finish" behaviour the old standalone scraper had.
    if (!errored && hookOnFinish && hookUrl.trim()) {
      sendNotify(collected, total, stopRef.current);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hits;
    return hits.filter((h) =>
      `${h.recipient} ${h.deliveredTo} ${h.sender} ${h.subject} ${h.folder} ${h.matched} ${h.event ?? ""}`
        .toLowerCase().includes(q)
    );
  }, [hits, search]);

  const anyExtracted = useMemo(() => hits.some(extracted), [hits]);
  // With ~50 order confirmations the useful question is "how many tickets and
  // how much did they cost in total", so total them up over what's on screen.
  const sums = useMemo(() => {
    const rows = shown.filter(extracted);
    const cur = new Set(rows.map((h) => h.currency).filter(Boolean));
    return {
      rows: rows.length,
      qty: rows.reduce((s, h) => s + (h.qty ?? 0), 0),
      total: rows.reduce((s, h) => s + (h.total ?? 0), 0),
      currency: cur.size === 1 ? [...cur][0]! : cur.size ? "mixed" : "",
    };
  }, [shown]);

  function hitsToCsv(rows: ScanHit[]): string {
    const cols: [string, (h: ScanHit) => string][] = [
      ["recipient", (h) => h.recipient],
      ["delivered_to", (h) => h.deliveredTo],
      ["sender", (h) => h.sender],
      ["sender_name", (h) => h.senderName],
      ["subject", (h) => h.subject],
      ["date", (h) => h.date],
      ["folder", (h) => h.folder],
      ["matched", (h) => h.matched],
      ["message_id", (h) => h.messageId],
      ["uid", (h) => String(h.uid)],
    ];
    // Extracted columns are appended only when the scan actually extracted
    // something, so a plain scan's CSV keeps the shape it always had.
    if (rows.some(extracted)) {
      cols.push(
        ["event", (h) => h.event ?? ""],
        ["qty", (h) => (h.qty != null ? String(h.qty) : "")],
        // Bare number: a spreadsheet must be able to SUM the column, so the
        // currency lives in its own cell rather than glued to the amount.
        ["total", (h) => (h.total != null ? h.total.toFixed(2) : "")],
        ["currency", (h) => h.currency ?? ""],
        ["order_ref", (h) => h.orderRef ?? ""],
        ["event_date", (h) => h.eventDate ?? ""],
        ["venue", (h) => h.venue ?? ""]
      );
    }
    const cell = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = cols.map((c) => c[0]).join(";");
    const out = rows.map((h) => cols.map((c) => cell(c[1](h))).join(";"));
    return "﻿" + [head, ...out].join("\r\n");
  }

  function exportCsv() {
    download(`scan_${new Date().toISOString().slice(0, 10)}.csv`, hitsToCsv(shown), "text/csv;charset=utf-8");
  }

  // A short human summary of the filter, for the Discord embed.
  function scopeString(): string {
    const parts: string[] = [];
    if (subject.trim()) parts.push(`Subject "${subject.trim()}"`);
    const ph = phrases.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ph.length) parts.push(`${ph.length} phrase(s) (${matchAll ? "all" : "any"})`);
    if (extractLa28) parts.push("LA28 details extracted");
    if (since) parts.push(`since ${since}`);
    parts.push(picked.size ? `${picked.size} folder(s)` : "all folders");
    return parts.join(" · ");
  }

  async function sendNotify(rows: ScanHit[], scannedTotal: number, stopped: boolean) {
    if (!hookUrl.trim()) {
      setHookStatus("No webhook URL set.");
      return;
    }
    setHookStatus("Sending…");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify",
          url: hookUrl.trim(),
          mentionId: hookMention.trim() || undefined,
          matches: rows.length,
          scanned: scannedTotal,
          scope: scopeString(),
          stopped,
          csv: hookAttachCsv && rows.length ? hitsToCsv(rows) : undefined,
          csvName: `scan_${new Date().toISOString().slice(0, 10)}.csv`,
        }),
      });
      const r = await res.json();
      setHookStatus(r.ok ? `Webhook sent (${r.detail}).` : `Webhook failed: ${r.detail}`);
    } catch (e) {
      setHookStatus("Webhook failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1>Scanner</h1>
      </div>
      <div className="chart-notice" style={{ marginBottom: 12 }}>
        Search the whole mailbox for anything — set a <strong>Subject</strong> and/or <strong>body phrases</strong>,
        optionally pick folders and a date, then <strong>Scan</strong>. Read-only (nothing gets marked read). A Subject
        filter makes it much faster; big scans run in chunks and you can <strong>Stop</strong> anytime.
      </div>

      <div className="scan-grid">
        {/* ── filter ── */}
        <div className="scan-panel">
          <label className="scan-label">Subject contains</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. ticket alert" />

          <label className="scan-label">Body phrases (one per line)</label>
          <textarea rows={4} value={phrases} onChange={(e) => setPhrases(e.target.value)}
                    placeholder={"Your Time Slot:\nDuration: 48 hours"} />

          <div className="scan-two">
            <div>
              <label className="scan-label">Phrase match</label>
              <select value={matchAll ? "all" : "any"} onChange={(e) => setMatchAll(e.target.value === "all")}>
                <option value="all">all must be present</option>
                <option value="any">any one is enough</option>
              </select>
            </div>
            <div>
              <label className="scan-label">Only since</label>
              <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </div>
          </div>

          <label className="scan-check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={extractLa28}
                   onChange={(e) => setExtractLa28(e.target.checked)} />
            <span>Extract LA28 order details (event · qty · total)</span>
          </label>
          <div className="hint">
            Reads each matching mail and pulls out the event, the ticket count and what was paid — different
            sport and price per mail, all read from the mail itself. Slower: it has to open every match.
          </div>

          <div className="scan-folders">
            <div className="scan-folders-head">
              <span className="scan-label" style={{ margin: 0 }}>Folders</span>
              <button className="btn btn-sm btn-ghost" onClick={loadFolders} disabled={foldersBusy}>
                {foldersBusy ? "Loading…" : "Load folders"}
              </button>
            </div>
            {folders.length > 0 && (
              <div className="scan-folder-list">
                {folders.map((f) => (
                  <label key={f.path} className={"scan-folder" + (f.skip ? " off" : "")}>
                    <input type="checkbox" disabled={f.skip} checked={picked.has(f.path)}
                           onChange={(e) =>
                             setPicked((prev) => {
                               const n = new Set(prev);
                               e.target.checked ? n.add(f.path) : n.delete(f.path);
                               return n;
                             })
                           } />
                    <span>{f.name}</span>
                    {f.skip && <span className="scan-tag">{f.reason}</span>}
                  </label>
                ))}
              </div>
            )}
            <div className="hint">Nothing ticked = every folder except trash/junk.</div>
          </div>

          <details className="scan-hook">
            <summary>
              Discord webhook <span className="scan-hook-sub">· {hookUrl.trim() ? "configured" : "off"}</span>
            </summary>
            <div className="scan-hook-body">
              <div className="scan-folders-head">
                <span className="scan-label" style={{ margin: 0 }}>Webhook URL &amp; ping</span>
                <button className="btn btn-sm btn-ghost" onClick={() => sendNotify(hits, scanned, false)}
                        disabled={!hookUrl.trim()}>Send test</button>
              </div>
              <input value={hookUrl} placeholder="https://discord.com/api/webhooks/…"
                     onChange={(e) => { setHookUrl(e.target.value); persist("scan_hook_url", e.target.value); }} />
              <input value={hookMention} placeholder="your Discord user ID (to get pinged)" style={{ marginTop: 8 }}
                     onChange={(e) => { setHookMention(e.target.value); persist("scan_hook_mention", e.target.value); }} />
              <label className="scan-check">
                <input type="checkbox" checked={hookOnFinish}
                       onChange={(e) => { setHookOnFinish(e.target.checked); persist("scan_hook_finish", e.target.checked ? "1" : "0"); }} />
                <span>Notify when a scan finishes</span>
              </label>
              <label className="scan-check">
                <input type="checkbox" checked={hookAttachCsv}
                       onChange={(e) => { setHookAttachCsv(e.target.checked); persist("scan_hook_csv", e.target.checked ? "1" : "0"); }} />
                <span>Attach the results CSV</span>
              </label>
              {hookStatus && <div className="hint" style={{ marginTop: 6 }}>{hookStatus}</div>}
            </div>
          </details>

          <div className="scan-actions">
            {!scanning ? (
              <button className="btn btn-primary" onClick={runScan}>Scan</button>
            ) : (
              <button className="btn btn-danger" onClick={() => (stopRef.current = true)}>Stop</button>
            )}
            <button className="btn btn-ghost" onClick={exportCsv} disabled={!hits.length}>Export CSV</button>
          </div>

          {error && <div className="error-banner" style={{ marginTop: 10 }}><strong>Scan error.</strong> {error}</div>}
        </div>

        {/* ── results ── */}
        <div className="scan-results">
          <div className="scan-status">
            <div className="stat"><div className="label">Matches</div><div className="value">{hits.length}</div></div>
            <div className="stat"><div className="label">Scanned</div><div className="value">{scanned}</div></div>
            {anyExtracted && (
              <>
                {/* Say outright how many mails the extractor could read. If 3 of
                    50 didn't parse, the totals below are short by 3 and you need
                    to know that, not discover it in the spreadsheet. */}
                <div className="stat">
                  <div className="label">
                    Extracted
                    {sums.rows < shown.length && (
                      <span className="stat-caveat"> · {shown.length - sums.rows} unread</span>
                    )}
                  </div>
                  <div className="value">{sums.rows}/{shown.length}</div>
                </div>
                <div className="stat"><div className="label">Tickets</div><div className="value">{sums.qty}</div></div>
                <div className="stat">
                  <div className="label">Spent</div>
                  <div className="value">{sums.total.toFixed(2)} {sums.currency}</div>
                </div>
              </>
            )}
            <div className="scan-progress">{scanning ? progress || "Scanning…" : progress}</div>
          </div>

          {hits.length > 0 && (
            <div className="table-toolbar">
              <input className="search" placeholder="Filter results…" value={search}
                     onChange={(e) => setSearch(e.target.value)} />
              {search && <span className="search-count">{shown.length} shown</span>}
            </div>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Recipient</th><th>Delivered to</th><th>Sender</th><th>Subject</th>
                  <th>Date</th><th>Folder</th>
                  {/* The three extracted columns replace "Matched" while
                      extracting — with no phrases set, Matched is always empty. */}
                  {anyExtracted ? (
                    <><th>Event</th><th className="amount-col">Qty</th><th className="amount-col">Total</th></>
                  ) : (
                    <th>Matched</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={anyExtracted ? 9 : 7} className="empty" style={{ padding: 24 }}>
                    {scanning ? "Scanning…" : "No results yet. Set a filter and hit Scan."}
                  </td></tr>
                ) : (
                  shown.slice(0, MAX_ROWS).map((h, i) => (
                    <tr key={h.messageId || `${h.uid}-${i}`}>
                      <td className="nums">{h.recipient}</td>
                      <td className="nums">{h.deliveredTo}</td>
                      <td className="nums">{h.sender}</td>
                      <td className="scan-subj" title={h.subject}>{h.subject}</td>
                      <td className="nums date-cell">{h.date}</td>
                      <td>{h.folder}</td>
                      {anyExtracted ? (
                        <>
                          <td className="scan-subj" title={h.event ?? ""}>
                            {h.event ?? <span className="unknown">—</span>}
                            {h.eventDate && <div className="entry-sub">{h.eventDate}</div>}
                          </td>
                          <td className="nums amount-col">{h.qty ?? <span className="unknown">—</span>}</td>
                          <td className="nums amount-col">
                            {h.total != null
                              ? `${h.total.toFixed(2)} ${h.currency ?? ""}`.trim()
                              : <span className="unknown">—</span>}
                          </td>
                        </>
                      ) : (
                        <td className="scan-matched" title={h.matched}>{h.matched}</td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {shown.length > MAX_ROWS && (
            <div className="hint" style={{ marginTop: 8 }}>
              Showing first {MAX_ROWS} of {shown.length}. Export CSV for all.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
