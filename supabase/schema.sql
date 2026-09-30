-- Ticket tracker schema (Supabase / Postgres)
-- Run this in the Supabase SQL editor. Safe to re-run.

create extension if not exists "pgcrypto";

-- Postgres has no "create type if not exists", so guard it by hand — otherwise
-- a second run of this file dies here with "type already exists".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum ('sold', 'listed', 'not_listed');
  end if;
end $$;

create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,
  event_date    date,
  location      text,                 -- e.g. "Cardiff - UK" / "Mercedes-Benz Stadium, Atlanta"
  section       text,                 -- "L35"   — kept apart from row/seats on purpose
  seat_row      text,                 -- "20".  NOT `row`: ROW is a reserved word in
                                      -- Postgres, so that column would need quoting in
                                      -- every statement forever. Labelled "Row" in the UI.
  seats         text,                 -- "15-16"
  qty_total     int  not null default 1,   -- tickets bought in this batch
  qty_sold      int  not null default 0,
  status        ticket_status not null default 'not_listed',
  buy_price     numeric(12,2) not null default 0,   -- TOTAL cost of the batch, typed by hand.
                                      -- Price-per-ticket is derived (buy_price / qty_total),
                                      -- never stored: two columns for one fact drift apart.
  sell_price    numeric(12,2) not null default 0,   -- total revenue so far, from the poller
  currency      text not null default 'EUR',
  order_ref     text,                 -- platform order number, e.g. "159627734"
  source        text,                 -- 'viagogo' | 'seatix' | 'manual'
  external_id   text,                 -- dedupe key: platform + order id
  needs_review  boolean not null default false,  -- flagged when the poller wasn't sure
  purchase_date date,                 -- when WE bought (≠ event_date, ≠ sold_at)
  ticket_type   text,                 -- 'Mobile' | 'PDF' | 'Hard ticket' | 'Season card'
  email_used    text,                 -- which inbox the order went to
  payment_method text,                -- 'PayPal' | card | …
  vgg_event_id  text,                 -- viagogo's own event id, for cross-referencing
  comment       text,
  sold_at       timestamptz,          -- when the sale happened (NOT event_date, which is
                                      -- the match itself and usually in the future).
                                      -- The poller sets it from the mail; the chart's
                                      -- time axis is coalesce(sold_at, created_at).
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Migration for a table created by an earlier run of this file ──────
-- `create table if not exists` above does nothing once the table exists, so
-- every column added later needs its own idempotent step. Never a drop+recreate:
-- this file must stay safe to run against a table with real rows in it.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'tickets' and column_name = 'venue')
     and not exists (select 1 from information_schema.columns
                     where table_name = 'tickets' and column_name = 'location') then
    alter table tickets rename column venue to location;
  end if;
end $$;

alter table tickets add column if not exists seat_row       text;
alter table tickets add column if not exists seats          text;
alter table tickets add column if not exists purchase_date  date;
alter table tickets add column if not exists ticket_type    text;
alter table tickets add column if not exists email_used     text;
alter table tickets add column if not exists payment_method text;
alter table tickets add column if not exists vgg_event_id   text;
alter table tickets add column if not exists comment        text;
-- Has the payout actually landed in the bank? Sold ≠ paid — platforms pay days
-- after the event. Toggled by the checkbox in the events table.
alter table tickets add column if not exists paid_out       boolean not null default false;

-- Manual "something's wrong with this transaction" flag — a short-paid refund, a
-- payment mismatch, a buyer dispute. User-set only (the poller never touches it);
-- flagged rows glow red in the table so a problem can't be forgotten. flag_note
-- holds the optional description of what's wrong.
alter table tickets add column if not exists flagged        boolean not null default false;
alter table tickets add column if not exists flag_note      text;

-- Individual sales that make up a batch: a purchase of 4 can sell as 2 @ €240
-- then 2 @ €200. Each element is { qty, amount, at, ext? } where amount is the
-- TOTAL for that fill. sell_price / qty_sold on the row stay as the aggregates
-- (app keeps them in step), so the generated profit column and all filters keep
-- working; this column just holds the itemised detail so it can be edited.
alter table tickets add column if not exists sales          jsonb not null default '[]';

-- One-time seed: turn each already-sold row's aggregate into a single fill, so
-- existing rows show their sale in the new editor. Only touches rows that have
-- no itemised sales yet, so it's safe to re-run.
update tickets
set sales = jsonb_build_array(jsonb_build_object(
  'qty', qty_sold, 'amount', sell_price, 'at', coalesce(sold_at::text, event_date::text)
))
where qty_sold > 0 and sales = '[]'::jsonb;

-- ── Cash entries: money in / money out, ticket-related or not ────────
-- The tickets table answers "how did this batch do?". It cannot answer "I sold
-- some LA28 codes today for 300" — income with no purchase, no seats, no event
-- behind it. Bending a ticket row into holding that (a fake 1-ticket purchase
-- with an invented event name) would pollute every count, chart and export, so
-- those live in their own ledger.
--
-- `amount` is ALWAYS positive; `kind` carries the sign. Signed amounts mean one
-- missing minus silently turns a cost into income, and every SUM needs a CASE to
-- split the two anyway.
--
-- ticket_id is optional on purpose — that's the point of this table. Set it and
-- the entry shows which event it belongs to (a 12 EUR delivery fee on one
-- order); deleting that ticket nulls the link instead of taking the entry with
-- it, because the money moved whether or not the row still exists.
create table if not exists entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'income',
  description text not null,
  amount      numeric(12,2) not null default 0,
  currency    text not null default 'EUR',
  category    text,                  -- free text, e.g. "Codes", "Fees", "Travel"
  occurred_at date not null default current_date,   -- when the money moved
  ticket_id   uuid references tickets (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Idempotent steps for a table made by an earlier run of this file.
alter table entries add column if not exists category text;
alter table entries add column if not exists note     text;

-- `add constraint` has no IF NOT EXISTS, so guard it like the enum above.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'entries_kind_chk') then
    alter table entries add constraint entries_kind_chk check (kind in ('income', 'expense'));
  end if;
end $$;

-- Same lockdown as tickets: RLS on, zero policies. Reached only through the
-- server-side service-role key.
alter table entries enable row level security;

create index if not exists entries_occurred_at_idx on entries (occurred_at);
create index if not exists entries_ticket_id_idx   on entries (ticket_id);

-- ── To-do: things to put into the tracker later ──────────────────────
-- A scratchpad for work that isn't done yet: "add the buy prices for the LA28
-- batch", "chase the Cardiff payout". Free text on purpose — it is written in a
-- hurry, and a form with required fields would just stop it being written.
--
-- `due` is nullable because most notes have no deadline; the ones that do are
-- the point of having it. `done` is kept rather than deleted so a finished list
-- still shows what was cleared, and `done_at` records when.
create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  due        date,
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same lockdown as every other table here: RLS on, zero policies, reached only
-- through the server-side service-role key.
alter table todos enable row level security;

create index if not exists todos_due_idx  on todos (due);
create index if not exists todos_done_idx on todos (done);

-- ── Poller watermark ─────────────────────────────────────────────────
-- Where the mail poller got to, so processing state lives HERE and not in the
-- owner's mailbox.
--
-- The poller used to treat "unseen" as its queue: it read every unread message
-- in INBOX and marked each \Seen. Against this account — a real working mailbox,
-- 29k messages, 2.5k unread — one run would have marked 2,558 genuine emails as
-- read, irreversibly (nothing records which were unread beforehand), while
-- timing out halfway through the serverless function's 60s budget. Read state is
-- the owner's; processing state is ours. They are not the same thing.
--
-- IMAP hands out monotonically increasing UIDs per mailbox, so remembering the
-- last one is enough. uid_validity guards the rare case where the server
-- renumbers the mailbox — if it changes, the old watermark is meaningless.
create table if not exists poll_state (
  mailbox      text primary key,
  uid_validity bigint not null,
  last_uid     bigint not null,
  updated_at   timestamptz not null default now()
);

alter table poll_state enable row level security;

-- ── Lock the table down ──────────────────────────────────────────────
-- A table made via SQL starts with RLS OFF, and Supabase exposes every table
-- over PostgREST. Left as-is, anyone holding the project URL + anon key (which
-- is public by design) could read and rewrite this table.
--
-- RLS on + zero policies = anon and authenticated get nothing at all. That's
-- the whole access model here: the app never uses the anon key, it reaches
-- Postgres only through the server-side service-role key, which bypasses RLS.
-- If you ever add a browser-side query, it will correctly return nothing until
-- you write a policy for it on purpose.
alter table tickets enable row level security;

-- Profit is derived: realized profit counts only the tickets actually sold, so
-- the unsold part of a batch is inventory rather than a loss.
--     profit = sell_price − buy_price × (qty_sold / qty_total)
-- Fully sold → sell − buy. Nothing sold → 0. The app's realizedProfit() must
-- match this exactly (lib/supabase.ts).
--
-- A generated column's expression can't be ALTERed in place, and it's fully
-- derived (no data to lose), so drop and re-add. Idempotent: the drop clears any
-- earlier `sell - buy` definition, the add installs the pro-rata one.
alter table tickets drop column if exists profit;
alter table tickets
  add column profit numeric(12,2)
  generated always as (sell_price - buy_price * qty_sold / nullif(qty_total, 0)) stored;

-- Prevent the mail poller from inserting the same sale twice.
create unique index if not exists tickets_external_id_uniq
  on tickets (external_id)
  where external_id is not null;

create index if not exists tickets_event_date_idx on tickets (event_date);
create index if not exists tickets_status_idx on tickets (status);
create index if not exists tickets_sold_at_idx on tickets (sold_at);

-- Stamp sold_at the moment a row first becomes 'sold' (manual edits in the UI;
-- the poller sets it explicitly from the mail date).
-- `set search_path = ''` keeps Supabase's linter quiet (it flags functions with a
-- mutable search_path). Safe here: these bodies touch only NEW and now(), and
-- now() lives in pg_catalog, which is always resolvable.
create or replace function stamp_sold_at()
returns trigger
set search_path = ''
as $$
begin
  if new.status = 'sold' and new.sold_at is null then
    new.sold_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists tickets_stamp_sold on tickets;
create trigger tickets_stamp_sold
  before insert or update on tickets
  for each row execute function stamp_sold_at();

-- keep updated_at fresh
create or replace function touch_updated_at()
returns trigger
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tickets_touch on tickets;
create trigger tickets_touch
  before update on tickets
  for each row execute function touch_updated_at();

-- Cash entries get the same treatment (the app polls on updated_at to decide
-- whether anything actually changed, so a stale stamp means a missed refresh).
drop trigger if exists entries_touch on entries;
create trigger entries_touch
  before update on entries
  for each row execute function touch_updated_at();

drop trigger if exists todos_touch on todos;
create trigger todos_touch
  before update on todos
  for each row execute function touch_updated_at();

-- Stamp done_at the moment an item is first ticked off, and clear it if the
-- item is reopened — so the timestamp can never claim something is finished
-- when the checkbox says otherwise.
create or replace function stamp_done_at()
returns trigger
set search_path = ''
as $$
begin
  if new.done and not coalesce(old.done, false) then
    new.done_at = now();
  elsif not new.done then
    new.done_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists todos_stamp_done on todos;
create trigger todos_stamp_done
  before insert or update on todos
  for each row execute function stamp_done_at();

-- ── Alert log ────────────────────────────────────────────────────────
-- What the standalone alerters (Seatix, sneakers) have already announced.
--
-- Those modules write nothing to `tickets` by design, which left them with no
-- memory. It surfaced when a forwarding loop on the mail account delivered every
-- message twice (same second, consecutive UIDs) and every sale pinged Discord
-- twice. The tracker never showed a double because tickets.external_id is
-- unique; the alerters had no equivalent. This is it.
--
-- The loop has been turned off, so this now guards the general case rather than
-- that one: any repeat read pings again — a hand-rewound watermark, a
-- redelivered mail, overlapping cron runs.
--
-- The primary key is doing real work: two cron runs can overlap and both hold
-- the same message, and only a uniqueness constraint can decide which one gets
-- to post. See lib/alertLog.ts for the claim/release protocol.
--
-- `channel` namespaces the key, so a third alerter needs no new table. Rows are
-- tiny and write-once; prune with
--     delete from alert_log where at < now() - interval '180 days';
-- if it ever matters.
create table if not exists alert_log (
  channel text not null,
  key     text not null,
  at      timestamptz not null default now(),
  primary key (channel, key)
);

alter table alert_log enable row level security;

create index if not exists alert_log_at_idx on alert_log (at);

-- ── Market capture ───────────────────────────────────────────────────
-- Sales-tracker data for events on the resale market, captured from pages the
-- owner opens in their own browser and posted here by a small extension.
--
-- Why it exists: the tracker knows everything about tickets already bought and
-- nothing about the ones worth buying. "Is this event moving?" is answered by
-- sell-through, velocity and how deep the supply is, and none of that is in a
-- mailbox.
--
-- Why it is stored HERE rather than read on demand: this data has no archive.
-- Every tracker's history starts the day it began watching — which is why a
-- January 2027 event can show "first sale: 15 Sep 2026" — and nothing can
-- backfill it. Days not captured are gone. So capture is cheap and permanent,
-- and the analysis is written later against whatever has accumulated.

create table if not exists market_events (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,            -- where the capture came from
  source_event_id   text not null,            -- that source's id, from the URL
  url               text,
  name              text not null,
  event_date        date,
  venue             text,
  city              text,
  country           text,
  -- How closely this event is being followed. Set by hand; the capture never
  -- downgrades it, so marking something 'owned' sticks.
  tier              text not null default 'watch',
  first_seen_at     timestamptz not null default now(),
  last_captured_at  timestamptz,
  unique (source, source_event_id)
);

-- One row per capture: the statistics tiles, as they read at that moment.
-- THIS is the time series. Two captures days apart give velocity, supply
-- movement and price drift that no single page view can show.
--
-- Every measure is nullable on purpose. A tile that hasn't loaded reads "N/A",
-- and null is the honest record of that — 0 would read as a sell-out.
create table if not exists market_snapshots (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references market_events (id) on delete cascade,
  captured_at       timestamptz not null,
  total_sales       int,
  total_tickets     int,
  average_price     numeric(12,2),
  floor_price       numeric(12,2),
  sales_24h         int,
  first_sale        date,
  listings          int,
  tickets_available int,
  currency          text not null default 'EUR',
  created_at        timestamptz not null default now()
);

-- Individual sales, deduped across captures.
--
-- `fingerprint` is the seat identity when seats are readable (the same seats
-- cannot sell twice) and a time-bucketed shape when they are not — the page
-- sometimes renders junk like "from - froo". See lib/market/parse.ts.
--
-- `sold_at_approx` is derived from "9h ago" and the capture time, so it is
-- worth roughly ±30 minutes; `precision` says how much to trust it and
-- `raw_update` keeps the original text for when a reading turns out wrong.
create table if not exists market_sales (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references market_events (id) on delete cascade,
  fingerprint    text not null,
  price          numeric(12,2),
  qty            int,
  currency       text not null default 'EUR',
  section        text,
  seat_row       text,
  seats          text,
  sold_at_approx timestamptz,
  precision      text,
  raw_update     text,
  first_seen_at  timestamptz not null default now(),
  unique (event_id, fingerprint)
);

alter table market_events    enable row level security;
alter table market_snapshots enable row level security;
alter table market_sales     enable row level security;

create index if not exists market_snapshots_event_idx on market_snapshots (event_id, captured_at desc);
create index if not exists market_sales_event_idx     on market_sales (event_id, sold_at_approx desc);
create index if not exists market_events_date_idx     on market_events (event_date);

-- The viagogo event a captured page is about, read off the viagogo link on
-- that page. It is what lets a pasted viagogo link on the Market page land on
-- the right capture exactly, instead of by guessing from the name.
alter table market_events add column if not exists vgg_event_id text;
create index if not exists market_events_vgg_idx on market_events (vgg_event_id);
