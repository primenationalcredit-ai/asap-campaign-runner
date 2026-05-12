import { NextResponse } from "next/server";
import { listDealFilters } from "@/lib/pipedrive";

export const runtime = "nodejs";

export async function GET() {
  try {
    const filters = await listDealFilters();
    return NextResponse.json({ filters });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
