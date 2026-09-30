# DeskTracker × Tikey

Lets the **Market** page in DeskTracker read an event's Tikey Sales Tracker page
in your own browser. You work only in the tracker: paste a viagogo event link,
press **Find**, and the numbers appear there a few seconds later.

## How it works

1. You paste a viagogo link on the Market page and press **Find**.
2. The tracker takes the event id from the link (`…/E-161613747`) and asks this
   extension for that event.
3. The extension opens `tikeymanager.com/salestracker/viagogo/event/E-161613747`
   in a **background tab of your browser** — signed in as you, past Tikey's
   security check as you — waits until the numbers have loaded, reads them, and
   closes the tab.
4. It hands what it read back to the Market page, which stores it with the login
   it already has. Each Find adds a point to that event's history.

## What it does and does not do

- **Only when you ask.** One event per Find or Refresh. No schedule, no queue,
  nothing running between requests.
- **Only Tikey's Sales Tracker page for that event.** The address is built inside
  the extension from the viagogo id alone; the tracker can't make it open
  anything else.
- **Leaves your own browsing alone.** Tikey pages you open yourself are not read —
  the reader asks the extension "was this tab requested?" and does nothing if not.
- **Talks only to your tracker.** Its bridge runs only on
  `ticket-tracker-two.vercel.app` (and `localhost` for development). No other
  site can ask it for anything or receive what it reads.
- **Holds no secret and never talks to the server.** The Market page does the
  storing, with your normal login.

Automated reading may not be allowed by Tikey's terms of service, even of data
your account can see. That is a risk to the Tikey account, and yours to weigh.

## Install (once)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → choose this `extension` folder.
4. Be signed in to Tikey in the same browser.
5. Reload the Market page. The "Paste a viagogo event link" box now reads from
   Tikey when you press **Find**.

There is nothing to configure.

## When something goes wrong

The Market page says what happened in plain words — not signed in to Tikey, the
tab was closed, the page took too long. When the extension reached the page but
couldn't read it, **What the extension saw** lists the page title, the event name
it found, how many of the 8 number tiles it found and loaded, and how many sale
rows. That is exactly what's needed to fix the reader if Tikey changes its layout.

A tab that hasn't finished after 25 seconds is brought to the front, because some
pages hold back work while their tab is hidden. It is closed again once read.

## When Tikey changes its layout

Values are found **by their label** ("Total Sales", "Floor Price") and table
columns **by their header**, never by CSS class — class names change with every
deploy of a site, labels almost never do. The extension sends raw text and the
tracker parses it (`lib/market/parse.ts`), so most fixes are a deploy of the
tracker, not a reinstall of this.

## If the tracker moves to another address

Add it to `content_scripts[1].matches` in `manifest.json` and press the reload
icon on the extension's card in `chrome://extensions`. Keep that list exact: it is
the list of sites allowed to ask this extension to read Tikey.

## Files

| file | job |
|---|---|
| `bridge.js` | on the tracker's pages: passes messages between the Market page and the extension |
| `background.js` | opens the requested event's tab, hands the result back, closes the tab |
| `reader.js` | on Tikey's Sales Tracker page: reads it, but only in a tab the tracker asked for |
