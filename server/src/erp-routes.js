import { Router } from "express";
import fs from "node:fs";
import db, { DB_PATH } from "./db.js";
import { requireAuth, requireRole, hashPassword } from "./auth.js";
import {
  ACCOUNT_CODES,
  postAccountVoucher,
  requireAccountIdByCode,
  resolvePartyAccountId,
  reconcileStock,
  trialBalance,
} from "./accounting.js";
import { round2 } from "./accounting-core.js";
import { assertPostingAllowed } from "./years.js";
import { DOC_PREFIX, nextUniqueVoucherNo, accountVoucherNo } from "./vouchers.js";
import { recordAuditLog } from "./audit.js";
import { APP_NAME, APP_VERSION, BUSY_TIMEOUT_MS } from "./config.js";
import { sendRouteError } from "./http-errors.js";
import { finiteNumber } from "./validation.js";

const router = Router();

// =========================================================
// 1. CUSTOMER RECEIPTS
// =========================================================

router.get("/api/receipts", requireAuth, (req, res) => {
  try {
    const { from, to, customer_id, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT r.id, r.voucher_no, r.date, r.customer_id, c.name AS customer_name,
             r.payment_mode, r.payment_account_id, a.name AS payment_account_name,
             r.amount, r.reference_no, r.remarks, r.created_by, u.username AS created_by_user,
             r.created_at
      FROM customer_receipts r
      JOIN customers c ON c.id = r.customer_id
      JOIN accounts a ON a.id = r.payment_account_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE 1=1
    `;
    const params = [];

    if (from) {
      sql += " AND r.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND r.date <= ?";
      params.push(String(to));
    }
    if (customer_id) {
      sql += " AND r.customer_id = ?";
      params.push(Number(customer_id));
    }

    sql += " ORDER BY r.date DESC, r.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/receipts", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const customerId = Number(req.body?.customer_id || 0);
    const customer = db
      .prepare("SELECT id, name FROM customers WHERE id = ? AND is_active = 1")
      .get(customerId);
    if (!customer) return res.status(400).json({ error: "Valid customer is required" });

    const amount = finiteNumber(req.body?.amount, "Receipt amount", { min: 0.01 });
    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const paymentAccountId = Number(req.body?.payment_account_id || 0);
    const paymentAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(paymentAccountId);
    if (!paymentAccount || paymentAccount.type !== "asset") {
      return res.status(400).json({ error: "Valid asset payment account (Cash/Bank) is required" });
    }

    const paymentMode = String(req.body?.payment_mode || "cash").toLowerCase();
    const referenceNo = String(req.body?.reference_no || "").trim();
    const remarks = String(req.body?.remarks || "").trim();

    const result = db.transaction(() => {
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.receipt);
      const insert = db
        .prepare(
          `
        INSERT INTO customer_receipts (voucher_no, date, customer_id, payment_mode, payment_account_id, amount, reference_no, remarks, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          voucherNo,
          date,
          customerId,
          paymentMode,
          paymentAccountId,
          amount,
          referenceNo,
          remarks,
          req.user?.id || null,
        );

      const receiptId = Number(insert.lastInsertRowid);
      const partyAccountId = resolvePartyAccountId("customer", customerId);

      // Double-entry accounting voucher: DR Cash/Bank, CR Accounts Receivable / Customer
      const avNo = accountVoucherNo(DOC_PREFIX.receipt, voucherNo);
      postAccountVoucher({
        voucherNo: avNo,
        date,
        voucherType: "receipt",
        refType: "receipt",
        refId: receiptId,
        narration: `Customer receipt from ${customer.name} (${voucherNo})${remarks ? ` - ${remarks}` : ""}`,
        createdBy: req.user?.id || null,
        entries: [
          { account_id: paymentAccountId, debit: amount, credit: 0 },
          { account_id: partyAccountId, debit: 0, credit: amount },
        ],
      });

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "customer_receipt",
        entityId: receiptId,
        details: {
          voucher_no: voucherNo,
          amount,
          customer_id: customerId,
          customer_name: customer.name,
        },
        ipAddress: req.ip,
      });

      return { id: receiptId, voucher_no: voucherNo, amount, date };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 2. SUPPLIER PAYMENTS
// =========================================================

router.get("/api/payments", requireAuth, (req, res) => {
  try {
    const { from, to, supplier_id, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT p.id, p.voucher_no, p.date, p.supplier_id, s.name AS supplier_name,
             p.payment_mode, p.payment_account_id, a.name AS payment_account_name,
             p.amount, p.reference_no, p.remarks, p.created_by, u.username AS created_by_user,
             p.created_at
      FROM supplier_payments p
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN accounts a ON a.id = p.payment_account_id
      LEFT JOIN users u ON u.id = p.created_by
      WHERE 1=1
    `;
    const params = [];

    if (from) {
      sql += " AND p.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND p.date <= ?";
      params.push(String(to));
    }
    if (supplier_id) {
      sql += " AND p.supplier_id = ?";
      params.push(Number(supplier_id));
    }

    sql += " ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/payments", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const supplierId = Number(req.body?.supplier_id || 0);
    const supplier = db
      .prepare("SELECT id, name FROM suppliers WHERE id = ? AND is_active = 1")
      .get(supplierId);
    if (!supplier) return res.status(400).json({ error: "Valid supplier is required" });

    const amount = finiteNumber(req.body?.amount, "Payment amount", { min: 0.01 });
    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const paymentAccountId = Number(req.body?.payment_account_id || 0);
    const paymentAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(paymentAccountId);
    if (!paymentAccount || paymentAccount.type !== "asset") {
      return res.status(400).json({ error: "Valid asset payment account (Cash/Bank) is required" });
    }

    const paymentMode = String(req.body?.payment_mode || "cash").toLowerCase();
    const referenceNo = String(req.body?.reference_no || "").trim();
    const remarks = String(req.body?.remarks || "").trim();

    const result = db.transaction(() => {
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.payment);
      const insert = db
        .prepare(
          `
        INSERT INTO supplier_payments (voucher_no, date, supplier_id, payment_mode, payment_account_id, amount, reference_no, remarks, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          voucherNo,
          date,
          supplierId,
          paymentMode,
          paymentAccountId,
          amount,
          referenceNo,
          remarks,
          req.user?.id || null,
        );

      const paymentId = Number(insert.lastInsertRowid);
      const partyAccountId = resolvePartyAccountId("supplier", supplierId);

      // Double-entry accounting voucher: DR Accounts Payable / Supplier, CR Cash/Bank
      const avNo = accountVoucherNo(DOC_PREFIX.payment, voucherNo);
      postAccountVoucher({
        voucherNo: avNo,
        date,
        voucherType: "payment",
        refType: "payment",
        refId: paymentId,
        narration: `Supplier payment to ${supplier.name} (${voucherNo})${remarks ? ` - ${remarks}` : ""}`,
        createdBy: req.user?.id || null,
        entries: [
          { account_id: partyAccountId, debit: amount, credit: 0 },
          { account_id: paymentAccountId, debit: 0, credit: amount },
        ],
      });

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "supplier_payment",
        entityId: paymentId,
        details: {
          voucher_no: voucherNo,
          amount,
          supplier_id: supplierId,
          supplier_name: supplier.name,
        },
        ipAddress: req.ip,
      });

      return { id: paymentId, voucher_no: voucherNo, amount, date };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 3. EXPENSES
// =========================================================

router.get("/api/expenses", requireAuth, (req, res) => {
  try {
    const { from, to, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT e.id, e.voucher_no, e.date, e.expense_account_id, ea.name AS expense_account_name, ea.code AS expense_account_code,
             e.payment_account_id, pa.name AS payment_account_name, pa.code AS payment_account_code,
             e.amount, e.reference_no, e.remarks, e.created_by, u.username AS created_by_user,
             e.created_at
      FROM expense_vouchers e
      JOIN accounts ea ON ea.id = e.expense_account_id
      JOIN accounts pa ON pa.id = e.payment_account_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE 1=1
    `;
    const params = [];
    if (from) {
      sql += " AND e.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND e.date <= ?";
      params.push(String(to));
    }
    sql += " ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/expenses", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const expenseAccountId = Number(req.body?.expense_account_id || 0);
    const expenseAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(expenseAccountId);
    if (!expenseAccount || expenseAccount.type !== "expense") {
      return res.status(400).json({ error: "Valid expense account is required" });
    }

    const paymentAccountId = Number(req.body?.payment_account_id || 0);
    const paymentAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(paymentAccountId);
    if (!paymentAccount || paymentAccount.type !== "asset") {
      return res.status(400).json({ error: "Valid payment account (Cash/Bank) is required" });
    }

    const amount = finiteNumber(req.body?.amount, "Expense amount", { min: 0.01 });
    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const referenceNo = String(req.body?.reference_no || "").trim();
    const remarks = String(req.body?.remarks || "").trim();

    const result = db.transaction(() => {
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.expense);
      const insert = db
        .prepare(
          `
        INSERT INTO expense_vouchers (voucher_no, date, expense_account_id, payment_account_id, amount, reference_no, remarks, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          voucherNo,
          date,
          expenseAccountId,
          paymentAccountId,
          amount,
          referenceNo,
          remarks,
          req.user?.id || null,
        );

      const expenseId = Number(insert.lastInsertRowid);
      const avNo = accountVoucherNo(DOC_PREFIX.expense, voucherNo);

      postAccountVoucher({
        voucherNo: avNo,
        date,
        voucherType: "expense",
        refType: "expense",
        refId: expenseId,
        narration: `Expense: ${expenseAccount.name} (${voucherNo})${remarks ? ` - ${remarks}` : ""}`,
        createdBy: req.user?.id || null,
        entries: [
          { account_id: expenseAccountId, debit: amount, credit: 0 },
          { account_id: paymentAccountId, debit: 0, credit: amount },
        ],
      });

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "expense_voucher",
        entityId: expenseId,
        details: { voucher_no: voucherNo, amount, expense_account: expenseAccount.name },
        ipAddress: req.ip,
      });

      return { id: expenseId, voucher_no: voucherNo, amount, date };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 4. INCOME
// =========================================================

router.get("/api/income", requireAuth, (req, res) => {
  try {
    const { from, to, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT inc.id, inc.voucher_no, inc.date, inc.income_account_id, ia.name AS income_account_name, ia.code AS income_account_code,
             inc.payment_account_id, pa.name AS payment_account_name, pa.code AS payment_account_code,
             inc.amount, inc.reference_no, inc.remarks, inc.created_by, u.username AS created_by_user,
             inc.created_at
      FROM income_vouchers inc
      JOIN accounts ia ON ia.id = inc.income_account_id
      JOIN accounts pa ON pa.id = inc.payment_account_id
      LEFT JOIN users u ON u.id = inc.created_by
      WHERE 1=1
    `;
    const params = [];
    if (from) {
      sql += " AND inc.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND inc.date <= ?";
      params.push(String(to));
    }
    sql += " ORDER BY inc.date DESC, inc.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/income", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const incomeAccountId = Number(req.body?.income_account_id || 0);
    const incomeAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(incomeAccountId);
    if (!incomeAccount || incomeAccount.type !== "income") {
      return res.status(400).json({ error: "Valid income account is required" });
    }

    const paymentAccountId = Number(req.body?.payment_account_id || 0);
    const paymentAccount = db
      .prepare("SELECT id, name, type FROM accounts WHERE id = ? AND is_active = 1")
      .get(paymentAccountId);
    if (!paymentAccount || paymentAccount.type !== "asset") {
      return res.status(400).json({ error: "Valid payment account (Cash/Bank) is required" });
    }

    const amount = finiteNumber(req.body?.amount, "Income amount", { min: 0.01 });
    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const referenceNo = String(req.body?.reference_no || "").trim();
    const remarks = String(req.body?.remarks || "").trim();

    const result = db.transaction(() => {
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.income);
      const insert = db
        .prepare(
          `
        INSERT INTO income_vouchers (voucher_no, date, income_account_id, payment_account_id, amount, reference_no, remarks, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          voucherNo,
          date,
          incomeAccountId,
          paymentAccountId,
          amount,
          referenceNo,
          remarks,
          req.user?.id || null,
        );

      const incomeId = Number(insert.lastInsertRowid);
      const avNo = accountVoucherNo(DOC_PREFIX.income, voucherNo);

      postAccountVoucher({
        voucherNo: avNo,
        date,
        voucherType: "income",
        refType: "income",
        refId: incomeId,
        narration: `Income: ${incomeAccount.name} (${voucherNo})${remarks ? ` - ${remarks}` : ""}`,
        createdBy: req.user?.id || null,
        entries: [
          { account_id: paymentAccountId, debit: amount, credit: 0 },
          { account_id: incomeAccountId, debit: 0, credit: amount },
        ],
      });

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "income_voucher",
        entityId: incomeId,
        details: { voucher_no: voucherNo, amount, income_account: incomeAccount.name },
        ipAddress: req.ip,
      });

      return { id: incomeId, voucher_no: voucherNo, amount, date };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 5. MANUAL JOURNAL VOUCHERS
// =========================================================

router.get("/api/journals", requireAuth, (req, res) => {
  try {
    const { from, to, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT j.id, j.voucher_no, j.date, j.reference_no, j.remarks, j.total_amount, j.created_by,
             u.username AS created_by_user, j.created_at
      FROM journal_vouchers j
      LEFT JOIN users u ON u.id = j.created_by
      WHERE 1=1
    `;
    const params = [];
    if (from) {
      sql += " AND j.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND j.date <= ?";
      params.push(String(to));
    }
    sql += " ORDER BY j.date DESC, j.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);

    const getLines = db.prepare(`
      SELECT jl.id, jl.account_id, a.code AS account_code, a.name AS account_name,
             jl.debit, jl.credit, jl.narration
      FROM journal_voucher_lines jl
      JOIN accounts a ON a.id = jl.account_id
      WHERE jl.voucher_id = ?
      ORDER BY jl.id ASC
    `);

    const result = rows.map((r) => ({
      ...r,
      lines: getLines.all(r.id),
    }));

    res.json(result);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/journals", requireAuth, requireRole("admin", "accountant"), (req, res) => {
  try {
    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (lines.length < 2) {
      return res.status(400).json({ error: "Journal voucher requires at least two lines" });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const validatedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const accountId = Number(line.account_id || 0);
      const account = db
        .prepare("SELECT id, name FROM accounts WHERE id = ? AND is_active = 1")
        .get(accountId);
      if (!account) {
        return res.status(400).json({ error: `Line ${i + 1}: Account not found or inactive` });
      }

      const debit = round2(finiteNumber(line.debit || 0, `Line ${i + 1} debit`, { min: 0 }));
      const credit = round2(finiteNumber(line.credit || 0, `Line ${i + 1} credit`, { min: 0 }));

      if (debit > 0 && credit > 0) {
        return res
          .status(400)
          .json({ error: `Line ${i + 1}: Line cannot have both debit and credit` });
      }
      if (debit === 0 && credit === 0) {
        return res
          .status(400)
          .json({ error: `Line ${i + 1}: Line must have either debit or credit` });
      }

      totalDebit += debit;
      totalCredit += credit;
      validatedLines.push({
        account_id: accountId,
        debit,
        credit,
        narration: String(line.narration || "").trim(),
      });
    }

    totalDebit = round2(totalDebit);
    totalCredit = round2(totalCredit);

    if (totalDebit <= 0 || totalCredit <= 0) {
      return res
        .status(400)
        .json({ error: "Journal voucher must have non-zero debits and credits" });
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        error: `Journal voucher is not balanced: Total Debit (${totalDebit}) != Total Credit (${totalCredit})`,
      });
    }

    const referenceNo = String(req.body?.reference_no || "").trim();
    const remarks = String(req.body?.remarks || "").trim();

    const result = db.transaction(() => {
      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.journal);
      const insert = db
        .prepare(
          `
        INSERT INTO journal_vouchers (voucher_no, date, reference_no, remarks, total_amount, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(voucherNo, date, referenceNo, remarks, totalDebit, req.user?.id || null);

      const journalId = Number(insert.lastInsertRowid);
      const insertLine = db.prepare(`
        INSERT INTO journal_voucher_lines (voucher_id, account_id, debit, credit, narration)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const line of validatedLines) {
        insertLine.run(journalId, line.account_id, line.debit, line.credit, line.narration);
      }

      const avNo = accountVoucherNo(DOC_PREFIX.journal, voucherNo);
      postAccountVoucher({
        voucherNo: avNo,
        date,
        voucherType: "journal",
        refType: "journal",
        refId: journalId,
        narration: `Journal Voucher ${voucherNo}${remarks ? ` - ${remarks}` : ""}`,
        createdBy: req.user?.id || null,
        entries: validatedLines,
      });

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "journal_voucher",
        entityId: journalId,
        details: {
          voucher_no: voucherNo,
          total_amount: totalDebit,
          lines_count: validatedLines.length,
        },
        ipAddress: req.ip,
      });

      return { id: journalId, voucher_no: voucherNo, total_amount: totalDebit, date };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 6. STOCK ADJUSTMENTS
// =========================================================

router.get("/api/stock/adjustments", requireAuth, (req, res) => {
  try {
    const { from, to, item_type, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT sa.id, sa.voucher_no, sa.date, sa.item_type,
             sa.factory_item_id, fi.name AS factory_item_name, fi.unit AS factory_item_unit,
             sa.particular_id, ip.type AS particular_type, ip.weight_unit AS particular_unit,
             i.name AS item_name,
             sa.previous_qty, sa.adjustment_qty, sa.resulting_qty, sa.reason,
             sa.user_id, u.username, sa.created_at
      FROM stock_adjustments sa
      LEFT JOIN factory_items fi ON fi.id = sa.factory_item_id
      LEFT JOIN item_particulars ip ON ip.id = sa.particular_id
      LEFT JOIN items i ON i.id = ip.item_id
      LEFT JOIN users u ON u.id = sa.user_id
      WHERE 1=1
    `;
    const params = [];
    if (from) {
      sql += " AND sa.date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND sa.date <= ?";
      params.push(String(to));
    }
    if (item_type) {
      sql += " AND sa.item_type = ?";
      params.push(String(item_type));
    }
    sql += " ORDER BY sa.date DESC, sa.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post(
  "/api/stock/adjustments",
  requireAuth,
  requireRole("admin", "accountant"),
  (req, res) => {
    try {
      const itemType = String(req.body?.item_type || "").toLowerCase();
      if (itemType !== "raw" && itemType !== "finished") {
        return res.status(400).json({ error: "item_type must be either 'raw' or 'finished'" });
      }

      const date = String(req.body?.date || "").trim();
      if (!date) return res.status(400).json({ error: "Date is required" });
      assertPostingAllowed(date);

      const adjustmentQty = round2(Number(req.body?.adjustment_qty || 0));
      if (!Number.isFinite(adjustmentQty) || adjustmentQty === 0) {
        return res.status(400).json({ error: "adjustment_qty must be a non-zero number" });
      }

      const reason = String(req.body?.reason || "").trim();
      if (!reason)
        return res.status(400).json({ error: "Reason is required for stock adjustment" });

      const result = db.transaction(() => {
        let previousQty = 0;
        let factoryItemId = null;
        let particularId = null;
        let itemName = "";
        let rate = 0;

        if (itemType === "raw") {
          factoryItemId = Number(req.body?.factory_item_id || 0);
          const item = db
            .prepare(
              "SELECT id, name, stock_qty, rate FROM factory_items WHERE id = ? AND is_active = 1",
            )
            .get(factoryItemId);
          if (!item) throw new Error("Raw material item not found or inactive");
          previousQty = round2(Number(item.stock_qty || 0));
          itemName = item.name;
          rate = Number(item.rate || 0);
        } else {
          particularId = Number(req.body?.particular_id || 0);
          const part = db
            .prepare(
              `
          SELECT ip.id, ip.stock_qty, ip.cost_price, i.name
          FROM item_particulars ip
          JOIN items i ON i.id = ip.item_id
          WHERE ip.id = ? AND i.is_active = 1
        `,
            )
            .get(particularId);
          if (!part) throw new Error("Finished goods item not found or inactive");
          previousQty = round2(Number(part.stock_qty || 0));
          itemName = part.name;
          rate = Number(part.cost_price || 0);
        }

        const resultingQty = round2(previousQty + adjustmentQty);
        if (resultingQty < 0) {
          throw new Error(
            `Adjustment would drive stock negative: Previous ${previousQty} + Adjustment ${adjustmentQty} = ${resultingQty} < 0`,
          );
        }

        const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.adjustment);

        // Update current stock
        if (itemType === "raw") {
          db.prepare("UPDATE factory_items SET stock_qty = ? WHERE id = ?").run(
            resultingQty,
            factoryItemId,
          );
        } else {
          db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(
            resultingQty,
            particularId,
          );
        }

        // Insert adjustment record
        const insert = db
          .prepare(
            `
        INSERT INTO stock_adjustments (voucher_no, date, item_type, factory_item_id, particular_id, previous_qty, adjustment_qty, resulting_qty, reason, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
          )
          .run(
            voucherNo,
            date,
            itemType,
            factoryItemId,
            particularId,
            previousQty,
            adjustmentQty,
            resultingQty,
            reason,
            req.user?.id || null,
          );

        const adjId = Number(insert.lastInsertRowid);

        // Insert stock ledger movement
        const qtyIn = adjustmentQty > 0 ? adjustmentQty : 0;
        const qtyOut = adjustmentQty < 0 ? Math.abs(adjustmentQty) : 0;

        db.prepare(
          `
        INSERT INTO stock_ledger (date, stock_type, particular_id, factory_item_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at)
        VALUES (?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        ).run(
          date,
          itemType,
          particularId,
          factoryItemId,
          adjId,
          voucherNo,
          qtyIn,
          qtyOut,
          rate,
          resultingQty,
          reason,
        );

        recordAuditLog(db, {
          userId: req.user?.id,
          username: req.user?.username,
          action: "CREATE",
          entity: "stock_adjustment",
          entityId: adjId,
          details: {
            voucher_no: voucherNo,
            item_type: itemType,
            item_name: itemName,
            previous_qty: previousQty,
            adjustment_qty: adjustmentQty,
            resulting_qty: resultingQty,
            reason,
          },
          ipAddress: req.ip,
        });

        return {
          id: adjId,
          voucher_no: voucherNo,
          previous_qty: previousQty,
          adjustment_qty: adjustmentQty,
          resulting_qty: resultingQty,
        };
      })();

      res.status(201).json(result);
    } catch (err) {
      sendRouteError(res, err, 400, "Request failed");
    }
  },
);

// =========================================================
// 7. OPENING STOCK
// =========================================================

router.get("/api/stock/opening", requireAuth, (req, res) => {
  try {
    const { item_type, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT os.id, os.voucher_no, os.date, os.item_type,
             os.factory_item_id, fi.name AS factory_item_name, fi.unit AS factory_item_unit,
             os.particular_id, ip.type AS particular_type, ip.weight_unit AS particular_unit,
             i.name AS item_name,
             os.qty, os.unit_cost, os.total_value, os.remarks, os.user_id, u.username, os.created_at
      FROM opening_stocks os
      LEFT JOIN factory_items fi ON fi.id = os.factory_item_id
      LEFT JOIN item_particulars ip ON ip.id = os.particular_id
      LEFT JOIN items i ON i.id = ip.item_id
      LEFT JOIN users u ON u.id = os.user_id
      WHERE 1=1
    `;
    const params = [];
    if (item_type) {
      sql += " AND os.item_type = ?";
      params.push(String(item_type));
    }
    sql += " ORDER BY os.date DESC, os.id DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/stock/opening", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const itemType = String(req.body?.item_type || "").toLowerCase();
    if (itemType !== "raw" && itemType !== "finished") {
      return res.status(400).json({ error: "item_type must be either 'raw' or 'finished'" });
    }

    const date = String(req.body?.date || "").trim();
    if (!date) return res.status(400).json({ error: "Date is required" });
    assertPostingAllowed(date);

    const qty = finiteNumber(req.body?.qty, "Opening quantity", { min: 0.01 });
    const unitCost = finiteNumber(req.body?.unit_cost || 0, "Unit cost", { min: 0 });
    const totalValue = round2(qty * unitCost);
    const remarks = String(req.body?.remarks || "Opening Stock").trim();

    const result = db.transaction(() => {
      let factoryItemId = null;
      let particularId = null;
      let itemName = "";
      let newBalance = 0;

      if (itemType === "raw") {
        factoryItemId = Number(req.body?.factory_item_id || 0);
        const item = db
          .prepare("SELECT id, name, stock_qty FROM factory_items WHERE id = ? AND is_active = 1")
          .get(factoryItemId);
        if (!item) throw new Error("Raw material item not found or inactive");
        itemName = item.name;
        newBalance = round2(Number(item.stock_qty || 0) + qty);
        db.prepare("UPDATE factory_items SET stock_qty = ? WHERE id = ?").run(
          newBalance,
          factoryItemId,
        );
      } else {
        particularId = Number(req.body?.particular_id || 0);
        const part = db
          .prepare(
            `
          SELECT ip.id, ip.stock_qty, i.name
          FROM item_particulars ip
          JOIN items i ON i.id = ip.item_id
          WHERE ip.id = ? AND i.is_active = 1
        `,
          )
          .get(particularId);
        if (!part) throw new Error("Finished goods item not found or inactive");
        itemName = part.name;
        newBalance = round2(Number(part.stock_qty || 0) + qty);
        db.prepare("UPDATE item_particulars SET stock_qty = ? WHERE id = ?").run(
          newBalance,
          particularId,
        );
      }

      const voucherNo = nextUniqueVoucherNo(DOC_PREFIX.opening);

      const insert = db
        .prepare(
          `
        INSERT INTO opening_stocks (voucher_no, date, item_type, factory_item_id, particular_id, qty, unit_cost, total_value, user_id, remarks, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          voucherNo,
          date,
          itemType,
          factoryItemId,
          particularId,
          qty,
          unitCost,
          totalValue,
          req.user?.id || null,
          remarks,
        );

      const opnId = Number(insert.lastInsertRowid);

      db.prepare(
        `
        INSERT INTO stock_ledger (date, stock_type, particular_id, factory_item_id, ref_type, ref_id, ref_no, qty_in, qty_out, rate, balance_after, remarks, created_at)
        VALUES (?, ?, ?, ?, 'opening', ?, ?, ?, 0, ?, ?, ?, datetime('now'))
      `,
      ).run(
        date,
        itemType,
        particularId,
        factoryItemId,
        opnId,
        voucherNo,
        qty,
        unitCost,
        newBalance,
        remarks,
      );

      recordAuditLog(db, {
        userId: req.user?.id,
        username: req.user?.username,
        action: "CREATE",
        entity: "opening_stock",
        entityId: opnId,
        details: {
          voucher_no: voucherNo,
          item_type: itemType,
          item_name: itemName,
          qty,
          unit_cost: unitCost,
          total_value: totalValue,
        },
        ipAddress: req.ip,
      });

      return {
        id: opnId,
        voucher_no: voucherNo,
        qty,
        total_value: totalValue,
        new_balance: newBalance,
      };
    })();

    res.status(201).json(result);
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 8. USER MANAGEMENT
// =========================================================

router.get("/api/users", requireAuth, requireRole("admin"), (_req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, username, full_name, role, is_active, created_at FROM users ORDER BY id ASC",
      )
      .all();
    res.json(rows);
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.post("/api/users", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const username = String(req.body?.username || "")
      .trim()
      .toLowerCase();
    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }
    if (!/^[a-z0-9_.-]+$/.test(username)) {
      return res.status(400).json({ error: "Username contains invalid characters" });
    }

    const password = String(req.body?.password || "");
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const role = String(req.body?.role || "user").toLowerCase();
    if (role !== "admin" && role !== "accountant" && role !== "user") {
      return res.status(400).json({ error: "Role must be 'admin', 'accountant' or 'user'" });
    }

    const fullName = String(req.body?.full_name || "").trim();

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(400).json({ error: `Username '${username}' already exists` });
    }

    const { hash, salt } = hashPassword(password);
    const insert = db
      .prepare(
        `
      INSERT INTO users (username, password_hash, password_salt, full_name, role, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    `,
      )
      .run(username, hash, salt, fullName, role);

    const userId = Number(insert.lastInsertRowid);
    recordAuditLog(db, {
      userId: req.user?.id,
      username: req.user?.username,
      action: "CREATE",
      entity: "user",
      entityId: userId,
      details: { username, role, full_name: fullName },
      ipAddress: req.ip,
    });

    res.status(201).json({ id: userId, username, full_name: fullName, role, is_active: 1 });
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

router.put("/api/users/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const targetUser = db
      .prepare("SELECT id, username, role, is_active FROM users WHERE id = ?")
      .get(targetId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const newRole = req.body?.role ? String(req.body.role).toLowerCase() : targetUser.role;
    if (newRole !== "admin" && newRole !== "accountant" && newRole !== "user") {
      return res.status(400).json({ error: "Role must be 'admin', 'accountant' or 'user'" });
    }

    const isActive =
      req.body?.is_active !== undefined
        ? Number(req.body.is_active)
          ? 1
          : 0
        : targetUser.is_active;

    // Safety guard: ensure at least one active admin always remains
    if (targetUser.role === "admin" && targetUser.is_active === 1) {
      if (isActive === 0 || newRole !== "admin") {
        const activeAdmins = db
          .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1")
          .get().c;
        if (activeAdmins <= 1) {
          return res
            .status(400)
            .json({ error: "Cannot deactivate or demote the last active administrator" });
        }
      }
    }

    const fullName = req.body?.full_name !== undefined ? String(req.body.full_name).trim() : null;

    db.prepare(
      `
      UPDATE users
      SET role = ?, is_active = ?, full_name = COALESCE(?, full_name)
      WHERE id = ?
    `,
    ).run(newRole, isActive, fullName, targetId);

    recordAuditLog(db, {
      userId: req.user?.id,
      username: req.user?.username,
      action: "UPDATE",
      entity: "user",
      entityId: targetId,
      details: { role: newRole, is_active: isActive, full_name: fullName },
      ipAddress: req.ip,
    });

    res.json({
      id: targetId,
      username: targetUser.username,
      full_name: fullName,
      role: newRole,
      is_active: isActive,
    });
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

router.post("/api/users/:id/reset-password", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const targetUser = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId);
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const newPassword = String(req.body?.new_password || "");
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const { hash, salt } = hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(
      hash,
      salt,
      targetId,
    );

    // Invalidate target user's active sessions
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(targetId, req.token);

    recordAuditLog(db, {
      userId: req.user?.id,
      username: req.user?.username,
      action: "RESET_PASSWORD",
      entity: "user",
      entityId: targetId,
      details: { username: targetUser.username },
      ipAddress: req.ip,
    });

    res.json({ ok: true, message: `Password reset successfully for user ${targetUser.username}` });
  } catch (err) {
    sendRouteError(res, err, 400, "Request failed");
  }
});

// =========================================================
// 9. AUDIT LOGS
// =========================================================

router.get("/api/audit-logs", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { entity, action, limit = 50, offset = 0 } = req.query;
    let sql = "SELECT * FROM audit_log WHERE 1=1";
    const params = [];
    if (entity) {
      sql += " AND entity = ?";
      params.push(String(entity));
    }
    if (action) {
      sql += " AND action = ?";
      params.push(String(action));
    }
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
    params.push(Math.min(Number(limit), 200), Number(offset));

    const rows = db.prepare(sql).all(...params);
    const countSql = "SELECT COUNT(*) AS total FROM audit_log";
    const total = db.prepare(countSql).get().total;

    res.json({ total, rows });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

// =========================================================
// 10. DIAGNOSTICS & SYSTEM STATUS
// =========================================================

router.get("/api/diagnostics", requireAuth, requireRole("admin"), (_req, res) => {
  try {
    let dbSize = 0;
    try {
      dbSize = fs.statSync(DB_PATH).size;
      const walPath = `${DB_PATH}-wal`;
      if (fs.existsSync(walPath)) dbSize += fs.statSync(walPath).size;
    } catch {
      // Ignore stat error
    }

    const journalMode = db.pragma("journal_mode", { simple: true });
    const userVersion = db.pragma("user_version", { simple: true });
    const integrityCheck = db.pragma("integrity_check", { simple: true });
    const fkViolations = db.pragma("foreign_key_check").length;

    const recon = reconcileStock(db);
    const tb = trialBalance(db);

    const backupCount = db.prepare("SELECT COUNT(*) AS c FROM backups").get().c;
    const latestBackup = db.prepare("SELECT * FROM backups ORDER BY id DESC LIMIT 1").get();

    res.json({
      app_name: APP_NAME,
      app_version: APP_VERSION,
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      platform: process.platform,
      database: {
        path: DB_PATH,
        size_bytes: dbSize,
        journal_mode: journalMode,
        busy_timeout_ms: BUSY_TIMEOUT_MS,
        user_version: userVersion,
        integrity_check: integrityCheck,
        foreign_key_violations: fkViolations,
      },
      stock_reconciliation: {
        ok: recon.ok,
        issues_count: recon.issues.length,
        checked: recon.checked,
      },
      accounting: {
        trial_balance_balanced: tb.balanced,
        total_debit: tb.total_debit,
        total_credit: tb.total_credit,
      },
      backups: {
        count: backupCount,
        latest: latestBackup || null,
      },
    });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

// =========================================================
// 11. FINANCIAL REPORTS (P&L, BALANCE SHEET, STOCK VALUATION, STATEMENTS)
// =========================================================

router.get("/api/reports/profit-and-loss", requireAuth, (req, res) => {
  try {
    const { from, to } = req.query;
    let dateFilter = "";
    const params = [];
    if (from) {
      dateFilter += " AND al.date >= ?";
      params.push(String(from));
    }
    if (to) {
      dateFilter += " AND al.date <= ?";
      params.push(String(to));
    }

    // Revenue accounts (Sales 4000, etc.)
    const salesRow = db
      .prepare(
        `
      SELECT COALESCE(SUM(al.credit - al.debit), 0) AS total
      FROM account_ledger al
      JOIN accounts a ON a.id = al.account_id
      WHERE a.code = '4000' ${dateFilter}
    `,
      )
      .get(...params);
    const grossSales = round2(Number(salesRow.total || 0));

    // Sales Returns (4100)
    const returnsRow = db
      .prepare(
        `
      SELECT COALESCE(SUM(al.debit - al.credit), 0) AS total
      FROM account_ledger al
      JOIN accounts a ON a.id = al.account_id
      WHERE a.code = '4100' ${dateFilter}
    `,
      )
      .get(...params);
    const salesReturns = round2(Number(returnsRow.total || 0));

    const netRevenue = round2(grossSales - salesReturns);

    // COGS (5300)
    const cogsRow = db
      .prepare(
        `
      SELECT COALESCE(SUM(al.debit - al.credit), 0) AS total
      FROM account_ledger al
      JOIN accounts a ON a.id = al.account_id
      WHERE a.code = '5300' ${dateFilter}
    `,
      )
      .get(...params);
    const cogs = round2(Number(cogsRow.total || 0));

    const grossProfit = round2(netRevenue - cogs);

    // Operating Expenses (type = 'expense', code != '5300')
    const expenseRows = db
      .prepare(
        `
      SELECT a.id, a.code, a.name, COALESCE(SUM(al.debit - al.credit), 0) AS amount
      FROM account_ledger al
      JOIN accounts a ON a.id = al.account_id
      WHERE a.type = 'expense' AND a.code != '5300' ${dateFilter}
      GROUP BY a.id
      HAVING amount != 0
      ORDER BY a.code ASC
    `,
      )
      .all(...params);

    let totalExpenses = 0;
    const expenses = expenseRows.map((e) => {
      const amt = round2(Number(e.amount));
      totalExpenses += amt;
      return { id: e.id, code: e.code, name: e.name, amount: amt };
    });
    totalExpenses = round2(totalExpenses);

    const netProfit = round2(grossProfit - totalExpenses);

    res.json({
      from: from || null,
      to: to || null,
      revenue: {
        gross_sales: grossSales,
        sales_returns: salesReturns,
        net_revenue: netRevenue,
      },
      cost_of_goods_sold: cogs,
      gross_profit: grossProfit,
      expenses: {
        breakdown: expenses,
        total_expenses: totalExpenses,
      },
      net_profit: netProfit,
    });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.get("/api/reports/balance-sheet", requireAuth, (req, res) => {
  try {
    const { to } = req.query;
    let dateFilter = "";
    const params = [];
    if (to) {
      dateFilter = " AND al.date <= ?";
      params.push(String(to));
    }

    const rows = db
      .prepare(
        `
      SELECT a.id, a.code, a.name, a.type, a.opening_balance,
             COALESCE(SUM(al.debit), 0) AS debit,
             COALESCE(SUM(al.credit), 0) AS credit
      FROM accounts a
      LEFT JOIN account_ledger al ON al.account_id = a.id ${dateFilter}
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY a.code ASC
    `,
      )
      .all(...params);

    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    let netProfitAccumulated = 0;

    for (const row of rows) {
      const opening = Number(row.opening_balance || 0);
      const debit = Number(row.debit);
      const credit = Number(row.credit);

      if (row.type === "asset") {
        const bal = round2(opening + debit - credit);
        if (bal !== 0) {
          assets.push({ id: row.id, code: row.code, name: row.name, balance: bal });
          totalAssets += bal;
        }
      } else if (row.type === "liability") {
        const bal = round2(opening + credit - debit);
        if (bal !== 0) {
          liabilities.push({ id: row.id, code: row.code, name: row.name, balance: bal });
          totalLiabilities += bal;
        }
      } else if (row.type === "equity") {
        const bal = round2(opening + credit - debit);
        if (bal !== 0) {
          equity.push({ id: row.id, code: row.code, name: row.name, balance: bal });
          totalEquity += bal;
        }
      } else if (row.type === "income") {
        netProfitAccumulated += credit - debit;
      } else if (row.type === "expense") {
        netProfitAccumulated -= debit - credit;
      }
    }

    totalAssets = round2(totalAssets);
    totalLiabilities = round2(totalLiabilities);
    netProfitAccumulated = round2(netProfitAccumulated);
    const finalEquity = round2(totalEquity + netProfitAccumulated);

    res.json({
      as_of_date: to || new Date().toISOString().split("T")[0],
      assets: { items: assets, total: totalAssets },
      liabilities: { items: liabilities, total: totalLiabilities },
      equity: {
        items: equity,
        current_net_profit: netProfitAccumulated,
        total_equity: finalEquity,
      },
      total_liabilities_and_equity: round2(totalLiabilities + finalEquity),
      balanced: Math.abs(totalAssets - round2(totalLiabilities + finalEquity)) <= 0.01,
    });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.get("/api/reports/stock-valuation", requireAuth, (_req, res) => {
  try {
    const rawItems = db
      .prepare(
        `
      SELECT id, code, name, unit, rate, stock_qty,
             ROUND(stock_qty * rate, 2) AS total_value
      FROM factory_items
      WHERE is_active = 1
      ORDER BY name ASC
    `,
      )
      .all();

    const finishedItems = db
      .prepare(
        `
      SELECT ip.id, ip.item_id, i.code AS item_code, i.name AS item_name, ip.type, ip.weight_unit,
             ip.cost_price, ip.sale_price, ip.stock_qty,
             ROUND(ip.stock_qty * ip.cost_price, 2) AS cost_value,
             ROUND(ip.stock_qty * ip.sale_price, 2) AS retail_value
      FROM item_particulars ip
      JOIN items i ON i.id = ip.item_id
      WHERE i.is_active = 1
      ORDER BY i.name ASC, ip.type ASC
    `,
      )
      .all();

    const rawTotalValue = round2(
      rawItems.reduce((acc, r) => acc + (Number(r.total_value) || 0), 0),
    );
    const finishedTotalCostValue = round2(
      finishedItems.reduce((acc, r) => acc + (Number(r.cost_value) || 0), 0),
    );
    const finishedTotalRetailValue = round2(
      finishedItems.reduce((acc, r) => acc + (Number(r.retail_value) || 0), 0),
    );

    res.json({
      raw_materials: {
        items: rawItems,
        total_value: rawTotalValue,
        count: rawItems.length,
      },
      finished_goods: {
        items: finishedItems,
        total_cost_value: finishedTotalCostValue,
        total_retail_value: finishedTotalRetailValue,
        count: finishedItems.length,
      },
      total_inventory_cost_value: round2(rawTotalValue + finishedTotalCostValue),
    });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

router.get("/api/reports/statements", requireAuth, (req, res) => {
  try {
    const partyType = String(req.query?.party_type || "customer").toLowerCase();
    const partyId = Number(req.query?.party_id || 0);
    const from = req.query?.from ? String(req.query.from) : null;
    const to = req.query?.to ? String(req.query.to) : null;

    if (!partyId) return res.status(400).json({ error: "party_id is required" });

    let party = null;
    if (partyType === "customer") {
      party = db
        .prepare("SELECT id, name, phone, address, opening_balance FROM customers WHERE id = ?")
        .get(partyId);
    } else {
      party = db
        .prepare("SELECT id, name, phone, address, opening_balance FROM suppliers WHERE id = ?")
        .get(partyId);
    }
    if (!party) return res.status(404).json({ error: `${partyType} not found` });

    const openingBalance = Number(party.opening_balance || 0);

    // Retrieve ledger entries from account_ledger if mapped, else combine business documents
    const accountId = resolvePartyAccountId(partyType, partyId);
    const ledgerRows = db
      .prepare(
        `
      SELECT al.id, al.date, al.debit, al.credit, al.narration,
             av.voucher_no, av.voucher_type, av.ref_type, av.ref_id
      FROM account_ledger al
      JOIN account_vouchers av ON av.id = al.voucher_id
      WHERE al.account_id = ?
        ${from ? "AND al.date >= ?" : ""}
        ${to ? "AND al.date <= ?" : ""}
      ORDER BY al.date ASC, al.id ASC
    `,
      )
      .all(...[accountId, ...(from ? [from] : []), ...(to ? [to] : [])]);

    let runningBalance = openingBalance;
    const isCustomer = partyType === "customer";

    const lines = ledgerRows.map((r) => {
      const debit = Number(r.debit || 0);
      const credit = Number(r.credit || 0);
      // For customer (Asset / Receivable): debit increases balance, credit decreases balance
      // For supplier (Liability / Payable): credit increases balance, debit decreases balance
      if (isCustomer) {
        runningBalance = round2(runningBalance + debit - credit);
      } else {
        runningBalance = round2(runningBalance + credit - debit);
      }
      return {
        id: r.id,
        date: r.date,
        voucher_no: r.voucher_no,
        voucher_type: r.voucher_type,
        ref_type: r.ref_type,
        ref_id: r.ref_id,
        narration: r.narration,
        debit,
        credit,
        balance: runningBalance,
      };
    });

    res.json({
      party: {
        id: party.id,
        name: party.name,
        type: partyType,
        opening_balance: openingBalance,
      },
      from,
      to,
      opening_balance: openingBalance,
      closing_balance: runningBalance,
      lines,
    });
  } catch (err) {
    sendRouteError(res, err, 500, "Request failed");
  }
});

export default router;
