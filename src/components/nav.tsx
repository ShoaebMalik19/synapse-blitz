"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Moon, Sun } from "lucide-react";
import { api } from "@/lib/client";
import { cx } from "./ui";

/** Recorder mark: an orange flight-recorder plate with a trace that breaks and resumes. */
export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Synapse home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="5" fill="var(--accent)" />
        <path d="M5 18h5l2-6 3 10 2-5" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 17h7" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.1 3.4" />
        <circle cx="20" cy="17" r="1.8" fill="var(--on-accent)" />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] font-semibold tracking-tight">SYNAPSE</span>
        <span className="placard mt-0.5 text-[8.5px] text-dim">agent flight recorder</span>
      </span>
    </Link>
  );
}

const THEME_EVENT = "synapse-theme-change";
const subscribeTheme = (cb: () => void) => {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
};

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === "dark", () => false);
  const flip = () => {
    const next = !dark;
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    window.dispatchEvent(new Event(THEME_EVENT));
    try {
      localStorage.setItem("synapse-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable — theme still applies for this visit */
    }
  };
  return (
    <button
      onClick={flip}
      className="inline-flex size-9 items-center justify-center rounded-[4px] text-muted hover:bg-fg/[0.06] hover:text-fg"
      aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
      title={dark ? "Day mode" : "Night mode"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function Nav({ authed = true }: { authed?: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const link = (href: string, label: string) => {
    const active = path === href || (href === "/dashboard" && path.startsWith("/workflows"));
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative px-1 py-4 text-[13px] font-medium transition-colors",
          active ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-accent" : "text-muted hover:text-fg",
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <header className="sticky top-0 z-30 border-b border-line-strong bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-5 sm:flex" aria-label="Primary">
            {link("/dashboard", "Console")}
            {link("/", "How it works")}
          </nav>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-2 hidden items-center gap-1.5 rounded-[3px] border border-line-strong px-2 py-1 font-mono text-[11px] text-muted md:inline-flex">
            <span className="size-1.5 rounded-full bg-ok" aria-hidden /> Monad testnet · 10143
          </span>
          <ThemeToggle />
          {authed && (
            <button
              onClick={async () => {
                await api("/api/session", { method: "DELETE" }).catch(() => null);
                router.push("/login");
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-[4px] px-2 text-[13px] text-muted hover:bg-fg/[0.06] hover:text-fg"
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
