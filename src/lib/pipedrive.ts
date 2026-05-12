// ============================================================
// Pipedrive API client
// ============================================================
// Uses v2 endpoints where available (deals, fields, pipelines,
// stages) and falls back to v1 for filters (no v2 equivalent yet).
//
// Auth:
//   v2 — x-api-token header
//   v1 — ?api_token=... query param
//
// Rate limiting: we don't try to police the company-wide daily
// token budget here. Our scheduler already caps invocations
// (1/min default), so we're well under any sane budget. If a
// request comes back 429, we bubble that up to the queue
// processor which marks the queue item for retry.
// ============================================================

import type {
  PipedriveDealField,
  PipedriveDealV2,
  PipedriveFilter,
  PipedrivePipeline,
  PipedriveStage,
} from "./types";

function getCreds() {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  const domain = process.env.PIPEDRIVE_COMPANY_DOMAIN;
  if (!token || !domain) {
    throw new Error(
      "Pipedrive creds missing. Check PIPEDRIVE_API_TOKEN and PIPEDRIVE_COMPANY_DOMAIN env vars."
    );
  }
  return { token, domain };
}

function v1Base() {
  const { domain } = getCreds();
  return `https://${domain}.pipedrive.com/v1`;
}

function v2Base() {
  const { domain } = getCreds();
  return `https://${domain}.pipedrive.com/api/v2`;
}

/** v2 request with x-api-token header. */
async function v2<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { token } = getCreds();
  const url = `${v2Base()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-token": token,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new PipedriveError(
      `Pipedrive v2 ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 500)}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

/** v1 request with api_token query param. */
async function v1<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { token } = getCreds();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${v1Base()}${path}${sep}api_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new PipedriveError(
      `Pipedrive v1 ${init.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 500)}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

export class PipedriveError extends Error {
  status: number;
  constructor(msg: string, status: number) {
    super(msg);
    this.status = status;
  }
}

// ============================================================
// Filters (v1 — no v2 endpoint yet)
// ============================================================

export async function listDealFilters(): Promise<PipedriveFilter[]> {
  const r = await v1<{ success: boolean; data: PipedriveFilter[] | null }>(
    `/filters?type=deals`
  );
  return (r.data ?? []).filter((f) => f.active_flag);
}

// ============================================================
// Pipelines & stages (v2)
// ============================================================

export async function listPipelines(): Promise<PipedrivePipeline[]> {
  const r = await v2<{ success: boolean; data: PipedrivePipeline[] | null }>(
    `/pipelines`
  );
  return (r.data ?? []).filter((p) => p.active);
}

export async function listStages(
  pipelineId?: number
): Promise<PipedriveStage[]> {
  const q = pipelineId ? `?pipeline_id=${pipelineId}` : "";
  const r = await v2<{ success: boolean; data: PipedriveStage[] | null }>(
    `/stages${q}`
  );
  return r.data ?? [];
}

// ============================================================
// Custom fields (v1 — v2 fields API is brand new and shape differs;
// v1 still works fine for read access)
// ============================================================

export async function listDealFields(): Promise<PipedriveDealField[]> {
  // Paginate to be safe (companies can have lots of custom fields).
  const all: PipedriveDealField[] = [];
  let start = 0;
  const limit = 500;
  while (true) {
    const r = await v1<{
      success: boolean;
      data: PipedriveDealField[] | null;
      additional_data?: {
        pagination?: { more_items_in_collection?: boolean; next_start?: number };
      };
    }>(`/dealFields?start=${start}&limit=${limit}`);
    const batch = r.data ?? [];
    all.push(...batch);
    const more = r.additional_data?.pagination?.more_items_in_collection;
    if (!more || batch.length === 0) break;
    start = r.additional_data?.pagination?.next_start ?? start + limit;
  }
  return all;
}

// ============================================================
// Deals
// ============================================================

interface DealListOpts {
  filter_id?: number;
  pipeline_id?: number;
  stage_id?: number;
  /** Comma-separated custom field keys to include (max 15). */
  custom_fields?: string[];
}

/**
 * Iterate every deal matching the given source, yielding chunks.
 * Uses cursor pagination (v2 max limit = 500).
 */
export async function* iterateDeals(
  opts: DealListOpts
): AsyncGenerator<PipedriveDealV2[]> {
  const params = new URLSearchParams();
  params.set("limit", "500");
  if (opts.filter_id) params.set("filter_id", String(opts.filter_id));
  if (opts.pipeline_id) params.set("pipeline_id", String(opts.pipeline_id));
  if (opts.stage_id) params.set("stage_id", String(opts.stage_id));
  if (opts.custom_fields && opts.custom_fields.length > 0) {
    params.set("custom_fields", opts.custom_fields.slice(0, 15).join(","));
  }

  let cursor: string | undefined;
  while (true) {
    if (cursor) params.set("cursor", cursor);
    else params.delete("cursor");

    const r = await v2<{
      success: boolean;
      data: PipedriveDealV2[] | null;
      additional_data?: { next_cursor?: string | null };
    }>(`/deals?${params.toString()}`);

    const batch = r.data ?? [];
    if (batch.length > 0) yield batch;

    const next = r.additional_data?.next_cursor;
    if (!next) break;
    cursor = next;
  }
}

/** Update a single deal — used by the queue processor. */
export async function updateDealField(
  dealId: number,
  fieldKey: string,
  newValue: unknown
): Promise<void> {
  // Built-in (non-custom) fields would live at the top level, but
  // we only support custom fields in v1 of this app.
  await v2(`/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({
      custom_fields: { [fieldKey]: newValue },
    }),
  });
}

/**
 * Count-only check used by the audience preview. Pipedrive v2 returns
 * `additional_data.pagination` info, but the simplest reliable count
 * is to stream the IDs with a minimal field projection.
 *
 * For huge audiences we cap at a sentinel after `maxCount` to keep
 * the preview fast — the real total is computed at launch time.
 */
export async function previewAudienceSize(
  opts: DealListOpts,
  maxCount = 50_000
): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  for await (const batch of iterateDeals(opts)) {
    count += batch.length;
    if (count >= maxCount) return { count, capped: true };
  }
  return { count, capped: false };
}
