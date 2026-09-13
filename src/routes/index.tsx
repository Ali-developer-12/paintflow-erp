import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Droplets, Loader2, Lock, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { API_URL } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In — Paint Factory ERP" },
      {
        name: "description",
        content:
          "Secure local sign-in for the Paint Factory ERP: items, formulas, production, sales, stock and accounts.",
      },
      { property: "og:title", content: "Sign In — Paint Factory ERP" },
      {
        property: "og:description",
        content: "Offline-first ERP for paint manufacturing and trading.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) void navigate({ to: "/app" });
  }, [ready, user, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
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
          <span className="text-base font-semibold">Paint ERP</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Every batch, barrel and balance in one place.
          </h1>
          <p className="mt-4 text-sm leading-relaxed opacity-70">
            Items and formulas, purchase and production, counter sales, issue vouchers, stock ledger,
            party accounts and reports — running entirely on your own machine.
          </p>
        </div>
        <p className="text-xs opacity-50">Local SQLite database · no cloud, no internet required</p>
      </div>

      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your operator credentials to unlock the system.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                  placeholder="admin"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
                  placeholder="••••••••"
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
              disabled={busy}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Signing in…" : "Unlock"}
            </button>
          </form>

          <div className="mt-8 rounded-md border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted-foreground">
            API endpoint: <span className="font-mono">{API_URL}</span>
            <br />
            Start the local server first: <span className="font-mono">cd server &amp;&amp; npm start</span>
            <br />
            Default credentials: <span className="font-mono">admin / admin123</span>
          </div>
        </div>
      </div>
    </div>
  );
}
