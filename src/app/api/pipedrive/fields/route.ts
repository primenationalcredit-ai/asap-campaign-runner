import { NextResponse } from "next/server";
import { listDealFields } from "@/lib/pipedrive";

export const runtime = "nodejs";

export async function GET() {
  try {
    const all = await listDealFields();
    // Surface only the fields the app can write to. Custom fields
    // have 40-char hex keys; built-in fields use short keys
    // (id, title, value, etc.). We support custom fields only.
    const custom = all.filter((f) => /^[a-f0-9]{40}$/i.test(f.key));
    return NextResponse.json({ fields: custom });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
