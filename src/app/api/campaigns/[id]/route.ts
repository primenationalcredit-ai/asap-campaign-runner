import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();
  const { data: campaign, error: e1 } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", params.id)
    .single();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 404 });

  // Recent activity — last 20 queue items, plus aggregate counts.
  const { data: recent } = await supabase
    .from("queue_items")
    .select("id, pipedrive_deal_id, pipedrive_deal_title, scheduled_at, status, attempts, sent_at, error_message")
    .eq("campaign_id", params.id)
    .order("scheduled_at", { ascending: false })
    .limit(20);

  // Next 5 upcoming sends
  const { data: upcoming } = await supabase
    .from("queue_items")
    .select("id, pipedrive_deal_id, pipedrive_deal_title, scheduled_at")
    .eq("campaign_id", params.id)
    .eq("status", "pending")
    .order("scheduled_at", { ascending: true })
    .limit(5);

  return NextResponse.json({
    campaign,
    recent_items: recent ?? [],
    upcoming_items: upcoming ?? [],
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();
  // queue_items will cascade.
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
