import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  BookOpenCheck,
  Plus,
  Printer,
  RefreshCcw,
  Receipt as ReceiptIcon,
  CreditCard,
  TrendingDown,
  TrendingUp,
  FileSpreadsheet,
  X,
} from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type Account = {
  id: number;
  code: string;
  name: string;
  type: string;
  parent_id: number | null;
};
type Customer = { id: number; name: string };
type Supplier = { id: number; name: string };

type Receipt = {
  id: number;
  voucher_no: string;
  date: string;
  customer_id: number;
  customer_name: string;
  payment_mode: string;
  payment_account_id: number;
  payment_account_name: string;
  amount: number;
  reference_no: string;
  remarks: string;
  created_at: string;
  created_by_user?: string;
};

type Payment = {
  id: number;
  voucher_no: string;
  date: string;
  supplier_id: number;
  supplier_name: string;
  payment_mode: string;
  payment_account_id: number;
  payment_account_name: string;
  amount: number;
  reference_no: string;
  remarks: string;
  created_at: string;
  created_by_user?: string;
};

type Expense = {
  id: number;
  voucher_no: string;
  date: string;
  expense_account_id: number;
  expense_account_name: string;
  payment_account_id: number;
  payment_account_name: string;
  amount: number;
  reference_no: string;
  remarks: string;
  created_at: string;
  created_by_user?: string;
};

type Income = {
  id: number;
  voucher_no: string;
  date: string;
  income_account_id: number;
  income_account_name: string;
  payment_account_id: number;
  payment_account_name: string;
  amount: number;
  reference_no: string;
  remarks: string;
  created_at: string;
  created_by_user?: string;
};

type JournalLine = {
  account_id: number;
  debit: number;
  credit: number;
  narration: string;
};

type Journal = {
  id: number;
  voucher_no: string;
  date: string;
  reference_no: string;
  remarks: string;
  total_amount: number;
  created_at: string;
  created_by_user?: string;
  lines: {
    id: number;
    account_id: number;
    account_code: string;
    account_name: string;
    debit: number;
    credit: number;
    narration: string;
  }[];
};

type PartyLedger = {
  party: { id: number; name: string; type: string; opening_balance: number };
  opening_balance: number;
  closing_balance: number;
  lines: {
    id: number;
    date: string;
    voucher_no: string;
    voucher_type: string;
    ref_type: string;
    narration: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
};

const formatAmount = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const Route = createFileRoute("/app/accounts")({ component: AccountsPage });

function AccountsPage() {
  const [activeTab, setActiveTab] = useState("receipts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Receipts State
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [receiptForm, setReceiptForm] = useState({
    customer_id: "",
    date: new Date().toISOString().slice(0, 10),
    payment_mode: "cash",
    payment_account_id: "",
    amount: "",
    reference_no: "",
    remarks: "",
  });

  // Payments State
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    supplier_id: "",
    date: new Date().toISOString().slice(0, 10),
    payment_mode: "cash",
    payment_account_id: "",
    amount: "",
    reference_no: "",
    remarks: "",
  });

  // Expenses State
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    expense_account_id: "",
    payment_account_id: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    reference_no: "",
    remarks: "",
  });

  // Income State
  const [incomeList, setIncomeList] = useState<Income[]>([]);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [incomeForm, setIncomeForm] = useState({
    income_account_id: "",
    payment_account_id: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    reference_no: "",
    remarks: "",
  });

  // Journal State
  const [journals, setJournals] = useState<Journal[]>([]);
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [journalForm, setJournalForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    reference_no: "",
    remarks: "",
    lines: [
      { account_id: "", debit: "", credit: "", narration: "" },
      { account_id: "", debit: "", credit: "", narration: "" },
    ],
  });

  // Party Ledger State
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [ledger, setLedger] = useState<PartyLedger | null>(null);

  // Print Modal State
  const [printDoc, setPrintDoc] = useState<{
    title: string;
    voucherNo: string;
    date: string;
    partyName?: string;
    accountName?: string;
    amount: number;
    remarks?: string;
    reference?: string;
    lines?: { account_name: string; debit: number; credit: number; narration?: string }[];
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Asset accounts (for Cash/Bank payments and receipts)
  const assetAccounts = useMemo(() => accounts.filter((a) => a.type === "asset"), [accounts]);
  const expenseAccounts = useMemo(() => accounts.filter((a) => a.type === "expense"), [accounts]);
  const incomeAccounts = useMemo(() => accounts.filter((a) => a.type === "income"), [accounts]);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [accs, custs, supps] = await Promise.all([
        apiGet<Account[]>("/accounts"),
        apiGet<Customer[]>("/setup/customers"),
        apiGet<Supplier[]>("/setup/suppliers"),
      ]);
      setAccounts(accs);
      setCustomers(custs);
      setSuppliers(supps);

      // Default payment account to Cash in Hand (1100)
      const cashAcc = accs.find((a) => a.code === "1100");
      if (cashAcc) {
        setReceiptForm((prev) => ({ ...prev, payment_account_id: String(cashAcc.id) }));
        setPaymentForm((prev) => ({ ...prev, payment_account_id: String(cashAcc.id) }));
        setExpenseForm((prev) => ({ ...prev, payment_account_id: String(cashAcc.id) }));
        setIncomeForm((prev) => ({ ...prev, payment_account_id: String(cashAcc.id) }));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }

  async function loadTabContent(tab: string) {
    try {
      if (tab === "receipts") {
        const rows = await apiGet<Receipt[]>("/receipts");
        setReceipts(rows);
      } else if (tab === "payments") {
        const rows = await apiGet<Payment[]>("/payments");
        setPayments(rows);
      } else if (tab === "expenses") {
        const rows = await apiGet<Expense[]>("/expenses");
        setExpenses(rows);
      } else if (tab === "income") {
        const rows = await apiGet<Income[]>("/income");
        setIncomeList(rows);
      } else if (tab === "journals") {
        const rows = await apiGet<Journal[]>("/journals");
        setJournals(rows);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : `Failed to load ${tab}`);
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadTabContent(activeTab);
  }, [activeTab]);

  // Load party ledger when party or type changes
  useEffect(() => {
    if (!selectedPartyId) {
      setLedger(null);
      return;
    }
    void apiGet<PartyLedger>(`/reports/statements?party_type=${partyType}&party_id=${selectedPartyId}`)
      .then(setLedger)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to load statement"));
  }, [partyType, selectedPartyId]);

  // Handle Receipt Submission
  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!receiptForm.customer_id || !receiptForm.payment_account_id || !receiptForm.amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; voucher_no: string }>("/receipts", {
        customer_id: Number(receiptForm.customer_id),
        date: receiptForm.date,
        payment_mode: receiptForm.payment_mode,
        payment_account_id: Number(receiptForm.payment_account_id),
        amount: Number(receiptForm.amount),
        reference_no: receiptForm.reference_no,
        remarks: receiptForm.remarks,
      });
      toast.success(`Receipt ${res.voucher_no} posted successfully`);
      setShowReceiptForm(false);
      setReceiptForm((prev) => ({ ...prev, amount: "", reference_no: "", remarks: "" }));
      void loadTabContent("receipts");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to post receipt");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Payment Submission
  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentForm.supplier_id || !paymentForm.payment_account_id || !paymentForm.amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; voucher_no: string }>("/payments", {
        supplier_id: Number(paymentForm.supplier_id),
        date: paymentForm.date,
        payment_mode: paymentForm.payment_mode,
        payment_account_id: Number(paymentForm.payment_account_id),
        amount: Number(paymentForm.amount),
        reference_no: paymentForm.reference_no,
        remarks: paymentForm.remarks,
      });
      toast.success(`Payment ${res.voucher_no} posted successfully`);
      setShowPaymentForm(false);
      setPaymentForm((prev) => ({ ...prev, amount: "", reference_no: "", remarks: "" }));
      void loadTabContent("payments");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to post payment");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Expense Submission
  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseForm.expense_account_id || !expenseForm.payment_account_id || !expenseForm.amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; voucher_no: string }>("/expenses", {
        expense_account_id: Number(expenseForm.expense_account_id),
        payment_account_id: Number(expenseForm.payment_account_id),
        date: expenseForm.date,
        amount: Number(expenseForm.amount),
        reference_no: expenseForm.reference_no,
        remarks: expenseForm.remarks,
      });
      toast.success(`Expense ${res.voucher_no} posted successfully`);
      setShowExpenseForm(false);
      setExpenseForm((prev) => ({ ...prev, amount: "", reference_no: "", remarks: "" }));
      void loadTabContent("expenses");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to post expense");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Income Submission
  async function submitIncome(e: React.FormEvent) {
    e.preventDefault();
    if (!incomeForm.income_account_id || !incomeForm.payment_account_id || !incomeForm.amount) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; voucher_no: string }>("/income", {
        income_account_id: Number(incomeForm.income_account_id),
        payment_account_id: Number(incomeForm.payment_account_id),
        date: incomeForm.date,
        amount: Number(incomeForm.amount),
        reference_no: incomeForm.reference_no,
        remarks: incomeForm.remarks,
      });
      toast.success(`Income ${res.voucher_no} posted successfully`);
      setShowIncomeForm(false);
      setIncomeForm((prev) => ({ ...prev, amount: "", reference_no: "", remarks: "" }));
      void loadTabContent("income");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to post income");
    } finally {
      setSubmitting(false);
    }
  }

  // Handle Journal Submission
  const journalTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of journalForm.lines) {
      debit += Number(line.debit || 0);
      credit += Number(line.credit || 0);
    }
    return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
  }, [journalForm.lines]);

  async function submitJournal(e: React.FormEvent) {
    e.preventDefault();
    if (Math.abs(journalTotals.debit - journalTotals.credit) > 0.01 || journalTotals.debit <= 0) {
      toast.error("Journal must be balanced with total debits equal to total credits (> 0)");
      return;
    }
    const linesPayload = journalForm.lines.map((l) => ({
      account_id: Number(l.account_id),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      narration: l.narration,
    }));
    setSubmitting(true);
    try {
      const res = await apiPost<{ id: number; voucher_no: string }>("/journals", {
        date: journalForm.date,
        reference_no: journalForm.reference_no,
        remarks: journalForm.remarks,
        lines: linesPayload,
      });
      toast.success(`Journal Voucher ${res.voucher_no} created successfully`);
      setShowJournalForm(false);
      setJournalForm({
        date: new Date().toISOString().slice(0, 10),
        reference_no: "",
        remarks: "",
        lines: [
          { account_id: "", debit: "", credit: "", narration: "" },
          { account_id: "", debit: "", credit: "", narration: "" },
        ],
      });
      void loadTabContent("journals");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create journal voucher");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-120px)] flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial Accounting & Vouchers</h1>
          <p className="text-sm text-muted-foreground">
            Customer Receipts, Supplier Payments, Expenses, Income, Journal Vouchers & Statements
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTabContent(activeTab)} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/80 p-1 flex-wrap h-auto">
          <TabsTrigger value="receipts" className="gap-1.5 py-1.5">
            <ReceiptIcon className="h-4 w-4" /> Customer Receipts
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5 py-1.5">
            <CreditCard className="h-4 w-4" /> Supplier Payments
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5 py-1.5">
            <TrendingDown className="h-4 w-4" /> Expenses
          </TabsTrigger>
          <TabsTrigger value="income" className="gap-1.5 py-1.5">
            <TrendingUp className="h-4 w-4" /> Income
          </TabsTrigger>
          <TabsTrigger value="journals" className="gap-1.5 py-1.5">
            <FileSpreadsheet className="h-4 w-4" /> Journal Vouchers
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5 py-1.5">
            <BookOpenCheck className="h-4 w-4" /> Party Statements
          </TabsTrigger>
          <TabsTrigger value="coa" className="gap-1.5 py-1.5">
            Chart of Accounts
          </TabsTrigger>
        </TabsList>

        {/* ----------------- 1. CUSTOMER RECEIPTS ----------------- */}
        <TabsContent value="receipts" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Customer Receipts Register</h2>
            <Button size="sm" onClick={() => setShowReceiptForm(!showReceiptForm)}>
              {showReceiptForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showReceiptForm ? "Cancel" : "New Receipt"}
            </Button>
          </div>

          {showReceiptForm && (
            <form onSubmit={submitReceipt} className="rounded-lg border border-border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm">Post New Customer Receipt</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Customer *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={receiptForm.customer_id}
                    onChange={(e) => setReceiptForm({ ...receiptForm, customer_id: e.target.value })}
                    required
                  >
                    <option value="">Select customer...</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Date *</label>
                  <Input
                    type="date"
                    value={receiptForm.date}
                    onChange={(e) => setReceiptForm({ ...receiptForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Deposit Into (Cash/Bank) *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={receiptForm.payment_account_id}
                    onChange={(e) => setReceiptForm({ ...receiptForm, payment_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select payment account...</option>
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Amount (Rs) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={receiptForm.amount}
                    onChange={(e) => setReceiptForm({ ...receiptForm, amount: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Payment Mode</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={receiptForm.payment_mode}
                    onChange={(e) => setReceiptForm({ ...receiptForm, payment_mode: e.target.value })}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer / Cheque</option>
                    <option value="online">Online / Wire</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Cheque / Reference No</label>
                  <Input
                    placeholder="Ref # or Cheque #"
                    value={receiptForm.reference_no}
                    onChange={(e) => setReceiptForm({ ...receiptForm, reference_no: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium block mb-1">Remarks / Narration</label>
                  <Input
                    placeholder="Payment details, invoice reference..."
                    value={receiptForm.remarks}
                    onChange={(e) => setReceiptForm({ ...receiptForm, remarks: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowReceiptForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Post Receipt (DR Cash, CR Customer)"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Account</th>
                  <th className="px-3 py-2.5 text-right">Amount (Rs)</th>
                  <th className="px-3 py-2.5">Ref #</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No customer receipts posted yet.
                    </td>
                  </tr>
                ) : (
                  receipts.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{r.voucher_no}</td>
                      <td className="px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2 font-medium">{r.customer_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.payment_account_name}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600">
                        {formatAmount(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.reference_no || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.remarks || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPrintDoc({
                              title: "CUSTOMER RECEIPT VOUCHER",
                              voucherNo: r.voucher_no,
                              date: r.date,
                              partyName: r.customer_name,
                              accountName: r.payment_account_name,
                              amount: r.amount,
                              reference: r.reference_no,
                              remarks: r.remarks,
                            })
                          }
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ----------------- 2. SUPPLIER PAYMENTS ----------------- */}
        <TabsContent value="payments" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Supplier Payments Register</h2>
            <Button size="sm" onClick={() => setShowPaymentForm(!showPaymentForm)}>
              {showPaymentForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showPaymentForm ? "Cancel" : "New Payment"}
            </Button>
          </div>

          {showPaymentForm && (
            <form onSubmit={submitPayment} className="rounded-lg border border-border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm">Post New Supplier Payment</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Supplier *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={paymentForm.supplier_id}
                    onChange={(e) => setPaymentForm({ ...paymentForm, supplier_id: e.target.value })}
                    required
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Date *</label>
                  <Input
                    type="date"
                    value={paymentForm.date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Pay From (Cash/Bank) *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={paymentForm.payment_account_id}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select payment account...</option>
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Amount (Rs) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Payment Mode</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={paymentForm.payment_mode}
                    onChange={(e) => setPaymentForm({ ...paymentForm, payment_mode: e.target.value })}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer / Cheque</option>
                    <option value="online">Online / Wire</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Cheque / Reference No</label>
                  <Input
                    placeholder="Ref # or Cheque #"
                    value={paymentForm.reference_no}
                    onChange={(e) => setPaymentForm({ ...paymentForm, reference_no: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium block mb-1">Remarks / Narration</label>
                  <Input
                    placeholder="Payment details, purchase bill reference..."
                    value={paymentForm.remarks}
                    onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowPaymentForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Post Payment (DR Supplier, CR Cash)"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Supplier</th>
                  <th className="px-3 py-2.5">Account</th>
                  <th className="px-3 py-2.5 text-right">Amount (Rs)</th>
                  <th className="px-3 py-2.5">Ref #</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No supplier payments posted yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{p.voucher_no}</td>
                      <td className="px-3 py-2">{p.date}</td>
                      <td className="px-3 py-2 font-medium">{p.supplier_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.payment_account_name}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">
                        {formatAmount(p.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs">{p.reference_no || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.remarks || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPrintDoc({
                              title: "SUPPLIER PAYMENT VOUCHER",
                              voucherNo: p.voucher_no,
                              date: p.date,
                              partyName: p.supplier_name,
                              accountName: p.payment_account_name,
                              amount: p.amount,
                              reference: p.reference_no,
                              remarks: p.remarks,
                            })
                          }
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ----------------- 3. EXPENSES ----------------- */}
        <TabsContent value="expenses" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Expense Register</h2>
            <Button size="sm" onClick={() => setShowExpenseForm(!showExpenseForm)}>
              {showExpenseForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showExpenseForm ? "Cancel" : "New Expense"}
            </Button>
          </div>

          {showExpenseForm && (
            <form onSubmit={submitExpense} className="rounded-lg border border-border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm">Record Expense Voucher</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Expense Account *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={expenseForm.expense_account_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, expense_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select expense account...</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Date *</label>
                  <Input
                    type="date"
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Paid From *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={expenseForm.payment_account_id}
                    onChange={(e) => setExpenseForm({ ...expenseForm, payment_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select cash/bank account...</option>
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Amount (Rs) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Bill / Reference No</label>
                  <Input
                    placeholder="Bill / Invoice #"
                    value={expenseForm.reference_no}
                    onChange={(e) => setExpenseForm({ ...expenseForm, reference_no: e.target.value })}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs font-medium block mb-1">Description / Remarks</label>
                  <Input
                    placeholder="Utility bill, factory repairs, transport charges..."
                    value={expenseForm.remarks}
                    onChange={(e) => setExpenseForm({ ...expenseForm, remarks: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowExpenseForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Record Expense (DR Expense, CR Payment)"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Expense Category</th>
                  <th className="px-3 py-2.5">Paid From</th>
                  <th className="px-3 py-2.5 text-right">Amount (Rs)</th>
                  <th className="px-3 py-2.5">Ref #</th>
                  <th className="px-3 py-2.5">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No expense vouchers posted yet.
                    </td>
                  </tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{e.voucher_no}</td>
                      <td className="px-3 py-2">{e.date}</td>
                      <td className="px-3 py-2 font-medium">{e.expense_account_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.payment_account_name}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">
                        {formatAmount(e.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs">{e.reference_no || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.remarks || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ----------------- 4. INCOME ----------------- */}
        <TabsContent value="income" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Income Register</h2>
            <Button size="sm" onClick={() => setShowIncomeForm(!showIncomeForm)}>
              {showIncomeForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showIncomeForm ? "Cancel" : "New Income"}
            </Button>
          </div>

          {showIncomeForm && (
            <form onSubmit={submitIncome} className="rounded-lg border border-border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm">Record Miscellaneous Income</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Income Account *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={incomeForm.income_account_id}
                    onChange={(e) => setIncomeForm({ ...incomeForm, income_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select income account...</option>
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Date *</label>
                  <Input
                    type="date"
                    value={incomeForm.date}
                    onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Received Into *</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={incomeForm.payment_account_id}
                    onChange={(e) => setIncomeForm({ ...incomeForm, payment_account_id: e.target.value })}
                    required
                  >
                    <option value="">Select cash/bank account...</option>
                    {assetAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Amount (Rs) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={incomeForm.amount}
                    onChange={(e) => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Receipt / Ref No</label>
                  <Input
                    placeholder="Reference #"
                    value={incomeForm.reference_no}
                    onChange={(e) => setIncomeForm({ ...incomeForm, reference_no: e.target.value })}
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs font-medium block mb-1">Description / Remarks</label>
                  <Input
                    placeholder="Scrap sales, empty barrels, rebate..."
                    value={incomeForm.remarks}
                    onChange={(e) => setIncomeForm({ ...incomeForm, remarks: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowIncomeForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Posting..." : "Record Income (DR Cash, CR Income)"}
                </Button>
              </div>
            </form>
          )}

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Voucher #</th>
                  <th className="px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Income Category</th>
                  <th className="px-3 py-2.5">Received Into</th>
                  <th className="px-3 py-2.5 text-right">Amount (Rs)</th>
                  <th className="px-3 py-2.5">Ref #</th>
                  <th className="px-3 py-2.5">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {incomeList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No income vouchers posted yet.
                    </td>
                  </tr>
                ) : (
                  incomeList.map((inc) => (
                    <tr key={inc.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{inc.voucher_no}</td>
                      <td className="px-3 py-2">{inc.date}</td>
                      <td className="px-3 py-2 font-medium">{inc.income_account_name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{inc.payment_account_name}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600">
                        {formatAmount(inc.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs">{inc.reference_no || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{inc.remarks || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ----------------- 5. JOURNAL VOUCHERS ----------------- */}
        <TabsContent value="journals" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">General Journal Vouchers</h2>
            <Button size="sm" onClick={() => setShowJournalForm(!showJournalForm)}>
              {showJournalForm ? <X className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {showJournalForm ? "Cancel" : "New Journal Voucher"}
            </Button>
          </div>

          {showJournalForm && (
            <form onSubmit={submitJournal} className="rounded-lg border border-border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm">Create Double-Entry Journal Voucher</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1">Date *</label>
                  <Input
                    type="date"
                    value={journalForm.date}
                    onChange={(e) => setJournalForm({ ...journalForm, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Reference No</label>
                  <Input
                    placeholder="JV Ref #"
                    value={journalForm.reference_no}
                    onChange={(e) => setJournalForm({ ...journalForm, reference_no: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Remarks</label>
                  <Input
                    placeholder="Description of adjustment/transfer..."
                    value={journalForm.remarks}
                    onChange={(e) => setJournalForm({ ...journalForm, remarks: e.target.value })}
                  />
                </div>
              </div>

              {/* Dynamic Line Items Table */}
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Account *</th>
                      <th className="px-3 py-2">Narration</th>
                      <th className="px-3 py-2 w-32 text-right">Debit (Rs)</th>
                      <th className="px-3 py-2 w-32 text-right">Credit (Rs)</th>
                      <th className="px-2 py-2 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {journalForm.lines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <select
                            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                            value={line.account_id}
                            onChange={(e) => {
                              const newLines = [...journalForm.lines];
                              newLines[idx].account_id = e.target.value;
                              setJournalForm({ ...journalForm, lines: newLines });
                            }}
                            required
                          >
                            <option value="">Select account...</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} - {a.name} ({a.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <Input
                            className="h-8 text-xs"
                            placeholder="Line detail"
                            value={line.narration}
                            onChange={(e) => {
                              const newLines = [...journalForm.lines];
                              newLines[idx].narration = e.target.value;
                              setJournalForm({ ...journalForm, lines: newLines });
                            }}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 text-xs text-right font-mono"
                            placeholder="0.00"
                            value={line.debit}
                            onChange={(e) => {
                              const newLines = [...journalForm.lines];
                              newLines[idx].debit = e.target.value;
                              if (e.target.value) newLines[idx].credit = "";
                              setJournalForm({ ...journalForm, lines: newLines });
                            }}
                          />
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 text-xs text-right font-mono"
                            placeholder="0.00"
                            value={line.credit}
                            onChange={(e) => {
                              const newLines = [...journalForm.lines];
                              newLines[idx].credit = e.target.value;
                              if (e.target.value) newLines[idx].debit = "";
                              setJournalForm({ ...journalForm, lines: newLines });
                            }}
                          />
                        </td>
                        <td className="p-2 text-center">
                          {journalForm.lines.length > 2 && (
                            <button
                              type="button"
                              className="text-destructive hover:opacity-80 p-1"
                              onClick={() => {
                                const newLines = journalForm.lines.filter((_, i) => i !== idx);
                                setJournalForm({ ...journalForm, lines: newLines });
                              }}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-semibold border-t border-border">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-right">
                        Totals:
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatAmount(journalTotals.debit)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatAmount(journalTotals.credit)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Balancing indicator */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setJournalForm({
                      ...journalForm,
                      lines: [...journalForm.lines, { account_id: "", debit: "", credit: "", narration: "" }],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
                </Button>

                <div className="flex items-center gap-4">
                  {Math.abs(journalTotals.debit - journalTotals.credit) <= 0.01 && journalTotals.debit > 0 ? (
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded">
                      ✓ Balanced (Total: {formatAmount(journalTotals.debit)})
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-destructive bg-destructive/10 px-2.5 py-1 rounded">
                      Difference: {formatAmount(Math.abs(journalTotals.debit - journalTotals.credit))} (Unbalanced)
                    </span>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      submitting ||
                      Math.abs(journalTotals.debit - journalTotals.credit) > 0.01 ||
                      journalTotals.debit <= 0
                    }
                  >
                    {submitting ? "Posting..." : "Post Journal Voucher"}
                  </Button>
                </div>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {journals.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground text-sm">
                No journal vouchers posted yet.
              </div>
            ) : (
              journals.map((jv) => (
                <div key={jv.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between bg-muted/40 px-4 py-2.5 border-b border-border">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-xs">{jv.voucher_no}</span>
                      <span className="text-xs text-muted-foreground">{jv.date}</span>
                      {jv.reference_no && (
                        <span className="text-xs bg-muted px-2 py-0.5 rounded font-mono">Ref: {jv.reference_no}</span>
                      )}
                      {jv.remarks && <span className="text-xs text-muted-foreground truncate">{jv.remarks}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">Total: Rs {formatAmount(jv.total_amount)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPrintDoc({
                            title: "GENERAL JOURNAL VOUCHER",
                            voucherNo: jv.voucher_no,
                            date: jv.date,
                            reference: jv.reference_no,
                            remarks: jv.remarks,
                            amount: jv.total_amount,
                            lines: jv.lines,
                          })
                        }
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border/60">
                      {jv.lines?.map((line, lidx) => (
                        <tr key={lidx}>
                          <td className="px-4 py-1.5 font-medium">
                            {line.account_code} - {line.account_name}
                          </td>
                          <td className="px-4 py-1.5 text-muted-foreground">{line.narration || "—"}</td>
                          <td className="px-4 py-1.5 text-right font-mono w-28">
                            {line.debit > 0 ? formatAmount(line.debit) : "—"}
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono w-28">
                            {line.credit > 0 ? formatAmount(line.credit) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* ----------------- 6. PARTY STATEMENTS ----------------- */}
        <TabsContent value="ledger" className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="text-xs font-medium block mb-1">Party Type</label>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={partyType}
                  onChange={(e) => {
                    setPartyType(e.target.value as "customer" | "supplier");
                    setSelectedPartyId("");
                  }}
                >
                  <option value="customer">Customer</option>
                  <option value="supplier">Supplier</option>
                </select>
              </div>
              <div className="min-w-[240px]">
                <label className="text-xs font-medium block mb-1">Select {partyType}</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedPartyId}
                  onChange={(e) => setSelectedPartyId(e.target.value)}
                >
                  <option value="">Select {partyType}...</option>
                  {partyType === "customer"
                    ? customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    : suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                </select>
              </div>
              {ledger && (
                <div className="ml-auto flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Current Balance</p>
                    <p
                      className={`text-base font-bold ${ledger.closing_balance > 0 ? "text-rose-600" : "text-emerald-600"}`}
                    >
                      Rs {formatAmount(ledger.closing_balance)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.print();
                    }}
                  >
                    <Printer className="h-4 w-4 mr-1.5" /> Print Statement
                  </Button>
                </div>
              )}
            </div>

            {!selectedPartyId ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                Select a customer or supplier to view their reconciled account statement.
              </div>
            ) : !ledger || ledger.lines.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No ledger transactions found for this party. Opening balance: Rs{" "}
                {formatAmount(ledger?.opening_balance || 0)}.
              </div>
            ) : (
              <div className="overflow-x-auto border border-border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Voucher #</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Narration</th>
                      <th className="px-3 py-2 text-right">Debit (Rs)</th>
                      <th className="px-3 py-2 text-right">Credit (Rs)</th>
                      <th className="px-3 py-2 text-right">Balance (Rs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr className="bg-muted/20 font-medium">
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2 font-mono text-xs">OPENING</td>
                      <td className="px-3 py-2">Opening Balance</td>
                      <td className="px-3 py-2 text-muted-foreground">Initial balance brought forward</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {partyType === "customer" && ledger.opening_balance > 0
                          ? formatAmount(ledger.opening_balance)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {partyType === "supplier" && ledger.opening_balance > 0
                          ? formatAmount(ledger.opening_balance)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {formatAmount(ledger.opening_balance)}
                      </td>
                    </tr>
                    {ledger.lines.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{row.date}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.voucher_no || "—"}</td>
                        <td className="px-3 py-2 capitalize text-xs">{row.voucher_type || row.ref_type}</td>
                        <td className="px-3 py-2 text-xs">{row.narration || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.debit > 0 ? formatAmount(row.debit) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.credit > 0 ? formatAmount(row.credit) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatAmount(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ----------------- 7. CHART OF ACCOUNTS ----------------- */}
        <TabsContent value="coa" className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-base font-semibold mb-3">Chart of Accounts</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left border-b border-border">
                  <tr>
                    <th className="px-3 py-2.5">Code</th>
                    <th className="px-3 py-2.5">Account Name</th>
                    <th className="px-3 py-2.5">Nature / Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono font-medium text-xs">{acc.code}</td>
                      <td className="px-3 py-2 font-medium">
                        {acc.parent_id ? "↳ " : ""}
                        {acc.name}
                      </td>
                      <td className="px-3 py-2 capitalize text-xs text-muted-foreground">{acc.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ----------------- PRINT VOUCHER MODAL ----------------- */}
      {printDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-card w-full max-w-2xl rounded-xl border border-border shadow-2xl p-6 space-y-6">
            <div className="flex justify-between items-start border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight">PaintFlow ERP</h2>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Industrial Factory Edition</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPrintDoc(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="border border-border/80 rounded-lg p-5 space-y-4 print-card">
              <div className="text-center pb-2 border-b border-border">
                <h3 className="text-base font-bold uppercase">{printDoc.title}</h3>
                <p className="font-mono text-sm font-semibold text-primary">{printDoc.voucherNo}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Date:</span> <strong>{printDoc.date}</strong>
                </div>
                {printDoc.partyName && (
                  <div>
                    <span className="text-muted-foreground">Party:</span> <strong>{printDoc.partyName}</strong>
                  </div>
                )}
                {printDoc.accountName && (
                  <div>
                    <span className="text-muted-foreground">Account:</span> <strong>{printDoc.accountName}</strong>
                  </div>
                )}
                {printDoc.reference && (
                  <div>
                    <span className="text-muted-foreground">Reference:</span> <strong>{printDoc.reference}</strong>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground">Amount:</span>{" "}
                  <strong className="text-sm font-mono">Rs {formatAmount(printDoc.amount)}</strong>
                </div>
                {printDoc.remarks && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Narration:</span> {printDoc.remarks}
                  </div>
                )}
              </div>

              {printDoc.lines && printDoc.lines.length > 0 && (
                <div className="pt-2">
                  <table className="w-full text-xs border border-border">
                    <thead className="bg-muted/50 text-left border-b border-border">
                      <tr>
                        <th className="p-2">Account</th>
                        <th className="p-2">Narration</th>
                        <th className="p-2 text-right">Debit</th>
                        <th className="p-2 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {printDoc.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="p-2 font-medium">{l.account_name}</td>
                          <td className="p-2 text-muted-foreground">{l.narration || "—"}</td>
                          <td className="p-2 text-right font-mono">{l.debit > 0 ? formatAmount(l.debit) : "—"}</td>
                          <td className="p-2 text-right font-mono">{l.credit > 0 ? formatAmount(l.credit) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pt-8 flex justify-between text-xs border-t border-border mt-6">
                <div>
                  <div className="border-t border-dotted border-border pt-1 w-32 text-center text-muted-foreground">
                    Prepared By
                  </div>
                </div>
                <div>
                  <div className="border-t border-dotted border-border pt-1 w-32 text-center text-muted-foreground">
                    Authorized Signatory
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPrintDoc(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  window.print();
                }}
              >
                <Printer className="h-4 w-4 mr-1.5" /> Print / Save PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
