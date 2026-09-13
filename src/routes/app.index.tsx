import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { MODULES } from "@/lib/modules";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Paint Factory ERP" },
      { name: "description", content: "Live counts across items, parties, purchases, sales and production." },
      { property: "og:title", content: "Dashboard — Paint Factory ERP" },
      { property: "og:description", content: "Live counts across items, parties, purchases, sales and production." },
    ],
  }),
  component: Dashboard,
});

type Summary = {
  items: number;
  particulars: number;
  customers: number;
  suppliers: number;
  factory_items: number;
  purchases: number;
  sales: number;
  productions: number;
};

const CARDS: { key: keyof Summary; label: string }[] = [
  { key: "items", label: "Items" },
  { key: "particulars", label: "Item Particulars" },
  { key: "factory_items", label: "Raw Materials" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "purchases", label: "Purchase Vouchers" },
  { key: "productions", label: "Production Batches" },
  { key: "sales", label: "Sale Vouchers" },
];

function Dashboard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiGet<Summary>("/dashboard/summary"),
    retry: false,
  });

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Phase 1 foundation: database schema, authentication and navigation are in place.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium">Local server not reachable</p>
          <p className="mt-1 text-muted-foreground">{(error as Error).message}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="rounded-lg border border-border bg-card p-4 shadow-panel">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {c.label}
            </p>
            <p className="num mt-2 text-2xl font-semibold tabular-nums">
              {isLoading ? "…" : (data?.[c.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-panel">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Module build status</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="erp-grid">
            <thead>
              <tr>
                <th>Module</th>
                <th>Group</th>
                <th>Phase</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.to}>
                  <td className="font-medium">{m.label}</td>
                  <td className="text-muted-foreground">{m.group}</td>
                  <td className="text-muted-foreground">{m.phase}</td>
                  <td>
                    <span
                      className={
                        m.phase === "Phase 1"
                          ? "rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"
                          : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      }
                    >
                      {m.phase === "Phase 1" ? "Complete" : "Planned"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
