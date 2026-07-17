# Ticket Tracker

Dashboard for tracking ticket buys & sells, with an IMAP mail poller that
auto-adds sales from Viagogo / Seatix emails and pings a Discord webhook.

## Flow

```
Viagogo / Seatix email  →  IMAP poller (Vercel cron)  →  parser  →  Supabase
                                                                      │
                                          Next.js dashboard ──────────┘
                                                                      │
                                          Discord webhook (notify) ───┘
```

Discord is **notification only** — it never feeds data back into the app.

## Two sides, two owners

The dashboard splits a ticket row down the middle, and the split is the design:

| | Purchase side | Sell side |
|---|---|---|
| **Filled by** | you, in `PurchaseModal` | the mail poller |
| **Fields** | event, location, section/row/seats, ticket type, count, buy price, currency, order no., email used, payment method, VGG id, comment | sell price, qty sold, status, `sold_at` |
| **Manual override** | — | `SellModal` (the Sell button) |

`PurchaseModal` has no sell price on purpose: one field, one owner. It mirrors the
tool this was modelled on, minus its Retailer field.

Price per ticket and total price are **one number, not two**. Only `buy_price`
(the batch total) is stored; per-ticket is `buy_price / qty_total`, and the form
rewrites each box as you type in the other. Two editable columns for one fact
drift apart, and then neither is trustworthy.

## Profit is realized on the sold portion only

`profit = sell_price − buy_price × (qty_sold / qty_total)`

The cost of tickets still in inventory is tracked (it's in `buy_price`) but never
subtracted from profit until those tickets sell. So a 4/6 batch sold below its
total cost can still show a profit — the 2 unsold tickets are stock, not a loss.
Fully sold → `sell − buy`. Nothing sold → `0`, never `−buy`.

This lives in **two places that must agree**: `realizedProfit()` in
`lib/supabase.ts` (what the UI shows) and the `profit` generated column in
`supabase/schema.sql` (for queries). Charts, the headline total, and the table
all filter on `qty_sold > 0 && buy_price > 0` — a row counts once it has sold
something *and* its cost is known.

Imported inventory (`source = 'import'`) comes from an inventory-tool CSV export.
Its "Profit" column was reproduced exactly by the formula above on all 141 sold
rows (verified at import). `partially_sold` rows collapse to `sold` — `qty_sold <
qty_total` already carries the "partial" fact — with the original noted in the
comment. There's no sale date in the export, so imported rows use the **event
date** as their chart-timeline anchor.

## The one rule that shapes everything

**The poller fills in the sell side only. Buy prices are always typed in by hand.**

Nothing in a sale email says what *we* paid. Seatix prints a "Total face value",
but that's the value printed on the ticket, not our cost — buying under or over
face is the entire trade, so treating them as equal would fabricate the profit.
`parseSeatix` still reads `faceValue`, but `poll-mail` deliberately never writes
it to `buy_price`.

Consequence: an auto-added sale lands with `buy_price = 0`. A sale whose cost we
don't know has **no known profit** — not an overstated one — so those rows are
held out of the charts and out of the headline total entirely, rather than
plotted with a caveat. Charting the payout as profit would answer "how am I
doing?" with the wrong quantity. The table shows them with a dashed
**+ buy price** button and a dash where the profit would be; the header reads
`0/1 priced`; the charts carry a banner counting them. Fill the buy price in and
everything appears. Numbers are never quietly flattering.

## Re-running the schema

`supabase/schema.sql` is idempotent and **safe to run against a table with real
rows**: `create table if not exists` for a fresh install, `add column if not
exists` per later column, and a guarded `rename` for `venue` → `location`. Never
drop-and-recreate it.

## Setup

1. **Supabase**: create a project, open the SQL editor, run `supabase/schema.sql`.
2. **Env**: copy `.env.example` → `.env.local`, fill in Supabase keys, Zoho IMAP
   creds (use a Zoho *app-specific password*), and your Discord webhook URL.
3. **Install & run**: `npm install && npm run dev`.
4. **Deploy**: see "Deploy & scheduling" below — GitHub → Vercel → env vars, plus
   an external 5-min pinger because Hobby cron only runs once a day.

## Parsers

Two platforms are supported: **Viagogo** (`automated@orders.viagogo.com`) and
**Seatix/Seatiks** (`delivery@seatiks.com`, whose mails say "Platform: Gigsberg").
Anything else — `we-list.com`, etc. — classifies as `unknown` and is skipped.
Platforms are detected by **body content, not sender**, because mail arrives
forwarded through a catch-all.

Both parsers are tested against **real sale emails** kept verbatim in
`lib/parsers/__fixtures__/real-emails.ts`. Run `npm test` after touching a regex.

`parseViagogo` finds the event name and venue **by position, not keywords** — the
date line (`Wednesday, July 15, 2026 - 03:00 pm`) is the anchor, the event name is
the non-empty line above it, the venue the one below. An earlier version keyed off
`/World Cup|vs/` and `/Stadium/`; on a concert at an arena it didn't skip the mail,
it inserted `eventName: "Congrats, you sold 2 tickets!"` with a correct-looking
price. The fixture file has that concert as a regression guard.

If the essentials (order ref, event name, payout) are missing, the parser returns
`null` and the mail is flagged for review rather than inserted.

## Two traps that only showed up when the poller actually ran

Both typechecked, built, and looked correct on the page. Neither survived one
real run against the live inbox.

**1. Next caches the database.** `supabaseAdmin()` passes its own
`fetch(..., { cache: "no-store" })`. Next patches the global fetch and caches
GETs; supabase-js calls that patched fetch, so a read gets served from Next's
Data Cache instead of Postgres. The poller wrote the watermark to 39004, re-read
a cached 38989 on the next run, and re-processed the same 15 messages — forever.
On Vercel, cron would have chewed the same batch every 5 minutes and never
reached a sale. **Don't remove that fetch override.**

**2. A partial index can't be an ON CONFLICT target.** `tickets_external_id_uniq`
is `where external_id is not null`, and Postgres rejects
`on_conflict=external_id` against it (`42P10`) unless the statement repeats the
predicate — which PostgREST's upsert never does. Every insert failed. The poller
now does a plain `insert` and treats `23505` as "already have it". Don't convert
it back to `.upsert(..., { onConflict: "external_id" })`.

## Deploy & scheduling

### Cron auth (this is settled, don't second-guess it)

Vercel **does** send `Authorization: Bearer <CRON_SECRET>` automatically once the
`CRON_SECRET` env var is set — this is Vercel's own documented pattern, and the
route's `auth !== \`Bearer ${CRON_SECRET}\`` check matches it exactly. (An earlier
version of this README claimed the opposite; that was wrong.) The same header,
same secret, is what the external pinger below sends, so both callers are
authenticated by one check.

### The free-plan scheduling problem

On the **Hobby (free) plan, a cron can only run once per day**, and a more
frequent expression **fails the deployment** — so `*/5 * * * *` is not an option.
Once a day is useless for "ping me when a sale lands." So:

- `vercel.json` holds a **daily** cron (`0 6 * * *`) — a free catch-up backstop
  that keeps the deploy valid.
- Real-time cadence comes from an **external scheduler** hitting the endpoint
  every 5 min. It's just an HTTP GET with the bearer header:
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/poll-mail`
  Set this up on cron-job.org (free): URL = the endpoint, add a request header
  `Authorization: Bearer <CRON_SECRET>`, interval 5 min.

Pro plan ($20/mo) removes this — then `*/5 * * * *` in `vercel.json` works
natively and the external pinger isn't needed.

### Deploy steps

1. Push this repo to GitHub.
2. Import it into Vercel (New Project → pick the repo).
3. Add env vars in Vercel → Settings → Environment Variables — the same keys as
   `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`,
   `IMAP_PASSWORD`, `DISCORD_WEBHOOK_URL`, `CRON_SECRET`.
4. Deploy. Then set up the cron-job.org pinger above.
5. Test once by hand:
   `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/poll-mail`

## Notes

- `profit` is a generated column in Postgres, pro-rata on the sold portion
  (`sell − buy × qty_sold/qty_total`); see "Profit is realized on the sold portion
  only" above. ROI % is computed in the app.
- The seat lives in three columns — `section`, `seat_row`, `seats` — the way the
  emails state it and the way the form edits it. It's joined into one string only
  for display. `seat_row`, not `row`: ROW is reserved in Postgres.
- Chart colours are validated against this app's own panel surface (`#161616`),
  not a default one. If the palette moves, re-run the dataviz validator rather
  than eyeballing it.
- The app name is the `APP_NAME` constant at the top of `app/page.tsx`.
- `sold_at` is when the sale happened; `event_date` is the match itself, usually
  in the future. The charts' time axis is `sold_at ?? created_at` — a trigger
  stamps `sold_at` when a row first turns `sold`.
- Charts count **sold rows only**. Unsold stock is money tied up, not a loss;
  summing every row used to report a listed ticket as negative profit.
- **The poller never touches the mailbox.** INBOX is opened `readOnly`, so the
  server cannot set `\Seen`, and "where we got to" lives in the `poll_state`
  table as an IMAP UID watermark. An earlier version used *unseen* as its queue
  and marked each message read — pointed at this account (a working inbox: 29k
  messages, 2.5k unread) its first run would have marked 2,558 real emails as
  read, irreversibly, and timed out halfway. Read state belongs to the mailbox's
  owner; processing state belongs to the app.
- First run adopts the current UID and backfills nothing — tracking starts from
  then on. `MAX_PER_RUN` caps a batch so a backlog can't blow the 60s budget.
- The watermark advances only after a clean run; any insert failure holds it and
  the batch is retried. At-least-once, with `external_id` (e.g.
  `viagogo:647501669`) as the unique key to swallow repeats. Seatix/Seatiks mails
  carry no order number at all, so their key is a hash of event + date + seat.
- IMAP running inside a serverless function is fine for a low poll rate. If Zoho
  rate-limits or you scale up, move the poller to a small always-on worker.
- `next.config.js` must use `experimental.serverComponentsExternalPackages` —
  this is Next 14, where the bare `serverExternalPackages` (Next 15) is silently
  ignored and `imapflow` gets bundled.
