"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  Search,
  ArrowLeft,
  Package,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StocktakeModal } from "@/components/inventory/stocktake-modal";
import { formatQuantityWithUom } from "@/lib/inventory/formatters";
import type { InventoryItemRow, StockMutationResult } from "@/types/inventory";

export interface StocktakeWorkflowProps {
  slug: string;
  items: InventoryItemRow[];
  totalCount: number;
  canAdjustStock: boolean;
  canViewValuation: boolean;
  currency: string;
}

export function StocktakeWorkflow({
  slug,
  items: initialItems,
  totalCount,
  canAdjustStock,
  currency: _currency,
}: StocktakeWorkflowProps) {
  const router = useRouter();
  const [items, setItems] = useState<InventoryItemRow[]>(initialItems);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeItem, setActiveItem] = useState<InventoryItemRow | null>(null);
  const [countedProductIds, setCountedProductIds] = useState<Set<string>>(new Set());

  // Filter items by search query
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.productName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)) ||
        (item.categoryName && item.categoryName.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  const handleStocktakeSuccess = (result: StockMutationResult) => {
    setCountedProductIds((prev) => new Set(prev).add(result.productId));

    // Update local item balance and version
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.productId === result.productId) {
          const newQty =
            result.status === "matched"
              ? result.matchedQuantity ?? item.quantity
              : result.quantityAfter;
          return {
            ...item,
            quantity: newQty,
            version: result.version ?? item.version + 1,
          };
        }
        return item;
      })
    );

    router.refresh();
  };

  return (
    <div className="space-y-6" data-testid="stocktake-workflow-root">
      {/* Top Navigation & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/${slug}/inventory`}
              className="inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              data-testid="back-to-inventory-link"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Back to Inventory
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6 text-primary" />
            Cycle Count & Stocktake
          </h1>
          <p className="text-sm text-muted-foreground">
            Perform physical inventory counts, reconcile variances, and audit on-hand balances.
          </p>
        </div>

        {/* Counter Summary */}
        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-lg border bg-card text-xs">
            <span className="text-muted-foreground">Session Counted: </span>
            <strong className="text-foreground font-semibold">
              {countedProductIds.size} / {items.length}
            </strong>
          </div>
        </div>
      </div>

      {/* Permission banner */}
      {!canAdjustStock && (
        <div
          data-testid="workflow-permission-warning"
          className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Read-Only Mode</p>
            <p className="text-xs mt-0.5">
              You do not possess the <code className="font-mono font-semibold">inventory:adjust</code> permission.
              You can view system balances but cannot record cycle counts.
            </p>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by product name, SKU, or barcode..."
            data-testid="stocktake-search-input"
            className="w-full h-10 pl-9 pr-4 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Showing {filteredItems.length} of {totalCount} items
        </div>
      </div>

      {/* Inventory Stocktake Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table
            className="w-full text-left border-collapse text-sm"
            data-testid="stocktake-items-table"
          >
            <thead>
              <tr className="border-b bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                <th className="px-4 py-3.5">Product</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">System Balance</th>
                <th className="px-4 py-3.5 text-center">Count Status</th>
                <th className="px-4 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted-foreground text-sm"
                    data-testid="stocktake-empty-state"
                  >
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No products found matching your search.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isCountedInSession = countedProductIds.has(item.productId);
                  const isArchived = item.productStatus === "archived";

                  return (
                    <tr
                      key={item.productId}
                      className="hover:bg-muted/30 transition-colors"
                      data-testid={`stocktake-row-${item.productId}`}
                    >
                      {/* Product & SKU */}
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-foreground">
                          {item.productName}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          {item.sku}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        {item.categoryName || "Uncategorized"}
                      </td>

                      {/* Product Status */}
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                            item.productStatus === "active"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : item.productStatus === "inactive"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.productStatus}
                        </span>
                      </td>

                      {/* System On-Hand Stock */}
                      <td className="px-4 py-3.5 text-right font-mono font-semibold">
                        {formatQuantityWithUom(item.quantity, item.unitOfMeasure)}
                      </td>

                      {/* Session Count Status */}
                      <td className="px-4 py-3.5 text-center">
                        {isCountedInSession ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Counted
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          size="sm"
                          variant={isCountedInSession ? "outline" : "default"}
                          disabled={!canAdjustStock || isArchived}
                          onClick={() => setActiveItem(item)}
                          data-testid={`stocktake-btn-${item.productId}`}
                        >
                          <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" />
                          {isCountedInSession ? "Recount" : "Count"}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Embedded Stocktake Modal */}
      {activeItem && (
        <StocktakeModal
          isOpen={Boolean(activeItem)}
          onClose={() => setActiveItem(null)}
          slug={slug}
          productId={activeItem.productId}
          productName={activeItem.productName}
          sku={activeItem.sku}
          currentStock={activeItem.quantity}
          currentVersion={activeItem.version}
          unitOfMeasure={activeItem.unitOfMeasure}
          isDiscrete={activeItem.isDiscrete}
          productStatus={activeItem.productStatus}
          canAdjustStock={canAdjustStock}
          onStocktakeSuccess={handleStocktakeSuccess}
        />
      )}
    </div>
  );
}
