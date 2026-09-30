// ─────────────────────────────────────────────────────────────
// DeskTracker × Tikey — the bridge. Runs on your DeskTracker pages only.
//
// A web page can't talk to an extension directly without knowing its id, and an
// unpacked extension's id differs per install. So this small script sits in the
// tracker's pages and passes messages both ways: the Market page asks for an
// event, the extension answers with what it read.
//
// The manifest limits it to the tracker's own address (and localhost for
// development). That list is the security boundary: only those pages can ask
// the extension to read Tikey, and only they receive what it read.
// ─────────────────────────────────────────────────────────────

const VERSION = chrome.runtime.getManifest().version;

function toPage(payload) {
  window.postMessage({ source: "desktracker-ext", ...payload }, location.origin);
}

window.addEventListener("message", (e) => {
  // Only this page, talking to itself — never a frame or another window.
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== "desktracker-page") return;

  if (m.type === "ping") {
    toPage({ type: "pong", id: m.id, version: VERSION });
  } else if (m.type === "read") {
    chrome.runtime
      .sendMessage({ type: "read", id: m.id, vggId: String(m.vggId ?? "") })
      .catch((err) => toPage({ type: "error", id: m.id, message: `Extension unavailable: ${err.message}` }));
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.to === "page" && msg.payload) toPage(msg.payload);
  return false;
});

// Lets the page see the helper is installed without waiting for a round-trip.
document.documentElement.dataset.desktrackerExt = VERSION;
