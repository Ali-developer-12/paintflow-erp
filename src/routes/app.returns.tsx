import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id: number; name: string };
type Supplier = { id: number; name: string };
type Particular = { id: number; item_id: number; type: string; weight_unit: string; stock_qty: number; item_name?: string };

type ReturnLine = { particular_id: number; description: string; qty: number; rate: number };

export const Route = createFileRoute("/app/returns")({
  component: ReturnsPage,
});

function ReturnsPage() {
  const [returnType, setReturnType] = useState<"customer" | "supplier">("customer");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [particulars, setParticulars] = useState<Particular[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);

  useEffect(() => {
    void (async () => {
      const [customersData, suppliersData, particularsData] = await Promise.all([
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Supplier[]>("/setup/suppliers"),
        apiGet<Particular[]>("/particulars"),
      ]);
      setCustomers(customersData);
      setSuppliers(suppliersData);
      setParticulars(particularsData);
      if (particularsData[0]) {
        setLines([{ particular_id: particularsData[0].id, description: particularsData[0].item_name ?? "", qty: 1, rate: 0 }]);
      }
    })();
  }, []);

  function addLine() {
    const base = particulars[0];
    setLines((cur) => [...cur, { particular_id: base ? base.id : 0, description: base?.item_name ?? "", qty: 1, rate: 0 }]);
  }

  function removeLine(index: number) {
    setLines((cur) => cur.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof ReturnLine, value: string | number) {
    setLines((cur) =>
      cur.map((line, i) => {
        if (i !== index) return line;
        if (field === "particular_id") {
          const selected = particulars.find((item) => item.id === Number(value));
          return { ...line, particular_id: Number(value), description: selected?.item_name ?? line.description };
        }
        return { ...line, [field]: field === "qty" || field === "rate" ? Number(value || 0) : value } as ReturnLine;
      }),
    );
  }

  async function saveReturn() {
    const selectedParty = returnType === "customer" ? customerId : supplierId;
    if (!selectedParty || !lines.some((line) => line.particular_id && line.qty > 0)) {
      alert("Select a party and at least one valid return line.");
      return;
    }

    await apiPost("/returns", {
      return_type: returnType,
      customer_id: returnType === "customer" ? Number(customerId) : null,
      supplier_id: returnType === "supplier" ? Number(supplierId) : null,
      remarks,
      lines: lines.map((line) => ({
        particular_id: line.particular_id,
        description: line.description,
        qty: line.qty,
        rate: line.rate,
      })),
    });

    setRemarks("");
    setLines([]);
    if (particulars[0]) {
      setLines([{ particular_id: particulars[0].id, description: particulars[0].item_name ?? "", qty: 1, rate: 0 }]);
    }
  }

  return (
    <div className="flex-1 space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Return</h1>
        <p className="text-sm text-muted-foreground">Record customer or supplier returns</p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Return type</label>
            <Select value={returnType} onValueChange={(value) => setReturnType(value as "customer" | "supplier")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{returnType === "customer" ? "Customer" : "Supplier"}</label>
            <Select value={returnType === "customer" ? customerId : supplierId} onValueChange={(value) => (returnType === "customer" ? setCustomerId(value) : setSupplierId(value))}>
              <SelectTrigger><SelectValue placeholder={returnType === "customer" ? "Select customer" : "Select supplier"} /></SelectTrigger>
              <SelectContent>
                {(returnType === "customer" ? customers : suppliers).map((party) => (
                  <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={addLine}><Plus className="h-4 w-4" /> Add line</Button>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">Remarks</label>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
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
                      <SelectTrigger className="w-52"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {particulars.map((particular) => (
                          <SelectItem key={particular.id} value={String(particular.id)}>{particular.item_name ?? `Particular ${particular.id}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2"><Input value={line.description} onChange={(e) => updateLine(index, "description", e.target.value)} /></td>
                  <td className="p-2"><Input type="number" value={line.qty} onChange={(e) => updateLine(index, "qty", Number(e.target.value))} /></td>
                  <td className="p-2"><Input type="number" value={line.rate} onChange={(e) => updateLine(index, "rate", Number(e.target.value))} /></td>
                  <td className="p-2">{(Number(line.qty || 0) * Number(line.rate || 0)).toLocaleString()}</td>
                  <td className="p-2"><Button variant="destructive" size="sm" onClick={() => removeLine(index)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => void saveReturn()}><Save className="h-4 w-4" /> Save return</Button>
        </div>
      </div>
    </div>
  );
}
