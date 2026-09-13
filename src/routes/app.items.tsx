import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calculator, Plus, Save, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";

type Item = {
  id: number;
  code: string;
  name: string;
  category: string;
  remarks: string;
};

type Particular = {
  id: number;
  item_id: number;
  type: string;
  weight_unit: string;
  cost_price: number;
  ws_price: number;
  sale_price: number;
  stock_qty: number;
  min_qty: number;
  max_qty: number;
  formula_code: string;
  sort_order: number;
};

type FactoryItem = {
  id: number;
  code: string;
  name: string;
  unit: string;
  rate: number;
  stock_qty: number;
  min_qty: number;
  max_qty: number;
  category: string;
  is_active: number;
};

type FormulaLine = {
  id?: number;
  factory_item_id: number | null;
  material_name: string;
  value: number;
  rate: number;
  cost_value: number;
};

export const Route = createFileRoute("/app/items")({
  component: ItemsPage,
});

function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [particulars, setParticulars] = useState<Particular[]>([]);
  const [factoryItems, setFactoryItems] = useState<FactoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalParticular, setModalParticular] = useState<Particular | null>(null);
  const [formulaLines, setFormulaLines] = useState<FormulaLine[]>([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [formulaCode, setFormulaCode] = useState("");

  async function loadItems() {
    const rows = await apiGet<Item[]>("/items");
    setItems(rows);
    if (!selectedItem && rows[0]) {
      setSelectedItem(rows[0]);
      const rowsForParticulars = await apiGet<Particular[]>(`/items/${rows[0].id}/particulars`);
      setParticulars(rowsForParticulars);
    }
  }

  async function loadParticulars(itemId: number) {
    const rows = await apiGet<Particular[]>(`/items/${itemId}/particulars`);
    setParticulars(rows);
  }

  async function loadFactoryItems() {
    const rows = await apiGet<FactoryItem[]>("/factory-items");
    setFactoryItems(rows);
  }

  async function loadFormula(particular: Particular) {
    const payload = await apiGet<{ formula: any; lines: FormulaLine[] }>(`/formulas/${particular.id}`);
    if (payload.formula) {
      setFormulaCode(payload.formula.code ?? "");
    } else {
      setFormulaCode("");
    }
    setFormulaLines(payload.lines.map((line) => ({
      id: line.id,
      factory_item_id: line.factory_item_id,
      material_name: line.material_name,
      value: Number(line.value || 0),
      rate: Number(line.rate || 0),
      cost_value: Number(line.cost_value || 0),
    })));
  }

  async function openFormula(particular: Particular) {
    setModalParticular(particular);
    await loadFormula(particular);
  }

  async function saveFormula() {
    if (!modalParticular) return;
    setModalBusy(true);
    try {
      const totalCost = formulaLines.reduce((sum, line) => sum + Number(line.value || 0) * Number(line.rate || 0), 0);
      const payload = {
        code: formulaCode,
        batch_size: 1,
        total_cost: totalCost,
        remarks: "",
        lines: formulaLines.map((line) => ({
          factory_item_id: line.factory_item_id,
          material_name: line.material_name,
          value: line.value,
          rate: line.rate,
          costValue: line.value * line.rate,
        })),
      };
      const result = await apiPost<{ formula: any; lines: FormulaLine[] }>(`/formulas/${modalParticular.id}`, payload);
      if (result.lines) setFormulaLines(result.lines.map((line) => ({
        id: line.id,
        factory_item_id: line.factory_item_id,
        material_name: line.material_name,
        value: Number(line.value || 0),
        rate: Number(line.rate || 0),
        cost_value: Number(line.cost_value || 0),
      })));
      setModalParticular(null);
    } finally {
      setModalBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadItems();
        await loadFactoryItems();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function addItem() {
    const draft = await apiPost<Item>("/items", {
      code: `ITEM-${Date.now()}`,
      name: "New item",
      category: "",
      remarks: "",
    });
    setItems((cur) => [draft, ...cur]);
    setSelectedItem(draft);
    await loadParticulars(draft.id);
  }

  async function deleteItem(item: Item) {
    await apiDelete(`/items/${item.id}`);
    const next = items.filter((it) => it.id !== item.id);
    setItems(next);
    if (selectedItem?.id === item.id) {
      setSelectedItem(next[0] ?? null);
      if (next[0]) await loadParticulars(next[0].id);
      else setParticulars([]);
    }
  }

  async function addParticular() {
    if (!selectedItem) return;
    const draft = {
      type: "",
      weight_unit: "",
      cost_price: 0,
      ws_price: 0,
      sale_price: 0,
      stock_qty: 0,
      min_qty: 0,
      max_qty: 0,
      formula_code: "",
    };
    const row = await apiPost<Particular>(`/items/${selectedItem.id}/particulars`, draft);
    setParticulars((cur) => [...cur, row]);
  }

  async function updateParticular(row: Particular, field: keyof Particular, value: string | number) {
    if (!selectedItem) return;
    const payload = {
      ...row,
      [field]: value,
    };
    const updated = await apiPut<Particular>(`/items/${selectedItem.id}/particulars/${row.id}`, payload);
    setParticulars((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function deleteParticular(row: Particular) {
    if (!selectedItem) return;
    await apiDelete(`/items/${selectedItem.id}/particulars/${row.id}`);
    setParticulars((cur) => cur.filter((r) => r.id !== row.id));
  }

  const totalCost = useMemo(() =>
    formulaLines.reduce((sum, line) => sum + Number(line.value || 0) * Number(line.rate || 0), 0),
    [formulaLines],
  );

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Items Master</h1>
          <p className="text-sm text-muted-foreground">Items and Formula / BOM</p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={addItem}>
            <Plus className="h-4 w-4" /> Add Item
          </button>
        </div>
      </div>

      <section className="grid flex-1 grid-cols-[320px_minmax(620px,1fr)] gap-4 overflow-hidden rounded-md border border-border bg-card">
        <aside className="border-r border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Items</div>
            <span className="rounded-full border px-2 py-0.5 text-[11px]">{items.length}</span>
          </div>
          <div className="max-h-full overflow-y-auto">
            {items.length === 0 && <div className="text-sm text-muted-foreground">No items</div>}
            {items.map((item) => (
              <div key={item.id} className={cn("mb-2 cursor-pointer rounded-md border p-3 transition", selectedItem?.id === item.id ? "border-teal-500 bg-teal-50/20" : "border-border hover:bg-accent")}
                onClick={async () => { setSelectedItem(item); await loadParticulars(item.id); }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{item.name}</div>
                    <div className="text-[11px] text-muted-foreground">{item.code}</div>
                  </div>
                  <button className="text-xs text-destructive" onClick={(e) => { e.stopPropagation(); void deleteItem(item); }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex flex-1 flex-col overflow-hidden">
          {selectedItem ? (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="text-lg font-semibold">{selectedItem.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedItem.code}</div>
                </div>
                <button className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent" onClick={addParticular}>
                  <Plus className="h-4 w-4" /> Add Particular
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">Sr</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Weight/Unit</th>
                    <th className="px-3 py-2">Cost Price</th>
                    <th className="px-3 py-2">WS Price</th>
                    <th className="px-3 py-2">Sale Price</th>
                    <th className="px-3 py-2">Stock</th>
                    <th className="px-3 py-2">Min</th>
                    <th className="px-3 py-2">Max</th>
                    <th className="px-3 py-2">F.Code</th>
                    <th className="px-3 py-2">Formula</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                  </thead>
                  <tbody>
                  {particulars.map((row, idx) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2 text-center">{idx + 1}</td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.type} onChange={(e) => void updateParticular(row, "type", e.target.value)} /></td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.weight_unit} onChange={(e) => void updateParticular(row, "weight_unit", e.target.value)} /></td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.cost_price} type="number" onChange={(e) => void updateParticular(row, "cost_price", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.ws_price} type="number" onChange={(e) => void updateParticular(row, "ws_price", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.sale_price} type="number" onChange={(e) => void updateParticular(row, "sale_price", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-20 rounded-md border px-2 py-1" value={row.stock_qty} type="number" onChange={(e) => void updateParticular(row, "stock_qty", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-20 rounded-md border px-2 py-1" value={row.min_qty} type="number" onChange={(e) => void updateParticular(row, "min_qty", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-20 rounded-md border px-2 py-1" value={row.max_qty} type="number" onChange={(e) => void updateParticular(row, "max_qty", Number(e.target.value))} /></td>
                      <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" value={row.formula_code} onChange={(e) => void updateParticular(row, "formula_code", e.target.value)} /></td>
                      <td className="px-3 py-2"><button className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => void openFormula(row)}><Calculator className="h-3.5 w-3.5" />Formula</button></td>
                      <td className="px-3 py-2"><button className="rounded-md border border-destructive px-2 py-1 text-xs text-destructive hover:bg-destructive/10" onClick={() => void deleteParticular(row)}><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No item selected</div>
          )}
        </section>
      </section>

      {modalParticular && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[760px] max-w-[90vw] rounded-lg border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <div className="text-lg font-semibold">Formula / BOM</div>
                <div className="text-xs text-muted-foreground">Particular #{modalParticular.id} · {selectedItem?.name}</div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-md border px-3 py-2 text-xs" onClick={() => setModalParticular(null)}>Close</button>
                <button className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => void saveFormula()}><Save className="h-3.5 w-3.5" />Save</button>
              </div>
            </div>

            <div className="mt-4">
              <div className="grid grid-cols-[140px_1fr] gap-2 items-center">
                <label className="text-xs font-medium">Formula Code</label>
                <input className="rounded-md border px-2 py-1 text-sm" value={formulaCode} onChange={(e) => setFormulaCode(e.target.value)} placeholder="F-001" />
              </div>

              <div className="mt-4 rounded-md border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left">Item Name</th>
                    <th className="px-3 py-2 text-left">Value</th>
                    <th className="px-3 py-2 text-left">Rate</th>
                    <th className="px-3 py-2 text-left">Cost Value</th>
                    <th className="px-3 py-2 text-left">Action</th>
                  </tr>
                  </thead>
                  <tbody>
                  {formulaLines.map((line, idx) => {
                    const cost = (Number(line.value || 0) * Number(line.rate || 0));
                    return (
                      <tr key={idx} className="border-t border-border">
                        <td className="px-3 py-2">
                          <select className="w-full rounded-md border px-2 py-1" value={line.factory_item_id ?? ""} onChange={(e) => {
                            const id = Number(e.target.value);
                            const factory = factoryItems.find((f) => f.id === id);
                            setFormulaLines((cur) => cur.map((it, i) => i === idx ? { ...it, factory_item_id: id, material_name: factory?.name ?? "", rate: factory?.rate ?? 0 } : it));
                          }}>
                            <option value="">Select material</option>
                            {factoryItems.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" type="number" value={line.value} onChange={(e) => {
                          const val = Number(e.target.value || 0);
                          setFormulaLines((cur) => cur.map((it, i) => i === idx ? { ...it, value: val, cost_value: val * Number(it.rate || 0) } : it));
                        }} /></td>
                        <td className="px-3 py-2"><input className="w-24 rounded-md border px-2 py-1" type="number" value={line.rate} onChange={(e) => {
                          const rate = Number(e.target.value || 0);
                          setFormulaLines((cur) => cur.map((it, i) => i === idx ? { ...it, rate, cost_value: Number(it.value || 0) * rate } : it));
                        }} /></td>
                        <td className="px-3 py-2 font-medium">{cost}</td>
                        <td className="px-3 py-2"><button className="rounded-md border px-2 py-1 text-xs" onClick={() => setFormulaLines((cur) => cur.filter((_, i) => i !== idx))}><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
                <div className="border-t border-border p-3">
                  <button className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs" onClick={() => setFormulaLines((cur) => [...cur, { factory_item_id: null, material_name: "", value: 0, rate: 0, cost_value: 0 }])}><Plus className="h-3.5 w-3.5" />Add Line</button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <div className="text-sm font-medium">Totals</div>
                <div className="flex gap-8 text-sm">
                  <span>Value: {formulaLines.reduce((sum, line) => sum + Number(line.value || 0), 0)}</span>
                  <span>Cost Value: {totalCost}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
