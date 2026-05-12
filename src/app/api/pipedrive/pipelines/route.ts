import { NextResponse } from "next/server";
import { listPipelines, listStages } from "@/lib/pipedrive";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [pipelines, stages] = await Promise.all([
      listPipelines(),
      listStages(),
    ]);
    return NextResponse.json({ pipelines, stages });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
