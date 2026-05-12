import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();

  // Decide whether to resume to 'running' or 'launching' based on
  // whether queueing is still in progress (launch_state has a cursor
  // and we haven't completed all pages).
  const { data: c, error: e1 } = await supabase
    .from("campaigns")
    .select("status, launch_state, total_items")
    .eq("id", params.id)
    .single();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 404 });
  if (c.status !== "paused") {
    return NextResponse.json({ error: "Campaign is not paused" }, { status: 400 });
  }

  const stillQueueing =
    c.total_items === 0 || c.launch_state?.pipedrive_cursor !== undefined;

  const next = stillQueueing ? "launching" : "running";
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: next })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
