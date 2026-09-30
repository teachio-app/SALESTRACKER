// ─────────────────────────────────────────────────────────────
// DeskTracker × Tikey — the tap. Runs in the Sales Tracker page's OWN script
// world ("world": "MAIN" in the manifest), from the very start of the page.
//
// Why it exists: the page shows 50 sales at a time out of, say, 1,321, and its
// charts are drawn from data that never appears as text. The page's scripts
// already fetched all of it, for you, with your session — this keeps a copy of
// those JSON responses as they arrive, so the tracker can see the whole sales
// history rather than the first page of it. It is the same information the
// browser's own DevTools Network tab shows.
//
// What it does NOT do: change any request, send anything anywhere, or keep
// anything beyond the tab's lifetime. The copies sit in memory until reader.js
// (the extension's isolated script, which only acts in a tab the tracker asked
// for) requests them with a window message; then they are handed over once.
// ─────────────────────────────────────────────────────────────

(() => {
  if (window.__desktrackerTap) return;
  window.__desktrackerTap = true;

  const MAX_ITEMS = 40;
  const MAX_BYTES = 8_000_000;
  const MAX_ONE = 5_000_000;
  const buf = [];
  let bytes = 0;

  function keep(url, text) {
    if (typeof text !== "string" || !text || text.length > MAX_ONE) return;
    const t = text.trim();
    if (t[0] !== "{" && t[0] !== "[") return;
    let json;
    try { json = JSON.parse(t); } catch { return; }
    buf.push({ url: String(url || "").slice(0, 300), at: Date.now(), json, size: t.length });
    bytes += t.length;
    while (buf.length > MAX_ITEMS || bytes > MAX_BYTES) bytes -= buf.shift().size;
  }

  // fetch: pass the response through untouched; read a clone on the side.
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const ct = res.headers.get("content-type") || "";
          if (/json/i.test(ct)) {
            const url = res.url || (args[0] && args[0].url) || String(args[0] || "");
            res.clone().text().then((t) => keep(url, t)).catch(() => {});
          }
        } catch { /* never let the tap break the page */ }
        return res;
      });
    };
  }

  // XMLHttpRequest: same, on load.
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__dtUrl = url;
    return XO.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (!/json/i.test(ct)) return;
        if (this.responseType === "" || this.responseType === "text") keep(this.__dtUrl, this.responseText);
        else if (this.responseType === "json" && this.response) keep(this.__dtUrl, JSON.stringify(this.response));
      } catch { /* ignore */ }
    });
    return XS.apply(this, a);
  };

  /**
   * Chart data, when the page draws with ApexCharts (its zoom/pan/menu toolbar
   * is ApexCharts'). Registered instances expose their series; charts without
   * an id aren't registered, which is why this is a second source, not the first.
   */
  function apexCharts() {
    const list = (window.Apex && window.Apex._chartInstances) || [];
    const out = [];
    for (const entry of list.slice(0, 12)) {
      try {
        const w = entry && entry.chart && entry.chart.w;
        if (!w) continue;
        const cfg = w.config || {};
        const y = Array.isArray(cfg.yaxis) ? cfg.yaxis[0] : cfg.yaxis;
        out.push(JSON.parse(JSON.stringify({
          id: String(entry.id || ""),
          type: (cfg.chart && cfg.chart.type) || "",
          title: (cfg.title && cfg.title.text) || "",
          yTitle: (y && y.title && y.title.text) || "",
          xType: (cfg.xaxis && cfg.xaxis.type) || "",
          categories: ((cfg.xaxis && cfg.xaxis.categories) || []).slice(0, 3000),
          labels: (cfg.labels || []).slice(0, 500),
          series: (cfg.series || []).slice(0, 6).map((s) =>
            typeof s === "number" ? { name: "", data: [s] } : { name: s.name || "", data: (s.data || []).slice(0, 4000) }),
        })));
      } catch { /* a chart that can't be copied is skipped */ }
    }
    return out;
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "desktracker-reader" || e.data.type !== "collect") return;
    let payloads = [];
    try {
      payloads = buf.map(({ url, at, json }) => ({ url, at, json }));
    } catch { payloads = []; }
    window.postMessage({ source: "desktracker-tap", type: "collected", id: e.data.id, payloads, apex: apexCharts() }, location.origin);
  });
})();
