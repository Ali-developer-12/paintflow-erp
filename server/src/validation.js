const NON_NEGATIVE_NUMERIC_FIELDS = new Set([
  "account_id",
  "amount",
  "batch_quantity",
  "batch_size",
  "batches",
  "cost_price",
  "cost_value",
  "credit",
  "credit_limit",
  "customer_id",
  "debit",
  "discount",
  "employee_id",
  "expense_account_id",
  "factory_item_id",
  "freight",
  "income_account_id",
  "item_id",
  "max_qty",
  "min_qty",
  "net_total",
  "opening_stock",
  "paid_amount",
  "parent_id",
  "particular_id",
  "payment_account_id",
  "produced_qty",
  "qty",
  "quantity",
  "rate",
  "sale_price",
  "salary",
  "sort_order",
  "stock",
  "stock_qty",
  "sub_total",
  "supplier_id",
  "tax",
  "total_amount",
  "total_cost",
  "unit_cost",
  "value",
  "ws_price",
]);

const SIGNED_NUMERIC_FIELDS = new Set(["adjustment_qty", "opening_balance"]);
const NUMERIC_FIELD_PATTERN =
  /(?:^id$|_id$|(?:^|_)(?:qty|quantity|amount|total|price|rate|cost|value|stock|debit|credit|discount|freight|tax|salary|batch|batches|limit|offset|balance|sort_order)(?:$|_))/i;

export function finiteNumber(value, fieldName, options = {}) {
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = options;
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  if (number < min || number > max) {
    throw new Error(`${fieldName} is out of range`);
  }
  return number;
}

export function validateNumericPayload(value) {
  if (Array.isArray(value)) {
    for (const entry of value) validateNumericPayload(entry);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [field, fieldValue] of Object.entries(value)) {
    if (SIGNED_NUMERIC_FIELDS.has(field)) {
      finiteNumber(fieldValue, field.replaceAll("_", " "));
    } else if (
      NON_NEGATIVE_NUMERIC_FIELDS.has(field) ||
      typeof fieldValue === "number" ||
      NUMERIC_FIELD_PATTERN.test(field)
    ) {
      finiteNumber(fieldValue, field.replaceAll("_", " "), { min: 0 });
    }
    if (fieldValue && typeof fieldValue === "object") validateNumericPayload(fieldValue);
  }
}
