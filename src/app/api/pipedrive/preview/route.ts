import { NextRequest, NextResponse } from "next/server";
import { previewAudienceSize } from "@/lib/pipedrive";
import type { SourceType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 26; // we may walk many pages

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source_type = body.source_type as SourceType;
    const source_config = body.source_config as Record<string, unknown>;

    const opts: {
      filter_id?: number;
      pipeline_id?: number;
      stage_id?: number;
    } = {};

    if (source_type === "pipedrive_filter") {
      const id = Number(source_config?.filter_id);
      if (!Number.isFinite(id)) {
        return NextResponse.json(
          { error: "source_config.filter_id is required" },
          { status: 400 }
        );
      }
      opts.filter_id = id;
    } else if (source_type === "pipedrive_pipeline") {
      const pid = Number(source_config?.pipeline_id);
      if (!Number.isFinite(pid)) {
        return NextResponse.json(
          { error: "source_config.pipeline_id is required" },
          { status: 400 }
        );
      }
      opts.pipeline_id = pid;
      const sid = Number(source_config?.stage_id);
      if (Number.isFinite(sid)) opts.stage_id = sid;
    } else {
      return NextResponse.json({ error: "Unknown source_type" }, { status: 400 });
    }

    const result = await previewAudienceSize(opts);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
