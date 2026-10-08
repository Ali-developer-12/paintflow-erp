import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Plus, SlidersHorizontal, Archive, RefreshCcw, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type StockItem = {
  id: number;
  name: string;
  unit: string;
  stock_qty: number;
  min_qty: number;
  max_qty: number;
  stock_type: "raw" | "finished";
  rate?: number;
};

type LedgerRow = {
  id: number;
  date: string;
  item_name: string;
  unit: string;
  ref_type: string;
  ref_no: string;
  qty_in: number;
  qty_out: number;
  balance_after: number;
};

type StockAdjustment = {
  id: number;
  voucher_no: string;
  date: string;
  item_type: "raw" | "finished";
  factory_item_id?: number;
  factory_item_name?: string;
  factory_item_unit?: string;
  particular_id?: number;
  item_name?: string;
  particular_type?: string;
  previous_qty: number;
  adjustment_qty: number;
  resulting_qty: number;
  reason: string;
  username?: string;
  created_at: string;
};

type OpeningStockRecord = {
  id: number;
  voucher_no: string;
  date: string;
  item_type: "raw" | "finished";
  factory_item_id?: number;
  factory_item_name?: string;
  factory_item_unit?: string;
  particular_id?: number;
  item_name?: string;
  particular_type?: string;
  qty: number;
  unit_cost: number;
  total_value: number;
  remarks: string;
  username?: string;
  created_at: string;
};

export const Route = createFileRoute("/app/stock")({ component: StockPage });

const quantity = (value: number) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function StockPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [items, setItems] = useState<StockItem[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [openingStocks, setOpeningStocks] = useState<OpeningStockRecord[]>([]);

  // Filters for Stock Ledger
  const [itemId, setItemId] = useState("");
  const [stockType, setStockType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Adjustment Form State
  const [showAdjForm, setShowAdjForm] = useState(false);
  const [adjForm, setAdjForm] = useState({
    item_type: "raw" as "raw" | "finished",
    item_id: "",
    date: new Date().toISOString().slice(0, 10),
    adjustment_qty: "",
    reason: "",
  });

  // Opening Stock Form State
  const [showOpnForm, setShowOpnForm] = useState(false);
  const [opnForm, setOpnForm] = useState({
    item_type: "raw" as "raw" | "finished",
    item_id: "",
    date: new Date().toISOString().slice(0, 10),
    qty: "",
    unit_cost: "",
    remarks: "Physical count opening balance",
  });

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(
    () =>
      new URLSearchParams(
        Object.entries({ item_id: itemId, stock_type: stockType, from, to }).filter(([, v]) => v),
      ).toString(),
    [itemId, stockType, from, to],
  );

  const loadStockData = useCallback(async () => {
    setLoading(true);
    try {
      const [stockItems, ledgerData] = await Promise.all([
        apiGet<StockItem[]>("/stock/summary"),
        apiGet<LedgerRow[]>(`/stock/ledger${query ? `?${query}` : ""}`),
      ]);
      setItems(stockItems);
      setLedger(ledgerData);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load stock data");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadAdjustments = useCallback(async () => {
    try {
      const rows = await apiGet<StockAdjustment[]>("/stock/adjustments");
      setAdjustments(rows);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load adjustments");
    }
  }, []);

  const loadOpeningStocks = useCallback(async () => {
    try {
      const rows = await apiGet<OpeningStockRecord[]>("/stock/opening");
      setOpeningStocks(rows);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load opening stock records");
    }
  }, []);

  useEffect(() => {
    void loadStockData();
  }, [loadStockData]);

  useEffect(() => {
    if (activeTab === "adjustments") void loadAdjustments();
    if (activeTab === "opening") void loadOpeningStocks();
  }, [activeTab, loadAdjustments, loadOpeningStocks]);

  // Selected item for Adjustment preview
  const selectedAdjItem = useMemo(() => {
    if (!adjForm.item_id) return null;
    return items.find(
      (i) => i.stock_type === adjForm.item_type && i.id === Number(adjForm.item_id),
    );
  }, [items, adjForm.item_type, adjForm.item_id]);

  const adjResultingQty = useMemo(() => {
    if (!selectedAdjItem || !adjForm.adjustment_qty) return null;
    const prev = Number(selectedAdjItem.stock_qty || 0);
    const adj = Number(adjForm.adjustment_qty || 0);
    return Math.round((prev + adj) * 100) / 100;
  }, [selectedAdjItem, adjForm.adjustment_qty]);

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjForm.item_id || !adjForm.adjustment_qty || !adjForm.reason) {
      toast.error("Please fill in all adjustment fields");
      return;
    }
    const delta = Number(adjForm.adjustment_qty);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Adjustment quantity must be non-zero");
      return;
    }
    if (adjResultingQty !== null && adjResultingQty < 0) {
      toast.error(`Adjustment would drive stock negative (${adjResultingQty}). Refused.`);
      return;
    }

    setSubmitting(true);
    try {
      const payload: {
        item_type: "raw" | "finished";
        date: string;
        adjustment_qty: number;
        reason: string;
        factory_item_id?: number;
        particular_id?: number;
      } = {
        item_type: adjForm.item_type,
        date: adjForm.date,
        adjustment_qty: delta,
        reason: adjForm.reason,
      };
      if (adjForm.item_type === "raw") {
        payload.factory_item_id = Number(adjForm.item_id);
      } else {
        payload.particular_id = Number(adjForm.item_id);
      }

      const res = await apiPost<{ voucher_no: string }>("/stock/adjustments", payload);
      toast.success(`Stock adjustment ${res.voucher_no} posted successfully`);
      setShowAdjForm(false);
      setAdjForm((prev) => ({ ...prev, item_id: "", adjustment_qty: "", reason: "" }));
      void loadStockData();
      void loadAdjustments();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOpeningStock(e: React.FormEvent) {
    e.preventDefault();
    if (!opnForm.item_id || !opnForm.qty) {
      toast.error("Item and opening quantity are required");
      return;
    }
    setSubmitting(true);
    try {
      const payload: {
        item_type: "raw" | "finished";
        date: string;
        qty: number;
        unit_cost: number;
        remarks: string;
        factory_item_id?: number;
        particular_id?: number;
      } = {
        item_type: opnForm.item_type,
        date: opnForm.date,
        qty: Number(opnForm.qty),
        unit_cost: Number(opnForm.unit_cost || 0),
        remarks: opnForm.remarks,
      };
      if (opnForm.item_type === "raw") {
        payload.factory_item_id = Number(opnForm.item_id);
      } else {
        payload.particular_id = Number(opnForm.item_id);
      }

      const res = await apiPost<{ voucher_no: string }>("/stock/opening", payload);
      toast.success(`Opening stock ${res.voucher_no} posted successfully`);
      setShowOpnForm(false);
      setOpnForm((prev) => ({ ...prev, item_id: "", qty: "", unit_cost: "" }));
      void loadStockData();
      void loadOpeningStocks();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Opening stock failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Management & Ledger</h1>
          <p className="text-sm text-muted-foreground">
            Reconciled physical quantities, auditable adjustments & stock movement history
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadStockData()} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/80 p-1">
          <TabsTrigger value="overview" className="gap-1.5 py-1.5">
            <Boxes className="h-4 w-4" /> Current Stock & Movement
          </TabsTrigger>
          <TabsTrigger value="adjustments" className="gap-1.5 py-1.5">
            <SlidersHorizontal className="h-4 w-4" /> Stock Adjustments
          </TabsTrigger>
          <TabsTrigger value="opening" className="gap-1.5 py-1.5">
            <Archive className="h-4 w-4" /> Opening Stock
          </TabsTrigger>
        </TabsList>

        {/* ----------------- 1. CURRENT STOCK & MOVEMENT ----------------- */}
        <TabsContent value="overview" className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-base font-semibold">Inventory Balances</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left border-b border-border">
                  <tr>
                    <th className="px-3 py-2">Item / Variant</th>
                    <th className="px-3 py-2">Category / Type</th>
                    <th className="px-3 py-2 text-right">In Stock</th>
                    <th className="px-3 py-2 text-right">Min Level</th>
                    <th className="px-3 py-2 text-right">Max Level</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                        No inventory records found.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => {
                      const isLow =
                        Number(item.min_qty) > 0 && Number(item.stock_qty) < Number(item.min_qty);
                      const isOver =
                        Number(item.max_qty) > 0 && Number(item.stock_qty) > Number(item.max_qty);
                      return (
                        <tr key={`${item.stock_type}-${item.id}`} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{item.name}</td>
                          <td className="px-3 py-2 capitalize text-xs text-muted-foreground">
                            {item.stock_type}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">
                            {quantity(item.stock_qty)} {item.unit}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {Number(item.min_qty) > 0 ? quantity(item.min_qty) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {Number(item.max_qty) > 0 ? quantity(item.max_qty) : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {isLow ? (
                              <span className="text-[11px] font-semibold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded">
                                Low Stock
                              </span>
                            ) : isOver ? (
                              <span className="text-[11px] font-semibold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded">
                                Overstocked
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">
                                Adequate
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Filter Item</label>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  <option value="">All items</option>
                  {items.map((i) => (
                    <option key={`${i.stock_type}-${i.id}`} value={i.id}>
                      {i.name} ({i.stock_type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Type</label>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={stockType}
                  onChange={(e) => setStockType(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="raw">Raw Materials</option>
                  <option value="finished">Finished Goods</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">From</label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">To</label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>

            <h3 className="text-base font-semibold">Auditable Stock Movement Ledger</h3>
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Transaction</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2 text-right">Qty In</th>
                    <th className="px-3 py-2 text-right">Qty Out</th>
                    <th className="px-3 py-2 text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                        No movement records found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    ledger.map((r, idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.item_name}</td>
                        <td className="px-3 py-2 capitalize text-xs">
                          <span className="bg-muted px-2 py-0.5 rounded font-mono">
                            {r.ref_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{r.ref_no || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">
                          {r.qty_in > 0 ? `+${quantity(r.qty_in)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-rose-600">
                          {r.qty_out > 0 ? `-${quantity(r.qty_out)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {quantity(r.balance_after)} {r.unit}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ----------------- 2. STOCK ADJUSTMENTS ----------------- */}
        <TabsContent value="adjustments" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold">Controlled Stock Adjustments</h2>
              <p className="text-xs text-muted-foreground">
                Explicit positive or negative adjustments for breakages, losses, or cycle counts
              </p>
            </div>
            <Button size="sm" onClick={() => setShowAdjForm(!showAdjForm)}>
              {showAdjForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showAdjForm ? "Cancel" : "New Adjustment"}
            </Button>
          </div>

          {showAdjForm && (
            <form
              onSubmit={submitAdjustment}
              className="rounded-lg border border-border bg-card p-5 space-y-4"
            >
              <h3 className="font-semibold text-sm">Post Stock Adjustment</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Item Category *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={adjForm.item_type}
                    onChange={(e) =>
                      setAdjForm({
                        ...adjForm,
                        item_type: e.target.value as "raw" | "finished",
                        item_id: "",
                      })
                    }
                  >
                    <option value="raw">Raw Material</option>
                    <option value="finished">Finished Good</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Select Item *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={adjForm.item_id}
                    onChange={(e) => setAdjForm({ ...adjForm, item_id: e.target.value })}
                    required
                  >
                    <option value="">Select item...</option>
                    {items
                      .filter((i) => i.stock_type === adjForm.item_type)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} (Current: {quantity(i.stock_qty)} {i.unit})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Adjustment Date *</label>
                  <Input
                    type="date"
                    value={adjForm.date}
                    onChange={(e) => setAdjForm({ ...adjForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">
                    Adjustment Qty (+ or -) *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 5 or -2.5"
                    value={adjForm.adjustment_qty}
                    onChange={(e) => setAdjForm({ ...adjForm, adjustment_qty: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="text-xs font-medium block mb-1">Auditable Reason *</label>
                  <Input
                    placeholder="Physical discrepancy, damaged packaging, quality testing sample..."
                    value={adjForm.reason}
                    onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                    required
                  />
                </div>
              </div>

              {selectedAdjItem && adjForm.adjustment_qty && (
                <div className="rounded-md bg-muted/60 p-3 text-xs flex flex-wrap items-center gap-6">
                  <div>
                    Previous Stock:{" "}
                    <strong>
                      {quantity(selectedAdjItem.stock_qty)} {selectedAdjItem.unit}
                    </strong>
                  </div>
                  <div>
                    Adjustment:{" "}
                    <strong
                      className={
                        Number(adjForm.adjustment_qty) > 0 ? "text-emerald-600" : "text-rose-600"
                      }
                    >
                      {Number(adjForm.adjustment_qty) > 0
                        ? `+${adjForm.adjustment_qty}`
                        : adjForm.adjustment_qty}{" "}
                      {selectedAdjItem.unit}
                    </strong>
                  </div>
                  <div>
                    Resulting Stock:{" "}
                    <strong
                      className={
                        adjResultingQty !== null && adjResultingQty < 0 ? "text-destructive" : ""
                      }
                    >
                      {adjResultingQty !== null ? quantity(adjResultingQty) : "—"}{" "}
                      {selectedAdjItem.unit}
                    </strong>
                  </div>
                  {adjResultingQty !== null && adjResultingQty < 0 && (
                    <span className="text-destructive font-bold">
                      ⚠ Error: Cannot drive stock negative!
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowAdjForm(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || (adjResultingQty !== null && adjResultingQty < 0)}
                >
                  {submitting ? "Posting..." : "Commit Stock Adjustment"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Item Name</th>
                  <th className="px-3 py-2.5 text-right">Previous Qty</th>
                  <th className="px-3 py-2.5 text-right">Adjustment</th>
                  <th className="px-3 py-2.5 text-right">Resulting Qty</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-3 py-2.5">Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adjustments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No stock adjustments have been recorded.
                    </td>
                  </tr>
                ) : (
                  adjustments.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{a.voucher_no}</td>
                      <td className="px-3 py-2">{a.date}</td>
                      <td className="px-3 py-2 capitalize text-xs">{a.item_type}</td>
                      <td className="px-3 py-2 font-medium">
                        {a.factory_item_name || a.item_name}{" "}
                        {a.particular_type ? `(${a.particular_type})` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {quantity(a.previous_qty)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold ${
                          a.adjustment_qty > 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {a.adjustment_qty > 0
                          ? `+${quantity(a.adjustment_qty)}`
                          : quantity(a.adjustment_qty)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {quantity(a.resulting_qty)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.reason}</td>
                      <td className="px-3 py-2 text-xs">{a.username || "System"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ----------------- 3. OPENING STOCK ----------------- */}
        <TabsContent value="opening" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold">Opening Stock Ledger Entries</h2>
              <p className="text-xs text-muted-foreground">
                Auditable opening inventory balances carried into system
              </p>
            </div>
            <Button size="sm" onClick={() => setShowOpnForm(!showOpnForm)}>
              {showOpnForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showOpnForm ? "Cancel" : "Post Opening Stock"}
            </Button>
          </div>

          {showOpnForm && (
            <form
              onSubmit={submitOpeningStock}
              className="rounded-lg border border-border bg-card p-5 space-y-4"
            >
              <h3 className="font-semibold text-sm">Post Opening Stock Balance</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Item Category *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={opnForm.item_type}
                    onChange={(e) =>
                      setOpnForm({
                        ...opnForm,
                        item_type: e.target.value as "raw" | "finished",
                        item_id: "",
                      })
                    }
                  >
                    <option value="raw">Raw Material</option>
                    <option value="finished">Finished Good</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Item *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={opnForm.item_id}
                    onChange={(e) => setOpnForm({ ...opnForm, item_id: e.target.value })}
                    required
                  >
                    <option value="">Select item...</option>
                    {items
                      .filter((i) => i.stock_type === opnForm.item_type)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Effective Date *</label>
                  <Input
                    type="date"
                    value={opnForm.date}
                    onChange={(e) => setOpnForm({ ...opnForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Opening Quantity *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={opnForm.qty}
                    onChange={(e) => setOpnForm({ ...opnForm, qty: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Unit Cost (Rs)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={opnForm.unit_cost}
                    onChange={(e) => setOpnForm({ ...opnForm, unit_cost: e.target.value })}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs font-medium block mb-1">Remarks / Audit Note</label>
                  <Input
                    placeholder="Catalog opening inventory, physical count verified..."
                    value={opnForm.remarks}
                    onChange={(e) => setOpnForm({ ...opnForm, remarks: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowOpnForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Commit Opening Stock"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Item Name</th>
                  <th className="px-3 py-2.5 text-right">Quantity</th>
                  <th className="px-3 py-2.5 text-right">Unit Cost (Rs)</th>
                  <th className="px-3 py-2.5 text-right">Total Valuation (Rs)</th>
                  <th className="px-3 py-2.5">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {openingStocks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No opening stock records found.
                    </td>
                  </tr>
                ) : (
                  openingStocks.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{o.voucher_no}</td>
                      <td className="px-3 py-2">{o.date}</td>
                      <td className="px-3 py-2 capitalize text-xs">{o.item_type}</td>
                      <td className="px-3 py-2 font-medium">
                        {o.factory_item_name || o.item_name}{" "}
                        {o.particular_type ? `(${o.particular_type})` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {quantity(o.qty)} {o.factory_item_unit || ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {quantity(o.unit_cost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                        {quantity(o.total_value)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {o.remarks || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
