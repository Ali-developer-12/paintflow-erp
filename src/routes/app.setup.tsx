import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, RefreshCcw, Key, Shield, History, Activity, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const tabs = [
  "Employees",
  "Customers",
  "Suppliers",
  "Transporters",
  "Accounts",
  "Factory Items",
  "New Year Posting",
  "Users & Roles",
  "Audit Trail",
  "Diagnostics",
] as const;

type UserRecord = {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  is_active: number;
  created_at: string;
};

type AuditRecord = {
  id: number;
  username?: string;
  action: string;
  entity: string;
  entity_id: string;
  details: string;
  created_at: string;
};

type DiagnosticsRecord = {
  app_name: string;
  app_version: string;
  uptime_seconds: number;
  node_version: string;
  platform: string;
  database: {
    path: string;
    size_bytes: number;
    journal_mode: string;
    busy_timeout_ms: number;
    user_version: number;
    integrity_check: string;
    foreign_key_violations: number;
  };
  stock_reconciliation: {
    ok: boolean;
    issues_count: number;
  };
  accounting: {
    trial_balance_balanced: boolean;
    total_debit: number;
    total_credit: number;
  };
  backups: {
    count: number;
    latest: { file_path: string; created_at: string } | null;
  };
};

type Employee = {
  id: number;
  name: string;
  designation: string;
  phone: string;
  address: string;
  salary: number;
};
type Customer = {
  id: number;
  name: string;
  phone: string;
  address: string;
  opening_balance: number;
};
type Supplier = {
  id: number;
  name: string;
  phone: string;
  address: string;
  opening_balance: number;
};
type Transporter = { id: number; name: string; phone: string; vehicle_no: string; address: string };
type Account = {
  id: number;
  code: string;
  name: string;
  type: string;
  parent_id: number | null;
  parent_name?: string;
  opening_balance: number;
};
type FactoryItem = { id: number; name: string; unit: string; rate: number; stock_qty: number };
type YearRecord = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current: number;
};

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

  const [employeeForm, setEmployeeForm] = useState({
    name: "",
    designation: "",
    phone: "",
    address: "",
    salary: "0",
  });
  const [customerForm, setCustomerForm] = useState({
    name: "",
    phone: "",
    address: "",
    opening_balance: "0",
  });
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    phone: "",
    address: "",
    opening_balance: "0",
  });
  const [transporterForm, setTransporterForm] = useState({
    name: "",
    phone: "",
    vehicle_no: "",
    address: "",
  });
  const [accountForm, setAccountForm] = useState({
    code: "",
    name: "",
    type: "Asset",
    parent_id: "",
    opening_balance: "0",
  });
  const [factoryForm, setFactoryForm] = useState({ name: "", unit: "KG", rate: "0", stock: "0" });

  const accountOptions = useMemo(
    () => accounts.filter((acc) => acc.id !== Number(accountForm.parent_id)),
    [accounts, accountForm.parent_id],
  );

  async function loadData() {
    setLoading(true);
    try {
      const [
        employeesData,
        customersData,
        suppliersData,
        transportersData,
        accountsData,
        factoryData,
        yearsData,
      ] = await Promise.all([
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

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsRecord | null>(null);
  const [userForm, setUserForm] = useState({ username: "", password: "", full_name: "", role: "user" });
  const [resetModalUser, setResetModalUser] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  async function loadUsers() {
    try {
      const rows = await apiGet<UserRecord[]>("/users");
      setUsers(rows);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load users");
    }
  }

  async function loadAuditLogs() {
    try {
      const res = await apiGet<{ rows: AuditRecord[] }>("/audit-logs");
      setAuditLogs(res.rows);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load audit logs");
    }
  }

  async function loadDiagnostics() {
    try {
      const res = await apiGet<DiagnosticsRecord>("/diagnostics");
      setDiagnostics(res);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load diagnostics");
    }
  }

  useEffect(() => {
    if (activeTab === "Users & Roles") void loadUsers();
    if (activeTab === "Audit Trail") void loadAuditLogs();
    if (activeTab === "Diagnostics") void loadDiagnostics();
  }, [activeTab]);

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!userForm.username.trim() || !userForm.password) {
      toast.error("Username and password are required");
      return;
    }
    setSavingUser(true);
    try {
      await apiPost("/users", userForm);
      toast.success(`User ${userForm.username} created successfully`);
      setUserForm({ username: "", password: "", full_name: "", role: "user" });
      await loadUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSavingUser(false);
    }
  }

  async function toggleUserStatus(u: UserRecord) {
    try {
      await apiPut(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 });
      toast.success(`User ${u.username} status updated`);
      await loadUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  async function toggleUserRole(u: UserRecord) {
    const newRole = u.role === "admin" ? "user" : "admin";
    try {
      await apiPut(`/users/${u.id}`, { role: newRole });
      toast.success(`User ${u.username} role changed to ${newRole}`);
      await loadUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetModalUser || !newPassword) return;
    try {
      await apiPost(`/users/${resetModalUser.id}/reset-password`, { new_password: newPassword });
      toast.success(`Password reset for ${resetModalUser.username}`);
      setResetModalUser(null);
      setNewPassword("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password");
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
    const yearName = window.prompt(
      "Enter the new accounting year label (for example: 2026)",
      String(new Date().getFullYear() + 1),
    );
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
                <Input
                  value={employeeForm.name}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Designation</label>
                <Input
                  value={employeeForm.designation}
                  onChange={(e) =>
                    setEmployeeForm({ ...employeeForm, designation: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input
                  value={employeeForm.phone}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Salary</label>
                <Input
                  type="number"
                  value={employeeForm.salary}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, salary: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input
                  value={employeeForm.address}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, address: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={() => void saveEmployee()}>
              <Save className="h-4 w-4" /> Save employee
            </Button>
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
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteEmployee(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
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
                <Input
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input
                  type="number"
                  value={customerForm.opening_balance}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, opening_balance: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input
                  value={customerForm.address}
                  onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={() => void saveCustomer()}>
              <Save className="h-4 w-4" /> Save customer
            </Button>
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
                      <td className="p-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteCustomer(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
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
                <Input
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input
                  type="number"
                  value={supplierForm.opening_balance}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, opening_balance: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input
                  value={supplierForm.phone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input
                  value={supplierForm.address}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={() => void saveSupplier()}>
              <Save className="h-4 w-4" /> Save supplier
            </Button>
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
                      <td className="p-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteSupplier(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
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
                <Input
                  value={transporterForm.name}
                  onChange={(e) => setTransporterForm({ ...transporterForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Phone</label>
                <Input
                  value={transporterForm.phone}
                  onChange={(e) =>
                    setTransporterForm({ ...transporterForm, phone: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Vehicle number</label>
                <Input
                  value={transporterForm.vehicle_no}
                  onChange={(e) =>
                    setTransporterForm({ ...transporterForm, vehicle_no: e.target.value })
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Address</label>
                <Input
                  value={transporterForm.address}
                  onChange={(e) =>
                    setTransporterForm({ ...transporterForm, address: e.target.value })
                  }
                />
              </div>
            </div>
            <Button onClick={() => void saveTransporter()}>
              <Save className="h-4 w-4" /> Save transporter
            </Button>
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
                      <td className="p-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteTransporter(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
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
                <Input
                  value={accountForm.code}
                  onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <Select
                  value={accountForm.type}
                  onValueChange={(value) => setAccountForm({ ...accountForm, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {["Asset", "Liability", "Income", "Expense", "Equity"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Opening balance</label>
                <Input
                  type="number"
                  value={accountForm.opening_balance}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, opening_balance: e.target.value })
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Parent account</label>
                <Select
                  value={accountForm.parent_id || ""}
                  onValueChange={(value) => setAccountForm({ ...accountForm, parent_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No parent</SelectItem>
                    {accountOptions.map((acc) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => void saveAccount()}>
              <Save className="h-4 w-4" /> Save account
            </Button>
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
                      <td className="p-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteAccount(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
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
                <Input
                  value={factoryForm.name}
                  onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Unit</label>
                <Input
                  value={factoryForm.unit}
                  onChange={(e) => setFactoryForm({ ...factoryForm, unit: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Rate</label>
                <Input
                  type="number"
                  value={factoryForm.rate}
                  onChange={(e) => setFactoryForm({ ...factoryForm, rate: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Stock</label>
                <Input
                  type="number"
                  value={factoryForm.stock}
                  onChange={(e) => setFactoryForm({ ...factoryForm, stock: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={() => void saveFactoryItem()}>
              <Save className="h-4 w-4" /> Save factory item
            </Button>
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
                      <td className="p-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteFactoryItem(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
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
            <p className="text-sm text-muted-foreground">
              Create a new financial year and make it the active year for posting.
            </p>
            <Button onClick={() => void startNewYear()}>
              <RefreshCcw className="h-4 w-4" /> Start new year posting
            </Button>
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
      case "Users & Roles":
        return (
          <div className="space-y-6">
            <form onSubmit={saveUser} className="rounded-md border border-border bg-card p-5 space-y-4">
              <div className="text-base font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Create Operator Account
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Username *</label>
                  <Input
                    placeholder="e.g. cashier1"
                    value={userForm.username}
                    onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Password *</label>
                  <Input
                    type="password"
                    placeholder="Min 6 characters"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Full Name</label>
                  <Input
                    placeholder="Operator full name"
                    value={userForm.full_name}
                    onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Role *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  >
                    <option value="user">User / Operator</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingUser}>
                  <Plus className="h-4 w-4 mr-1" /> {savingUser ? "Creating..." : "Create User"}
                </Button>
              </div>
            </form>

            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="p-2.5">Username</th>
                    <th className="p-2.5">Full Name</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Created At</th>
                    <th className="p-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground">
                        No users loaded.
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-mono font-medium">{u.username}</td>
                        <td className="p-2.5">{u.full_name || "—"}</td>
                        <td className="p-2.5">
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-semibold ${
                              u.role === "admin"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-semibold ${
                              u.is_active
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {u.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground">{u.created_at}</td>
                        <td className="p-2.5 text-center">
                          <div className="inline-flex gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => void toggleUserRole(u)}
                            >
                              Role: {u.role === "admin" ? "Demote" : "Promote"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => void toggleUserStatus(u)}
                            >
                              {u.is_active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => {
                                setResetModalUser(u);
                                setNewPassword("");
                              }}
                            >
                              <Key className="h-3 w-3 mr-1" /> Reset PW
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Reset Password Modal */}
            {resetModalUser && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                <form
                  onSubmit={handlePasswordReset}
                  className="bg-card w-full max-w-sm rounded-xl border border-border p-5 space-y-4 shadow-xl"
                >
                  <div className="flex justify-between items-center border-b border-border pb-2">
                    <h4 className="font-bold text-sm">Reset Password for {resetModalUser.username}</h4>
                    <button type="button" onClick={() => setResetModalUser(null)}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">New Password (min 6 chars)</label>
                    <Input
                      type="password"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setResetModalUser(null)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm">
                      Update Password
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </div>
        );
      case "Audit Trail":
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-base font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-primary" /> System Audit Trail
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadAuditLogs()}>
                <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
              </Button>
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="p-2.5">Date & Time</th>
                    <th className="p-2.5">Operator</th>
                    <th className="p-2.5">Action</th>
                    <th className="p-2.5">Entity</th>
                    <th className="p-2.5">Entity ID</th>
                    <th className="p-2.5">Audit Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                        No audit records recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-mono">{log.created_at}</td>
                        <td className="p-2.5 font-medium">{log.username || "System"}</td>
                        <td className="p-2.5">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded font-bold">
                            {log.action}
                          </span>
                        </td>
                        <td className="p-2.5 capitalize">{log.entity}</td>
                        <td className="p-2.5 font-mono">{log.entity_id || "—"}</td>
                        <td className="p-2.5 font-mono text-[11px] text-muted-foreground truncate max-w-md">
                          {log.details || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "Diagnostics":
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div className="text-base font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Application & Database Diagnostics
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadDiagnostics()}>
                <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Refresh
              </Button>
            </div>

            {diagnostics ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="rounded-lg border border-border p-4 bg-card space-y-2">
                  <h4 className="font-bold text-sm text-foreground">Application Info</h4>
                  <p><strong>App:</strong> {diagnostics.app_name}</p>
                  <p><strong>Version:</strong> {diagnostics.app_version}</p>
                  <p><strong>Uptime:</strong> {Math.floor(diagnostics.uptime_seconds / 60)} minutes</p>
                  <p><strong>Node.js:</strong> {diagnostics.node_version}</p>
                  <p><strong>Platform:</strong> {diagnostics.platform}</p>
                </div>

                <div className="rounded-lg border border-border p-4 bg-card space-y-2">
                  <h4 className="font-bold text-sm text-foreground">SQLite Storage</h4>
                  <p className="truncate"><strong>Path:</strong> {diagnostics.database.path}</p>
                  <p><strong>Size:</strong> {(diagnostics.database.size_bytes / 1024).toFixed(1)} KB</p>
                  <p><strong>Journal Mode:</strong> {diagnostics.database.journal_mode}</p>
                  <p><strong>Busy Timeout:</strong> {diagnostics.database.busy_timeout_ms} ms</p>
                  <p><strong>Schema Version:</strong> user_version {diagnostics.database.user_version}</p>
                </div>

                <div className="rounded-lg border border-border p-4 bg-card space-y-2">
                  <h4 className="font-bold text-sm text-foreground">Integrity Health</h4>
                  <p className="flex items-center gap-1.5">
                    <strong>Integrity:</strong>
                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {diagnostics.database.integrity_check}
                    </span>
                  </p>
                  <p><strong>FK Violations:</strong> {diagnostics.database.foreign_key_violations}</p>
                  <p className="flex items-center gap-1.5">
                    <strong>Stock Ledger:</strong>
                    <span className={diagnostics.stock_reconciliation.ok ? "text-emerald-600 font-semibold" : "text-destructive font-semibold"}>
                      {diagnostics.stock_reconciliation.ok ? "Reconciled (0 issues)" : `${diagnostics.stock_reconciliation.issues_count} issues`}
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <strong>Trial Balance:</strong>
                    <span className={diagnostics.accounting.trial_balance_balanced ? "text-emerald-600 font-semibold" : "text-destructive font-semibold"}>
                      {diagnostics.accounting.trial_balance_balanced ? `Balanced (Rs ${diagnostics.accounting.total_debit})` : "Imbalanced"}
                    </span>
                  </p>
                  <p><strong>Backups Recorded:</strong> {diagnostics.backups.count}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading diagnostics...</div>
            )}
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
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading masters…</div>
        ) : (
          renderForm()
        )}
      </div>
    </div>
  );
}
