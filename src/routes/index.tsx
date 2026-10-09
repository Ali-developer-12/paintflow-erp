import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Droplets, Loader2, Lock, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { API_URL, apiGet } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In — PaintFlow ERP" },
      {
        name: "description",
        content:
          "Secure local sign-in for PaintFlow ERP: items, formulas, production, sales, stock and accounts.",
      },
      { property: "og:title", content: "Sign In — PaintFlow ERP" },
      {
        property: "og:description",
        content: "Offline-first ERP for paint manufacturing and trading.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, ready, login, setup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) void navigate({ to: "/app" });
  }, [ready, user, navigate]);

  useEffect(() => {
    let active = true;
    void apiGet<{
      needsSetup: boolean;
      lastRestore: { ok: boolean; error?: string } | null;
    }>("/auth/status")
      .then(({ needsSetup: required, lastRestore }) => {
        if (active) setNeedsSetup(required);
        if (active && lastRestore) {
          setRestoreNotice({
            ok: lastRestore.ok,
            message: lastRestore.ok
              ? "Backup restored successfully."
              : `Backup restore failed: ${lastRestore.error || "The previous data was kept."}`,
          });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to check administrator setup");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsSetup) await setup(username, password, fullName);
      else await login(username, password);
      void navigate({ to: "/app" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Droplets className="h-5 w-5" />
          </div>
          <span className="text-base font-semibold">PaintFlow ERP</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Every batch, barrel and balance in one place.
          </h1>
          <p className="mt-4 text-sm leading-relaxed opacity-70">
            Items and formulas, purchase and production, counter sales, issue vouchers, stock
            ledger, party accounts and reports — running entirely on your own machine.
          </p>
        </div>
        <p className="text-xs opacity-50">Local SQLite database · no cloud, no internet required</p>
      </div>

      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight">
            {needsSetup ? "Create administrator account" : "Sign in"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {needsSetup
              ? "Set up the first administrator account for this database."
              : "Enter your operator credentials to unlock the system."}
          </p>

          {restoreNotice && (
            <p
              role={restoreNotice.ok ? "status" : "alert"}
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                restoreNotice.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {restoreNotice.message}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {needsSetup && (
              <div className="space-y-1.5">
                <label
                  htmlFor="full-name"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Full name
                </label>
                <input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  required
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
                  placeholder="Your name"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Username
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
                  placeholder={needsSetup ? "Choose a username" : "Username"}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={needsSetup ? "new-password" : "current-password"}
                  minLength={needsSetup ? 8 : undefined}
                  required
                  className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
                  placeholder={needsSetup ? "At least 8 characters" : "Password"}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || needsSetup === null}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Please wait…" : needsSetup ? "Create administrator" : "Unlock"}
            </button>
          </form>

          <div className="mt-8 rounded-md border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted-foreground">
            API endpoint: <span className="font-mono">{API_URL}</span>
            <br />
            Start the local server first:{" "}
            <span className="font-mono">cd server &amp;&amp; npm start</span>
            <br />
            First run: create the administrator account here. No default password is set.
          </div>
        </div>
      </div>
    </div>
  );
}
