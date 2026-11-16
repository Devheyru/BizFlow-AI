import React from "react";
import Link from "next/link";
import {
  Warehouse,
  Clock,
  DollarSign,
  ArrowUpRight,
} from "lucide-react";
import { getInventoryProductAction } from "@/actions/inventory-actions";
import {
  formatQuantityWithUom,
  formatCurrency,
  getStockStatusBadge,
  calculateStockStatus,
} from "@/lib/inventory/formatters";
import type { InventoryProductDetail } from "@/types/inventory";

export interface InventorySummaryCardProps {
  slug?: string;
  productId?: string;
  inventory?: InventoryProductDetail | null;
  className?: string;
}

/**
 * Format timestamp to localized human-readable date and time.
 * Falls back gracefully to original string or placeholder if unparseable.
 */
function formatMovementTimestamp(dateString: string | null | undefined): string {
  if (!dateString) {
    return "No stock movements recorded";
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

export interface InventorySummaryCardViewProps {
  inventory: InventoryProductDetail;
  slug?: string;
  className?: string;
}

/**
 * Synchronous presentation view for the Inventory Summary Card.
 * Can be rendered directly when pre-fetched inventory data is available.
 */
export function InventorySummaryCardView({
  inventory,
  slug,
  className = "",
}: InventorySummaryCardViewProps) {
  const isArchived = inventory.productStatus === "archived";
  const stockStatus =
    inventory.stockStatus ||
    calculateStockStatus(inventory.quantity, inventory.reorderPoint);

  const { label, variant } = getStockStatusBadge(stockStatus);

  const badgeColorMap = {
    destructive:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800",
    warning:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    default:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    secondary:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  };

  // Dual-permission gate: valuation rendered strictly when server serialized unitCost and totalValue
  const hasValuation =
    inventory.unitCost !== null &&
    inventory.unitCost !== undefined &&
    inventory.totalValue !== null &&
    inventory.totalValue !== undefined;

  const currency = inventory.currency || "USD";

  return (
    <div
      data-testid="inventory-summary-card"
      className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-6 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Warehouse className="h-5 w-5 text-zinc-500" />
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Inventory &amp; Stock Summary
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Real-time stock balance, movement, and reorder status
            </p>
          </div>
        </div>
        {slug && (
          <Link
            href={`/${slug}/inventory?search=${encodeURIComponent(
              inventory.sku || inventory.productName
            )}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
          >
            Manage Stock
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* On-Hand Quantity */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              On-Hand Stock
            </span>
            {isArchived ? (
              <span
                data-testid="inventory-stock-status-badge"
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
              >
                [Archived]
              </span>
            ) : (
              <span
                data-testid="inventory-stock-status-badge"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeColorMap[variant]}`}
              >
                {variant === "destructive" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
                {variant === "warning" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                )}
                {variant === "default" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
                {label}
              </span>
            )}
          </div>
          <div
            data-testid="inventory-current-quantity"
            className="text-2xl font-bold text-zinc-900 dark:text-zinc-100"
          >
            {formatQuantityWithUom(
              inventory.quantity,
              inventory.unitOfMeasure,
              inventory.isDiscrete
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Available physical balance
          </p>
        </div>

        {/* Reorder Threshold */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Reorder Threshold
          </span>
          <div
            data-testid="inventory-reorder-threshold"
            className={`text-2xl font-bold ${
              inventory.reorderPoint !== null && inventory.reorderPoint !== undefined
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-400 dark:text-zinc-500 text-lg font-normal italic"
            }`}
          >
            {inventory.reorderPoint !== null && inventory.reorderPoint !== undefined
              ? formatQuantityWithUom(
                  inventory.reorderPoint,
                  inventory.unitOfMeasure,
                  inventory.isDiscrete
                )
              : "Not configured"}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {inventory.reorderPoint !== null && inventory.reorderPoint !== undefined
              ? "Alert trigger for low stock replenishment"
              : "No minimum replenishment point set"}
          </p>
        </div>

        {/* Last Movement Date (Feature 004 Finding 2 / Finding 6) */}
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            Last Movement
          </span>
          {inventory.canViewMovementHistory === false ? (
            // State C: User is not authorized to view movement history (e.g. Cashier lacking inventory:history)
            <>
              <div
                data-testid="inventory-last-movement"
                className="text-sm font-medium pt-1 text-zinc-500 dark:text-zinc-400 italic"
              >
                Access Restricted
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                You don&apos;t have permission to view inventory movement history.
              </p>
            </>
          ) : inventory.movementHistoryError ? (
            // State D: Movement-history query fails
            <>
              <div
                data-testid="inventory-last-movement"
                className="text-sm font-medium pt-1 text-red-600 dark:text-red-400 italic"
              >
                Unavailable
              </div>
              <p className="text-xs text-red-500 dark:text-red-400">
                Failed to load movement history.
              </p>
            </>
          ) : inventory.lastMovementAt ? (
            // State A: User is authorized and movements exist
            <>
              <div
                data-testid="inventory-last-movement"
                className="text-sm font-semibold pt-1 text-zinc-900 dark:text-zinc-100"
              >
                {formatMovementTimestamp(inventory.lastMovementAt)}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Audited ledger activity
              </p>
            </>
          ) : (
            // State B: User is authorized and no movements exist
            <>
              <div
                data-testid="inventory-last-movement"
                className="text-sm font-normal pt-1 text-zinc-400 dark:text-zinc-500 italic"
              >
                No stock movements recorded
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No stock movements recorded
              </p>
            </>
          )}
        </div>
      </div>

      {/* Confidential Valuation Metrics (Strictly Dual-Permission Gated) */}
      {hasValuation && (
        <div
          data-testid="inventory-valuation-section"
          className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Stock Asset Valuation
            </span>
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              Confidential
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg space-y-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Unit Cost Basis
              </span>
              <div
                data-testid="inventory-unit-cost"
                className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
              >
                {formatCurrency(inventory.unitCost, currency)}
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                Recorded supplier cost per {inventory.unitOfMeasure}
              </p>
            </div>

            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg space-y-1">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Total Asset Value
              </span>
              <div
                data-testid="inventory-total-value"
                className="text-lg font-bold text-zinc-900 dark:text-zinc-100"
              >
                {formatCurrency(inventory.totalValue, currency)}
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                On-hand asset valuation (qty × cost)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Skeleton loading state for the Inventory Summary Card.
 */
export function InventorySummaryCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      data-testid="inventory-summary-skeleton"
      className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-5 animate-pulse ${className}`}
    >
      <div className="h-6 w-48 bg-zinc-200 dark:bg-zinc-800 rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-24 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl" />
        <div className="h-24 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl" />
        <div className="h-24 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Embedded Inventory Summary Card Server Component (T035, Feature 004).
 *
 * Requirements:
 * - Fetches product inventory state via `getInventoryProductAction(slug, productId)`.
 * - Gracefully omits itself (returns null) when caller lacks `inventory:read` permission.
 * - Displays on-hand quantity, stock status badge, reorder point, and last movement timestamp.
 * - Displays confidential stock valuation only when server authorized (`unitCost !== null`).
 * - Fully read-only: zero mutations or ledger modifications.
 */
export async function InventorySummaryCard({
  slug,
  productId,
  inventory: initialInventory,
  className,
}: InventorySummaryCardProps) {
  let inventory = initialInventory;

  if (inventory === undefined && slug && productId) {
    try {
      const res = await getInventoryProductAction(slug, productId);
      if (!res.success) {
        // Forbidden, not found, or error — fail closed by omitting the card
        return null;
      }
      inventory = res.data;
    } catch {
      return null;
    }
  }

  if (!inventory) {
    return null;
  }

  return (
    <InventorySummaryCardView
      inventory={inventory}
      slug={slug}
      className={className}
    />
  );
}

export default InventorySummaryCard;
