import { NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const config = {
  // Apply to everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/auth).*)"],
};

export function middleware(req: NextRequest) {
  if (isAuthed(req)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
