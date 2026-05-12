// ============================================================
// Action resolver
// ============================================================
// For each deal pulled from Pipedrive, decide what (if anything)
// we're going to do to it. Returns the queue_items row payload,
// or null if this deal should be skipped (e.g. its current field
// value isn't in the configured chain).
// ============================================================

import type {
  ChainStep,
  PipedriveDealV2,
  UpdateDealFieldConfig,
} from "./types";

export interface ResolvedAction {
  action_payload: {
    type: "update_deal_field";
    field_key: string;
    current_value: unknown;
    new_value: unknown;
  };
}

/**
 * Look up the current value of a custom field on a v2 deal.
 * Pipedrive v2 puts custom fields under `custom_fields` keyed by
 * the field hash. Blank values may come back as null, undefined,
 * empty string, or missing key — all should be treated as "blank".
 */
function readCustomField(
  deal: PipedriveDealV2,
  fieldKey: string
): unknown {
  const v = deal.custom_fields?.[fieldKey];
  if (v === undefined || v === null || v === "") return null;
  return v;
}

/** Normalize values for comparison: numbers stay numbers, strings stay strings, null/empty become null. */
function normalize(v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  // Pipedrive enum option IDs come back as numbers; chain values
  // may have been entered as numbers OR as strings. Coerce numeric
  // strings to numbers so comparisons match.
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    return parseInt(v, 10);
  }
  return v;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na === nb;
}

/**
 * Apply the campaign's action config to a single deal.
 * Returns null if the deal should be skipped.
 */
export function resolveUpdateDealFieldAction(
  deal: PipedriveDealV2,
  cfg: UpdateDealFieldConfig
): ResolvedAction | null {
  const currentRaw = readCustomField(deal, cfg.field_key);
  const current = normalize(currentRaw);

  let next: unknown;
  if (cfg.value_mode === "fixed") {
    if (cfg.fixed_value === undefined) return null;
    next = normalize(cfg.fixed_value);
    // No-op skip: if the deal is already at the target value, skip
    // it. Saves an API call and a Pipedrive activity log entry.
    if (valuesEqual(current, next)) return null;
  } else {
    // Chain mode: find a step whose `from_value` matches the
    // deal's current value. If no match, skip.
    const step = cfg.chain?.find((s: ChainStep) =>
      valuesEqual(normalize(s.from_value), current)
    );
    if (!step) return null;
    next = normalize(step.to_value);
    // If to_value is null OR equals current, treat as a no-op skip.
    // (Joe's chain: ...21 → null means "stop at 21". A row at 21
    // matches `from_value: 21, to_value: null` and we skip it.)
    if (next === null) return null;
    if (valuesEqual(current, next)) return null;
  }

  return {
    action_payload: {
      type: "update_deal_field",
      field_key: cfg.field_key,
      current_value: currentRaw,
      new_value: next,
    },
  };
}
