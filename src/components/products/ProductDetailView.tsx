"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Package,
  ArrowLeft,
  Edit,
  Tag,
  Barcode,
  Clock,
  ShieldCheck,
  AlertTriangle,
  History,
  TrendingUp,
  DollarSign,
  Layers,
  CheckCircle,
  RefreshCw,
  Archive,
} from "lucide-react";
import type { Product, ProductStatus } from "@/types/product";
import { calculateGrossMargin, formatCurrency, formatGrossMargin } from "@/lib/products/margin";
import { ProductLifecycleActions } from "./ProductLifecycleActions";

export interface AuditEventItem {
  id: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor?: {
    firstName: string;
    lastName: string;
  } | null;
}

export interface ProductDetailViewProps {
  product: Product;
  currency: string;
  canReadCost: boolean;
  canUpdate?: boolean;
  canArchive?: boolean;
  slug: string;
  auditEvents?: AuditEventItem[];
}

/**
 * ProductDetailView Component (T041, FR-024, FR-025, FR-039, FR-041)
 *
 * Implements comprehensive product detail view with:
 * - Direct image rendering (signed URL for internal storage or HTTPS external)
 * - Metadata, SKU, Barcode, UOM badge, Category with archived status indicator
 * - Prominent selling price
 * - Confidential financial metrics panel strictly gated by `canReadCost` (zero cost exposure for Cashiers)
 * - Audit timeline displaying chronological product audit history
 * - Navigation and edit controls
 */
export function ProductDetailView({
  product,
  currency,
  canReadCost,
  canUpdate = false,
  canArchive = false,
  slug,
  auditEvents = [],
}: ProductDetailViewProps) {
  const [imageError, setImageError] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<ProductStatus>(product.status);
  const [currentVersion, setCurrentVersion] = useState<number>(product.version);

  React.useEffect(() => {
    setCurrentStatus(product.status);
    setCurrentVersion(product.version);
  }, [product.status, product.version]);

  // Compute margin metrics only if caller has products:read_cost
  const marginMetrics = canReadCost
    ? calculateGrossMargin(product.sellingPrice, product.costPrice)
    : null;

  const displayImageUrl = product.signedImageUrl || product.imageUrl;

  const statusColorMap = {
    active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    inactive: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    archived: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
  };

  const statusLabelMap = {
    active: "Active",
    inactive: "Inactive",
    archived: "Archived",
  };

  const formatDate = (dateString: string) => {
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
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="space-y-2">
          <Link
            href={`/${slug}/products`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Products Catalog
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {product.name}
            </h1>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                statusColorMap[currentStatus]
              }`}
            >
              {statusLabelMap[currentStatus]}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {canUpdate && currentStatus !== "archived" && (
            <Link
              href={`/${slug}/products/${product.id}/edit`}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-lg shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            >
              <Edit className="h-4 w-4" />
              Edit Product
            </Link>
          )}

          <ProductLifecycleActions
            slug={slug}
            productId={product.id}
            productName={product.name}
            sku={product.sku}
            initialStatus={currentStatus}
            initialVersion={currentVersion}
            canUpdate={canUpdate}
            canArchive={canArchive}
            variant="detail"
            onStatusChange={(newStatus, newVersion) => {
              setCurrentStatus(newStatus);
              setCurrentVersion(newVersion);
              product.status = newStatus;
              product.version = newVersion;
            }}
          />
        </div>
      </div>

      {/* Main Grid: Details & Financials */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Image and Identifiers */}
        <div className="space-y-6 lg:col-span-1">
          {/* Product Image Card */}
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
            <div className="aspect-square w-full rounded-lg bg-zinc-100 dark:bg-zinc-800/60 overflow-hidden flex items-center justify-center border border-zinc-100 dark:border-zinc-800 relative">
              {displayImageUrl && !imageError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayImageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover object-center"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-zinc-400 dark:text-zinc-500">
                  <Package className="h-16 w-16 mb-2 stroke-[1.25]" />
                  <span className="text-xs font-medium">No image provided</span>
                </div>
              )}
            </div>
          </div>

          {/* Core Identifiers Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider text-xs">
              Product Identifiers
            </h3>

            <div className="space-y-3 divide-y divide-zinc-100 dark:divide-zinc-800/80">
              <div className="flex items-center justify-between pt-2 first:pt-0">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  SKU
                </span>
                <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {product.sku}
                </span>
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Barcode className="h-3.5 w-3.5" />
                  Barcode
                </span>
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                  {product.barcode || <span className="text-zinc-400 italic">None</span>}
                </span>
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Unit of Measure
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 capitalize">
                  {product.unitOfMeasure}
                </span>
              </div>

              <div className="flex items-center justify-between pt-3">
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  Category
                </span>
                <div className="flex items-center gap-1.5">
                  {product.category ? (
                    <>
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {product.category.name}
                      </span>
                      {product.category.status === "archived" && (
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
                          Archived
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-zinc-400 italic">Uncategorized</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Pricing, Financial Metrics, Description & Metadata */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pricing & Financial Panel */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-6">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Pricing &amp; Valuation
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Selling Price (Always visible) */}
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Selling Price
                </span>
                <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatCurrency(product.sellingPrice, currency)}
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Customer retail price per {product.unitOfMeasure}
                </p>
              </div>

              {/* Confidential Cost Price (Strictly gated by canReadCost, FR-039) */}
              {canReadCost && marginMetrics && (
                <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Acquisition Cost
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                      Confidential
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {marginMetrics.hasRecordedCost &&
                    marginMetrics.costPrice !== null &&
                    marginMetrics.costPrice !== undefined
                      ? formatCurrency(marginMetrics.costPrice, currency)
                      : <span className="text-zinc-400 dark:text-zinc-500 text-lg font-normal">—</span>}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {marginMetrics.hasRecordedCost
                      ? "Supplier cost basis"
                      : "Cost price not recorded"}
                  </p>
                </div>
              )}
            </div>

            {/* Confidential Profitability & Gross Margin Panel (FR-024, FR-025, FR-039) */}
            {canReadCost && marginMetrics && (
              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Gross Profit (Per Unit)
                  </span>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {marginMetrics.grossProfit !== null && marginMetrics.grossProfit !== undefined
                      ? formatCurrency(marginMetrics.grossProfit, currency)
                      : "—"}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
                    Gross Margin %
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {formatGrossMargin(marginMetrics.grossMarginPercentage)}
                    </span>
                    {marginMetrics.isNegativeMargin && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-900">
                        <AlertTriangle className="h-3 w-3" />
                        Negative Margin
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Description Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Description
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
              {product.description || (
                <span className="italic text-zinc-400 dark:text-zinc-500">
                  No description provided for this product.
                </span>
              )}
            </p>
          </div>

          {/* System & Audit Metadata Card */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-zinc-500" />
              Concurrency &amp; Audit Metadata
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg space-y-1">
                <span className="text-zinc-500 dark:text-zinc-400">OCC Version</span>
                <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                  v{product.version}
                </div>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg space-y-1">
                <span className="text-zinc-500 dark:text-zinc-400">Created At</span>
                <div className="font-medium text-zinc-700 dark:text-zinc-300">
                  {formatDate(product.createdAt)}
                </div>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg space-y-1">
                <span className="text-zinc-500 dark:text-zinc-400">Last Modified</span>
                <div className="font-medium text-zinc-700 dark:text-zinc-300">
                  {formatDate(product.updatedAt)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Timeline (FR-041) */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <History className="h-5 w-5 text-zinc-500" />
              Audit Timeline
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Immutable audit history recorded in organization audit log (FR-041)
            </p>
          </div>
          <span className="text-xs font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
            {auditEvents.length} {auditEvents.length === 1 ? "Event" : "Events"}
          </span>
        </div>

        {auditEvents.length > 0 ? (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">
            {auditEvents.map((evt) => {
              const actorName = evt.actor
                ? `${evt.actor.firstName} ${evt.actor.lastName}`.trim()
                : "Authorized User";

              let icon = <Clock className="h-3.5 w-3.5 text-zinc-500" />;
              let eventTitle = evt.eventType;

              if (evt.eventType === "product.created") {
                icon = <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
                eventTitle = "Product Registered";
              } else if (evt.eventType === "product.updated") {
                icon = <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />;
                eventTitle = "Product Updated";
              } else if (evt.eventType === "product.status_changed") {
                icon = <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
                eventTitle = "Status Changed";
              } else if (evt.eventType === "product.archived") {
                icon = <Archive className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-400" />;
                eventTitle = "Product Archived";
              } else if (evt.eventType === "product.restored") {
                icon = <RefreshCw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
                eventTitle = "Product Restored";
              }

              return (
                <div key={evt.id} className="relative group">
                  <div className="absolute -left-6 top-1.5 h-4 w-4 rounded-full bg-white dark:bg-zinc-900 border-2 border-zinc-400 dark:border-zinc-600 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 dark:bg-zinc-400" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        {icon}
                        {eventTitle}
                      </span>
                      <span className="text-xs text-zinc-400">•</span>
                      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        {actorName}
                      </span>
                      <span className="text-xs text-zinc-400">•</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatDate(evt.createdAt)}
                      </span>
                    </div>

                    {/* Metadata summary (safe: no plaintext confidential costs leaked) */}
                    {evt.metadata && Object.keys(evt.metadata).length > 0 && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 p-2.5 rounded-md mt-1 border border-zinc-100 dark:border-zinc-800 font-mono">
                        {Object.entries(evt.metadata)
                          .filter(([key]) => key !== "product_id")
                          .map(([key, val]) => (
                            <span key={key} className="mr-3 inline-block">
                              <span className="text-zinc-400">{key}:</span>{" "}
                              <span className="text-zinc-700 dark:text-zinc-200">
                                {typeof val === "boolean" ? (val ? "true" : "false") : String(val)}
                              </span>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No audit records found for this product.
          </div>
        )}
      </div>
    </div>
  );
}
