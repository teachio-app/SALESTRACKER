# DeskTracker Market Capture

Saves the Sales Tracker pages you open into your own tracker, so you build a
price and volume history of your own.

## Why this exists

Resale sales data has **no archive**. Every tracker's history starts the day it
began watching — which is why an event in January 2027 shows "first sale:
15 Sep 2026". Nothing can backfill it. A day not captured is gone for good.

So the point is not the dashboard. The point is that from the day you install
this, every event you look at starts accumulating a history that is yours,
stays yours if you cancel the subscription, and that you can run your own
analysis over.

## What it does and does not do

- **Does**: read a page that is already on your screen, and post what it read to
  your own endpoint.
- **Does not**: browse, follow links, request pages you did not open, run in the
  background, or send anything anywhere except the URL you configure.

That distinction is the whole design. A script that walked the site on its own
would be scraping, would show up as unusual traffic, and would put the account
you pay for at risk. This is indistinguishable from you using the site normally,
because that is all it is.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → choose this `extension/` folder.
4. Click **Details → Extension options** and fill in:
   - **Ingest URL** — `https://<your-app>.vercel.app/api/market/ingest`
   - **Ingest token** — the value of `MARKET_INGEST_TOKEN`

Before it can store anything, the tables have to exist: run `supabase/schema.sql`
in the Supabase SQL editor, and set `MARKET_INGEST_TOKEN` in the Vercel project's
environment variables.

## Where it shows up

The **Market** page in DeskTracker. Every captured event is listed there with its
latest numbers; open one for the reading, its history charts and the captured
sales. Paste a viagogo event link into the box at the top to jump straight to it —
the capture records the viagogo link printed beside the event's title, so a
pasted link lands on the right event exactly.

## Checking it works

Open any Sales Tracker page and the browser console (F12). Each capture logs a
line:

```
[DeskTracker] captured "NBA Manchester: …" — 47 new sale(s), 3 already known, snapshot saved
```

Failures are logged loudly too, on purpose: a capture tool that fails quietly
looks exactly like a quiet market, and you would not find out for weeks.

## When the site changes

Values are found **by their label** ("Total Sales", "Floor Price") and table
columns **by their header**, never by CSS class — class names are generated and
change on every deploy, labels rarely change at all.

If a redesign does break it, the fix is usually in `lib/market/parse.ts` on the
server, not here: the extension sends raw strings and does no parsing, so most
changes are a deploy rather than a reinstall.

## Adapting it to another site

`manifest.json` → `host_permissions` and `content_scripts.matches` decide where
it runs. `content.js` → `TILES` maps each stored field to the label printed under
it. Both are a few lines.
