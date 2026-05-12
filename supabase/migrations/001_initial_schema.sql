-- ============================================================
-- ASAP Campaign Runner — initial schema
-- ============================================================
-- Run this in Supabase SQL Editor for a fresh project.

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------
-- campaigns
-- ----------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- Source: which Pipedrive deals to operate on
  source_type text not null check (source_type in ('pipedrive_filter', 'pipedrive_pipeline')),
  source_config jsonb not null,
  -- For pipedrive_filter:  { "filter_id": 123 }
  -- For pipedrive_pipeline: { "pipeline_id": 5, "stage_id": 42 (optional) }

  -- Action
  action_type text not null check (action_type in ('update_deal_field', 'send_email', 'send_sms')),
  action_config jsonb not null,
  -- For update_deal_field:
  --   { "field_key": "f1c65d5cd...",
  --     "field_name": "Potential Client Campaigns",
  --     "value_mode": "fixed" | "chain",
  --     "fixed_value": "<option_id_or_text>",       (if fixed)
  --     "chain": [                                  (if chain)
  --       { "from_value": null,    "to_value": 41 },     -- null means "blank"
  --       { "from_value": 41,      "to_value": 42 },
  --       ...
  --     ]
  --   }

  -- Pacing
  rate_per_minute numeric not null default 1 check (rate_per_minute > 0),
  business_hours_start time not null default '08:00',
  business_hours_end   time not null default '17:00',
  timezone text not null default 'America/Chicago',
  skip_weekends boolean not null default true,
  skip_holidays boolean not null default true,
  custom_skip_dates date[] not null default '{}',
  randomize_within_minute boolean not null default true,

  -- Status
  status text not null default 'draft'
    check (status in ('draft', 'launching', 'running', 'paused', 'completed', 'failed', 'cancelled')),

  -- Resumable queueing state — populated when status='launching' and used
  -- by the scheduler to pick up where it left off if queueing spans
  -- multiple function invocations.
  -- {
  --   "next_scheduled_at": "ISO",    -- where the schedule cursor sits
  --   "pipedrive_cursor": "...",     -- v2 cursor for next page of deals
  --   "deals_seen": 0,               -- how many deals we've inspected
  --   "deals_queued": 0              -- how many we've written to queue_items
  -- }
  launch_state jsonb not null default '{}'::jsonb,

  -- Stats
  total_items   integer not null default 0,
  sent_count    integer not null default 0,
  failed_count  integer not null default 0,
  skipped_count integer not null default 0,

  -- Timestamps
  created_at  timestamptz not null default now(),
  launched_at timestamptz,
  completed_at timestamptz,
  estimated_completion_at timestamptz,

  -- Raw snapshot of all matching deals at launch time, for audit
  audience_snapshot_count integer
);

create index if not exists campaigns_status_idx on campaigns(status);
create index if not exists campaigns_created_at_idx on campaigns(created_at desc);


-- ----------------------------------------------------------------
-- queue_items — one row per (campaign × deal)
-- ----------------------------------------------------------------
create table if not exists queue_items (
  id bigserial primary key,
  campaign_id uuid not null references campaigns(id) on delete cascade,

  -- Target
  pipedrive_deal_id bigint not null,
  pipedrive_deal_title text,

  -- What we'll actually do when the queue runs this row
  action_payload jsonb not null,
  -- For update_deal_field:
  --   { "field_key": "...", "current_value": <any>, "new_value": <any> }

  -- Scheduling
  scheduled_at timestamptz not null,

  -- Status
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  sent_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),

  -- Prevent the same campaign from queuing the same deal twice
  unique (campaign_id, pipedrive_deal_id)
);

create index if not exists queue_pending_idx
  on queue_items (scheduled_at) where status = 'pending';

create index if not exists queue_campaign_status_idx
  on queue_items (campaign_id, status);


-- ----------------------------------------------------------------
-- holidays — US federal + custom company holidays
-- ----------------------------------------------------------------
create table if not exists holidays (
  id bigserial primary key,
  date date not null unique,
  name text not null,
  is_federal boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed US federal holidays (observed) through 2027.
-- Joe can add company-specific shutdown days through the UI later.
insert into holidays (date, name, is_federal) values
  -- 2026
  ('2026-01-01', 'New Year''s Day', true),
  ('2026-01-19', 'MLK Day', true),
  ('2026-02-16', 'Presidents'' Day', true),
  ('2026-05-25', 'Memorial Day', true),
  ('2026-06-19', 'Juneteenth', true),
  ('2026-07-03', 'Independence Day (observed)', true),
  ('2026-09-07', 'Labor Day', true),
  ('2026-10-12', 'Columbus Day', true),
  ('2026-11-11', 'Veterans Day', true),
  ('2026-11-26', 'Thanksgiving', true),
  ('2026-12-25', 'Christmas Day', true),
  -- 2027
  ('2027-01-01', 'New Year''s Day', true),
  ('2027-01-18', 'MLK Day', true),
  ('2027-02-15', 'Presidents'' Day', true),
  ('2027-05-31', 'Memorial Day', true),
  ('2027-06-18', 'Juneteenth (observed)', true),
  ('2027-07-05', 'Independence Day (observed)', true),
  ('2027-09-06', 'Labor Day', true),
  ('2027-10-11', 'Columbus Day', true),
  ('2027-11-11', 'Veterans Day', true),
  ('2027-11-25', 'Thanksgiving', true),
  ('2027-12-24', 'Christmas Day (observed)', true)
on conflict (date) do nothing;


-- ----------------------------------------------------------------
-- Helper: atomic stat increments for the queue processor
-- ----------------------------------------------------------------
create or replace function increment_campaign_sent(p_campaign_id uuid)
returns void language sql as $$
  update campaigns set sent_count = sent_count + 1 where id = p_campaign_id;
$$;

create or replace function increment_campaign_failed(p_campaign_id uuid)
returns void language sql as $$
  update campaigns set failed_count = failed_count + 1 where id = p_campaign_id;
$$;


-- ----------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------
-- The app uses the service-role key for all backend operations and
-- gates UI access with a shared APP_PASSWORD cookie, so RLS isn't
-- doing meaningful enforcement here — but enabling it prevents
-- accidental anon-key reads if the anon key ever leaks.
alter table campaigns    enable row level security;
alter table queue_items  enable row level security;
alter table holidays     enable row level security;

-- No policies = no access for anon/authed-via-anon keys.
-- Service role bypasses RLS, which is what the API routes use.
