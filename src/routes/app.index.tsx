import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — GSN Paints" },
      {
        name: "description",
        content: "Overview of your factory data across items, sales, stock and accounts.",
      },
      { property: "og:title", content: "Dashboard — GSN Paints" },
      {
        property: "og:description",
        content: "Overview of your factory data across items, sales, stock and accounts.",
      },
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

const PRIMARY_CARDS: { key: keyof Summary; label: string }[] = [
  { key: "items", label: "Items" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "sales", label: "Sales" },
];

const BUSINESS_CARDS: { key: keyof Summary; label: string }[] = [
  { key: "factory_items", label: "Raw materials" },
  { key: "purchases", label: "Purchase vouchers" },
  { key: "productions", label: "Production batches" },
  { key: "particulars", label: "Particulars" },
];

function Dashboard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiGet<Summary>("/dashboard/summary"),
    retry: false,
  });

  const hasData = Boolean(data && Object.values(data).some((value) => Number(value) > 0));

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your factory data.</p>
      </div>

      {error && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium">Local server not reachable</p>
          <p className="mt-1 text-muted-foreground">{(error as Error).message}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PRIMARY_CARDS.map((card) => (
          <div key={card.key} className="rounded-lg border border-border bg-card p-4 shadow-panel">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {card.label}
            </p>
            <p className="num mt-2 text-2xl font-semibold tabular-nums">
              {isLoading ? "…" : (data?.[card.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BUSINESS_CARDS.map((card) => (
          <div key={card.key} className="rounded-lg border border-border bg-card p-4 shadow-panel">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {card.label}
            </p>
            <p className="num mt-2 text-2xl font-semibold tabular-nums">
              {isLoading ? "…" : (data?.[card.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {!isLoading && !hasData && (
        <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
          No factory data yet. Add your first supplier, raw material, or sale to start tracking the
          production cycle.
        </div>
      )}
    </div>
  );
}
