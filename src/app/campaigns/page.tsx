"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  source_type: string;
  action_type: string;
  rate_per_minute: number;
  total_items: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  estimated_completion_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:      "bg-ink-100 text-ink-700",
  launching:  "bg-amber-100 text-amber-800",
  running:    "bg-emerald-100 text-emerald-800",
  paused:     "bg-ink-200 text-ink-700",
  completed:  "bg-brand-100 text-brand-700",
  failed:     "bg-red-100 text-red-700",
  cancelled:  "bg-ink-200 text-ink-700",
};

export default function CampaignsPage() {
  const [items, setItems] = useState<CampaignSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await fetch("/api/campaigns");
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load");
        if (active) setItems(j.campaigns);
      } catch (e: unknown) {
        if (active) setErr(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    const t = setInterval(load, 10_000); // refresh every 10s for live status
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader active="campaigns" />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-semibold text-ink-900 mb-1">Campaigns</h1>
        <p className="text-sm text-ink-500 mb-6">
          Bulk Pipedrive operations on a schedule. Click into a campaign for live progress.
        </p>

        {err && <div className="mb-4 text-sm text-red-600">{err}</div>}

        {items === null ? (
          <div className="text-sm text-ink-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-ink-500 mb-4">No campaigns yet.</p>
            <Link href="/campaigns/new" className="btn-primary">Create your first campaign</Link>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50">
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">Status</th>
                  <th className="text-right px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">Progress</th>
                  <th className="text-right px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">Rate</th>
                  <th className="text-right px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-500">Est. complete</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const pct = c.total_items > 0
                    ? Math.round(((c.sent_count + c.failed_count) / c.total_items) * 100)
                    : 0;
                  return (
                    <tr key={c.id} className="border-b border-ink-100 hover:bg-ink-50">
                      <td className="px-4 py-3">
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-ink-900 hover:text-brand-500">
                          {c.name}
                        </Link>
                        <div className="text-xs text-ink-400 font-mono mt-0.5">
                          {c.source_type} · {c.action_type}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`pill ${STATUS_STYLES[c.status] || "bg-ink-100 text-ink-700"}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-sm font-mono text-ink-700">
                          {c.sent_count.toLocaleString()} / {c.total_items.toLocaleString()}
                          {c.failed_count > 0 && (
                            <span className="text-red-600 ml-1">({c.failed_count} failed)</span>
                          )}
                        </div>
                        <div className="mt-1 h-1 w-32 bg-ink-100 rounded-full ml-auto overflow-hidden">
                          <div
                            className="h-full bg-brand-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-ink-600">
                        {c.rate_per_minute}/min
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-ink-600">
                        {c.estimated_completion_at
                          ? new Date(c.estimated_completion_at).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
