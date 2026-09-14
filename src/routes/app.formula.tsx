import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Calculator, ExternalLink } from "lucide-react";
import FormulaBomModal from "@/components/formula-bom-modal";
import { apiGet } from "@/lib/api";

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

type FormulaRow = {
  particular_id: number;
  item_id: number;
  item_name: string;
  type: string;
  formula_code: string;
  total_value: number;
  total_cost: number;
};

type UnassignedRow = {
  particular_id: number;
  item_id: number;
  item_name: string;
  type: string;
  formula_code: string;
};

export const Route = createFileRoute("/app/formula")({
  component: FormulaPage,
});

function FormulaPage() {
  const [rows, setRows] = useState<FormulaRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [factoryItems, setFactoryItems] = useState<FactoryItem[]>([]);
  const [modalParticular, setModalParticular] = useState<Particular | null>(null);
  const [modalItemName, setModalItemName] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadFactoryItems() {
    const items = await apiGet<FactoryItem[]>("/factory-items");
    setFactoryItems(items);
  }

  async function loadFormulas() {
    const data = await apiGet<FormulaRow[]>("/formulas");
    setRows(data);
  }

  async function loadUnassigned() {
    const data = await apiGet<UnassignedRow[]>("/formulas/unassigned");
    setUnassigned(data);
  }

  async function openFormula(particular: Particular, itemName: string) {
    setModalParticular(particular);
    setModalItemName(itemName);
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await Promise.all([loadFormulas(), loadUnassigned(), loadFactoryItems()]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Formula / BOM</h1>
          <p className="text-sm text-muted-foreground">Defined item formulas</p>
        </div>
        <Link
          to="/app/items"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <ExternalLink className="h-4 w-4" /> Items Master
        </Link>
      </div>

      <section className="rounded-md border border-border bg-card">
        {loading && <div className="p-3 text-sm text-muted-foreground">Loading formulas…</div>}

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <span>No Formula / BOM records have been created yet.</span>
            <Link to="/app/items" className="inline-flex items-center gap-1 font-medium text-primary">
              <ArrowUpRight className="h-4 w-4" /> Jump to Items Master
            </Link>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-4 py-3">Item Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">F.Code</th>
                  <th className="px-4 py-3">Total Value</th>
                  <th className="px-4 py-3">Total Cost</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.particular_id} className="border-t border-border hover:bg-accent/30">
                    <td className="px-4 py-3 font-medium">{row.item_name}</td>
                    <td className="px-4 py-3">{row.type}</td>
                    <td className="px-4 py-3">{row.formula_code}</td>
                    <td className="px-4 py-3">{Number(row.total_value || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">{Number(row.total_cost || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        onClick={() =>
                          void openFormula({
                            id: row.particular_id,
                            item_id: row.item_id,
                            type: row.type,
                            weight_unit: "",
                            cost_price: 0,
                            ws_price: 0,
                            sale_price: 0,
                            stock_qty: 0,
                            min_qty: 0,
                            max_qty: 0,
                            formula_code: row.formula_code,
                            sort_order: 0,
                          }, row.item_name)
                        }
                      >
                        <Calculator className="h-3.5 w-3.5" /> Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {unassigned.length > 0 && (
        <section className="rounded-md border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Particulars without formulas</div>
            <Link to="/app/items" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
              <ArrowUpRight className="h-3.5 w-3.5" /> Items Master
            </Link>
          </div>
          <div className="space-y-2">
            {unassigned.map((row) => (
              <div key={row.particular_id} className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{row.item_name}</span>
                  <span className="ml-2 text-muted-foreground">{row.type}</span>
                </div>
                <Link to="/app/items" className="inline-flex items-center gap-1 text-xs text-primary">
                  <ArrowUpRight className="h-3.5 w-3.5" /> Create Formula
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <FormulaBomModal
        particular={modalParticular}
        itemName={modalItemName}
        factoryItems={factoryItems}
        onClose={() => setModalParticular(null)}
      />
    </div>
  );
}
