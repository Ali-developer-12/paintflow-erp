import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  Printer,
  TrendingUp,
  Scale,
  Boxes,
  ShoppingCart,
  Receipt,
  RefreshCcw,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReportType = "sales" | "purchases" | "pnl" | "balance_sheet" | "stock_valuation";

type RegisterRow = {
  id: number;
  voucher_no?: string;
  date?: string;
  party_name?: string | null;
  total_amount?: number;
  ref_type?: string;
  ref_no?: string | null;
  item_name?: string | null;
  qty_in?: number;
  qty_out?: number;
  balance_after?: number;
};

type PnLData = {
  from: string | null;
  to: string | null;
  revenue: {
    gross_sales: number;
    sales_returns: number;
    net_revenue: number;
  };
  cost_of_goods_sold: number;
  gross_profit: number;
  expenses: {
    breakdown: { id: number; code: string; name: string; amount: number }[];
    total_expenses: number;
  };
  net_profit: number;
};

type BalanceSheetData = {
  as_of_date: string;
  assets: { items: { id: number; code: string; name: string; balance: number }[]; total: number };
  liabilities: {
    items: { id: number; code: string; name: string; balance: number }[];
    total: number;
  };
  equity: {
    items: { id: number; code: string; name: string; balance: number }[];
    current_net_profit: number;
    total_equity: number;
  };
  total_liabilities_and_equity: number;
  balanced: boolean;
};

type StockValuationData = {
  raw_materials: {
    items: {
      id: number;
      code: string;
      name: string;
      unit: string;
      rate: number;
      stock_qty: number;
      total_value: number;
    }[];
    total_value: number;
    count: number;
  };
  finished_goods: {
    items: {
      id: number;
      item_name: string;
      type: string;
      cost_price: number;
      sale_price: number;
      stock_qty: number;
      cost_value: number;
      retail_value: number;
    }[];
    total_cost_value: number;
    total_retail_value: number;
    count: number;
  };
  total_inventory_cost_value: number;
};

const formatAmount = (val: number) =>
  Number(val || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null);
  const [valuation, setValuation] = useState<StockValuationData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      if (reportType === "sales" || reportType === "purchases") {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const data = await apiGet<RegisterRow[]>(
          `/reports/${reportType}${params.toString() ? `?${params.toString()}` : ""}`,
        );
        setRows(data);
      } else if (reportType === "pnl") {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const data = await apiGet<PnLData>(
          `/reports/profit-and-loss${params.toString() ? `?${params.toString()}` : ""}`,
        );
        setPnl(data);
      } else if (reportType === "balance_sheet") {
        const params = new URLSearchParams();
        if (to) params.set("to", to);
        const data = await apiGet<BalanceSheetData>(
          `/reports/balance-sheet${params.toString() ? `?${params.toString()}` : ""}`,
        );
        setBalanceSheet(data);
      } else if (reportType === "stock_valuation") {
        const data = await apiGet<StockValuationData>("/reports/stock-valuation");
        setValuation(data);
      }
    } finally {
      setLoading(false);
    }
  }, [from, reportType, to]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <div className="flex-1 space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Intelligence & Reports</h1>
          <p className="text-sm text-muted-foreground">
            Sales & Purchase Registers, Profit & Loss, Balance Sheet, and Stock Valuation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadReport()} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.print();
            }}
          >
            <Printer className="h-4 w-4 mr-1.5" /> Print / Save PDF
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-border pb-4">
          <Button
            variant={reportType === "sales" ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType("sales")}
          >
            <Receipt className="h-4 w-4 mr-1.5" /> Sales Register
          </Button>
          <Button
            variant={reportType === "purchases" ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType("purchases")}
          >
            <ShoppingCart className="h-4 w-4 mr-1.5" /> Purchase Register
          </Button>
          <Button
            variant={reportType === "pnl" ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType("pnl")}
          >
            <TrendingUp className="h-4 w-4 mr-1.5" /> Profit & Loss
          </Button>
          <Button
            variant={reportType === "balance_sheet" ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType("balance_sheet")}
          >
            <Scale className="h-4 w-4 mr-1.5" /> Balance Sheet
          </Button>
          <Button
            variant={reportType === "stock_valuation" ? "default" : "outline"}
            size="sm"
            onClick={() => setReportType("stock_valuation")}
          >
            <Boxes className="h-4 w-4 mr-1.5" /> Stock Valuation
          </Button>
        </div>

        {/* Date Filter Bar */}
        {reportType !== "stock_valuation" && (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div>
              <label className="text-xs font-medium block mb-1">From Date</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">To Date</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button variant="secondary" onClick={() => void loadReport()} disabled={loading}>
              <BarChart3 className="h-4 w-4 mr-1" /> Load Data
            </Button>
          </div>
        )}

        {/* ---------------- 1 & 2. SALES / PURCHASE REGISTER ---------------- */}
        {(reportType === "sales" || reportType === "purchases") && (
          <div className="overflow-x-auto rounded-md border border-border mt-3">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">
                    {reportType === "sales" ? "Customer" : "Supplier"}
                  </th>
                  <th className="px-3 py-2.5 text-right">Amount (Rs)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                      No records found for the selected period.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.voucher_no}</td>
                      <td className="px-3 py-2 font-medium">
                        {row.party_name ?? "Counter Customer"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {formatAmount(row.total_amount ?? 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="bg-muted/40 font-bold border-t border-border">
                  <tr>
                    <td colSpan={3} className="px-3 py-2.5 text-right">
                      Grand Total:
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-base text-primary">
                      Rs{" "}
                      {formatAmount(
                        rows.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0),
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* ---------------- 3. PROFIT & LOSS STATEMENT ---------------- */}
        {reportType === "pnl" && pnl && (
          <div className="space-y-6 pt-2 max-w-3xl">
            <div className="text-center pb-2 border-b border-border">
              <h2 className="text-lg font-bold">STATEMENT OF PROFIT AND LOSS</h2>
              <p className="text-xs text-muted-foreground">
                Period: {pnl.from || "Beginning"} to {pnl.to || "Current Date"}
              </p>
            </div>

            {/* Operating Revenue */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Operating Revenue
              </h3>
              <div className="rounded-md border border-border divide-y divide-border text-sm">
                <div className="flex justify-between px-4 py-2">
                  <span>Gross Sales</span>
                  <span className="font-mono">{formatAmount(pnl.revenue.gross_sales)}</span>
                </div>
                <div className="flex justify-between px-4 py-2 text-rose-600">
                  <span>Less: Sales Returns</span>
                  <span className="font-mono">({formatAmount(pnl.revenue.sales_returns)})</span>
                </div>
                <div className="flex justify-between px-4 py-2.5 font-bold bg-muted/30">
                  <span>Net Revenue</span>
                  <span className="font-mono">Rs {formatAmount(pnl.revenue.net_revenue)}</span>
                </div>
              </div>
            </div>

            {/* Cost of Goods Sold */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Cost of Sales
              </h3>
              <div className="rounded-md border border-border divide-y divide-border text-sm">
                <div className="flex justify-between px-4 py-2 text-rose-600">
                  <span>Cost of Goods Sold (Raw materials & production overheads)</span>
                  <span className="font-mono">({formatAmount(pnl.cost_of_goods_sold)})</span>
                </div>
                <div className="flex justify-between px-4 py-2.5 font-bold bg-muted/30">
                  <span>Gross Profit</span>
                  <span
                    className={`font-mono ${pnl.gross_profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    Rs {formatAmount(pnl.gross_profit)}
                  </span>
                </div>
              </div>
            </div>

            {/* Operating Expenses */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Operating Expenses
              </h3>
              <div className="rounded-md border border-border divide-y divide-border text-sm">
                {pnl.expenses.breakdown.length === 0 ? (
                  <div className="px-4 py-3 text-muted-foreground text-xs italic">
                    No operating expenses recorded.
                  </div>
                ) : (
                  pnl.expenses.breakdown.map((exp) => (
                    <div key={exp.id} className="flex justify-between px-4 py-2">
                      <span>
                        {exp.code} - {exp.name}
                      </span>
                      <span className="font-mono">{formatAmount(exp.amount)}</span>
                    </div>
                  ))
                )}
                <div className="flex justify-between px-4 py-2.5 font-bold bg-muted/30">
                  <span>Total Operating Expenses</span>
                  <span className="font-mono text-rose-600">
                    Rs {formatAmount(pnl.expenses.total_expenses)}
                  </span>
                </div>
              </div>
            </div>

            {/* Net Profit / Loss */}
            <div className="rounded-lg border-2 border-primary bg-primary/5 p-4 flex justify-between items-center text-lg font-bold">
              <span>NET PROFIT / (LOSS)</span>
              <span
                className={`font-mono text-xl ${pnl.net_profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                Rs {formatAmount(pnl.net_profit)}
              </span>
            </div>
          </div>
        )}

        {/* ---------------- 4. BALANCE SHEET ---------------- */}
        {reportType === "balance_sheet" && balanceSheet && (
          <div className="space-y-6 pt-2 max-w-4xl">
            <div className="text-center pb-2 border-b border-border">
              <h2 className="text-lg font-bold">STATEMENT OF FINANCIAL POSITION (BALANCE SHEET)</h2>
              <p className="text-xs text-muted-foreground">As of {balanceSheet.as_of_date}</p>
              {balanceSheet.balanced ? (
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">
                  ✓ Reconciled: Assets = Liabilities + Equity
                </span>
              ) : (
                <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded">
                  ⚠ Imbalanced: Difference detected
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Assets Column */}
              <div className="space-y-3">
                <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
                  Assets
                </h3>
                <div className="rounded-md border border-border divide-y divide-border text-sm">
                  {balanceSheet.assets.items.map((a) => (
                    <div key={a.id} className="flex justify-between px-3 py-2">
                      <span>
                        {a.code} - {a.name}
                      </span>
                      <span className="font-mono">{formatAmount(a.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-3 py-2.5 font-bold bg-muted/40 text-primary">
                    <span>Total Assets</span>
                    <span className="font-mono">Rs {formatAmount(balanceSheet.assets.total)}</span>
                  </div>
                </div>
              </div>

              {/* Liabilities & Equity Column */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
                    Liabilities
                  </h3>
                  <div className="rounded-md border border-border divide-y divide-border text-sm">
                    {balanceSheet.liabilities.items.map((l) => (
                      <div key={l.id} className="flex justify-between px-3 py-2">
                        <span>
                          {l.code} - {l.name}
                        </span>
                        <span className="font-mono">{formatAmount(l.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 font-semibold bg-muted/20">
                      <span>Total Liabilities</span>
                      <span className="font-mono">
                        Rs {formatAmount(balanceSheet.liabilities.total)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">
                    Equity
                  </h3>
                  <div className="rounded-md border border-border divide-y divide-border text-sm">
                    {balanceSheet.equity.items.map((eq) => (
                      <div key={eq.id} className="flex justify-between px-3 py-2">
                        <span>
                          {eq.code} - {eq.name}
                        </span>
                        <span className="font-mono">{formatAmount(eq.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between px-3 py-2 text-emerald-600">
                      <span>Retained Net Earnings / Profit</span>
                      <span className="font-mono">
                        {formatAmount(balanceSheet.equity.current_net_profit)}
                      </span>
                    </div>
                    <div className="flex justify-between px-3 py-2 font-semibold bg-muted/20">
                      <span>Total Equity</span>
                      <span className="font-mono">
                        Rs {formatAmount(balanceSheet.equity.total_equity)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-primary/60 bg-primary/5 p-3 flex justify-between font-bold text-sm">
                  <span>Total Liabilities & Equity</span>
                  <span className="font-mono text-primary">
                    Rs {formatAmount(balanceSheet.total_liabilities_and_equity)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- 5. STOCK VALUATION ---------------- */}
        {reportType === "stock_valuation" && valuation && (
          <div className="space-y-6 pt-2">
            <div className="flex flex-wrap items-center justify-between bg-primary/10 rounded-lg p-4 border border-primary/20">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Total Inventory Cost Valuation
                </p>
                <p className="text-2xl font-bold font-mono text-primary">
                  Rs {formatAmount(valuation.total_inventory_cost_value)}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>
                  Raw Materials:{" "}
                  <strong>Rs {formatAmount(valuation.raw_materials.total_value)}</strong>
                </p>
                <p>
                  Finished Goods (Cost):{" "}
                  <strong>Rs {formatAmount(valuation.finished_goods.total_cost_value)}</strong>
                </p>
                <p>
                  Finished Goods (Retail):{" "}
                  <strong>Rs {formatAmount(valuation.finished_goods.total_retail_value)}</strong>
                </p>
              </div>
            </div>

            {/* Raw Materials Grid */}
            <div className="space-y-2">
              <h3 className="font-bold text-sm">
                Raw Materials Inventory ({valuation.raw_materials.count} items)
              </h3>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left border-b border-border">
                    <tr>
                      <th className="px-3 py-2">Item Name</th>
                      <th className="px-3 py-2 text-right">In Stock</th>
                      <th className="px-3 py-2 text-right">Cost Rate (Rs)</th>
                      <th className="px-3 py-2 text-right">Total Valuation (Rs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {valuation.raw_materials.items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{item.name}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatAmount(item.stock_qty)} {item.unit}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatAmount(item.rate)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatAmount(item.total_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-bold border-t border-border">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right">
                        Subtotal Raw Inventory:
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        Rs {formatAmount(valuation.raw_materials.total_value)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Finished Goods Grid */}
            <div className="space-y-2">
              <h3 className="font-bold text-sm">
                Finished Goods Inventory ({valuation.finished_goods.count} products)
              </h3>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left border-b border-border">
                    <tr>
                      <th className="px-3 py-2">Product Name</th>
                      <th className="px-3 py-2">Variant</th>
                      <th className="px-3 py-2 text-right">In Stock</th>
                      <th className="px-3 py-2 text-right">Unit Cost</th>
                      <th className="px-3 py-2 text-right">Sale Price</th>
                      <th className="px-3 py-2 text-right">Cost Value (Rs)</th>
                      <th className="px-3 py-2 text-right">Retail Value (Rs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {valuation.finished_goods.items.map((prod) => (
                      <tr key={prod.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{prod.item_name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{prod.type}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatAmount(prod.stock_qty)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatAmount(prod.cost_price)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatAmount(prod.sale_price)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatAmount(prod.cost_value)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">
                          {formatAmount(prod.retail_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-bold border-t border-border">
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-right">
                        Subtotal Finished Inventory:
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        Rs {formatAmount(valuation.finished_goods.total_cost_value)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-600">
                        Rs {formatAmount(valuation.finished_goods.total_retail_value)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
