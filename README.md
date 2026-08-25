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

## Access

The dashboard and `/api/tickets` sit behind a short **HTTP Basic Auth** gate
(`middleware.ts`, `APP_USER` / `APP_PASSWORD`) — the browser's native
username/password prompt, no login page. `/api/cron/poll-mail` is excluded and
keeps its own `CRON_SECRET` Bearer auth, so the external pinger reaches it without
the login. The two auth schemes share the `Authorization` header but never
collide because the cron path is outside the middleware matcher.

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

## Cashflow: money that isn't a ticket batch

A ticket row answers "how did this batch do?". It cannot answer *"I sold some
LA28 codes today for €300"* — income with no purchase, no seats, no event. The
`entries` table (page: **Cashflow**, API: `/api/entries`) holds those: a
description, an amount, a date, and optionally a category, a note and the ticket
it relates to. `ticket_id` is nullable **on purpose** — being able to record
money that has nothing to do with a listing is the entire reason the table
exists.

Two rules:

- **`amount` is always positive; `kind` (`income` | `expense`) carries the
  sign.** Signed amounts mean one missing minus silently turns a cost into
  income, and every `SUM` needs a `CASE` to split the two anyway. The one place
  the sign is applied is `signedAmount()`.
- **Cash entries never enter the ticket charts.** "Profit by month", Revenue,
  Invested and ROI are ticket-batch quantities; folding a code sale into them
  would make ROI meaningless. The combined figure lives on the Cashflow page as
  **Overall incl. tickets** = this page's net + realized ticket profit over the
  same period.

Entries load alongside tickets in the `(app)` layout via `Promise.allSettled`,
so a missing `entries` table (schema not re-run yet) shows a banner on the
Cashflow page and leaves the rest of the dashboard working.

## Invested now: the money still out

`tied up = buy_price − (paid_out ? realized cost : 0)`

The **Invested now** figure on the Events page is how much of your own cash is
sitting in tickets at this moment. Two things are out at any time: stock you
bought and haven't sold, and rows that sold but whose payout hasn't landed —
sold ≠ paid, platforms pay days after the event. Ticking **Paid** on a row says
the cash arrived, and what arrived covers exactly the sold portion's cost, so
that part drops out while any unsold remainder keeps counting.

**Invested now** and **Awaiting payout** are the same money seen from both sides
— cost still out, revenue still owed — and both are **balances, not flows**, so
both deliberately ignore the period tabs. Money sunk into a purchase two years
ago is still sunk today; a payout owed since May is still owed in July. A window
could only ever report either one too low, and Awaiting payout used to do exactly
that: on 1M it read ~9.4k short while the invested figure beside it (which never
filtered) stayed put. Two numbers about the same money computed over different
sets is how a header stops being believable. `· all rows` marks both while a
period is selected. Rows with no buy price can't be counted (their cost is
unknown) and are admitted as `· N unpriced` rather than folded in as zero.

The rest of that header stays period-scoped, because those figures really are
flows or counts of the window: Sold, Problems, Total profit.

`realizedCost` / `tiedUpCost` / `openInvestment` live in `lib/supabase.ts` and are
pinned down by `lib/money.test.ts` — half-sold batches, a payout that landed, a
`qty_sold` that overshoots `qty_total`. Run both suites with `npm test`.

## To do

A scratchpad for work that still has to go into the tracker — "add the buy
prices for the LA28 batch", "chase the Cardiff payout" — with an optional
deadline. Free text on purpose: it gets written in a hurry, and a form with
required fields would just stop it being written.

Order is the whole value of the page, so it isn't a sortable table: **overdue
first, then today, then by deadline, undated below that, finished at the
bottom**. Within the undated group the newest is first — an undated note is a
thought you just had, not a task from last month. The sidebar badge counts what's
open and turns **red** the moment something is late, so a missed deadline shows
from every page.

Dates are compared as `yyyy-mm-dd` strings, never parsed into `Date`, so nothing
can shift by a day in a non-UTC timezone; `todayISO()` is deliberately local
rather than `toISOString()`, which is UTC and reads as yesterday late in the
evening. `lib/todo.test.ts` pins both, plus the year/month boundaries.

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

Re-run it after pulling a change that touches the schema — the Cashflow page
needs the `entries` table, and until the file has been run again `/api/entries`
answers `Could not find the table 'public.entries'`.

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

## Scanner: LA28 order extraction

The Scanner normally reports mail *metadata* (who/when/subject/folder). Tick
**Extract LA28 order details** and each matching mail is also read for the three
things a purchase confirmation actually says — **event**, **ticket count**,
**amount paid** — plus order #, event date and venue in the CSV. The parser is
`lib/parsers/la28.ts`; it is **scanner-only** and writes nothing to the database.
Buy prices still get typed in by hand (see the rule above); this just saves
reading 50 mails by eye.

Nothing about a sport, price or quantity is hard-coded — every field comes out of
the mail — so the same scan handles 50 confirmations that are each a different
event at a different price. Three traps it has to survive, all covered by
fixtures in `parsers.test.ts`:

- **The service fee repeats the ticket count.** `8 × $40.00` then `8 × $9.61`
  sums to 16 tickets unless fee rows are excluded, which is done by label. That
  also keeps a two-category order (`4 × B` + `2 × C` = 6) correct.
- **`Subtotal` ends in "total".** Every total regex is anchored, and `Order
  total` is preferred over the closing `Total` row.
- **text and html parts both carry the same order.** They are concatenated for
  phrase matching, but extraction reads only ONE part (`pickExtractSource`) —
  otherwise every quantity doubles.

`htmlToText` (now `lib/htmlText.ts`) turns block tags into **newlines** rather
than spaces. These mails are nested tables; with everything on one line a
label/value pair like `Venue:` / the address can't be told apart from the next
cell. Wrapped values (`<br>` mid-address) are rejoined on the dangling comma.

## The poller reads envelopes first

This catch-all mailbox takes thousands of messages a day and almost none of them
are sales. Bodies cost ~0.4s each and a few dozen fit in a run; envelopes come
back at ~450/second. So the poller scans envelopes across a wide window and pays
for bodies only where a sale could plausibly be — otherwise it processes ~180
messages an hour against a thousand arriving, falls behind every hour, and never
reaches a sale. That is not hypothetical: it happened twice.

**The filter is an ALLOW-list**, and it started as the opposite. The deny-list
was chosen on the belief — stated in this README, and in `seatix.ts` — that
Seatix mail arrives *forwarded through the catch-all*, so filtering on sender
could drop real sales. Measuring the mailbox disproved it: sales arrive straight
from their own domains (`automated@orders.viagogo.com`, `sales@seatiks.com`).
Meanwhile a deny-list has to be taught every new flood and is silently useless
until it is — which is exactly what happened when 2,397 "Confirm your RSVP"
messages arrived from a domain nobody had seen before and the poller fell behind
again.

Measured over 2,954 real envelopes: **315 opened (10.7 %), and no platform mail
among the skipped**. That second number is the one that matters.

An allow-list's own risk is the mirror image — a sale from somewhere unexpected
gets skipped, and skipping is invisible. Two things answer that: a subject test
that opens sale-shaped mail whatever the sender (`Sale confirmation …`, `you
sold`, `Order - 651889083`), and the poller reporting its **top skipped sender
domains** in the cron response, so an unfamiliar platform surfaces somewhere
rather than nowhere.

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

## The Seatix alert module (standalone)

`/api/cron/seatix-alert` is a mail→Discord relay and nothing else: it reads new
mail, keeps only what `parseSeatix` recognises, and posts each sale to its **own**
webhook (`SEATIX_WEBHOOK_URL`) tagging a **role** (`SEATIX_ROLE_ID`).

It is deliberately separate from the dashboard:

| | |
|---|---|
| **UI** | none. A route handler never reaches the client bundle, so the dashboard doesn't grow by a byte and never waits on it. |
| **Database** | writes nothing to `tickets`. No rows, no seat matching, no review queue — the sale poller owns all of that and is untouched. |
| **State** | one row in `poll_state` under its own key, `INBOX@seatix-alert`. No migration: that table is keyed by name, so the row appears on first run. |

**Its own watermark is the whole trick.** A watermark records where *one reader*
got to. Two readers on the same INBOX sharing a row would consume each other's
mail — whichever ran first would advance past a message and hide it from the
other forever. `fetchNewEmails({ stateKey })` takes the key; omitting it keeps
the sale poller on the exact row it has always used.

Both alerts fire for a Seatix sale — the poller's to `DISCORD_WEBHOOK_URL`, this
one to `SEATIX_WEBHOOK_URL` with the role ping. That's the point: different
channel, different audience.

A role is mentioned as **`<@&id>`**. The user syntax `<@id>` renders as a dead
grey mention and pings nobody, and `allowed_mentions: { parse: [], roles: [id] }`
is what stops an event name containing `@everyone` from turning the webhook into
a megaphone. Both halves are pinned in `lib/discord.test.ts`.

Setup:

1. Set `SEATIX_WEBHOOK_URL` and `SEATIX_ROLE_ID` in Vercel → Environment
   Variables. (Role ID: Server Settings → Roles → right-click → Copy Role ID,
   with Developer Mode on.)
2. Verify without waiting for a sale:
   `curl -H "Authorization: Bearer <CRON_SECRET>" "https://<app>.vercel.app/api/cron/seatix-alert?test=1"`
   — posts a sample alert, reads no mail, moves no watermark.
3. Add a **second** cron-job.org job pointing at
   `/api/cron/seatix-alert` with the same `Authorization: Bearer <CRON_SECRET>`
   header. It is deliberately not in `vercel.json`: Hobby cron fires once a day,
   useless for a sale alert, and a second entry would only risk the plan's cron
   limit on every deploy.

Missing `SEATIX_WEBHOOK_URL` → the endpoint returns **503 and reads no mail**,
rather than quietly advancing its watermark past sales nobody was told about.
A failed Discord post holds the watermark too, so an outage delays alerts
instead of losing them.

## The Discord → Discord relay (standalone)

`/api/cron/discord-relay` reads a channel you can see but don't own, and reposts
new messages to your own webhook. A bot on the REST API (`GET
/channels/{id}/messages` every few minutes), so there's no gateway connection to
keep alive and it fits the same serverless cron as everything else. No UI,
nothing written to `tickets`, no schema change.

Two Discord-side requirements, both of which fail **silently**:

- the bot needs **View Channel + Read Message History** on that channel;
- the app needs the **MESSAGE CONTENT intent** (Developer Portal → Bot →
  Privileged Gateway Intents). It gates `content`, `embeds`, `attachments` and
  `components`, and applies to the REST API too — without it the bot still sees
  the messages, it just sees them EMPTY, which reads exactly like a quiet
  channel. `?peek=1` and the `emptyContent` counter exist to make that visible.

Setup:

1. discord.com/developers → New Application → Bot → copy the token, and switch
   **Message Content Intent** on.
2. OAuth2 → URL Generator → scope `bot`, permissions **View Channel** +
   **Read Message History** → open the link and add it to the source server.
   *This step needs someone with Manage Server there.*
3. Set `RELAY_BOT_TOKEN` and `RELAY_SOURCE_CHANNEL_ID` in Vercel, redeploy.
4. Check it: `?peek=1` reports whether the bot can see the channel and whether
   content is arriving — without relaying anything or moving the cursor.
5. Point a cron-job.org job at the bare URL.

The first run adopts the current position and backfills nothing, like the mail
poller. Empty messages still advance the cursor — otherwise it would stick on
one forever, which is exactly the trap the mail watermark fell into.

`allowed_mentions: { parse: [] }` on every relayed post is not optional: this
forwards text written by someone else, so without it a source message containing
`@everyone` would fire `@everyone` in **your** server.

Reading a channel with a *user* account needs no bot and no permission, and is a
Terms of Service violation that gets accounts banned. It isn't offered here.

## The Pushover → Discord bridge (standalone)

Some tools only know how to shout into Pushover — they take a user key and an
app token and offer nothing else. `/api/cron/pushover-bridge` relays those into
a Discord channel. Same shape as the Seatix module: no UI, nothing written to
`tickets`, no schema change (its "highest relayed id" lives in `poll_state`
under `pushover@bridge`, which is the same idea as a mail watermark).

Receiving is only possible through Pushover's **Open Client API** — the ordinary
API just sends. Two consequences worth knowing before relying on it:

- **Login takes the account password, not a key.** So it happens once, via
  `?setup=1`, and only the resulting `secret` and `device_id` are kept. Those can
  read messages; they cannot own the account. The password is never stored.
- **Pushover licenses an Open Client as a desktop device** — a Pushover for
  Desktop licence is required within 30 days of activating one.

Setup — step 1 reads `CRON_SECRET` out of `.env.local`, so there is nothing to
look up by hand:

```
# 1. once, from the ticket-tracker folder. Prints the variables to paste
#    into Vercel. The password is used for this one call and never stored.
node scripts/pushover-setup.mjs you@example.com "your-password" [2fa-code]

# 2. after adding them in Vercel and redeploying — check the webhook
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://<app>.vercel.app/api/cron/pushover-bridge?test=1"

# 3. optional, later: a key per source. Paste the result into that app's
#    USER KEY field, leaving its own app token alone.
curl -H "Authorization: Bearer <CRON_SECRET>" \
  "https://<app>.vercel.app/api/cron/pushover-bridge?group=ticket-bot"
```

Then point a cron-job.org job at the bare URL, like the other two.

`PUSHOVER_WEBHOOK_URL` is optional: leave it unset and relayed notifications go
to `DISCORD_WEBHOOK_URL`, the same place sale alerts already land.

A **group key is used in place of a user key**, which is what makes one key per
source possible: each app gets its own, they all still deliver to you, and the
relay labels every alert with the app that sent it. What can't be done is
minting someone else's *user* key — those only come from a person registering.

Acknowledgement is deliberate: messages are marked delivered at Pushover only
after they reach Discord, and the loop stops at the first webhook failure. A
Discord outage delays alerts rather than eating them — the same contract as the
mail watermark.

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
   `IMAP_PASSWORD`, `DISCORD_WEBHOOK_URL`, `APP_USER`, `APP_PASSWORD`,
   `CRON_SECRET`. **Without `APP_USER`/`APP_PASSWORD` the app fails closed (503)** —
   the login gate refuses to serve rather than expose the dashboard.
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
