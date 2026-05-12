import Link from "next/link";

export function AppHeader({ active }: { active?: "campaigns" | "new" }) {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/campaigns" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-brand-500 grid place-items-center text-white text-xs font-bold">A</div>
            <div className="leading-tight">
              <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">ASAP</div>
              <div className="text-sm font-semibold text-ink-900 -mt-0.5">Campaign Runner</div>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            <Link
              href="/campaigns"
              className={`px-3 py-1.5 text-sm rounded-md ${
                active === "campaigns"
                  ? "bg-ink-100 text-ink-900 font-medium"
                  : "text-ink-600 hover:bg-ink-50"
              }`}
            >
              Campaigns
            </Link>
          </nav>
        </div>
        <Link href="/campaigns/new" className="btn-primary text-sm">+ New campaign</Link>
      </div>
    </header>
  );
}
