import { useEffect, useMemo, useState } from "react";
import { Calculator, Plus, Save, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

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

type FormulaBomModalProps = {
  particular: Particular | null;
  itemName?: string;
  factoryItems: FactoryItem[];
  onClose: () => void;
};

export default function FormulaBomModal({
  particular,
  itemName,
  factoryItems,
  onClose,
}: FormulaBomModalProps) {
  const [formulaLines, setFormulaLines] = useState<FormulaLine[]>([]);
  const [formulaCode, setFormulaCode] = useState("");
  const [modalBusy, setModalBusy] = useState(false);

  async function loadFormula(particularRow: Particular) {
    const payload = await apiGet<{ formula: any; lines: FormulaLine[] }>(`/formulas/${particularRow.id}`);
    if (payload.formula) {
      setFormulaCode(payload.formula.code ?? "");
    } else {
      setFormulaCode("");
    }

    setFormulaLines(
      payload.lines.map((line) => ({
        id: line.id,
        factory_item_id: line.factory_item_id,
        material_name: line.material_name,
        value: Number(line.value || 0),
        rate: Number(line.rate || 0),
        cost_value: Number(line.cost_value || 0),
      })),
    );
  }

  async function saveFormula() {
    if (!particular) return;
    setModalBusy(true);
    try {
      const totalCost = formulaLines.reduce(
        (sum, line) => sum + Number(line.value || 0) * Number(line.rate || 0),
        0,
      );
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

      const result = await apiPost<{ formula: any; lines: FormulaLine[] }>(`/formulas/${particular.id}`, payload);
      if (result.lines) {
        setFormulaLines(
          result.lines.map((line) => ({
            id: line.id,
            factory_item_id: line.factory_item_id,
            material_name: line.material_name,
            value: Number(line.value || 0),
            rate: Number(line.rate || 0),
            cost_value: Number(line.cost_value || 0),
          })),
        );
      }
      onClose();
    } finally {
      setModalBusy(false);
    }
  }

  const totalCost = useMemo(
    () => formulaLines.reduce((sum, line) => sum + Number(line.value || 0) * Number(line.rate || 0), 0),
    [formulaLines],
  );

  useEffect(() => {
    if (!particular) return;
    void loadFormula(particular);
  }, [particular]);

  if (!particular) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[760px] max-w-[90vw] rounded-lg border border-border bg-card p-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <div className="text-lg font-semibold">Formula / BOM</div>
            <div className="text-xs text-muted-foreground">
              Particular #{particular.id} · {itemName ?? "Item"}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-2 text-xs" onClick={onClose}>
              Close
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-70"
              disabled={modalBusy}
              onClick={() => void saveFormula()}
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="grid grid-cols-[140px_1fr] items-center gap-2">
            <label className="text-xs font-medium">Formula Code</label>
            <input
              className="rounded-md border px-2 py-1 text-sm"
              value={formulaCode}
              onChange={(e) => setFormulaCode(e.target.value)}
              placeholder="F-001"
            />
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
                  const cost = Number(line.value || 0) * Number(line.rate || 0);
                  return (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-3 py-2">
                        <select
                          className="w-full rounded-md border px-2 py-1"
                          value={line.factory_item_id ?? ""}
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            const factory = factoryItems.find((f) => f.id === id);
                            setFormulaLines((cur) =>
                              cur.map((it, i) =>
                                i === idx ? { ...it, factory_item_id: id, material_name: factory?.name ?? "", rate: factory?.rate ?? 0 } : it,
                              ),
                            );
                          }}
                        >
                          <option value="">Select material</option>
                          {factoryItems.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-24 rounded-md border px-2 py-1"
                          type="number"
                          value={line.value}
                          onChange={(e) => {
                            const val = Number(e.target.value || 0);
                            setFormulaLines((cur) =>
                              cur.map((it, i) =>
                                i === idx ? { ...it, value: val, cost_value: val * Number(it.rate || 0) } : it,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-24 rounded-md border px-2 py-1"
                          type="number"
                          value={line.rate}
                          onChange={(e) => {
                            const rate = Number(e.target.value || 0);
                            setFormulaLines((cur) =>
                              cur.map((it, i) =>
                                i === idx ? { ...it, rate, cost_value: Number(it.value || 0) * rate } : it,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{cost}</td>
                      <td className="px-3 py-2">
                        <button
                          className="rounded-md border px-2 py-1 text-xs"
                          onClick={() => setFormulaLines((cur) => cur.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-border p-3">
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
                onClick={() =>
                  setFormulaLines((cur) => [
                    ...cur,
                    { factory_item_id: null, material_name: "", value: 0, rate: 0, cost_value: 0 },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add Line
              </button>
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
  );
}
