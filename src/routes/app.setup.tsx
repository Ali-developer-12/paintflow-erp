import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, RefreshCcw } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const tabs = [
  "Employees",
  "Customers",
  "Suppliers",
  "Transporters",
  "Accounts",
  "Factory Items",
  "New Year Posting",
] as const;

type Employee = { id: number; name: string; designation: string; phone: string; address: string; salary: number };
type Customer = { id: number; name: string; phone: string; address: string; opening_balance: number };
type Supplier = { id: number; name: string; phone: string; address: string; opening_balance: number };
type Transporter = { id: number; name: string; phone: string; vehicle_no: string; address: string };
type Account = { id: number; code: string; name: string; type: string; parent_id: number | null; parent_name?: string; opening_balance: number };
type FactoryItem = { id: number; name: string; unit: string; rate: number; stock_qty: number };
type YearRecord = { id: number; name: string; start_date: string; end_date: string; is_current: number };

export const Route = createFileRoute("/app/setup")({
  component: SetupPage,
});

function SetupPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [factoryItems, setFactoryItems] = useState<FactoryItem[]>([]);
  const [years, setYears] = useState<YearRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [employeeForm, setEmployeeForm] = useState({ name: "", designation: "", phone: "", address: "", salary: "0" });
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "", address: "", opening_balance: "0" });
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", address: "", opening_balance: "0" });
  const [transporterForm, setTransporterForm] = useState({ name: "", phone: "", vehicle_no: "", address: "" });
  const [accountForm, setAccountForm] = useState({ code: "", name: "", type: "Asset", parent_id: "", opening_balance: "0" });
  const [factoryForm, setFactoryForm] = useState({ name: "", unit: "KG", rate: "0", stock: "0" });

  const accountOptions = useMemo(() => accounts.filter((acc) => acc.id !== Number(accountForm.parent_id)), [accounts, accountForm.parent_id]);

  async function loadData() {
    setLoading(true);
    try {
      const [employeesData, customersData, suppliersData, transportersData, accountsData, factoryData, yearsData] = await Promise.all([
        apiGet<Employee[]>("/setup/employees"),
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Supplier[]>("/setup/suppliers"),
        apiGet<Transporter[]>("/setup/transporters"),
        apiGet<Account[]>("/setup/accounts"),
        apiGet<FactoryItem[]>("/setup/factory-items"),
        apiGet<YearRecord[]>("/setup/financial-years"),
      ]);
      setEmployees(employeesData);
      setCustomers(customersData);
      setSuppliers(suppliersData);
      setTransporters(transportersData);
      setAccounts(accountsData);
      setFactoryItems(factoryData);
      setYears(yearsData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveEmployee() {
    if (!employeeForm.name.trim()) return;
    await apiPost("/setup/employees", {
      name: employeeForm.name,
      designation: employeeForm.designation,
      phone: employeeForm.phone,
      address: employeeForm.address,
      salary: Number(employeeForm.salary || 0),
    });
    setEmployeeForm({ name: "", designation: "", phone: "", address: "", salary: "0" });
    await loadData();
  }

  async function deleteEmployee(id: number) {
    await apiDelete(`/setup/employees/${id}`);
    await loadData();
  }

  async function saveCustomer() {
    if (!customerForm.name.trim()) return;
    await apiPost("/setup/customers", {
      name: customerForm.name,
      phone: customerForm.phone,
      address: customerForm.address,
      opening_balance: Number(customerForm.opening_balance || 0),
    });
    setCustomerForm({ name: "", phone: "", address: "", opening_balance: "0" });
    await loadData();
  }

  async function deleteCustomer(id: number) {
    await apiDelete(`/setup/customers/${id}`);
    await loadData();
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) return;
    await apiPost("/setup/suppliers", {
      name: supplierForm.name,
      phone: supplierForm.phone,
      address: supplierForm.address,
      opening_balance: Number(supplierForm.opening_balance || 0),
    });
    setSupplierForm({ name: "", phone: "", address: "", opening_balance: "0" });
    await loadData();
  }

  async function deleteSupplier(id: number) {
    await apiDelete(`/setup/suppliers/${id}`);
    await loadData();
  }

  async function saveTransporter() {
    if (!transporterForm.name.trim()) return;
    await apiPost("/setup/transporters", {
      name: transporterForm.name,
      phone: transporterForm.phone,
      vehicle_no: transporterForm.vehicle_no,
      address: transporterForm.address,
    });
    setTransporterForm({ name: "", phone: "", vehicle_no: "", address: "" });
    await loadData();
  }

  async function deleteTransporter(id: number) {
    await apiDelete(`/setup/transporters/${id}`);
    await loadData();
  }

  async function saveAccount() {
    if (!accountForm.name.trim()) return;
    await apiPost("/setup/accounts", {
      code: accountForm.code,
      name: accountForm.name,
      type: accountForm.type,
      parent_id: accountForm.parent_id ? Number(accountForm.parent_id) : null,
      opening_balance: Number(accountForm.opening_balance || 0),
    });
    setAccountForm({ code: "", name: "", type: "Asset", parent_id: "", opening_balance: "0" });
    await loadData();
  }

  async function deleteAccount(id: number) {
    await apiDelete(`/setup/accounts/${id}`);
    await loadData();
  }

  async function saveFactoryItem() {
    if (!factoryForm.name.trim()) return;
    await apiPost("/setup/factory-items", {
      name: factoryForm.name,
      unit: factoryForm.unit,
      rate: Number(factoryForm.rate || 0),
      stock: Number(factoryForm.stock || 0),
    });
    setFactoryForm({ name: "", unit: "KG", rate: "0", stock: "0" });
    await loadData();
  }

  async function deleteFactoryItem(id: number) {
    await apiDelete(`/setup/factory-items/${id}`);
    await loadData();
  }

  async function startNewYear() {
    const yearName = window.prompt("Enter the new accounting year label (for example: 2026)", String(new Date().getFullYear() + 1));
    if (!yearName) return;
    await apiPost("/setup/new-year-posting", { name: yearName.trim() });
    await loadData();
  }

  const renderForm = () => {
    switch (activeTab) {
      case "Employees":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Designation</label>
                <Input value={employeeForm.designation} onChange={(e) => setEmployeeForm({ ...employeeForm, designation: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input value={employeeForm.phone} onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Salary</label>
                <Input type="number" value={employeeForm.salary} onChange={(e) => setEmployeeForm({ ...employeeForm, salary: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input value={employeeForm.address} onChange={(e) => setEmployeeForm({ ...employeeForm, address: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => void saveEmployee()}><Save className="h-4 w-4" /> Save employee</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Designation</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Salary</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.designation || "-"}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{Number(row.salary || 0).toLocaleString()}</td>
                      <td className="p-2">
                        <Button variant="destructive" size="sm" onClick={() => void deleteEmployee(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Customers":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input type="number" value={customerForm.opening_balance} onChange={(e) => setCustomerForm({ ...customerForm, opening_balance: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => void saveCustomer()}><Save className="h-4 w-4" /> Save customer</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Address</th>
                    <th className="p-2 text-left">Opening Balance</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.address || "-"}</td>
                      <td className="p-2">{Number(row.opening_balance || 0).toLocaleString()}</td>
                      <td className="p-2"><Button variant="destructive" size="sm" onClick={() => void deleteCustomer(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Suppliers":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input type="number" value={supplierForm.opening_balance} onChange={(e) => setSupplierForm({ ...supplierForm, opening_balance: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => void saveSupplier()}><Save className="h-4 w-4" /> Save supplier</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Address</th>
                    <th className="p-2 text-left">Opening Balance</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.address || "-"}</td>
                      <td className="p-2">{Number(row.opening_balance || 0).toLocaleString()}</td>
                      <td className="p-2"><Button variant="destructive" size="sm" onClick={() => void deleteSupplier(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Transporters":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={transporterForm.name} onChange={(e) => setTransporterForm({ ...transporterForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input value={transporterForm.phone} onChange={(e) => setTransporterForm({ ...transporterForm, phone: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Vehicle number</label>
                <Input value={transporterForm.vehicle_no} onChange={(e) => setTransporterForm({ ...transporterForm, vehicle_no: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input value={transporterForm.address} onChange={(e) => setTransporterForm({ ...transporterForm, address: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => void saveTransporter()}><Save className="h-4 w-4" /> Save transporter</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Vehicle #</th>
                    <th className="p-2 text-left">Address</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transporters.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.vehicle_no || "-"}</td>
                      <td className="p-2">{row.address || "-"}</td>
                      <td className="p-2"><Button variant="destructive" size="sm" onClick={() => void deleteTransporter(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Accounts":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Code</label>
                <Input value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <Select value={accountForm.type} onValueChange={(value) => setAccountForm({ ...accountForm, type: value })}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {['Asset','Liability','Income','Expense','Equity'].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input type="number" value={accountForm.opening_balance} onChange={(e) => setAccountForm({ ...accountForm, opening_balance: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Parent account</label>
                <Select value={accountForm.parent_id || ""} onValueChange={(value) => setAccountForm({ ...accountForm, parent_id: value })}>
                  <SelectTrigger><SelectValue placeholder="No parent" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No parent</SelectItem>
                    {accountOptions.map((acc) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => void saveAccount()}><Save className="h-4 w-4" /> Save account</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Code</th>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Parent</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.code || "-"}</td>
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.type}</td>
                      <td className="p-2">{row.parent_name || "-"}</td>
                      <td className="p-2"><Button variant="destructive" size="sm" onClick={() => void deleteAccount(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Factory Items":
        return (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={factoryForm.name} onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Unit</label>
                <Input value={factoryForm.unit} onChange={(e) => setFactoryForm({ ...factoryForm, unit: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Rate</label>
                <Input type="number" value={factoryForm.rate} onChange={(e) => setFactoryForm({ ...factoryForm, rate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stock</label>
                <Input type="number" value={factoryForm.stock} onChange={(e) => setFactoryForm({ ...factoryForm, stock: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => void saveFactoryItem()}><Save className="h-4 w-4" /> Save factory item</Button>
            <div className="rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Unit</th>
                    <th className="p-2 text-left">Rate</th>
                    <th className="p-2 text-left">Stock</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {factoryItems.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{row.unit}</td>
                      <td className="p-2">{Number(row.rate || 0).toLocaleString()}</td>
                      <td className="p-2">{Number(row.stock_qty || 0).toLocaleString()}</td>
                      <td className="p-2"><Button variant="destructive" size="sm" onClick={() => void deleteFactoryItem(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "New Year Posting":
        return (
          <div className="space-y-4 rounded-md border border-border bg-card p-5">
            <div className="text-lg font-semibold">New accounting year</div>
            <p className="text-sm text-muted-foreground">Create a new financial year and make it the active year for posting.</p>
            <Button onClick={() => void startNewYear()}><RefreshCcw className="h-4 w-4" /> Start new year posting</Button>
            <div className="rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="p-2 text-left">Year</th>
                    <th className="p-2 text-left">Start</th>
                    <th className="p-2 text-left">End</th>
                    <th className="p-2 text-left">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year.id} className="border-t border-border">
                      <td className="p-2">{year.name}</td>
                      <td className="p-2">{year.start_date}</td>
                      <td className="p-2">{year.end_date}</td>
                      <td className="p-2">{year.is_current ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setup / Masters</h1>
          <p className="text-sm text-muted-foreground">Phase 3 master data and accounting setup</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${activeTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card p-5">
        {loading ? <div className="text-sm text-muted-foreground">Loading masters…</div> : renderForm()}
      </div>
    </div>
  );
}
