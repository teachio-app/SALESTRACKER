"use client";

import { useMemo, useRef, useState } from "react";
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

export default function ScannerPage() {
  const [subject, setSubject] = useState("");
  const [phrases, setPhrases] = useState("");
  const [matchAll, setMatchAll] = useState(true);
  const [since, setSince] = useState("");
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

  function currentFilter() {
    return {
      subjectContains: subject.trim(),
      bodyPhrases: phrases.split("\n").map((s) => s.trim()).filter(Boolean),
      matchAll,
      since: since || undefined,
      folders: picked.size ? [...picked] : undefined,
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
        if (chunk.hits.length) setHits((prev) => [...prev, ...chunk.hits]);

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
      setError(e instanceof Error ? e.message : String(e));
    }
    setScanning(false);
    if (stopRef.current) setProgress("Stopped.");
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hits;
    return hits.filter((h) =>
      `${h.recipient} ${h.deliveredTo} ${h.sender} ${h.subject} ${h.folder} ${h.matched}`.toLowerCase().includes(q)
    );
  }, [hits, search]);

  function exportCsv() {
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
    const cell = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = cols.map((c) => c[0]).join(";");
    const rows = shown.map((h) => cols.map((c) => cell(c[1](h))).join(";"));
    download(`scan_${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + [head, ...rows].join("\r\n"), "text/csv;charset=utf-8");
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
                  <th>Date</th><th>Folder</th><th>Matched</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={7} className="empty" style={{ padding: 24 }}>
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
                      <td className="scan-matched" title={h.matched}>{h.matched}</td>
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
