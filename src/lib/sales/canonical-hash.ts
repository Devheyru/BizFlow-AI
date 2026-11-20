import { createHash } from "crypto";
import type { ExecuteSaleInput } from "@/lib/validations/sales";

export interface CanonicalItemInput {
  productId: string;
  quantity: number | string;
  lineDiscountAmount?: number | string;
  expectedVersion?: number | null;
}

export interface CanonicalPaymentInput {
  paymentMethod: string;
  amount: number | string;
  amountTendered?: number | string | null;
  changeDue?: number | string | null;
  referenceNo?: string | null;
}

/**
 * Formats a numeric quantity or financial amount into the canonical NUMERIC(14,4) string
 * matching PostgreSQL `to_char(amount, 'FM9999999990.0000')`.
 * - Handles negative values cleanly (e.g. -5 -> "-5.0000")
 * - Strictly avoids negative zero ("-0.0000" -> "0.0000")
 * - Strictly fixes 4 decimal places
 */
export function formatCanonicalAmount(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid numeric amount for canonical payload: ${amount}`);
  }
  if (Object.is(num, -0) || num === 0) {
    return "0.0000";
  }
  return num.toFixed(4);
}

/**
 * Normalizes payment reference numbers:
 * - Empty string or whitespace-only is converted to null
 * - Non-empty string is trimmed
 */
export function normalizeReferenceNo(ref?: string | null): string | null {
  if (ref == null) {
    return null;
  }
  const trimmed = ref.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Deterministically sorts sale items by product_id ascending (lexicographically).
 */
export function sortSaleItems<T extends CanonicalItemInput>(items: T[]): T[] {
  return [...items].sort((a, b) => a.productId.localeCompare(b.productId));
}

/**
 * Deterministically sorts sale payments across 5 discriminating fields:
 * 1. payment_method ASC
 * 2. amount ASC
 * 3. amount_tendered ASC NULLS LAST
 * 4. change_due ASC NULLS LAST
 * 5. reference_no ASC NULLS LAST
 */
export function sortSalePayments<T extends CanonicalPaymentInput>(payments: T[]): T[] {
  return [...payments].sort((a, b) => {
    // 1. payment_method ASC
    const methodCmp = a.paymentMethod.localeCompare(b.paymentMethod);
    if (methodCmp !== 0) return methodCmp;

    // 2. amount ASC
    const aAmt = typeof a.amount === "string" ? parseFloat(a.amount) : a.amount;
    const bAmt = typeof b.amount === "string" ? parseFloat(b.amount) : b.amount;
    if (aAmt !== bAmt) return aAmt - bAmt;

    // 3. amount_tendered ASC NULLS LAST
    const aTender =
      a.amountTendered != null
        ? typeof a.amountTendered === "string"
          ? parseFloat(a.amountTendered)
          : a.amountTendered
        : null;
    const bTender =
      b.amountTendered != null
        ? typeof b.amountTendered === "string"
          ? parseFloat(b.amountTendered)
          : b.amountTendered
        : null;
    if (aTender === null && bTender !== null) return 1;
    if (aTender !== null && bTender === null) return -1;
    if (aTender !== null && bTender !== null && aTender !== bTender) return aTender - bTender;

    // 4. change_due ASC NULLS LAST
    const aChange =
      a.changeDue != null
        ? typeof a.changeDue === "string"
          ? parseFloat(a.changeDue)
          : a.changeDue
        : null;
    const bChange =
      b.changeDue != null
        ? typeof b.changeDue === "string"
          ? parseFloat(b.changeDue)
          : b.changeDue
        : null;
    if (aChange === null && bChange !== null) return 1;
    if (aChange !== null && bChange === null) return -1;
    if (aChange !== null && bChange !== null && aChange !== bChange) return aChange - bChange;

    // 5. reference_no ASC NULLS LAST
    const aRef = normalizeReferenceNo(a.referenceNo);
    const bRef = normalizeReferenceNo(b.referenceNo);
    if (aRef === null && bRef !== null) return 1;
    if (aRef !== null && bRef === null) return -1;
    if (aRef !== null && bRef !== null) return aRef.localeCompare(bRef);

    return 0;
  });
}

/**
 * Formats a single canonical sale item matching PostgreSQL's internal JSONB key ordering and text formatting:
 * `{"quantity": "...", "product_id": "...", "line_discount_amount": "..."}`
 */
function formatCanonicalItem(it: CanonicalItemInput): string {
  const quantity = formatCanonicalAmount(it.quantity);
  const productId = it.productId.toLowerCase().trim();
  const lineDiscount = formatCanonicalAmount(it.lineDiscountAmount ?? 0);
  return `{"quantity": "${quantity}", "product_id": "${productId}", "line_discount_amount": "${lineDiscount}"}`;
}

/**
 * Formats a single canonical sale payment matching PostgreSQL's internal JSONB key ordering and text formatting:
 * `{"amount": "...", "change_due": ... | null, "reference_no": ... | null, "payment_method": "...", "amount_tendered": ... | null}`
 */
function formatCanonicalPayment(p: CanonicalPaymentInput): string {
  const amount = formatCanonicalAmount(p.amount);
  const changeDue = p.changeDue != null ? `"${formatCanonicalAmount(p.changeDue)}"` : "null";
  const refNo = normalizeReferenceNo(p.referenceNo);
  const refNoJson = refNo != null ? JSON.stringify(refNo) : "null";
  const method = p.paymentMethod;
  const amountTendered =
    p.amountTendered != null ? `"${formatCanonicalAmount(p.amountTendered)}"` : "null";
  return `{"amount": "${amount}", "change_due": ${changeDue}, "reference_no": ${refNoJson}, "payment_method": "${method}", "amount_tendered": ${amountTendered}}`;
}

/**
 * Builds the canonical JSON string representing the sale payload.
 * Structure matches PostgreSQL `execute_sale` `v_canonical_json::text` byte-for-byte:
 * `{"items": [...], "payments": [...], "customer_id": ... | null, "order_discount_amount": "..."}`
 */
export function buildCanonicalSalePayloadString(input: {
  customerId?: string | null;
  items: CanonicalItemInput[];
  payments: CanonicalPaymentInput[];
  orderDiscountAmount?: number | string;
}): string {
  const sortedItems = sortSaleItems(input.items);
  const itemsText = sortedItems.map(formatCanonicalItem).join(", ");

  const sortedPayments = sortSalePayments(input.payments);
  const paymentsText = sortedPayments.map(formatCanonicalPayment).join(", ");

  const customerIdText = input.customerId ? `"${input.customerId.toLowerCase().trim()}"` : "null";
  const orderDiscountText = `"${formatCanonicalAmount(input.orderDiscountAmount ?? 0)}"`;

  return `{"items": [${itemsText}], "payments": [${paymentsText}], "customer_id": ${customerIdText}, "order_discount_amount": ${orderDiscountText}}`;
}

/**
 * Computes deterministic SHA-256 hexadecimal hash of the canonical sale payload asynchronously
 * using standard Web Crypto API (supported across all modern browsers and Node 18+).
 */
export async function computeCanonicalSalePayloadHash(
  input: ExecuteSaleInput
): Promise<string> {
  const payloadString = buildCanonicalSalePayloadString(input);

  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(payloadString);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node.js fallback
  return createHash("sha256").update(payloadString, "utf8").digest("hex");
}

/**
 * Synchronous variant of canonical sale payload hash computation using Node.js crypto.
 * Used in server actions and synchronous test suites.
 */
export function computeCanonicalSalePayloadHashSync(
  input: ExecuteSaleInput
): string {
  const payloadString = buildCanonicalSalePayloadString(input);
  return createHash("sha256").update(payloadString, "utf8").digest("hex");
}
