import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "paused" })
    .eq("id", params.id)
    .in("status", ["running", "launching"])
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ campaign: data });
}
