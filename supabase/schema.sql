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
