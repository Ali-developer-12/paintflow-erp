import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, PanelLeftClose, PanelLeft, Droplets } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { MODULES, MODULE_GROUPS } from "@/lib/modules";
import { API_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (ready && !user) void navigate({ to: "/" });
  }, [ready, user, navigate]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Droplets className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Paint ERP</p>
              <p className="truncate text-[10px] uppercase tracking-wider opacity-60">
                Factory Edition
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {MODULE_GROUPS.map((group) => {
            const items = MODULES.filter((m) => m.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-3">
                {!collapsed && (
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest opacity-50">
                    {group}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {items.map((m) => (
                    <li key={m.to}>
                      <Link
                        to={m.to}
                        activeOptions={{ exact: m.to === "/app" }}
                        activeProps={{
                          className: "bg-sidebar-accent text-sidebar-accent-foreground",
                        }}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium opacity-90 transition-colors hover:bg-sidebar-accent hover:opacity-100"
                        title={m.label}
                      >
                        <m.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{m.label}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2.5 text-xs opacity-70 hover:opacity-100"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b border-border bg-card/90 px-5 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Enterprise Resource Planning</p>
            <p className="truncate text-[11px] text-muted-foreground">Local database · {API_URL}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-medium leading-tight">{user.full_name ?? user.username}</p>
              <p className="text-[11px] capitalize text-muted-foreground">{user.role}</p>
            </div>
            <button
              onClick={() => {
                logout();
                void navigate({ to: "/" });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
