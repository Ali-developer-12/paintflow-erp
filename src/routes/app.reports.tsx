import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Customer = { id: number; name: string };
type Supplier = { id: number; name: string };
type Particular = { id: number; item_name?: string };

type ReportType = "sales" | "purchases" | "general";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [partyId, setPartyId] = useState<string>("");
  const [itemId, setItemId] = useState<string>("");
  const [parties, setParties] = useState<Array<{ id: number; name: string }>>([]);
  const [items, setItems] = useState<Particular[]>([]);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const [customersData, suppliersData, itemsData] = await Promise.all([
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Supplier[]>("/setup/suppliers"),
        apiGet<Particular[]>("/particulars"),
      ]);
      setItems(itemsData);
      setParties(reportType === "purchases" ? suppliersData : customersData);
    })();
  }, [reportType]);

  useEffect(() => {
    setPartyId("");
  }, [reportType]);

  async function loadReport() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (partyId) params.set("party", partyId);
    if (itemId) params.set("item", itemId);
    const rowsData = await apiGet<any[]>(`/reports/${reportType}${params.toString() ? `?${params.toString()}` : ""}`);
    setRows(rowsData);
  }

  return (
    <div className="flex-1 space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Sales, purchase and general reporting</p>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap gap-2 mb-5">
          {(["sales", "purchases", "general"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setReportType(type)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${reportType === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {type === "sales" ? "Sale Reports" : type === "purchases" ? "Purchase Reports" : "General Reports"}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Party</label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger><SelectValue placeholder="All parties" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All parties</SelectItem>
                {parties.map((party) => (
                  <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Item</label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="All items" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All items</SelectItem>
                {items.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.item_name ?? `Particular ${item.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => void loadReport()}><BarChart3 className="h-4 w-4" /> Load report</Button>
        </div>

        <div className="mt-5 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/70">
              <tr>
                {reportType === "sales" && (
                  <>
                    <th className="p-2 text-left">Voucher</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Customer</th>
                    <th className="p-2 text-left">Total</th>
                  </>
                )}
                {reportType === "purchases" && (
                  <>
                    <th className="p-2 text-left">Voucher</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Supplier</th>
                    <th className="p-2 text-left">Total</th>
                  </>
                )}
                {reportType === "general" && (
                  <>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Ref</th>
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-left">Qty In</th>
                    <th className="p-2 text-left">Qty Out</th>
                    <th className="p-2 text-left">Balance</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">No records found</td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={`${reportType}-${idx}`} className="border-t border-border">
                    {reportType === "sales" && (
                      <>
                        <td className="p-2">{row.voucher_no}</td>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2">{row.party_name || "-"}</td>
                        <td className="p-2">{Number(row.total_amount || 0).toLocaleString()}</td>
                      </>
                    )}
                    {reportType === "purchases" && (
                      <>
                        <td className="p-2">{row.voucher_no}</td>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2">{row.party_name || "-"}</td>
                        <td className="p-2">{Number(row.total_amount || 0).toLocaleString()}</td>
                      </>
                    )}
                    {reportType === "general" && (
                      <>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2">{row.ref_type} / {row.ref_no || "-"}</td>
                        <td className="p-2">{row.item_name || "-"}</td>
                        <td className="p-2">{Number(row.qty_in || 0).toLocaleString()}</td>
                        <td className="p-2">{Number(row.qty_out || 0).toLocaleString()}</td>
                        <td className="p-2">{Number(row.balance_after || 0).toLocaleString()}</td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
