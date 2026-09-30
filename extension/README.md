# DeskTracker × Tikey

Lets the **Market** page in DeskTracker read an event's Tikey Sales Tracker page
in your own browser. You work only in the tracker: paste a viagogo event link,
press **Find**, and the event appears there a few seconds later — laid out like
Tikey's page, with every sale, and the A.I analysis one click away.

## How it works

1. You paste a viagogo link on the Market page and press **Find**.
2. The tracker takes the event id from the link (`…/E-161613747`) and asks this
   extension for that event.
3. The extension opens `tikeymanager.com/salestracker/viagogo/event/E-161613747`
   in a **background tab of your browser** — signed in as you, past Tikey's
   security check as you — waits until the numbers have loaded, reads them, and
   closes the tab.
4. It hands what it read back to the Market page, which shows it. **Nothing is
   stored**; a new Find is a new read.

## What it reads

- **The page as shown**: the eight statistics, the event header, the first page
  of the sales table.
- **The page's own data**: the JSON Tikey's scripts load to draw the page — the
  whole sales history (not just the 50 rows on screen), the listings on offer,
  the chart series. `tap.js` keeps a copy of those responses as they arrive, in
  the tab's memory, and hands them over once when the reader asks. It is the
  same information the browser's DevTools Network tab shows. It changes no
  request and sends nothing anywhere.

The tracker makes sense of that data itself (`lib/market/deep.ts`), so when
Tikey changes its format the fix is a deploy of the tracker, not a reinstall.

## What it does and does not do

- **Only when you ask.** One event per Find or Refresh. No schedule, no queue,
  nothing running between requests.
- **Only Tikey's Sales Tracker page for that event.** The address is built inside
  the extension from the viagogo id alone; the tracker can't make it open
  anything else.
- **Leaves your own browsing alone.** On Tikey pages you open yourself the reader
  does nothing — it asks the extension "was this tab requested?" first. (`tap.js`
  still keeps its in-memory copy there, and it is thrown away with the tab.)
- **Talks only to your tracker.** Its bridge runs only on
  `ticket-tracker-two.vercel.app` (and `localhost` for development). No other
  site can ask it for anything or receive what it reads.
- **Holds no secret and never talks to the server.**

Automated reading may not be allowed by Tikey's terms of service, even of data
your account can see. That is a risk to the Tikey account, and yours to weigh.

## Install (once) — and after every update

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this `extension` folder. If it's already installed,
   press the **reload** icon (↻) on its card instead — an update does nothing
   until you do.
4. Be signed in to Tikey in the same browser.
5. Reload the Market page. "Tikey reader ready" shows next to the title.

There is nothing to configure.

## When something goes wrong

The Market page says what happened in plain words — not signed in to Tikey, the
tab was closed, the page took too long. When the read worked but something
wasn't found (a tile, the header, the full sales history), a notice names it and
offers **Copy details for the fix**: the page's text in order plus a description
of the data it loaded. Send that, and the reader can be taught the new layout.

A tab that hasn't finished after 25 seconds is brought to the front, because some
pages hold back work while their tab is hidden. It is closed again once read.

## If the tracker moves to another address

Add it to the bridge's `matches` in `manifest.json` and reload the extension.
Keep that list exact: it is the list of sites allowed to ask this extension to
read Tikey.

## Files

| file | job |
|---|---|
| `bridge.js` | on the tracker's pages: passes messages between the Market page and the extension |
| `background.js` | opens the requested event's tab, hands the result back, closes the tab |
| `tap.js` | in Tikey's page world: keeps a copy of the JSON the page loads |
| `reader.js` | on Tikey's Sales Tracker page: reads it, but only in a tab the tracker asked for |
