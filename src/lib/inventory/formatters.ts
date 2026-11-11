import type { StockStatus } from "@/types/inventory";

/**
 * Normalizes and formats a stock quantity:
 * - If discrete (e.g. piece, box, pair, pack), formats as an integer with thousand separators.
 * - If continuous (e.g. kg, liter, meter), formats with trailing decimal places up to 4 scale.
 */
export function formatStockQuantity(
  quantity: number | string | null | undefined,
  isDiscrete: boolean = false
): string {
  if (quantity === null || quantity === undefined) {
    return "0";
  }
  const num = typeof quantity === "string" ? parseFloat(quantity) : quantity;
  if (isNaN(num)) {
    return "0";
  }

  if (isDiscrete || Number.isInteger(num)) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0,
    }).format(Math.round(num));
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(num);
}

/**
 * Returns formatted quantity accompanied by the Unit of Measure.
 */
export function formatQuantityWithUom(
  quantity: number | string | null | undefined,
  uom: string,
  isDiscrete: boolean = false
): string {
  const formattedQty = formatStockQuantity(quantity, isDiscrete);
  return `${formattedQty} ${uom}`;
}

/**
 * Formats a monetary amount into a localized currency string.
 * Defaults to USD if currency is not provided.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency: string = "USD"
): string {
  if (amount === null || amount === undefined) {
    return "$0.00";
  }
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) {
    return "$0.00";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

/**
 * Computes deterministic stock status based on live quantity and reorder point:
 * - `out_of_stock`: quantity <= 0
 * - `low_stock`: quantity > 0 AND quantity <= reorderPoint (when reorderPoint is set and > 0)
 * - `in_stock`: quantity > reorderPoint OR reorderPoint is not set
 */
export function calculateStockStatus(
  quantity: number | string | null | undefined,
  reorderPoint: number | string | null | undefined
): StockStatus {
  const qty = typeof quantity === "string" ? parseFloat(quantity) : (quantity ?? 0);
  const rp =
    reorderPoint !== null && reorderPoint !== undefined && reorderPoint !== ""
      ? typeof reorderPoint === "string"
        ? parseFloat(reorderPoint)
        : reorderPoint
      : null;

  if (qty <= 0) {
    return "out_of_stock";
  }

  if (rp !== null && !isNaN(rp) && rp > 0 && qty <= rp) {
    return "low_stock";
  }

  return "in_stock";
}

/**
 * Deterministic priority score for stock status sorting:
 * 1 = out_of_stock (highest urgency)
 * 2 = low_stock (medium urgency)
 * 3 = in_stock (normal)
 */
export function getStockStatusPriority(status: StockStatus): number {
  switch (status) {
    case "out_of_stock":
      return 1;
    case "low_stock":
      return 2;
    case "in_stock":
      return 3;
    default:
      return 4;
  }
}

/**
 * Visual badge properties for stock status display.
 */
export function getStockStatusBadge(status: StockStatus): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "warning";
} {
  switch (status) {
    case "out_of_stock":
      return { label: "Out of Stock", variant: "destructive" };
    case "low_stock":
      return { label: "Low Stock", variant: "warning" };
    case "in_stock":
      return { label: "In Stock", variant: "default" };
  }
}

