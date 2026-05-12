import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("campaigns")
    .select(
      "id, name, description, status, source_type, action_type, rate_per_minute, total_items, sent_count, failed_count, skipped_count, created_at, launched_at, completed_at, estimated_completion_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Minimal validation; trust the UI but defend against obvious bad input.
    const required = ["name", "source_type", "source_config", "action_type", "action_config"];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null) {
        return NextResponse.json({ error: `Missing field: ${k}` }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        name: String(body.name).slice(0, 200),
        description: body.description ? String(body.description).slice(0, 1000) : null,
        source_type: body.source_type,
        source_config: body.source_config,
        action_type: body.action_type,
        action_config: body.action_config,
        rate_per_minute: Number(body.rate_per_minute ?? 1),
        business_hours_start: body.business_hours_start ?? "08:00",
        business_hours_end:   body.business_hours_end   ?? "17:00",
        timezone:             body.timezone             ?? "America/Chicago",
        skip_weekends:        body.skip_weekends        ?? true,
        skip_holidays:        body.skip_holidays        ?? true,
        custom_skip_dates:    body.custom_skip_dates    ?? [],
        randomize_within_minute: body.randomize_within_minute ?? true,
        status: "draft",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ campaign: data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
