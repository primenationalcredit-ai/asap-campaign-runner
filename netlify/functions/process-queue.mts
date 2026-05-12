// ============================================================
// Netlify Scheduled Function — process-queue
// ============================================================
// Runs every minute (cron "* * * * *", configured in netlify.toml).
//
// Two responsibilities, in priority order:
//   1. EXECUTE: For each campaign in 'running' status, send any
//      queue_items whose scheduled_at is now-or-past. Up to N
//      items per tick to stay within Pipedrive burst limits.
//
//   2. QUEUE:   For each campaign in 'launching' status, pull the
//      next batch of deals from Pipedrive, resolve actions, write
//      queue_items rows with computed schedules. Resumes from the
//      cursor stored in launch_state.
//
// We process execute-first so a long queueing run never starves
// outbound sends.
//
// ============================================================

import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

// We can't use the @/ alias inside a Netlify function (different
// build target), so we inline imports from src/lib via relative
// paths. Netlify will bundle these.
import {
  iterateDealsWithCursor,
  updateDealField,
} from "../../src/lib/pipedrive";
import {
  distributeSlots,
  estimateCompletion,
  type PacingRules,
} from "../../src/lib/scheduler";
import { resolveUpdateDealFieldAction } from "../../src/lib/action-resolver";
import type {
  CampaignRow,
  PipedriveDealV2,
  UpdateDealFieldConfig,
} from "../../src/lib/types";

// ----- tuning knobs -----
const MAX_EXECUTES_PER_TICK = 10;   // Pipedrive PATCHes per minute
const MAX_QUEUE_BATCH = 2_000;      // Deals to inspect per tick when launching
const QUEUE_INSERT_CHUNK = 1_000;   // Supabase max rows per insert
const MAX_ATTEMPTS = 3;

export const config: Config = {
  schedule: "* * * * *",
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async (_req: Request) => {
  const supabase = getSupabase();
  const log: string[] = [];

  try {
    const exec = await processExecutions(supabase, log);
    const queue = await processQueueing(supabase, log);
    const done = await markCompletedCampaigns(supabase, log);

    log.push(`tick complete: executed=${exec.executed} queued=${queue.queued} completed=${done}`);
  } catch (err) {
    log.push(`tick error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Log to stdout so it shows up in Netlify function logs.
  console.log(log.join("\n"));
  return new Response("ok");
};

// ============================================================
// PART 1 — EXECUTE due queue items
// ============================================================
async function processExecutions(supabase: ReturnType<typeof getSupabase>, log: string[]) {
  const nowIso = new Date().toISOString();

  // Pull due pending items whose campaign is 'running'.
  // Postgres lets us join here via a sub-select since the
  // supabase-js client doesn't expose join filtering cleanly.
  const { data: dueItems, error } = await supabase
    .from("queue_items")
    .select(`
      id, campaign_id, pipedrive_deal_id, action_payload, attempts,
      campaigns!inner(id, status, action_type, action_config)
    `)
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .eq("campaigns.status", "running")
    .order("scheduled_at", { ascending: true })
    .limit(MAX_EXECUTES_PER_TICK);

  if (error) {
    log.push(`execute: query error: ${error.message}`);
    return { executed: 0 };
  }
  if (!dueItems || dueItems.length === 0) return { executed: 0 };

  let executed = 0;
  for (const itemRaw of dueItems) {
    const item = itemRaw as unknown as {
      id: number;
      campaign_id: string;
      pipedrive_deal_id: number;
      action_payload: { type: string; field_key: string; new_value: unknown };
      attempts: number;
      campaigns: { id: string; status: string; action_type: string };
    };

    // Mark processing so we don't double-pick if the function
    // overlaps. (Belt-and-suspenders — schedule cron is once/min.)
    const { error: lockErr } = await supabase
      .from("queue_items")
      .update({ status: "processing", attempts: item.attempts + 1 })
      .eq("id", item.id)
      .eq("status", "pending");
    if (lockErr) continue;

    try {
      if (item.action_payload.type === "update_deal_field") {
        await updateDealField(
          item.pipedrive_deal_id,
          item.action_payload.field_key,
          item.action_payload.new_value
        );
      } else {
        throw new Error(`Unsupported action: ${item.action_payload.type}`);
      }

      await supabase
        .from("queue_items")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
        .eq("id", item.id);

      await supabase.rpc("increment_campaign_sent", { p_campaign_id: item.campaign_id });
      executed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextAttempts = item.attempts + 1;
      const isFinal = nextAttempts >= MAX_ATTEMPTS;
      await supabase
        .from("queue_items")
        .update({
          status: isFinal ? "failed" : "pending",
          error_message: msg.slice(0, 1000),
        })
        .eq("id", item.id);
      if (isFinal) {
        await supabase.rpc("increment_campaign_failed", { p_campaign_id: item.campaign_id });
      }
      log.push(`execute: deal=${item.pipedrive_deal_id} ${isFinal ? "failed" : "retry"}: ${msg.slice(0, 200)}`);
    }
  }

  return { executed };
}

// ============================================================
// PART 2 — QUEUE more items for any 'launching' campaign
// ============================================================
async function processQueueing(supabase: ReturnType<typeof getSupabase>, log: string[]) {
  // One campaign per tick. Oldest 'launching' first.
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "launching")
    .order("launched_at", { ascending: true })
    .limit(1);

  if (error) {
    log.push(`queue: query error: ${error.message}`);
    return { queued: 0 };
  }
  if (!campaigns || campaigns.length === 0) return { queued: 0 };

  const campaign = campaigns[0] as unknown as CampaignRow;
  if (campaign.action_type !== "update_deal_field") {
    log.push(`queue: campaign ${campaign.id} has unsupported action ${campaign.action_type}, marking failed`);
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return { queued: 0 };
  }
  const actionCfg = campaign.action_config as UpdateDealFieldConfig;

  // Compute filter opts
  const opts: { filter_id?: number; pipeline_id?: number; stage_id?: number; custom_fields?: string[] } = {
    custom_fields: [actionCfg.field_key],
  };
  if (campaign.source_type === "pipedrive_filter") {
    opts.filter_id = Number((campaign.source_config as { filter_id: number }).filter_id);
  } else if (campaign.source_type === "pipedrive_pipeline") {
    const sc = campaign.source_config as { pipeline_id: number; stage_id?: number };
    opts.pipeline_id = Number(sc.pipeline_id);
    if (sc.stage_id) opts.stage_id = Number(sc.stage_id);
  }

  // Build pacing rules
  const { data: holidays } = await supabase.from("holidays").select("date");
  const skipSet = new Set<string>([
    ...(holidays ?? []).map((h: { date: string }) => h.date),
    ...((campaign.custom_skip_dates ?? []) as string[]),
  ]);
  const rules: PacingRules = {
    rate_per_minute: campaign.rate_per_minute,
    business_hours_start: campaign.business_hours_start,
    business_hours_end: campaign.business_hours_end,
    timezone: campaign.timezone,
    skip_weekends: campaign.skip_weekends,
    skip_holidays: campaign.skip_holidays,
    skip_dates: campaign.skip_holidays ? skipSet : new Set((campaign.custom_skip_dates ?? []) as string[]),
    randomize_within_minute: campaign.randomize_within_minute,
  };

  const tickStart = Date.now();
  const TICK_BUDGET_MS = 20_000;

  let seen = campaign.launch_state?.deals_seen ?? 0;
  let queuedThisTick = 0;
  let skippedThisTick = 0;
  let cursorScheduledAt = campaign.launch_state?.next_scheduled_at
    ? new Date(campaign.launch_state.next_scheduled_at)
    : new Date();
  const startCursor: string | null = campaign.launch_state?.pipedrive_cursor ?? null;

  // On the very first tick (no stored cursor yet), pre-load any rows
  // already in queue_items so we don't double-queue. Subsequent ticks
  // use the cursor to resume, so they only see fresh deals and can
  // skip this expensive query.
  let alreadyQueued = new Set<number>();
  if (!startCursor) {
    const { data: existing } = await supabase
      .from("queue_items")
      .select("pipedrive_deal_id")
      .eq("campaign_id", campaign.id);
    alreadyQueued = new Set<number>(
      (existing ?? []).map((r: { pipedrive_deal_id: number }) => r.pipedrive_deal_id)
    );
  }

  let reachedEnd = true;
  let nextCursor: string | null = startCursor;
  const pendingInserts: Array<Record<string, unknown>> = [];

  outer: for await (const { batch, nextCursor: cur } of iterateDealsWithCursor({
    ...opts,
    startCursor,
  })) {
    nextCursor = cur;

    for (const deal of batch as PipedriveDealV2[]) {
      seen++;
      if (alreadyQueued.has(deal.id)) continue;

      const resolved = resolveUpdateDealFieldAction(deal, actionCfg);
      if (!resolved) {
        // Persist the skip so we never inspect this deal again on
        // resume. We use the queue_items table itself with
        // status='skipped' to keep all per-deal state in one place.
        pendingInserts.push({
          campaign_id: campaign.id,
          pipedrive_deal_id: deal.id,
          pipedrive_deal_title: deal.title?.slice(0, 200) ?? null,
          action_payload: { type: "skipped", reason: "no chain match" },
          scheduled_at: new Date().toISOString(), // unused for skipped
          status: "skipped",
        });
        alreadyQueued.add(deal.id);
        skippedThisTick++;
        continue;
      }

      const [slot] = distributeSlots(cursorScheduledAt, 1, rules);
      cursorScheduledAt = new Date(new Date(slot).getTime() + 1);

      pendingInserts.push({
        campaign_id: campaign.id,
        pipedrive_deal_id: deal.id,
        pipedrive_deal_title: deal.title?.slice(0, 200) ?? null,
        action_payload: resolved.action_payload,
        scheduled_at: slot,
        status: "pending",
      });
      alreadyQueued.add(deal.id);
      queuedThisTick++;

      // Periodic flush to Supabase
      if (pendingInserts.length >= QUEUE_INSERT_CHUNK) {
        const chunk = pendingInserts.splice(0, QUEUE_INSERT_CHUNK);
        const { error: ie } = await supabase
          .from("queue_items")
          .upsert(chunk, { onConflict: "campaign_id,pipedrive_deal_id", ignoreDuplicates: true });
        if (ie) log.push(`queue: insert error: ${ie.message}`);
      }

      if (queuedThisTick >= MAX_QUEUE_BATCH || Date.now() - tickStart > TICK_BUDGET_MS) {
        reachedEnd = false;
        break outer;
      }
    }

    // After a page completes, if the cursor is null Pipedrive has no
    // more pages — we've reached the end.
    if (cur === null) {
      reachedEnd = true;
      break;
    }
  }

  // Final flush
  if (pendingInserts.length > 0) {
    const { error: ie } = await supabase
      .from("queue_items")
      .upsert(pendingInserts, { onConflict: "campaign_id,pipedrive_deal_id", ignoreDuplicates: true });
    if (ie) log.push(`queue: final insert error: ${ie.message}`);
  }

  // Update campaign state. Skipped count is batched at the tick
  // boundary instead of one DB write per skipped deal.
  const newSkippedCount = (campaign.skipped_count ?? 0) + skippedThisTick;
  const newState = {
    next_scheduled_at: cursorScheduledAt.toISOString(),
    pipedrive_cursor: reachedEnd ? null : nextCursor,
    deals_seen: seen,
    deals_queued: (campaign.launch_state?.deals_queued ?? 0) + queuedThisTick,
  };

  if (reachedEnd) {
    const totalQueued = newState.deals_queued;
    const lastSlotIso = cursorScheduledAt.toISOString();

    await supabase
      .from("campaigns")
      .update({
        status: "running",
        launch_state: newState,
        total_items: totalQueued,
        audience_snapshot_count: seen,
        estimated_completion_at: lastSlotIso,
        skipped_count: newSkippedCount,
      })
      .eq("id", campaign.id);

    log.push(`queue: campaign ${campaign.id} fully queued (seen=${seen}, queued=${totalQueued}, skipped=${newSkippedCount})`);
  } else {
    await supabase
      .from("campaigns")
      .update({
        launch_state: newState,
        total_items: newState.deals_queued,
        skipped_count: newSkippedCount,
      })
      .eq("id", campaign.id);

    log.push(`queue: campaign ${campaign.id} partial (seen=${seen}, queued+=${queuedThisTick}, skipped+=${skippedThisTick})`);
  }

  return { queued: queuedThisTick };
}

// ============================================================
// PART 3 — Mark campaigns complete once their queue is drained
// ============================================================
async function markCompletedCampaigns(
  supabase: ReturnType<typeof getSupabase>,
  log: string[]
) {
  const { data: running } = await supabase
    .from("campaigns")
    .select("id, total_items, sent_count, failed_count")
    .eq("status", "running");
  if (!running || running.length === 0) return 0;

  let done = 0;
  for (const c of running as Array<{ id: string; total_items: number; sent_count: number; failed_count: number }>) {
    if (c.total_items === 0) continue;
    if (c.sent_count + c.failed_count >= c.total_items) {
      // Belt-and-suspenders: count any remaining pending rows
      const { count } = await supabase
        .from("queue_items")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .eq("status", "pending");
      if ((count ?? 0) === 0) {
        await supabase
          .from("campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", c.id);
        done++;
        log.push(`complete: campaign ${c.id} marked completed`);
      }
    }
  }
  return done;
}
