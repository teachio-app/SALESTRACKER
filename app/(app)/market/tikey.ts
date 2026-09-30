"use client";

import { useEffect, useState } from "react";
import type { Capture } from "@/lib/market/types";
import type { Deep } from "@/lib/market/deep";

// ─────────────────────────────────────────────────────────────
// Talking to the "DeskTracker × Tikey" browser extension from the Market page.
//
// The browser won't let this page read a Tikey tab — one site can't read
// another. The extension can, in your own signed-in browser, so the page asks it
// for an event by viagogo id and gets back what the page showed. Messages go
// through window.postMessage to the extension's bridge script, which only runs
// on this tracker's own address.
//
// Nothing is stored: the page renders what came back, and a new Find is a new
// read. The extension holds no secret and never talks to the server.
// ─────────────────────────────────────────────────────────────

export type ReadDiag = {
  title?: string;
  path?: string;
  heading?: string;
  tilesFound?: number;
  tilesLoaded?: number;
  saleRows?: number;
};

export class ReadError extends Error {
  constructor(message: string, readonly diag?: ReadDiag) {
    super(message);
  }
}

/** A read that worked — possibly with some fields the page didn't yield. */
export type ReadResult = {
  capture: Capture;
  /** Human names of what couldn't be read, e.g. "event date", "“24h sales” tile". */
  missing: string[];
  /** The page's text lines, sent only when something is missing — to fix the reader from. */
  outline?: string[];
  /** The JSON the page's own scripts loaded, from the extension's tap (v3+). */
  deep?: Deep;
};

type FromExt =
  | { source: "desktracker-ext"; type: "pong"; id: string; version: string }
  | { source: "desktracker-ext"; type: "progress"; id: string; message: string }
  | ({ source: "desktracker-ext"; type: "result"; id: string } & ReadResult)
  | { source: "desktracker-ext"; type: "error"; id: string; message: string; diag?: ReadDiag };

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function onExt(handler: (m: FromExt) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.source === "desktracker-ext") handler(e.data as FromExt);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

function toExt(msg: Record<string, unknown>) {
  window.postMessage({ source: "desktracker-page", ...msg }, window.location.origin);
}

/**
 * Is the extension here? "checking" briefly on load, then its version or
 * "missing". The bridge stamps the page before anything renders, so this is
 * usually known at once; the ping covers a bridge that loaded late.
 */
export function useTikeyHelper(): "checking" | "missing" | string {
  const [state, setState] = useState<"checking" | "missing" | string>("checking");
  useEffect(() => {
    const stamped = document.documentElement.dataset.desktrackerExt;
    if (stamped) { setState(stamped); return; }
    const id = newId();
    const off = onExt((m) => { if (m.type === "pong" && m.id === id) { setState(m.version); off(); } });
    toExt({ type: "ping", id });
    const t = setTimeout(() => { off(); setState((s) => (s === "checking" ? "missing" : s)); }, 1200);
    return () => { off(); clearTimeout(t); };
  }, []);
  return state;
}

/**
 * Ask the extension to read one event's Sales Tracker page.
 *
 * Resolves with the raw capture; rejects with a ReadError whose message is
 * written for the person pressing the button, and whose `diag` says what the
 * reader actually found on the page — the thing needed to fix it if Tikey
 * changes its layout.
 */
export function readFromTikey(vggId: string, onProgress?: (message: string) => void): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    const id = newId();
    // Longer than the extension's own limits, so its specific message wins.
    const t = setTimeout(() => { off(); reject(new ReadError("No answer from the extension.")); }, 70_000);
    const off = onExt((m) => {
      if (m.id !== id) return;
      if (m.type === "progress") onProgress?.(m.message);
      else if (m.type === "result") {
        clearTimeout(t); off();
        resolve({ capture: m.capture, missing: m.missing ?? [], outline: m.outline, deep: m.deep });
      }
      else if (m.type === "error") { clearTimeout(t); off(); reject(new ReadError(m.message, m.diag)); }
    });
    toExt({ type: "read", id, vggId });
  });
}
