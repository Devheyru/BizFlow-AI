"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  AlertTriangle,
  Package,
  DollarSign,
  Tag,
} from "lucide-react";
import type { Product, UnitOfMeasure } from "@/types/product";
import { ALLOWED_UOM } from "@/types/product";
import { updateProductAction } from "@/actions/product-actions";
import { ConcurrencyConflictModal } from "@/components/products/ConcurrencyConflictModal";
import {
  ProductImageUploader,
  type ProductImageValue,
} from "@/components/products/ProductImageUploader";
import { createClient } from "@/lib/supabase/client";
import {
  uploadProductImage,
  removeProductImage,
} from "@/lib/products/image-storage";

export interface CategorySelectOption {
  id: string;
  name: string;
  status: "active" | "archived";
}

export interface ProductEditFormProps {
  product: Product;
  categories: CategorySelectOption[];
  currency: string;
  canReadCost: boolean;
  slug: string;
}

/**
 * ProductEditForm Component (T042, FR-008, FR-023, BR-016)
 *
 * Implements optimistic concurrency product editing with:
 * - Pre-populated fields and expected_version tracking
 * - Cost operation handling ('unchanged' | 'set' | 'clear') gated by canReadCost
 * - ConcurrencyConflictModal wired to P0010 (STALE_UPDATE_CONFLICT)
 * - Safe image update lifecycle
 */
export function ProductEditForm({
  product,
  categories,
  currency,
  canReadCost,
  slug,
}: ProductEditFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state initialized from current product
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description || "");
  const [sku, setSku] = useState(product.sku);
  const [barcode, setBarcode] = useState(product.barcode || "");
  const [categoryId, setCategoryId] = useState(product.categoryId || "");
  const [unitOfMeasure, setUnitOfMeasure] = useState<UnitOfMeasure>(product.unitOfMeasure);
  const [sellingPrice, setSellingPrice] = useState(product.sellingPrice.toString());
  // Media / Image state initialized from product
  const [imageState, setImageState] = useState<ProductImageValue>(() => {
    if (!product.imageUrl) {
      return { file: null, url: null, source: "none" };
    }
    if (product.imageUrl.startsWith("https://")) {
      return { file: null, url: product.imageUrl, source: "url" };
    }
    return { file: null, url: null, source: "file" };
  });

  // Cost management state
  const [costOperation, setCostOperation] = useState<"unchanged" | "set" | "clear">("unchanged");
  const [costPrice, setCostPrice] = useState(
    product.costPrice !== null && product.costPrice !== undefined
      ? product.costPrice.toString()
      : ""
  );

  // Error & Conflict states
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const parsedSellingPrice = parseFloat(sellingPrice);
    if (isNaN(parsedSellingPrice) || parsedSellingPrice < 0) {
      setErrorMessage("Selling price must be a valid number greater than or equal to 0.00.");
      return;
    }

    let parsedCostPrice: number | undefined = undefined;
    if (costOperation === "set") {
      parsedCostPrice = parseFloat(costPrice);
      if (isNaN(parsedCostPrice) || parsedCostPrice < 0) {
        setErrorMessage("Cost price must be a valid number greater than or equal to 0.00 when setting cost.");
        return;
      }
    }

    startTransition(async () => {
      let finalImageUrl: string | null = product.imageUrl ?? null;
      let newlyUploadedStoragePath: string | null = null;
      const supabase = createClient();

      // If user selected a new binary file to replace/set product image
      if (imageState.source === "file" && imageState.file) {
        const uploadRes = await uploadProductImage(
          supabase,
          product.organizationId,
          product.id,
          imageState.file
        );

        if (!uploadRes.success) {
          setErrorMessage(`Failed to upload product image: ${uploadRes.error}`);
          return;
        }

        finalImageUrl = uploadRes.path;
        newlyUploadedStoragePath = uploadRes.path;
      } else if (imageState.source === "url" && imageState.url) {
        finalImageUrl = imageState.url.trim();
      } else if (imageState.source === "none") {
        finalImageUrl = null;
      }

      let result;
      try {
        result = await updateProductAction(slug, product.id, {
          expected_version: product.version,
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          sku: sku.trim().toUpperCase(),
          barcode: barcode.trim() ? barcode.trim() : null,
          category_id: categoryId ? categoryId : null,
          unit_of_measure: unitOfMeasure,
          selling_price: parsedSellingPrice,
          cost_operation: costOperation,
          cost_price: parsedCostPrice,
          image_url: finalImageUrl,
        });
      } catch (actionErr) {
        // Fallback rollback cleanup only if server action invocation crashed unexpectedly
        if (newlyUploadedStoragePath) {
          await removeProductImage(supabase, newlyUploadedStoragePath, {
            operation: "rollback_new_image",
            organizationId: product.organizationId,
            productId: product.id,
          });
        }
        setErrorMessage(actionErr instanceof Error ? actionErr.message : "Failed to update product.");
        return;
      }

      if (!result.success) {
        // Server action updateProductAction already authoritatively rolled back newlyUploadedStoragePath.
        // Avoid duplicate client-side deletion.
        if (
          result.error?.code === "P0010" ||
          result.error?.code === "CONCURRENCY_CONFLICT" ||
          result.error?.code === "STALE_UPDATE_CONFLICT"
        ) {
          setIsConflictOpen(true);
          setConflictVersion(product.version + 1);
        } else {
          setErrorMessage(result.error?.message || "Failed to update product.");
        }
        return;
      }

      // Success: redirect to product detail page
      router.push(`/${slug}/products/${product.id}`);
      router.refresh();
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Navigation & Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="space-y-1">
          <Link
            href={`/${slug}/products/${product.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Product Details
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Edit Product: {product.name}
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              v{product.version}
            </span>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-3 text-red-800 dark:text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{errorMessage}</div>
        </div>
      )}

      {/* Edit Form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Information Section */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-500" />
            General Information
          </h2>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed product description (optional)"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>
          </div>
        </div>

        {/* Identifiers & Categorization */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Tag className="h-4 w-4 text-zinc-500" />
            Identifiers &amp; Classification
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sku" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Stock Keeping Unit (SKU) <span className="text-red-500">*</span>
              </label>
              <input
                id="sku"
                type="text"
                required
                maxLength={50}
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2 text-sm font-mono uppercase rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            <div>
              <label htmlFor="barcode" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Barcode (UPC / EAN / GTIN)
              </label>
              <input
                id="barcode"
                type="text"
                maxLength={14}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Optional (8-14 alphanumeric)"
                className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            <div>
              <label htmlFor="category" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Category
              </label>
              <select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              >
                <option value="">Unassigned (None)</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} {cat.status === "archived" ? "(Archived)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="uom" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Unit of Measure (UOM) <span className="text-red-500">*</span>
              </label>
              <select
                id="uom"
                value={unitOfMeasure}
                onChange={(e) => setUnitOfMeasure(e.target.value as UnitOfMeasure)}
                className="w-full px-3.5 py-2 text-sm capitalize rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              >
                {ALLOWED_UOM.map((uom) => (
                  <option key={uom} value={uom} className="capitalize">
                    {uom}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Pricing & Cost Management */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Pricing &amp; Cost
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sellingPrice" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                Selling Price ({currency.toUpperCase()}) <span className="text-red-500">*</span>
              </label>
              <input
                id="sellingPrice"
                type="number"
                step="0.01"
                min="0"
                required
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            {/* Confidential Cost Management (Gated by canReadCost) */}
            {canReadCost ? (
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                  Cost Price Operation (Confidential)
                </label>
                <div className="flex gap-4">
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="radio"
                      name="costOp"
                      value="unchanged"
                      checked={costOperation === "unchanged"}
                      onChange={() => setCostOperation("unchanged")}
                      className="text-zinc-900 focus:ring-zinc-900"
                    />
                    Keep Unchanged
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="radio"
                      name="costOp"
                      value="set"
                      checked={costOperation === "set"}
                      onChange={() => setCostOperation("set")}
                      className="text-zinc-900 focus:ring-zinc-900"
                    />
                    Update Cost
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="radio"
                      name="costOp"
                      value="clear"
                      checked={costOperation === "clear"}
                      onChange={() => setCostOperation("clear")}
                      className="text-zinc-900 focus:ring-zinc-900"
                    />
                    Clear Cost
                  </label>
                </div>

                {costOperation === "set" && (
                  <div className="pt-2 animate-in fade-in duration-150">
                    <label htmlFor="costPrice" className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1">
                      New Cost Price ({currency.toUpperCase()}) <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="costPrice"
                      type="number"
                      step="0.0001"
                      min="0"
                      required={costOperation === "set"}
                      value={costPrice}
                      onChange={(e) => setCostPrice(e.target.value)}
                      placeholder="0.0000"
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                    />
                  </div>
                )}
                {costOperation === "clear" && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Submitting will delete the recorded cost price, marking it as unknown/unrecorded.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Media / Product Image Uploader (T031, T042, FR-011, FR-042) */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-500" />
            Product Media
          </h2>

          <ProductImageUploader
            mode="edit"
            slug={slug}
            organizationId={product.organizationId}
            productId={product.id}
            initialImageUrl={product.imageUrl}
            value={imageState}
            onChange={setImageState}
            disabled={isPending}
          />
        </div>

        {/* Form Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <Link
            href={`/${slug}/products/${product.id}`}
            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-lg shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-4 w-4" />
            {isPending ? "Saving Changes..." : "Save Product"}
          </button>
        </div>
      </form>

      {/* Concurrency Conflict Modal (T038, FR-023, BR-016) */}
      <ConcurrencyConflictModal
        isOpen={isConflictOpen}
        onClose={() => setIsConflictOpen(false)}
        expectedVersion={product.version}
        currentVersion={conflictVersion}
        onRefresh={() => {
          setIsConflictOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
