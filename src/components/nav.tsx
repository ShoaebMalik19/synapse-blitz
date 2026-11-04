"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { api } from "@/lib/client";
import { cx } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#c4b5fd" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#5b8cff" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#11111a" stroke="rgba(255,255,255,0.1)" />
        <path d="M9 11h6l2 5 2-5h4M9 21h4l2-5M17 16l2 5h4" fill="none" stroke="url(#lg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="11" r="1.6" fill="#c4b5fd" />
        <circle cx="23" cy="21" r="1.6" fill="#5b8cff" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Synapse</span>
    </Link>
  );
}

export function Nav({ authed = true }: { authed?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={cx("rounded-md px-2.5 py-1.5 text-[13px] transition-colors", path === href ? "bg-white/[0.06] text-fg" : "text-muted hover:text-fg")}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-1 sm:flex">
            {link("/dashboard", "Dashboard")}
            {link("/", "Overview")}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted md:inline-flex">
            <span className="size-1.5 rounded-full bg-ok" /> Monad testnet · 10143
          </span>
          {authed && (
            <button
              onClick={async () => {
                await api("/api/session", { method: "DELETE" }).catch(() => null);
                router.push("/login");
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted hover:text-fg"
              aria-label="Sign out"
            >
              <LogOut className="size-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
