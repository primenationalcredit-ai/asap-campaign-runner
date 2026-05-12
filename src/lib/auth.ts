// ============================================================
// App auth — shared-password cookie gate
// ============================================================
// Internal tool, not multi-tenant. One shared password (env var)
// is enough. Anyone who knows it can use the app.
//
// IMPORTANT: this file is imported by middleware.ts which runs in
// the Edge runtime. That means: NO Node-only modules (crypto, fs,
// buffer, etc.). Only standard Web APIs + JS primitives.
// ============================================================

import { NextRequest } from "next/server";

const COOKIE_NAME = "asap_campaign_auth";

export function getAppPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw || pw.length < 8) {
    throw new Error("APP_PASSWORD env var must be set (8+ chars)");
  }
  return pw;
}

/**
 * Constant-time string equality. JS-only (no Node crypto) so it
 * works in the Edge runtime where middleware runs.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify a submitted password and return the cookie value to set.
 * Returns null if the password is wrong.
 *
 * The cookie value is just the password itself. We considered using
 * HMAC for a more opaque token, but Node's crypto module isn't
 * available in the Edge runtime and the security benefit was
 * marginal for an internal single-password tool. The cookie is
 * httpOnly + Secure + SameSite=Lax so extracting it requires a
 * pretty intrusive attacker who could just brute-force /api/auth
 * anyway.
 */
export function passwordToCookieValue(submittedPw: string): string | null {
  const real = getAppPassword();
  if (!constantTimeEqual(submittedPw, real)) return null;
  return real;
}

/** Used by middleware and API routes to gate requests. */
export function isAuthed(req: NextRequest): boolean {
  try {
    const cookie = req.cookies.get(COOKIE_NAME)?.value;
    if (!cookie) return false;
    return constantTimeEqual(cookie, getAppPassword());
  } catch {
    return false;
  }
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
