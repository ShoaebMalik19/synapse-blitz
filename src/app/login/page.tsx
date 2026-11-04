"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/nav";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/api/session", { method: "POST", body: JSON.stringify({ token }) });
          router.push(next.startsWith("/") ? next : "/dashboard");
        } catch (e) {
          setErr(e instanceof ApiError ? `${e.message}. Check OPERATOR_ACCESS_TOKEN in your .env file.` : "Sign-in failed. Check that the server is running.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="placard mb-2 block text-muted" htmlFor="token">
          Operator access token
        </label>
        <input
          id="token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-11 w-full rounded-[4px] border border-line-strong bg-field px-3 font-mono text-sm outline-none focus:border-fg"
          aria-describedby="token-hint"
        />
        <p id="token-hint" className="mt-1.5 text-xs text-dim">
          The <code className="font-mono">OPERATOR_ACCESS_TOKEN</code> value from your .env file.
        </p>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <Button type="submit" className="h-11 w-full" disabled={busy || !token}>
        {busy ? <Spinner /> : <KeyRound className="size-4" />} Sign in to the console
      </Button>
      <p className="border-t border-dashed border-line-strong pt-4 text-xs leading-relaxed text-dim">
        One operator per deployment. Spending, escrow and failure drills all require this session, and signing keys never leave the server.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="chart-paper flex min-h-screen flex-col">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <Card className="overflow-hidden">
            <div className="placard flex items-center justify-between bg-fg px-6 py-2 text-bg">
              <span>Console access</span>
              <span className="text-accent">● Restricted</span>
            </div>
            <Suspense>
              <LoginForm />
            </Suspense>
          </Card>
        </div>
      </div>
    </div>
  );
}
