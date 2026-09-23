import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id: number; name: string };
type Particular = { id: number; item_id: number; type: string; weight_unit: string; stock_qty: number; item_name?: string };

type IssueLine = { particular_id: number; size: string; shade: string; qty: number };

export const Route = createFileRoute("/app/issue-voucher")({
  component: IssueVoucherPage,
});

function IssueVoucherPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [particulars, setParticulars] = useState<Particular[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [voucherNo, setVoucherNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<IssueLine[]>([]);

  useEffect(() => {
    void (async () => {
      const [customersData, particularsData] = await Promise.all([
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Particular[]>("/particulars"),
      ]);
      setCustomers(customersData);
      setParticulars(particularsData);
      if (particularsData[0]) {
        setLines([{ particular_id: particularsData[0].id, size: particularsData[0].type, shade: particularsData[0].weight_unit, qty: 1 }]);
      }
    })();
  }, []);

  function addLine() {
    const base = particulars[0];
    setLines((cur) => [
      ...cur,
      { particular_id: base ? base.id : 0, size: base?.type ?? "", shade: base?.weight_unit ?? "", qty: 1 },
    ]);
  }

  function removeLine(index: number) {
    setLines((cur) => cur.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof IssueLine, value: string | number) {
    setLines((cur) =>
      cur.map((line, i) => {
        if (i !== index) return line;
        if (field === "particular_id") {
          const selected = particulars.find((item) => item.id === Number(value));
          return { ...line, particular_id: Number(value), size: selected?.type ?? "", shade: selected?.weight_unit ?? "" };
        }
        return { ...line, [field]: field === "qty" ? Number(value || 0) : value } as IssueLine;
      }),
    );
  }

  async function saveVoucher() {
    if (!customerId || !lines.some((line) => line.particular_id && line.qty > 0)) {
      alert("Select a customer and at least one valid issue item.");
      return;
    }

    await apiPost("/issue-vouchers", {
      voucher_no: voucherNo || undefined,
      date,
      customer_id: Number(customerId),
      remarks,
      lines: lines.map((line) => ({
        particular_id: line.particular_id,
        size: line.size,
        shade: line.shade,
        qty: line.qty,
      })),
    });

    setVoucherNo("");
    setRemarks("");
    setLines([]);
    if (particulars[0]) {
      setLines([{ particular_id: particulars[0].id, size: particulars[0].type, shade: particulars[0].weight_unit, qty: 1 }]);
    }
  }

  return (
    <div className="flex-1 space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Issue Voucher</h1>
        <p className="text-sm text-muted-foreground">Issue finished goods to customer</p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Voucher #</label>
            <Input value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
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

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium">Remarks</label>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <div className="mt-5 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70">
              <tr>
                <th className="p-2 text-left">Item</th>
                <th className="p-2 text-left">Size</th>
                <th className="p-2 text-left">Shade</th>
                <th className="p-2 text-left">In Stock</th>
                <th className="p-2 text-left">Qty</th>
                <th className="p-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const selectedParticular = particulars.find((particular) => particular.id === line.particular_id);
                return (
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
                    <td className="p-2"><Input value={line.size} onChange={(e) => updateLine(index, "size", e.target.value)} /></td>
                    <td className="p-2"><Input value={line.shade} onChange={(e) => updateLine(index, "shade", e.target.value)} /></td>
                    <td className="p-2">{selectedParticular ? Number(selectedParticular.stock_qty || 0).toLocaleString() : 0}</td>
                    <td className="p-2"><Input type="number" value={line.qty} onChange={(e) => updateLine(index, "qty", Number(e.target.value))} /></td>
                    <td className="p-2"><Button variant="destructive" size="sm" onClick={() => removeLine(index)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => void saveVoucher()}><Save className="h-4 w-4" /> Save voucher</Button>
        </div>
      </div>
    </div>
  );
}
