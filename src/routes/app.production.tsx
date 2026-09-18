import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Factory, PackageCheck, PlusCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

type FormulaRow = {
  particular_id: number;
  item_id: number;
  item_name: string;
  type: string;
  formula_code: string;
  total_value: number;
  total_cost: number;
};

type FormulaLine = {
  id: number;
  formula_id: number;
  factory_item_id: number | null;
  material_name: string;
  value: number;
  rate: number;
  cost_value: number;
  sort_order: number;
};

type FormulaDetail = {
  formula: {
    id: number;
    particular_id: number;
    code: string;
    batch_size: number;
    total_cost: number;
    remarks: string;
  } | null;
  lines: FormulaLine[];
};

export const Route = createFileRoute("/app/production")({
  component: ProductionPage,
});

function ProductionPage() {
  const [formulaRows, setFormulaRows] = useState<FormulaRow[]>([]);
  const [selectedParticularId, setSelectedParticularId] = useState<string>("");
  const [formulaDetail, setFormulaDetail] = useState<FormulaDetail>({ formula: null, lines: [] });
  const [batchQuantity, setBatchQuantity] = useState(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await apiGet<FormulaRow[]>("/formulas");
        setFormulaRows(rows);
        if (rows[0]) {
          setSelectedParticularId(String(rows[0].particular_id));
          const detail = await apiGet<FormulaDetail>(`/formulas/${rows[0].particular_id}`);
          setFormulaDetail(detail);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load formulas");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const selectedFormula = useMemo(
    () => formulaRows.find((row) => String(row.particular_id) === selectedParticularId) ?? null,
    [selectedParticularId, formulaRows],
  );

  useEffect(() => {
    if (!selectedParticularId) {
      setFormulaDetail({ formula: null, lines: [] });
      return;
    }

    void (async () => {
      try {
        const detail = await apiGet<FormulaDetail>(`/formulas/${selectedParticularId}`);
        setFormulaDetail(detail);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load formula details");
      }
    })();
  }, [selectedParticularId]);

  const batchMultiplier = useMemo(() => {
    if (!formulaDetail.formula || !formulaDetail.formula.batch_size) return 0;
    return Number(batchQuantity || 0) / Number(formulaDetail.formula.batch_size || 1);
  }, [batchQuantity, formulaDetail.formula]);

  const requirements = useMemo(
    () =>
      formulaDetail.lines.map((line) => {
        const materialQty = Number(line.value || 0) * batchMultiplier;
        return {
          ...line,
          requiredQty: materialQty,
          totalCost: materialQty * Number(line.rate || 0),
        };
      }),
    [batchMultiplier, formulaDetail.lines],
  );

  async function handleSave() {
    setError("");
    setSuccess("");

    if (!selectedParticularId || Number(batchQuantity || 0) <= 0) {
      setError("Choose a formula and enter a valid batch quantity.");
      return;
    }

    try {
      setIsSaving(true);
      await apiPost("/productions", {
        particular_id: Number(selectedParticularId),
        batch_quantity: Number(batchQuantity),
        remarks: "",
      });
      setSuccess("Production batch saved and stock updated.");
      const refreshedRows = await apiGet<FormulaRow[]>("/formulas");
      setFormulaRows(refreshedRows);
      if (selectedParticularId) {
        const detail = await apiGet<FormulaDetail>(`/formulas/${selectedParticularId}`);
        setFormulaDetail(detail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this production batch");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Production</h1>
          <p className="text-sm text-muted-foreground">Batch planning and material consumption</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        {isLoading && <div className="mb-4 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Loading production data...</div>}
        {formulaRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-8 text-sm text-muted-foreground">
            <Factory className="h-6 w-6" />
            No Formula / BOM records exist yet. Create one in the Items Master or Formula/BOM page first.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-2">
              <label className="text-sm font-medium">Finished item / particular</label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={selectedParticularId}
                onChange={(event) => setSelectedParticularId(event.target.value)}
              >
                {formulaRows.map((row) => (
                  <option key={row.particular_id} value={String(row.particular_id)}>
                    {row.item_name} / {row.type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Batch quantity</label>
              <input
                type="number"
                min="1"
                step="0.01"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={batchQuantity}
                onChange={(event) => setBatchQuantity(Number(event.target.value || 0))}
              />
            </div>
          </div>
        )}

        {selectedFormula && formulaDetail.formula && (
          <div className="mt-4 rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
            Formula: <span className="font-medium text-foreground">{selectedFormula.item_name}</span> / {selectedFormula.type} · Batch size {Number(formulaDetail.formula.batch_size || 1)}
          </div>
        )}

        {requirements.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Formula Qty</th>
                  <th className="px-3 py-2">Required Qty</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((line) => (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{line.material_name}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(line.value || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(line.requiredQty || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(line.rate || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{Number(line.totalCost || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {success && <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{success}</div>}

        <div className="mt-4 flex justify-end">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void handleSave()}
            disabled={isSaving || formulaRows.length === 0}
          >
            <PlusCircle className="h-4 w-4" />
            {isSaving ? "Saving…" : "Save Batch"}
          </button>
        </div>
      </div>
    </div>
  );
}
