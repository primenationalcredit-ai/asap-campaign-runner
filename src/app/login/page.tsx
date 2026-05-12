"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginFormInner() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/campaigns";

  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Login failed");
      }
      router.push(from);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen dot-bg flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">ASAP</div>
          <h1 className="mt-1 text-xl font-semibold text-ink-900">Campaign Runner</h1>
          <p className="mt-1 text-sm text-ink-500">Internal access only.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              className="input mt-1"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              required
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Verifying…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  );
}
