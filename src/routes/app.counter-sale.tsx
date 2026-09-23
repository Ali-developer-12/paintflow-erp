import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id: number; name: string };
type Particular = { id: number; item_id: number; type: string; weight_unit: string; stock_qty: number; sale_price: number; item_name?: string };

type SaleLine = {
  particular_id: number;
  description: string;
  qty: number;
  rate: number;
};

export const Route = createFileRoute("/app/counter-sale")({
  component: CounterSalePage,
});

function CounterSalePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [particulars, setParticulars] = useState<Particular[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [customersData, particularsData] = await Promise.all([
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Particular[]>("/particulars"),
      ]);
      setCustomers(customersData);
      setParticulars(particularsData);
      if (particularsData[0]) {
        setLines([{ particular_id: particularsData[0].id, description: particularsData[0].item_name ?? "", qty: 1, rate: Number(particularsData[0].sale_price || 0) }]);
      }
    })();
  }, []);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.rate || 0), 0),
    [lines],
  );

  function updateLine(index: number, field: keyof SaleLine, value: string | number) {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line;
        if (field === "particular_id") {
          const selected = particulars.find((p) => p.id === Number(value));
          return {
            ...line,
            particular_id: Number(value),
            rate: selected ? Number(selected.sale_price || 0) : line.rate,
            description: selected?.item_name ?? line.description,
          };
        }
        return { ...line, [field]: field === "qty" || field === "rate" ? Number(value || 0) : value } as SaleLine;
      }),
    );
  }

  function addLine() {
    const defaultParticular = particulars[0];
    setLines((cur) => [
      ...cur,
      {
        particular_id: defaultParticular ? defaultParticular.id : 0,
        description: defaultParticular?.item_name ?? "",
        qty: 1,
        rate: defaultParticular ? Number(defaultParticular.sale_price || 0) : 0,
      },
    ]);
  }

  function removeLine(index: number) {
    setLines((cur) => cur.filter((_, i) => i !== index));
  }

  async function saveSale() {
    if (!customerId || !lines.some((line) => line.particular_id && line.qty > 0)) {
      alert("Select a customer and at least one valid sale line.");
      return;
    }

    setSaving(true);
    try {
      await apiPost("/sales", {
        customer_id: Number(customerId),
        remarks: "Counter sale",
        lines: lines.map((line) => ({
          particular_id: line.particular_id,
          qty: line.qty,
          rate: line.rate,
          description: line.description,
        })),
      });
      setLines([]);
      if (particulars[0]) {
        setLines([{ particular_id: particulars[0].id, description: particulars[0].item_name ?? "", qty: 1, rate: Number(particulars[0].sale_price || 0) }]);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Counter Sale</h1>
        <p className="text-sm text-muted-foreground">Phase 5 sales entry</p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Customer</label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={addLine}><Plus className="h-4 w-4" /> Add line</Button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70">
              <tr>
                <th className="p-2 text-left">Item</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-left">Qty</th>
                <th className="p-2 text-left">Rate</th>
                <th className="p-2 text-left">Amount</th>
                <th className="p-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.particular_id}-${index}`} className="border-t border-border">
                  <td className="p-2">
                    <Select value={String(line.particular_id)} onValueChange={(value) => updateLine(index, "particular_id", value)}>
                      <SelectTrigger className="w-48"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {particulars.map((particular) => (
                          <SelectItem key={particular.id} value={String(particular.id)}>
                            {particular.item_name ?? `Particular ${particular.id}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2"><Input value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} /></td>
                  <td className="p-2"><Input type="number" value={line.qty} onChange={(e) => updateLine(index, "qty", Number(e.target.value))} /></td>
                  <td className="p-2"><Input type="number" value={line.rate} onChange={(e) => updateLine(index, "rate", Number(e.target.value))} /></td>
                  <td className="p-2 text-right">{(Number(line.qty || 0) * Number(line.rate || 0)).toLocaleString()}</td>
                  <td className="p-2"><Button variant="destructive" size="sm" onClick={() => removeLine(index)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-lg font-semibold">Total: {total.toLocaleString()}</div>
          <Button onClick={() => void saveSale()} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save sale"}</Button>
        </div>
      </div>
    </div>
  );
}
