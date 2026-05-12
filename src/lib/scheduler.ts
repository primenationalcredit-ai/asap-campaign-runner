// ============================================================
// Scheduler — business-hours distribution
// ============================================================
// Given a start time, a count, and pacing rules, produces an
// array of timestamps spaced evenly through eligible minutes
// only. "Eligible" = inside the business-hours window, on a
// weekday (if skip_weekends), and not on a holiday (if
// skip_holidays).
//
// We use luxon for timezone math because business hours are
// in the user's local zone (default America/Chicago) but
// scheduled_at is stored as UTC.
// ============================================================

import { DateTime, Interval } from "luxon";

export interface PacingRules {
  rate_per_minute: number;
  business_hours_start: string;   // "HH:MM" or "HH:MM:SS"
  business_hours_end: string;
  timezone: string;               // IANA, e.g. "America/Chicago"
  skip_weekends: boolean;
  skip_holidays: boolean;
  skip_dates: Set<string>;        // ISO "YYYY-MM-DD" — combined list of holidays + custom
  randomize_within_minute: boolean;
}

/** Parse "HH:MM" or "HH:MM:SS" into {hour, minute}. */
function parseTime(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":");
  return { hour: parseInt(h, 10), minute: parseInt(m, 10) };
}

function isSkipDay(dt: DateTime, rules: PacingRules): boolean {
  if (rules.skip_weekends && (dt.weekday === 6 || dt.weekday === 7)) return true;
  if (rules.skip_holidays) {
    const key = dt.toISODate();
    if (key && rules.skip_dates.has(key)) return true;
  }
  return false;
}

/**
 * Advance `dt` to the next valid business minute.
 * If dt is already valid, returns dt unchanged.
 */
function advanceToBusinessMinute(
  dt: DateTime,
  rules: PacingRules
): DateTime {
  const start = parseTime(rules.business_hours_start);
  const end = parseTime(rules.business_hours_end);

  // Hard cap to avoid runaway loops if config is broken.
  for (let i = 0; i < 365; i++) {
    if (isSkipDay(dt, rules)) {
      dt = dt
        .plus({ days: 1 })
        .set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
      continue;
    }

    const windowStart = dt.set({
      hour: start.hour, minute: start.minute, second: 0, millisecond: 0,
    });
    const windowEnd = dt.set({
      hour: end.hour, minute: end.minute, second: 0, millisecond: 0,
    });

    if (dt < windowStart) {
      dt = windowStart;
      continue;
    }
    if (dt >= windowEnd) {
      dt = dt
        .plus({ days: 1 })
        .set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
      continue;
    }

    return dt;
  }
  throw new Error("advanceToBusinessMinute exceeded 365-day search");
}

/**
 * Distribute `count` slots evenly across eligible business minutes,
 * starting at `startUtc` (or as soon thereafter as is eligible).
 *
 * Returns ISO timestamps (UTC) suitable for inserting into the
 * `queue_items.scheduled_at` column.
 *
 * NOTE: We intentionally compute slots one-by-one rather than via
 * a math formula because the eligibility rules (weekend skip,
 * holidays, daily window) make a closed-form solution messy.
 * For 30K items this loop runs in <100ms; not worth optimizing.
 */
export function distributeSlots(
  startUtc: Date,
  count: number,
  rules: PacingRules
): string[] {
  if (count <= 0) return [];

  const intervalMs = (60 * 1000) / rules.rate_per_minute;
  const zone = rules.timezone;
  let cursor = DateTime.fromJSDate(startUtc, { zone });

  // Jump cursor forward to the first eligible minute.
  cursor = advanceToBusinessMinute(cursor, rules);

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let slot = cursor;

    if (rules.randomize_within_minute) {
      // Jitter within the minute. Keeps things from looking
      // robotic (always firing at :00) and avoids thundering-herd
      // when multiple campaigns coincide on the same minute.
      const jitterMs = Math.floor(Math.random() * 60_000);
      slot = slot.set({ second: 0, millisecond: 0 }).plus({ milliseconds: jitterMs });
    }

    out.push(slot.toUTC().toISO()!);

    // Advance cursor by the interval, then re-validate.
    cursor = cursor.plus({ milliseconds: intervalMs });
    cursor = advanceToBusinessMinute(cursor, rules);
  }

  return out;
}

/**
 * Given the same pacing rules and a count, predict when the
 * campaign will finish. Used in the UI preview and stored on the
 * campaign row at launch.
 */
export function estimateCompletion(
  startUtc: Date,
  count: number,
  rules: PacingRules
): Date | null {
  if (count <= 0) return null;
  // Compute the LAST slot only — that's the finish time.
  // Cheap shortcut: distribute and read the tail. For 30K this is fine.
  const slots = distributeSlots(startUtc, count, rules);
  if (slots.length === 0) return null;
  return new Date(slots[slots.length - 1]);
}

/**
 * Useful for the UI: how many eligible business minutes exist in
 * the next N calendar days?
 */
export function eligibleMinutesInRange(
  startUtc: Date,
  days: number,
  rules: PacingRules
): number {
  const zone = rules.timezone;
  const start = parseTime(rules.business_hours_start);
  const end = parseTime(rules.business_hours_end);
  const minutesPerDay = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute);

  let count = 0;
  let cursor = DateTime.fromJSDate(startUtc, { zone }).startOf("day");
  for (let i = 0; i < days; i++) {
    if (!isSkipDay(cursor, rules)) count += minutesPerDay;
    cursor = cursor.plus({ days: 1 });
  }
  return count;
}
