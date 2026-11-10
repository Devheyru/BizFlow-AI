"use client";

import React, { useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Package,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Plus,
} from "lucide-react";
import type { ProductListItem, ProductSortField, SortOrder } from "@/types/product";
import { formatCurrency, formatGrossMargin } from "@/lib/products/margin";
import { getSignedProductImageUrlAction } from "@/actions/product-actions";
import { ProductLifecycleActions } from "./ProductLifecycleActions";

export interface ProductTableProps {
  products: ProductListItem[];
  canReadCost: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canArchive?: boolean;
  currency: string;
  sortBy?: ProductSortField;
  sortOrder?: SortOrder;
  slug: string;
  hasActiveFilters?: boolean;
}

export interface ProductThumbnailProps {
  product: ProductListItem;
  slug: string;
}

/**
 * ProductThumbnail (T025, FR-026, FR-042)
 *
 * Renders thumbnail image with dual-protocol resolution:
 * - Uses server-pre-signed URL or external HTTPS URL immediately
 * - Falls back to client-side signing for relative Storage paths if pre-signing was absent
 * - Gracefully falls back to the Package placeholder icon if loading fails or no image exists
 */
export function ProductThumbnail({ product, slug }: ProductThumbnailProps) {
  const [hasError, setHasError] = React.useState(false);
  const [clientSignedUrl, setClientSignedUrl] = React.useState<string | null>(null);

  // Initial display URL: Use pre-signed URL from server, or direct external HTTPS URL
  const initialDisplayUrl =
    product.signedImageUrl ||
    (product.imageUrl?.startsWith("https://") ? product.imageUrl : null);

  // Client-side dynamic signing fallback:
  // If product has an internal storage path but signedImageUrl was not pre-signed
  React.useEffect(() => {
    let isMounted = true;
    if (
      !initialDisplayUrl &&
      product.imageUrl &&
      !product.imageUrl.startsWith("https://")
    ) {
      getSignedProductImageUrlAction(slug, product.imageUrl)
        .then((res) => {
          if (isMounted && res.success && res.data?.signedUrl) {
            setClientSignedUrl(res.data.signedUrl);
          }
        })
        .catch(() => {
          // Graceful fallback to Package placeholder icon
        });
    }
    return () => {
      isMounted = false;
    };
  }, [initialDisplayUrl, product.imageUrl, slug]);

  const displayUrl = initialDisplayUrl || clientSignedUrl;

  // Genuine no-image state, or image failed to load -> show intended Package placeholder icon
  if (!displayUrl || hasError) {
    return (
      <div
        className="h-10 w-10 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden"
        data-testid={`product-thumbnail-placeholder-${product.id}`}
      >
        <Package className="h-5 w-5 text-gray-400" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className="h-10 w-10 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden"
      data-testid={`product-thumbnail-image-${product.id}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={displayUrl}
        alt={product.name}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

/**
 * ProductTable (T025, FR-026, FR-029, FR-030, FR-039)
 *
 * Responsive catalog table rendering SKU, Name, Category, UOM badge,
 * Selling Price, Status badge, and conditional Cost/Margin columns strictly gated
 * by `products:read_cost` permission (omitted entirely for Cashiers).
 */
export function ProductTable({
  products,
  canReadCost,
  canCreate = false,
  canUpdate = false,
  canArchive = false,
  currency,
  sortBy = "name",
  sortOrder = "asc",
  slug,
  hasActiveFilters = false,
}: ProductTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const handleSort = (field: ProductSortField) => {
    const params = new URLSearchParams(searchParams.toString());
    const isCurrentField = sortBy === field;
    const nextOrder: SortOrder = isCurrentField && sortOrder === "asc" ? "desc" : "asc";

    params.set("sortBy", field);
    params.set("sortOrder", nextOrder);
    params.delete("page");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleClearFilters = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const renderSortIcon = (field: ProductSortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
    );
  };

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-900/50">
        <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
          <Package className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {hasActiveFilters ? "No products found" : "No products yet"}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
          {hasActiveFilters
            ? "No products match your current search and filter criteria. Try adjusting or clearing your filters."
            : "Your organization does not have any registered products. Get started by adding your first catalog item."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Clear Filters
            </button>
          )}
          {!hasActiveFilters && canCreate && (
            <Link
              href={`/${slug}/products/new`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Create First Product</span>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-950/70 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          <tr>
            <th scope="col" className="py-3.5 pl-4 pr-3 sm:pl-6">
              <button
                type="button"
                onClick={() => handleSort("name")}
                className="group inline-flex items-center gap-1.5 focus:outline-none"
              >
                <span>Product</span>
                {renderSortIcon("name")}
              </button>
            </th>
            <th scope="col" className="px-3 py-3.5">
              <button
                type="button"
                onClick={() => handleSort("sku")}
                className="group inline-flex items-center gap-1.5 focus:outline-none"
              >
                <span>SKU</span>
                {renderSortIcon("sku")}
              </button>
            </th>
            <th scope="col" className="px-3 py-3.5 hidden md:table-cell">
              Barcode
            </th>
            <th scope="col" className="px-3 py-3.5">
              Category
            </th>
            <th scope="col" className="px-3 py-3.5">
              UOM
            </th>
            <th scope="col" className="px-3 py-3.5 text-right">
              <button
                type="button"
                onClick={() => handleSort("selling_price")}
                className="group inline-flex items-center gap-1.5 focus:outline-none justify-end w-full"
              >
                <span>Selling Price</span>
                {renderSortIcon("selling_price")}
              </button>
            </th>

            {/* Confidential Cost & Margin columns: ONLY rendered if caller has products:read_cost */}
            {canReadCost && (
              <>
                <th scope="col" className="px-3 py-3.5 text-right">
                  Cost Price
                </th>
                <th scope="col" className="px-3 py-3.5 text-right">
                  Margin
                </th>
              </>
            )}

            <th scope="col" className="px-3 py-3.5 text-center">
              Status
            </th>

            {(canUpdate || canArchive) && (
              <th scope="col" className="px-3 py-3.5 text-right">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {products.map((product) => {
            const hasNegativeMargin =
              canReadCost &&
              product.grossMargin !== undefined &&
              product.grossMargin !== null &&
              product.grossMargin < 0;

            return (
              <tr
                key={product.id}
                className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors"
              >
                {/* Product Name & Thumbnail */}
                <td className="py-3.5 pl-4 pr-3 sm:pl-6">
                  <div className="flex items-center gap-3">
                    <ProductThumbnail product={product} slug={slug} />
                    <div className="min-w-0">
                      <Link
                        href={`/${slug}/products/${product.id}`}
                        className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate block max-w-xs"
                      >
                        {product.name}
                      </Link>
                      {product.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </div>
                </td>

                {/* SKU */}
                <td className="px-3 py-3.5 whitespace-nowrap font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {product.sku}
                </td>

                {/* Barcode */}
                <td className="px-3 py-3.5 whitespace-nowrap font-mono text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">
                  {product.barcode || "—"}
                </td>

                {/* Category */}
                <td className="px-3 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                  {product.categoryName ? (
                    <span className="inline-flex items-center gap-1">
                      <span>{product.categoryName}</span>
                    </span>
                  ) : (
                    <span className="italic text-gray-400 dark:text-gray-500">Uncategorized</span>
                  )}
                </td>

                {/* UOM Badge */}
                <td className="px-3 py-3.5 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                    {product.unitOfMeasure}
                  </span>
                </td>

                {/* Selling Price */}
                <td className="px-3 py-3.5 whitespace-nowrap text-right font-medium text-gray-900 dark:text-gray-100">
                  {formatCurrency(product.sellingPrice, currency)}
                </td>

                {/* Confidential Cost Price (gated by products:read_cost) */}
                {canReadCost && (
                  <td className="px-3 py-3.5 whitespace-nowrap text-right text-gray-600 dark:text-gray-400 font-mono text-xs">
                    {product.costPrice !== undefined && product.costPrice !== null
                      ? formatCurrency(product.costPrice, currency)
                      : "—"}
                  </td>
                )}

                {/* Confidential Gross Margin (gated by products:read_cost) */}
                {canReadCost && (
                  <td className="px-3 py-3.5 whitespace-nowrap text-right text-xs">
                    {product.grossMargin !== undefined && product.grossMargin !== null ? (
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          hasNegativeMargin
                            ? "text-red-600 dark:text-red-400 font-semibold"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {hasNegativeMargin && (
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-label="Negative Margin Warning" />
                        )}
                        <span>{formatGrossMargin(product.grossMargin)}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                    )}
                  </td>
                )}

                {/* Status Badge */}
                <td className="px-3 py-3.5 whitespace-nowrap text-center">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
                      product.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800"
                        : product.status === "inactive"
                        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800"
                        : "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
                    }`}
                  >
                    {product.status}
                  </span>
                </td>

                {/* Lifecycle Actions */}
                {(canUpdate || canArchive) && (
                  <td className="px-3 py-3.5 whitespace-nowrap text-right">
                    <ProductLifecycleActions
                      slug={slug}
                      productId={product.id}
                      productName={product.name}
                      sku={product.sku}
                      initialStatus={product.status}
                      initialVersion={product.version}
                      canUpdate={canUpdate}
                      canArchive={canArchive}
                      variant="table"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

