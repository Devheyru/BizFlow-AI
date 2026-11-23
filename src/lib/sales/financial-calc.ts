import { getCurrencyExponent } from "@/lib/inventory/formatters";

export interface PosLineItemInput {
  productId: string;
  unitPrice: number;
  quantity: number;
  lineDiscountAmount: number;
}

export interface ComputedLineItem {
  productId: string;
  lineGross: number;
  lineDiscount: number;
  lineNet: number;
  allocatedOrderDiscount: number;
  taxableAmount: number;
  allocatedTax: number;
  lineTotal: number;
}

export interface PosFinancialCalculationResult {
  /** Sum of (quantity * unitPrice) before any discounts */
  subtotal: number;
  /** Sum of line-level discounts */
  totalLineDiscounts: number;
  /** Net subtotal after line discounts (matches PostgreSQL v_subtotal) */
  netSubtotal: number;
  /** Order-level discount applied (capped at netSubtotal and rounded to currency decimals) */
  effectiveOrderDiscount: number;
  /** Net taxable base before tax calculation */
  taxableBase: number;
  /** Total calculated tax matching PostgreSQL v_total_tax */
  totalTax: number;
  /** Total payable amount matching PostgreSQL v_total_amount */
  totalPayable: number;
  /** Detailed line-item breakdown */
  lineItems: ComputedLineItem[];
}

/**
 * Computes POS financial totals replicating PostgreSQL `public.execute_sale` Pass 1 & Pass 2:
 * - Line items sorted by `product_id ASC` for deterministic allocation
 * - Proportional order discount allocation with residual absorbed by final line item
 * - Line-by-line tax calculation (inclusive vs exclusive) rounded to currency decimals
 * - Total payable equal to sum of line totals, guaranteeing zero rounding discrepancy with PostgreSQL
 */
export function calculatePosTotals(params: {
  items: PosLineItemInput[];
  orderDiscountAmount: number;
  taxRate: number;
  isTaxInclusive: boolean;
  currency?: string;
}): PosFinancialCalculationResult {
  const { items, orderDiscountAmount, taxRate, isTaxInclusive, currency = "USD" } = params;
  const decimals = getCurrencyExponent(currency);
  const factor = Math.pow(10, decimals);

  if (!items || items.length === 0) {
    return {
      subtotal: 0,
      totalLineDiscounts: 0,
      netSubtotal: 0,
      effectiveOrderDiscount: 0,
      taxableBase: 0,
      totalTax: 0,
      totalPayable: 0,
      lineItems: [],
    };
  }

  // 1. Pass 1: Product validation & gross/net calculation (sorted by productId ASC)
  const sortedItems = [...items].sort((a, b) =>
    a.productId.toLowerCase().localeCompare(b.productId.toLowerCase())
  );

  let subtotal = 0;
  let totalLineDiscounts = 0;
  let netSubtotal = 0;

  const preLines = sortedItems.map((it) => {
    const lineGross = Math.round(it.quantity * it.unitPrice * 10000) / 10000;
    const lineDiscount = Math.min(lineGross, Math.max(0, it.lineDiscountAmount));
    const lineNet = Math.round((lineGross - lineDiscount) * 10000) / 10000;

    subtotal = Math.round((subtotal + lineGross) * 10000) / 10000;
    totalLineDiscounts = Math.round((totalLineDiscounts + lineDiscount) * 10000) / 10000;
    netSubtotal = Math.round((netSubtotal + lineNet) * 10000) / 10000;

    return {
      productId: it.productId,
      lineGross,
      lineDiscount,
      lineNet,
    };
  });

  // 2. Order discount calculation & rounding
  const rawOrderDiscount = Math.max(0, orderDiscountAmount);
  const roundedOrderDiscount = Math.round(rawOrderDiscount * factor) / factor;
  const effectiveOrderDiscount = Math.min(netSubtotal, roundedOrderDiscount);

  // 3. Pass 2: Order discount allocation & line-by-line tax calculation
  let runningOrderDisc = 0;
  let totalTax = 0;
  let totalPayable = 0;

  const lineItems: ComputedLineItem[] = preLines.map((line, idx) => {
    let allocOrderDisc = 0;
    if (netSubtotal > 0) {
      if (idx === preLines.length - 1) {
        // Final line absorbs residual order discount
        allocOrderDisc = Math.round((effectiveOrderDiscount - runningOrderDisc) * factor) / factor;
      } else {
        allocOrderDisc =
          Math.round(((line.lineNet / netSubtotal) * effectiveOrderDiscount) * factor) / factor;
        runningOrderDisc = Math.round((runningOrderDisc + allocOrderDisc) * factor) / factor;
      }
    }

    const lineDiscounted = Math.max(0, Math.round((line.lineNet - allocOrderDisc) * 10000) / 10000);

    let taxableAmount = 0;
    let allocatedTax = 0;
    let lineTotal = 0;

    if (isTaxInclusive) {
      if (taxRate > 0) {
        taxableAmount =
          Math.round((lineDiscounted / (1.0 + taxRate / 100.0)) * factor) / factor;
        allocatedTax = Math.round((lineDiscounted - taxableAmount) * factor) / factor;
        lineTotal = lineDiscounted;
      } else {
        taxableAmount = lineDiscounted;
        allocatedTax = 0;
        lineTotal = lineDiscounted;
      }
    } else {
      if (taxRate > 0) {
        taxableAmount = lineDiscounted;
        allocatedTax = Math.round((lineDiscounted * (taxRate / 100.0)) * factor) / factor;
        lineTotal = Math.round((taxableAmount + allocatedTax) * factor) / factor;
      } else {
        taxableAmount = lineDiscounted;
        allocatedTax = 0;
        lineTotal = lineDiscounted;
      }
    }

    totalTax = Math.round((totalTax + allocatedTax) * factor) / factor;
    totalPayable = Math.round((totalPayable + lineTotal) * factor) / factor;

    return {
      productId: line.productId,
      lineGross: line.lineGross,
      lineDiscount: line.lineDiscount,
      lineNet: line.lineNet,
      allocatedOrderDiscount: allocOrderDisc,
      taxableAmount,
      allocatedTax,
      lineTotal,
    };
  });

  const taxableBase = Math.max(0, Math.round((netSubtotal - effectiveOrderDiscount) * factor) / factor);

  return {
    subtotal,
    totalLineDiscounts,
    netSubtotal,
    effectiveOrderDiscount,
    taxableBase,
    totalTax,
    totalPayable,
    lineItems,
  };
}

// ============================================================================
// Return & Refund Proportional Calculation Utilities (T070, US4)
// ============================================================================

/**
 * Decimal-safe rounding function matching PostgreSQL `round(numeric, integer)`.
 * Implements symmetric round-half-away-from-zero matching PostgreSQL `numeric` arithmetic.
 * Avoids IEEE 754 precision drift (e.g. 1.005 * 100 = 100.49999999999999) and ensures
 * exact parity for both positive and negative halfway boundaries.
 */
export function roundToCurrency(value: number, decimals: number): number {
  if (isNaN(value) || !isFinite(value)) return 0;
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const rounded = Number(Math.round(Number(abs + "e" + decimals)) + "e-" + decimals);
  return sign * rounded;
}

export interface ReturnRefundLineInput {
  saleItemId: string;
  /** Sale item total_price snapshot (includes unit price, discounts, and tax) */
  totalPrice: number;
  /** Original sold quantity on the sale item */
  soldQuantity: number;
  /** Remaining unreturned quantity for this sale item */
  remainingReturnableQty: number;
  /** Cumulative amount already refunded for this sale item in previous returns */
  previouslyRefundedAmount: number;
  /** Quantity requested for this return */
  returnQuantity: number;
}

export interface ReturnRefundPreviewLineResult {
  saleItemId: string;
  returnQuantity: number;
  quantity: number;
  refundAmount: number;
  isResidual: boolean;
}

export interface ReturnRefundPreviewParams {
  items: ReturnRefundLineInput[];
  saleTotalAmount: number;
  previouslyRefundedTotal: number;
  refundMethod: string;
  originalMethodTenderAmount?: number;
  previouslyRefundedMethodAmount?: number;
  currency?: string;
}

export interface ReturnRefundPreviewResult {
  totalRefund: number;
  total: number;
  lineBreakdowns: ReturnRefundPreviewLineResult[];
  remainingCumulativePayable: number;
  isCumulativeCapped: boolean;
  remainingMethodTender: number;
  isSplitTenderCapped: boolean;
  isValid: boolean;
}

/**
 * Computes estimated proportional return refund replicating PostgreSQL `public.execute_sale_return`:
 * - Uses authoritative ISO 4217 currency exponent for rounding precision.
 * - Employs exact decimal arithmetic matching PostgreSQL numeric round.
 * - When returning the final remaining quantity of an item, absorbs residual difference:
 *     refundAmount = totalPrice - previouslyRefundedAmount
 * - Proportional allocation for partial returns:
 *     refundAmount = round((totalPrice / soldQuantity) * returnQuantity, decimals)
 * - Enforces cumulative refund ceiling against remaining sale total.
 * - Enforces split-tender ceiling against remaining method tender (for non-cash methods).
 */
export function calculateReturnRefundPreview(
  params: ReturnRefundPreviewParams
): ReturnRefundPreviewResult {
  const {
    items,
    saleTotalAmount,
    previouslyRefundedTotal,
    refundMethod,
    originalMethodTenderAmount = 0,
    previouslyRefundedMethodAmount = 0,
    currency = "USD",
  } = params;

  const decimals = getCurrencyExponent(currency);

  let totalRefund = 0;
  const lineBreakdowns: ReturnRefundPreviewLineResult[] = [];

  for (const item of items) {
    if (item.returnQuantity <= 0) continue;

    let lineRefund = 0;
    let isResidual = false;

    // Final remaining quantity absorbs residual rounding discrepancy
    if (item.returnQuantity >= item.remainingReturnableQty && item.soldQuantity > 0) {
      lineRefund = Math.max(
        0,
        roundToCurrency(item.totalPrice - item.previouslyRefundedAmount, decimals)
      );
      isResidual = true;
    } else if (item.soldQuantity > 0) {
      lineRefund = roundToCurrency(
        (item.totalPrice / item.soldQuantity) * item.returnQuantity,
        decimals
      );
    }

    totalRefund = roundToCurrency(totalRefund + lineRefund, decimals);
    lineBreakdowns.push({
      saleItemId: item.saleItemId,
      returnQuantity: item.returnQuantity,
      quantity: item.returnQuantity,
      refundAmount: lineRefund,
      isResidual,
    });
  }

  // Cumulative refund cap check: total prior + new refund cannot exceed sale total amount
  const remainingCumulativePayable = Math.max(
    0,
    roundToCurrency(saleTotalAmount - previouslyRefundedTotal, decimals)
  );
  const isCumulativeCapped = totalRefund > remainingCumulativePayable;

  // Split-tender cap check: for non-cash methods, refund cannot exceed original tender minus prior refunds
  let remainingMethodTender = Infinity;
  let isSplitTenderCapped = false;

  if (refundMethod !== "cash") {
    remainingMethodTender = Math.max(
      0,
      roundToCurrency(originalMethodTenderAmount - previouslyRefundedMethodAmount, decimals)
    );
    isSplitTenderCapped = totalRefund > remainingMethodTender;
  }

  const isValid =
    items.length > 0 &&
    lineBreakdowns.some((l) => l.returnQuantity > 0) &&
    totalRefund > 0 &&
    !isCumulativeCapped &&
    !isSplitTenderCapped;

  return {
    totalRefund,
    total: totalRefund,
    lineBreakdowns,
    remainingCumulativePayable,
    isCumulativeCapped,
    remainingMethodTender,
    isSplitTenderCapped,
    isValid,
  };
}
