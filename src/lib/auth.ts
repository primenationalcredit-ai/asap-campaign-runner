// ============================================================
// App auth — shared-password cookie gate
// ============================================================
// Internal tool, not multi-tenant. One shared password (env var)
// is enough. Anyone who knows it can use the app.
// We sign the cookie value with the password itself so users
// can't forge it without knowing the secret.
// ============================================================

import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "asap_campaign_auth";

function expectedToken(password: string): string {
  // Cookie value is HMAC(password, "asap-campaign-runner-auth-v1")
  // — knowing the password lets us produce this; anyone without it
  // can't.
  return createHmac("sha256", password)
    .update("asap-campaign-runner-auth-v1")
    .digest("hex");
}

export function getAppPassword(): string {
  const pw = process.env.APP_PASSWORD;
  if (!pw || pw.length < 8) {
    throw new Error("APP_PASSWORD env var must be set (8+ chars)");
  }
  return pw;
}

/** Verify a submitted password and return the cookie value to set. */
export function passwordToCookieValue(submittedPw: string): string | null {
  const real = getAppPassword();
  if (submittedPw.length !== real.length) return null;
  const a = Buffer.from(submittedPw);
  const b = Buffer.from(real);
  if (!timingSafeEqual(a, b)) return null;
  return expectedToken(real);
}

/** Used by middleware and API routes to gate requests. */
export function isAuthed(req: NextRequest): boolean {
  try {
    const cookie = req.cookies.get(COOKIE_NAME)?.value;
    if (!cookie) return false;
    const expected = expectedToken(getAppPassword());
    if (cookie.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
  } catch {
    return false;
  }
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
