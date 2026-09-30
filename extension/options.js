// Settings for the capture script. Two fields, stored in the browser's synced
// extension storage — never in the page, and never sent anywhere except to the
// endpoint you enter here.

const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(["endpoint", "token"]).then(({ endpoint, token }) => {
  if (endpoint) $("endpoint").value = endpoint;
  if (token) $("token").value = token;
});

function say(message, ok) {
  const el = $("status");
  el.textContent = message;
  el.className = ok ? "ok" : "bad";
  if (ok) setTimeout(() => (el.textContent = ""), 2500);
}

$("save").addEventListener("click", async () => {
  const endpoint = $("endpoint").value.trim();
  const token = $("token").value.trim();

  if (!endpoint || !token) return say("Both fields are needed.", false);

  // Catch the two mistakes that otherwise fail silently later: a URL that isn't
  // one, and pointing at the app's root instead of the ingest route. Both would
  // look exactly like "the market is quiet".
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return say("That is not a URL.", false);
  }
  if (!url.pathname.endsWith("/api/market/ingest")) {
    return say("URL should end with /api/market/ingest", false);
  }

  await chrome.storage.sync.set({ endpoint, token });
  say("Saved.", true);
});
