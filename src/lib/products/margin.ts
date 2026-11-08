import type { ProductMarginMetrics } from "@/types/product";

/**
 * Calculates gross profit and gross margin percentage in compliance with
 * FR-024, FR-025, BR-007, and BR-008.
 *
 * Rules:
 * 1. Unauthorized caller (`costPrice === undefined`): All cost-derived properties
 *    are strictly omitted from the returned object to prevent mathematical derivation leakage.
 * 2. Unrecorded cost (`costPrice === null`): `grossProfit` and `grossMarginPercentage`
 *    are `null` (displayed as N/A "—"), with `hasRecordedCost = false` and `isNegativeMargin = false`.
 * 3. Selling price = 0.00: Gross margin percentage is mathematically undefined (division by zero)
 *    and returns `null` (displayed as N/A "—") without throwing exceptions or producing NaN / Infinity.
 * 4. Recorded cost (`costPrice` is a number):
 *    - Gross Profit = `selling_price - cost_price`
 *    - Gross Margin % = `((selling_price - cost_price) / selling_price) * 100` (rounded to 1 decimal place)
 *    - Negative margin (`costPrice > sellingPrice`) is flagged with `isNegativeMargin = true`.
 */
export function calculateGrossMargin(
  sellingPrice: number,
  costPrice?: number | null
): ProductMarginMetrics {
  // Rule 1: Caller lacks products:read_cost permission -> omit all cost-derived properties
  if (costPrice === undefined) {
    return {
      sellingPrice,
    };
  }

  // Rule 2: Unrecorded cost (no row in product_costs) -> gross margin is N/A
  if (costPrice === null) {
    return {
      sellingPrice,
      costPrice: null,
      grossProfit: null,
      grossMarginPercentage: null,
      hasRecordedCost: false,
      isNegativeMargin: false,
    };
  }

  // Cost is recorded (including 0.0000)
  // Compute gross profit with rounding to 4 decimal places to prevent IEEE 754 precision drift
  const grossProfit = Math.round((sellingPrice - costPrice) * 10000) / 10000;
  const isNegativeMargin = grossProfit < 0;

  // Rule 3: Zero selling price -> gross margin percentage is undefined (division by zero)
  if (sellingPrice === 0) {
    return {
      sellingPrice,
      costPrice,
      grossProfit,
      grossMarginPercentage: null,
      hasRecordedCost: true,
      isNegativeMargin,
    };
  }

  // Standard gross margin calculation rounded to 1 decimal place (e.g., 40.0%)
  const rawMargin = ((sellingPrice - costPrice) / sellingPrice) * 100;
  const grossMarginPercentage = Math.round(rawMargin * 10) / 10;

  return {
    sellingPrice,
    costPrice,
    grossProfit,
    grossMarginPercentage,
    hasRecordedCost: true,
    isNegativeMargin,
  };
}

/**
 * Formats a gross margin percentage for UI display.
 * Returns "—" (N/A) for null or undefined margins, or "XX.X%" for valid numbers.
 */
export function formatGrossMargin(margin: number | null | undefined): string {
  if (margin === null || margin === undefined || isNaN(margin)) {
    return "—";
  }
  return `${margin.toFixed(1)}%`;
}

/**
 * Formats a monetary amount in the specified ISO 4217 currency.
 */
export function formatCurrency(amount: number, currency: string = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    })
      .format(amount)
      .replace(/\u00a0/g, " ");
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

