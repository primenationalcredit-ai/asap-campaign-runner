"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  source_type: string;
  source_config: Record<string, unknown>;
  action_type: string;
  action_config: {
    field_key?: string;
    field_name?: string;
    value_mode?: "fixed" | "chain";
    fixed_value?: unknown;
    chain?: Array<{ from_value: unknown; to_value: unknown }>;
  };
  rate_per_minute: number;
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  skip_weekends: boolean;
  skip_holidays: boolean;
  custom_skip_dates: string[];
  randomize_within_minute: boolean;
  total_items: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  estimated_completion_at: string | null;
  launch_state: {
    next_scheduled_at?: string;
    deals_seen?: number;
    deals_queued?: number;
  };
}

interface QueueItem {
  id: number;
  pipedrive_deal_id: number;
  pipedrive_deal_title: string | null;
  scheduled_at: string;
  status?: string;
  attempts?: number;
  sent_at?: string | null;
  error_message?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:     "bg-ink-100 text-ink-700",
  launching: "bg-amber-100 text-amber-800",
  running:   "bg-emerald-100 text-emerald-800",
  paused:    "bg-ink-200 text-ink-700",
  completed: "bg-brand-100 text-brand-700",
  failed:    "bg-red-100 text-red-700",
  cancelled: "bg-ink-200 text-ink-700",
};

const ITEM_STATUS_STYLES: Record<string, string> = {
  pending:    "bg-ink-100 text-ink-700",
  processing: "bg-amber-100 text-amber-800",
  sent:       "bg-emerald-100 text-emerald-800",
  failed:     "bg-red-100 text-red-700",
  skipped:    "bg-ink-100 text-ink-500",
};

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recent, setRecent] = useState<QueueItem[]>([]);
  const [upcoming, setUpcoming] = useState<QueueItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/campaigns/${params.id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Load failed");
      setCampaign(j.campaign);
      setRecent(j.recent_items || []);
      setUpcoming(j.upcoming_items || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [params.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000); // refresh every 5s
    return () => clearInterval(t);
  }, [load]);

  async function callAction(verb: "launch" | "pause" | "resume") {
    setActing(true);
    try {
      const r = await fetch(`/api/campaigns/${params.id}/${verb}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${verb} failed`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }

  async function onDelete() {
    if (!confirm("Delete this campaign and all its queue items? This cannot be undone.")) return;
    setActing(true);
    try {
      const r = await fetch(`/api/campaigns/${params.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Delete failed");
      router.push("/campaigns");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setActing(false);
    }
  }

  if (err && !campaign) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
          <Link href="/campaigns" className="text-sm text-brand-500 hover:underline">← Campaigns</Link>
          <div className="card p-6 mt-4 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
        </main>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 text-sm text-ink-400">Loading…</main>
      </div>
    );
  }

  const processed = campaign.sent_count + campaign.failed_count;
  const pct = campaign.total_items > 0 ? Math.round((processed / campaign.total_items) * 100) : 0;
  const remaining = Math.max(0, campaign.total_items - processed);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
        <div>
          <Link href="/campaigns" className="text-sm text-brand-500 hover:underline">← Campaigns</Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink-900">{campaign.name}</h1>
              {campaign.description && (
                <p className="text-sm text-ink-500 mt-1">{campaign.description}</p>
              )}
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className={`pill ${STATUS_STYLES[campaign.status] || "bg-ink-100 text-ink-700"}`}>
                  {campaign.status}
                </span>
                <span className="font-mono text-ink-400">{campaign.id.slice(0, 8)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {campaign.status === "draft" && (
                <button className="btn-primary" disabled={acting} onClick={() => callAction("launch")}>
                  Launch
                </button>
              )}
              {(campaign.status === "running" || campaign.status === "launching") && (
                <button className="btn-secondary" disabled={acting} onClick={() => callAction("pause")}>
                  Pause
                </button>
              )}
              {campaign.status === "paused" && (
                <button className="btn-primary" disabled={acting} onClick={() => callAction("resume")}>
                  Resume
                </button>
              )}
              <button className="btn-secondary text-red-600 hover:bg-red-50" disabled={acting} onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        {/* ---------- Progress ---------- */}
        <section className="card p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Total" value={campaign.total_items.toLocaleString()} />
            <Stat label="Sent" value={campaign.sent_count.toLocaleString()} tone="emerald" />
            <Stat label="Failed" value={campaign.failed_count.toLocaleString()} tone={campaign.failed_count > 0 ? "red" : "neutral"} />
            <Stat label="Skipped" value={campaign.skipped_count.toLocaleString()} />
          </div>
          <div className="mt-5">
            <div className="flex justify-between text-xs text-ink-500 mb-1">
              <span>{pct}% complete</span>
              <span>{remaining.toLocaleString()} remaining</span>
            </div>
            <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {campaign.status === "launching" && (
            <div className="mt-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
              Queueing in progress. The scheduler will keep pulling deals from Pipedrive on each tick until all eligible deals are queued.
              {campaign.launch_state?.deals_seen !== undefined && (
                <> So far: <span className="font-mono">{campaign.launch_state.deals_seen.toLocaleString()}</span> deals inspected, <span className="font-mono">{campaign.launch_state.deals_queued?.toLocaleString() ?? 0}</span> queued.</>
              )}
            </div>
          )}
        </section>

        {/* ---------- Config summary ---------- */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Configuration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Row label="Source">
              {campaign.source_type === "pipedrive_filter"
                ? <>Pipedrive filter <span className="font-mono">#{String(campaign.source_config.filter_id)}</span></>
                : <>Pipeline <span className="font-mono">#{String(campaign.source_config.pipeline_id)}</span>{campaign.source_config.stage_id && <> · stage <span className="font-mono">#{String(campaign.source_config.stage_id)}</span></>}</>}
            </Row>
            <Row label="Action">{campaign.action_type}</Row>
            {campaign.action_config.field_name && (
              <Row label="Field">
                {campaign.action_config.field_name}
                <span className="text-ink-400 font-mono text-xs ml-2">{campaign.action_config.field_key?.slice(0, 8)}…</span>
              </Row>
            )}
            <Row label="Value mode">{campaign.action_config.value_mode}</Row>
            <Row label="Rate">{campaign.rate_per_minute}/min</Row>
            <Row label="Business hours">{campaign.business_hours_start.slice(0,5)}–{campaign.business_hours_end.slice(0,5)} {campaign.timezone}</Row>
            <Row label="Skip">
              {[
                campaign.skip_weekends && "weekends",
                campaign.skip_holidays && "US holidays",
                campaign.custom_skip_dates.length > 0 && `${campaign.custom_skip_dates.length} custom date(s)`,
              ].filter(Boolean).join(", ") || "—"}
            </Row>
            <Row label="Randomize">{campaign.randomize_within_minute ? "yes (within each minute)" : "no"}</Row>
            <Row label="Launched">{campaign.launched_at ? new Date(campaign.launched_at).toLocaleString() : "—"}</Row>
            <Row label="Est. completion">{campaign.estimated_completion_at ? new Date(campaign.estimated_completion_at).toLocaleString() : "—"}</Row>
          </div>

          {campaign.action_config.value_mode === "chain" && campaign.action_config.chain && (
            <div className="pt-2">
              <div className="label mb-2">Chain</div>
              <div className="space-y-1">
                {campaign.action_config.chain.map((s, i) => (
                  <div key={i} className="font-mono text-xs text-ink-700">
                    {s.from_value === null ? "(blank)" : String(s.from_value)} → {s.to_value === null ? "(blank)" : String(s.to_value)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ---------- Upcoming ---------- */}
        {upcoming.length > 0 && (
          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500 mb-3">Next 5 scheduled</h2>
            <div className="divide-y divide-ink-100">
              {upcoming.map((it) => (
                <div key={it.id} className="py-2 flex items-center justify-between text-sm">
                  <div className="flex-1 truncate">
                    <span className="font-mono text-ink-400">#{it.pipedrive_deal_id}</span>{" "}
                    <span className="text-ink-700">{it.pipedrive_deal_title || "(no title)"}</span>
                  </div>
                  <div className="text-xs text-ink-500 font-mono">
                    {new Date(it.scheduled_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Recent activity ---------- */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500 mb-3">Recent activity</h2>
          {recent.length === 0 ? (
            <div className="text-sm text-ink-400">No activity yet.</div>
          ) : (
            <div className="divide-y divide-ink-100">
              {recent.map((it) => (
                <div key={it.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`pill ${ITEM_STATUS_STYLES[it.status || "pending"]}`}>{it.status}</span>
                      <span className="font-mono text-ink-400 text-xs">#{it.pipedrive_deal_id}</span>
                      <span className="text-ink-700 truncate">{it.pipedrive_deal_title || "(no title)"}</span>
                    </div>
                    {it.error_message && (
                      <div className="mt-0.5 text-xs text-red-600 truncate" title={it.error_message}>
                        {it.error_message}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-ink-500 font-mono whitespace-nowrap">
                    {it.sent_at ? new Date(it.sent_at).toLocaleString() : new Date(it.scheduled_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "emerald" | "red" }) {
  const colors = {
    neutral: "text-ink-900",
    emerald: "text-emerald-700",
    red:     "text-red-700",
  };
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold font-mono ${colors[tone]}`}>{value}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-0.5 text-ink-700">{children}</div>
    </div>
  );
}
