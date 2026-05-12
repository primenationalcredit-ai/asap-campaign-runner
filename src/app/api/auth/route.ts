import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, passwordToCookieValue } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pw = String(body?.password ?? "");
    const cookieVal = passwordToCookieValue(pw);
    if (!cookieVal) {
      // Small delay to slow brute force.
      await new Promise((r) => setTimeout(r, 1000));
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE_NAME, cookieVal, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
