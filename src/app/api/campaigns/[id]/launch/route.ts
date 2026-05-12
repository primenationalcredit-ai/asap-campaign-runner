import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();

  const { data: campaign, error: e1 } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", params.id)
    .single();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 404 });

  if (campaign.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot launch from status '${campaign.status}'` },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("campaigns")
    .update({
      status: "launching",
      launched_at: nowIso,
      launch_state: {
        next_scheduled_at: nowIso,
        pipedrive_cursor: null,
        deals_seen: 0,
        deals_queued: 0,
      },
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The actual queueing happens in the scheduled processor (runs every minute).
  // It will pick up this campaign on its next tick.
  return NextResponse.json({ campaign: data });
}
