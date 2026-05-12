# ASAP Campaign Runner

Internal marketing automation that bulk-updates Pipedrive deal fields on a
business-hours schedule. Replaces the Zapier-based field-update step for
campaigns like "Missed Opps drip", advancing thousands of deals one per
minute so downstream automations send messages at a sane pace.

**Phase 1 (now):** Update Pipedrive deal custom field, fixed value or
progression chain.
**Phase 2 (later):** Send RingCentral SMS directly.
**Phase 3 (later):** Send Outlook email via Microsoft Graph.

---

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres + service-role key, no auth UI — see "Access" below)
- Netlify (hosting + scheduled functions running cron `* * * * *`)
- Pipedrive API v2 (deals, pipelines, stages, fields) + v1 (filters)
- Luxon for timezone math

---

## Architecture in one paragraph

A campaign is a row in the `campaigns` table. When you hit Launch, the
status flips to `launching` and a small JSONB `launch_state` is seeded.
A single Netlify scheduled function (`netlify/functions/process-queue.mts`)
runs every minute and does two jobs each tick: (1) execute up to 10 due
`queue_items` whose campaign is `running`, (2) for one `launching`
campaign, walk the next batch of deals from Pipedrive, resolve each
deal's target value via the action config, and insert `queue_items` rows
with computed `scheduled_at` timestamps. Once all deals are queued the
campaign flips to `running`. Pacing respects business hours, weekends,
and US holidays (configured per campaign).

---

## One-time setup

You'll need: a GitHub account, a Supabase account, a Netlify account, and
a Pipedrive admin login.

### 1. Create Supabase project

1. Go to https://supabase.com → New project.
2. Name: `asap-campaign-runner`. Pick a region near you (us-east-2 or
   us-west-1). Set a strong DB password (you won't need it again).
3. Wait for provisioning (~2 min).
4. In the SQL Editor, paste the entire contents of
   `supabase/migrations/001_initial_schema.sql` and run it. You should
   see "Success. No rows returned." plus the seeded holidays.
5. Grab three values from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not actually
     used by the app since we go through service role, but harmless to
     set — Supabase JS prefers it to exist)
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Create GitHub repo and push

```powershell
cd C:\path\to\asap-campaign-runner
git init
git add .
git commit -m "Initial commit"
gh repo create primenationalcredit-ai/asap-campaign-runner --private --source=. --remote=origin
git push -u origin main
```

(If you don't use `gh`, create the repo on github.com first, then
`git remote add origin git@github.com:primenationalcredit-ai/asap-campaign-runner.git`
followed by `git push -u origin main`.)

### 3. Connect to Netlify

1. https://app.netlify.com → Add new site → Import an existing project.
2. Pick GitHub → `primenationalcredit-ai/asap-campaign-runner`.
3. Build settings should auto-detect from `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `.next`
4. Before clicking Deploy, click **Environment variables → Add a
   variable → Import from .env**. Paste in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   PIPEDRIVE_API_TOKEN=YOUR-40-CHAR-TOKEN
   PIPEDRIVE_COMPANY_DOMAIN=your-company-domain
   APP_PASSWORD=pick-something-strong
   ```

   - `PIPEDRIVE_COMPANY_DOMAIN` is the `XXX` in `XXX.pipedrive.com`
     when you log into Pipedrive (it's NOT a full URL).
   - `APP_PASSWORD` is the shared login password for the app. Anyone
     who knows it can log in. Pick at least 16 random characters.
5. Deploy. First build takes ~3 min.
6. Once deployed, optionally rename the Netlify subdomain under **Site
   configuration → Site information** (e.g. `asap-campaigns`).

### 4. Verify the scheduled function

In Netlify under **Functions**, you should see `process-queue` listed
as a scheduled function on cron `* * * * *`. Click it → Logs to watch
it tick (you should see "tick complete: executed=0 queued=0 completed=0"
once per minute when no campaigns are running).

### 5. Rotate your Pipedrive token

The token you pasted into chat earlier should be considered compromised.
After the app is deployed and verified working:

1. Pipedrive → Settings → Personal Preferences → API → Regenerate token.
2. Netlify → Site → Environment variables → edit `PIPEDRIVE_API_TOKEN`
   → paste new token → Save.
3. Trigger a redeploy (Site → Deploys → Trigger deploy → Deploy site).

---

## Launching the Missed Opps 30K campaign

1. Go to `https://YOUR-SITE.netlify.app/login`, enter your `APP_PASSWORD`.
2. Click **+ New campaign**.
3. Basics:
   - Name: `Missed Opps — advance to next stage`
   - Description: (optional, e.g. "Bumps every Missed Opps deal forward
     one stage. Stops at 21.")
4. Audience: pick **Pipeline / stage** → "Missed Opportunities" (no
   stage filter, all stages). Click **Preview audience** to confirm
   the count is ~30K. If you'd rather use the same Pipedrive filter
   you used in Zapier, switch to **Pipedrive filter** and pick it.
5. Action:
   - Field: **Potential Client Campaigns** (the app will fetch its
     dropdown options automatically — you should see Missed Opps 1, 4,
     7, 10, 13, 16, 19, 21 in the option lists).
   - Value mode: **Chain**.
   - Click **+ Add step** 8 times and build:
     - `(blank)` → `Missed Opps 1`
     - `Missed Opps 1` → `Missed Opps 4`
     - `Missed Opps 4` → `Missed Opps 7`
     - `Missed Opps 7` → `Missed Opps 10`
     - `Missed Opps 10` → `Missed Opps 13`
     - `Missed Opps 13` → `Missed Opps 16`
     - `Missed Opps 16` → `Missed Opps 19`
     - `Missed Opps 19` → `Missed Opps 21`
   - Don't add an entry with `Missed Opps 21` as the "from" — deals at
     21 will be skipped automatically (no chain match = skip).
6. Pacing:
   - Updates per minute: `1`
   - Business hours: `08:00`–`17:00`
   - Timezone: `America/Chicago`
   - Skip weekends: on
   - Skip US holidays: on
   - Randomize within each minute: on
7. Click **Create & launch**. You'll be taken to the detail page.
8. Within ~60 seconds you should see the campaign status flip from
   `launching` to `running` (or stay in `launching` for the first few
   minutes if Pipedrive has many pages — each tick queues up to 2,000
   deals). The first send fires on the next eligible business minute.

**Expected timeline:** 1 update/min × 9hrs × 5 days = 2,700/week.
30K deals ≈ 11 weeks of business days to fully push through one round.
That's by design (Joe wanted the downstream Zapier text/email automation
spread evenly to avoid customer-side spam and Pipedrive rate limits).

To finish faster, bump **Updates per minute** to 2 (~5.5 weeks) or 3
(~3.7 weeks). At 5/min you're still well under Pipedrive's burst limit.

---

## Operating notes

- **Pause / Resume:** Buttons on the campaign detail page. Pausing
  stops both queueing (if still in `launching`) and execution. Resuming
  picks up where it left off.
- **Delete:** Removes the campaign and cascades all queue items.
  Cannot be undone.
- **Failures:** Each queue item gets up to 3 attempts before being
  marked `failed`. The failed count is shown in the activity log with
  the error message.
- **Re-running:** Each campaign can only push each deal once. If you
  want to re-run on the same audience (e.g. to advance everyone another
  step in the chain), create a new campaign.

---

## Project layout

```
asap-campaign-runner/
├── netlify/functions/
│   └── process-queue.mts        # The cron processor. Heart of the app.
├── src/
│   ├── app/                     # Next.js App Router pages + API routes
│   │   ├── campaigns/           # List, new, detail pages
│   │   ├── api/
│   │   │   ├── campaigns/       # CRUD + launch/pause/resume
│   │   │   ├── pipedrive/       # Read-only proxies to Pipedrive
│   │   │   └── auth/            # Shared-password login
│   │   ├── login/page.tsx
│   │   └── ...
│   ├── components/AppHeader.tsx
│   ├── lib/
│   │   ├── pipedrive.ts         # v2 + v1 client
│   │   ├── scheduler.ts         # Business-hours slot distribution
│   │   ├── action-resolver.ts   # Decide what to do with each deal
│   │   ├── supabase.ts          # Admin client factory
│   │   ├── auth.ts              # HMAC-signed password cookie
│   │   └── types.ts
│   └── middleware.ts            # Gates all routes behind auth
├── supabase/migrations/
│   └── 001_initial_schema.sql
├── netlify.toml                 # Cron schedule + Next.js plugin
├── .env.example
├── package.json
└── README.md
```

---

## Local development (optional)

```bash
npm install
cp .env.example .env.local
# fill in values
npm run dev
```

The scheduled function won't fire locally — for local processor testing,
trigger it manually:

```bash
curl http://localhost:8888/.netlify/functions/process-queue
```

(Requires Netlify CLI: `npm i -g netlify-cli`, then `netlify dev` instead
of `npm run dev`.)

---

## Future phases

- **Phase 2: RingCentral SMS.** Add `send_sms` action type. Need a
  RingCentral sandbox app first to get API credentials.
- **Phase 3: Outlook email via Microsoft Graph.** Add `send_email`
  action type. Need an Azure AD app registration.
- **Quality-of-life:** Per-user logins (Supabase Auth), per-campaign
  retry config, webhook on completion, CSV export of activity log.
