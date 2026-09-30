// ─────────────────────────────────────────────────────────────
// DeskTracker × Tikey — the coordinator.
//
// The tracker asks for one event by its viagogo id. This opens that event's
// Sales Tracker page in a background tab of YOUR browser, lets reader.js read
// it, hands the result back to the tracker tab that asked, and closes the tab.
//
// What it will open is fixed here, not by the caller: the tracker sends a
// number, and the only address ever built from it is Tikey's own Sales Tracker
// page for that viagogo event. A page that somehow reached this extension could
// not make it open anything else.
//
// One read at a time, and only when asked. There is no queue, no schedule and
// nothing running in the background between requests.
// ─────────────────────────────────────────────────────────────

const tikeyUrl = (vggId) => `https://www.tikeymanager.com/salestracker/viagogo/event/E-${vggId}`;
const VGG_ID = /^\d{5,12}$/;

/** A background tab that hasn't delivered by now is brought forward to finish. */
const FOCUS_AFTER_MS = 25_000;
/** And given up on after this. reader.js stops at 40s, so this is a backstop. */
const GIVE_UP_MS = 50_000;

// State lives in storage.session, not only in variables: a Manifest V3 worker
// can be stopped between two messages, and the tab it opened would otherwise
// become an orphan nobody answers for.
const getPending = async () => (await chrome.storage.session.get("pending")).pending ?? null;
const setPending = (p) => chrome.storage.session.set({ pending: p });

const timers = { focus: null, giveUp: null };
function clearTimers() {
  clearTimeout(timers.focus);
  clearTimeout(timers.giveUp);
  timers.focus = timers.giveUp = null;
}

/** Deliver to the tracker tab that asked. bridge.js passes it to the page. */
function tell(requesterTabId, payload) {
  return chrome.tabs.sendMessage(requesterTabId, { to: "page", payload }).catch(() => {
    /* the tracker tab was closed or reloaded — nobody left to tell */
  });
}

async function startRead(msg, requesterTabId) {
  if (!VGG_ID.test(String(msg.vggId ?? ""))) {
    return tell(requesterTabId, { type: "error", id: msg.id, message: "That isn't a viagogo event id." });
  }
  const busy = await getPending();
  if (busy) {
    return tell(requesterTabId, { type: "error", id: msg.id, message: "Already reading another event — wait for it to finish." });
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: tikeyUrl(msg.vggId), active: false });
  } catch (e) {
    return tell(requesterTabId, { type: "error", id: msg.id, message: `Couldn't open Tikey: ${e.message}` });
  }
  await setPending({ tabId: tab.id, requesterTabId, id: msg.id, vggId: msg.vggId, at: Date.now() });
  tell(requesterTabId, { type: "progress", id: msg.id, message: "Opening Tikey in a background tab…" });

  clearTimers();
  // Some pages hold back work while their tab is hidden. If this one hasn't
  // delivered, bring it forward rather than fail — you asked for this read, so
  // seeing the tab for a moment is better than seeing an error.
  timers.focus = setTimeout(async () => {
    const p = await getPending();
    if (!p || p.tabId !== tab.id) return;
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    tell(p.requesterTabId, { type: "progress", id: p.id, message: "Bringing the Tikey tab forward to finish loading…" });
  }, FOCUS_AFTER_MS);
  timers.giveUp = setTimeout(() => finish(tab.id, { type: "error", message: "Tikey took too long to load." }), GIVE_UP_MS);
}

/** Close the tab, return focus to the tracker, report, clear state. */
async function finish(tabId, payload) {
  const p = await getPending();
  if (!p || p.tabId !== tabId) return;
  clearTimers();
  await setPending(null);
  chrome.tabs.remove(tabId).catch(() => {});
  chrome.tabs.update(p.requesterTabId, { active: true }).catch(() => {});
  tell(p.requesterTabId, { ...payload, id: p.id, vggId: p.vggId });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!msg || tabId == null) return false;

  switch (msg.type) {
    // From the tracker (via bridge.js).
    case "read":
      startRead(msg, tabId);
      return false;

    // From reader.js: "was I asked for?" Anything else it loads on stays untouched.
    case "hello":
      getPending().then((p) => sendResponse({ read: !!p && p.tabId === tabId }));
      return true; // async reply

    case "progress":
      getPending().then((p) => {
        if (p && p.tabId === tabId) tell(p.requesterTabId, { type: "progress", id: p.id, message: msg.message });
      });
      return false;

    case "captured":
      finish(tabId, { type: "result", capture: msg.capture });
      return false;

    case "failed":
      finish(tabId, { type: "error", message: msg.message, diag: msg.diag });
      return false;
  }
  return false;
});

// You closed the Tikey tab yourself: say so instead of waiting out the timeout.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const p = await getPending();
  if (p && p.tabId === tabId) {
    clearTimers();
    await setPending(null);
    tell(p.requesterTabId, { type: "error", id: p.id, vggId: p.vggId, message: "The Tikey tab was closed before it finished." });
  }
});

// A leftover from a browser restart mid-read must not block the next one.
chrome.runtime.onStartup.addListener(() => setPending(null));
chrome.runtime.onInstalled.addListener(() => setPending(null));
