import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Minus, PackagePlus, Plus, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

type Supplier = {
  id: number;
  name: string;
};

type FactoryItem = {
  id: number;
  name: string;
  unit: string;
  stock_qty: number;
  rate: number;
};

type Item = {
  id: number;
  name: string;
};

type Particular = {
  id: number;
  item_id: number;
  type: string;
  stock_qty: number;
};

type PurchaseLine = {
  id: string;
  stockType: "factory" | "particular";
  factory_item_id: string;
  particular_id: string;
  qty: number;
  rate: number;
  description: string;
  amount: number;
};

const makeLine = (): PurchaseLine => ({
  id: crypto.randomUUID(),
  stockType: "factory",
  factory_item_id: "",
  particular_id: "",
  qty: 1,
  rate: 0,
  description: "",
  amount: 0,
});

export const Route = createFileRoute("/app/purchase")({
  component: PurchasePage,
});

function PurchasePage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [factoryItems, setFactoryItems] = useState<FactoryItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [particularsByItem, setParticularsByItem] = useState<Record<number, Particular[]>>({});
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [supplierNameInput, setSupplierNameInput] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([makeLine()]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [supplierRows, factoryRows, itemRows] = await Promise.all([
          apiGet<Supplier[]>("/suppliers"),
          apiGet<FactoryItem[]>("/factory-items"),
          apiGet<Item[]>("/items"),
        ]);

        setSuppliers(supplierRows);
        if (supplierRows[0]) setSelectedSupplierId(String(supplierRows[0].id));

        setFactoryItems(factoryRows);
        setItems(itemRows);

        if (itemRows.length > 0) {
          const groups = await Promise.all(
            itemRows.map(async (item) => {
              const rows = await apiGet<Particular[]>(`/items/${item.id}/particulars`);
              return [item.id, rows] as const;
            }),
          );
          setParticularsByItem(Object.fromEntries(groups));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load purchase data");
      }
    })();
  }, []);

  const isManualSupplier = suppliers.length === 0;

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
    [lines],
  );

  function updateLine(index: number, next: Partial<PurchaseLine>) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const updated = { ...line, ...next };
        const qty = Number(updated.qty || 0);
        const rate = Number(updated.rate || 0);
        updated.amount = qty * rate;
        if (updated.stockType === "particular") {
          updated.factory_item_id = "";
        }
        if (updated.stockType === "factory") {
          updated.particular_id = "";
        }
        return updated;
      }),
    );
  }

  function addLine() {
    setLines((current) => [...current, makeLine()]);
  }

  function removeLine(index: number) {
    setLines((current) => (current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : [makeLine()]));
  }

  async function handleSubmit() {
    setError("");
    setSuccess("");

    const payloadLines = lines
      .map((line) => {
        const qty = Number(line.qty || 0);
        const rate = Number(line.rate || 0);
        if (qty <= 0 || rate < 0) return null;

        const factoryItemId = line.stockType === "factory" ? Number(line.factory_item_id || 0) : null;
        const particularId = line.stockType === "particular" ? Number(line.particular_id || 0) : null;

        if (!factoryItemId && !particularId) {
          return null;
        }

        return {
          factory_item_id: factoryItemId || null,
          particular_id: particularId || null,
          qty,
          rate,
          amount: qty * rate,
          name:
            line.stockType === "factory"
              ? factoryItems.find((item) => item.id === factoryItemId)?.name || ""
              : items
                  .map((item) => ({ item, particulars: particularsByItem[item.id] || [] }))
                  .flatMap(({ item, particulars }) =>
                    particulars.filter((particular) => particular.id === particularId).map(() => `${item.name} / ${particular.type}`),
                  )[0] || "",
        };
      })
      .filter(Boolean);

    if (payloadLines.length === 0) {
      setError("Add at least one valid purchase line with quantity and rate.");
      return;
    }

    try {
      setIsSaving(true);
      await apiPost("/purchases", {
        date: new Date().toISOString().slice(0, 10),
        supplier_id: isManualSupplier ? undefined : Number(selectedSupplierId || 0),
        supplier_name: isManualSupplier ? supplierNameInput : undefined,
        remarks: "",
        lines: payloadLines,
      });
      setSuccess("Purchase recorded successfully.");
      setLines([makeLine()]);
      setSupplierNameInput("");
      setSelectedSupplierId(suppliers[0] ? String(suppliers[0].id) : "");
      const refreshedFactoryItems = await apiGet<FactoryItem[]>("/factory-items");
      const refreshedSuppliers = await apiGet<Supplier[]>("/suppliers");
      setFactoryItems(refreshedFactoryItems);
      setSuppliers(refreshedSuppliers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save purchase");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase</h1>
          <p className="text-sm text-muted-foreground">Supplier intake and stock replenishment</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Supplier</label>
            {isManualSupplier ? (
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={supplierNameInput}
                onChange={(event) => setSupplierNameInput(event.target.value)}
                placeholder="Add supplier name"
              />
            ) : (
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedSupplierId}
                onChange={(event) => setSelectedSupplierId(event.target.value)}
              >
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={String(supplier.id)}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            )}
            {isManualSupplier && <p className="text-xs text-muted-foreground">Temporary supplier-name shim while Phase 3 supplier CRUD is still pending.</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Purchase total</label>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-lg font-semibold tabular-nums">
              {Number(total || 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Line items</h2>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            onClick={addLine}
          >
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.id} className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 md:grid-cols-[1.2fr_1.2fr_1fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stock type</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={line.stockType}
                  onChange={(event) => updateLine(index, { stockType: event.target.value as "factory" | "particular" })}
                >
                  <option value="factory">Raw material</option>
                  <option value="particular">Finished item</option>
                </select>
              </div>

              {line.stockType === "factory" ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Material</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                    value={line.factory_item_id}
                    onChange={(event) => updateLine(index, { factory_item_id: event.target.value })}
                  >
                    <option value="">Select raw material</option>
                    {factoryItems.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name} ({item.unit})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Finished item</label>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                    value={line.particular_id}
                    onChange={(event) => updateLine(index, { particular_id: event.target.value })}
                  >
                    <option value="">Select item</option>
                    {items.flatMap((item) => {
                      const particulars = particularsByItem[item.id] || [];
                      if (particulars.length === 0) {
                        return [
                          <option key={`${item.id}-none`} value="" disabled>
                            {item.name} (no particulars)
                          </option>,
                        ];
                      }

                      return particulars.map((particular) => (
                        <option key={particular.id} value={String(particular.id)}>
                          {item.name} / {particular.type}
                        </option>
                      ));
                    })}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qty</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={line.qty}
                  onChange={(event) => updateLine(index, { qty: Number(event.target.value) })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rate</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                  value={line.rate}
                  onChange={(event) => updateLine(index, { rate: Number(event.target.value) })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</label>
                <div className="rounded-md border border-border bg-background px-2 py-2 text-sm font-medium tabular-nums">
                  {Number(line.amount || 0).toLocaleString()}
                </div>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => removeLine(index)}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {factoryItems.length === 0 && (
          <div className="mt-4 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No raw materials exist yet. A purchase can be saved only after the factory item list is populated.
          </div>
        )}

        {error && <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {success && <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{success}</div>}

        <div className="mt-4 flex justify-end">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
          >
            <PackagePlus className="h-4 w-4" />
            {isSaving ? "Saving…" : "Save Purchase"}
          </button>
        </div>
      </div>
    </div>
  );
}
