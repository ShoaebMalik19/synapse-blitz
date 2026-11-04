"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Logo } from "@/components/nav";
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
          setErr(e instanceof ApiError ? e.message : "Sign-in failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-xs text-muted" htmlFor="token">
        Operator access token
      </label>
      <input
        id="token"
        type="password"
        autoComplete="current-password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="h-10 w-full rounded-lg border border-line-strong bg-elev px-3 font-mono text-sm outline-none focus:border-violet/60"
        placeholder="OPERATOR_ACCESS_TOKEN from .env"
      />
      {err && <ErrorNote>{err}</ErrorNote>}
      <Button type="submit" className="w-full" disabled={busy || !token}>
        {busy ? <Spinner /> : <KeyRound className="size-4" />} Sign in
      </Button>
      <p className="text-xs leading-relaxed text-dim">
        Prototype single-operator model: the server issues an HMAC-signed HttpOnly session. Spending, escrow and failure
        injection require this session.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="glow flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <Suspense>
            <LoginForm />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}
