"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import {
  Package,
  DollarSign,
  Tag,
  AlertTriangle,
  Save,
  Loader2,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import {
  CreateProductSchema,
  type CreateProductInput,
  ALLOWED_UOM,
} from "@/lib/validations/product";
import { createProductAction, updateProductAction } from "@/actions/product-actions";
import {
  ProductImageUploader,
  type ProductImageValue,
} from "@/components/products/ProductImageUploader";
import { createClient } from "@/lib/supabase/client";
import { uploadProductImage, removeProductImage } from "@/lib/products/image-storage";
import type { UnitOfMeasure } from "@/types/product";

export interface CategoryOption {
  id: string;
  name: string;
}

export interface ProductFormProps {
  slug: string;
  organizationId: string;
  currency: string;
  canReadCost: boolean;
  categories: CategoryOption[];
  onSuccess?: (productId: string) => void;
}

interface FormValues {
  name: string;
  sku: string;
  selling_price: number | string;
  unit_of_measure: UnitOfMeasure;
  barcode?: string;
  description?: string;
  category_id?: string;
  cost_price?: number | string;
}

/**
 * ProductForm Component (T033, US2, FR-001 - FR-016, FR-039, FR-042)
 *
 * Implements canonical product registration with:
 * - React Hook Form + Zod validation using CreateProductSchema
 * - Active category dropdown with graceful empty-state handling
 * - Strict role-based cost price confidentiality (completely omitted when unauthorized)
 * - Canonical product-first staged image upload lifecycle:
 *   1. createProductAction called (persisting product with null or HTTPS image)
 *   2. If local file was staged, uploaded to private product-images bucket
 *   3. updateProductAction called with expected_version: 1 to attach storage path
 *   4. Safe rollback cleanup of storage object on failure without deleting product
 */
export function ProductForm({
  slug,
  organizationId,
  currency,
  canReadCost,
  categories,
  onSuccess,
}: ProductFormProps) {
  const router = useRouter();

  // Staged image state from ProductImageUploader
  const [imageState, setImageState] = useState<ProductImageValue>({
    file: null,
    url: null,
    source: "none",
  });

  // Submission lifecycle state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionProgress, setSubmissionProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Partial success state (product created but image attachment failed)
  const [partialSuccess, setPartialSuccess] = useState<{
    productId: string;
    productName: string;
    message: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      name: "",
      sku: "",
      selling_price: "",
      unit_of_measure: "piece",
      barcode: "",
      description: "",
      category_id: "",
      cost_price: "",
    },
  });

  const onSubmit = async (data: FormValues) => {
    // If a product was already created in a previous step of this submission, avoid duplicate creation
    if (partialSuccess) {
      router.push(`/${slug}/products/${partialSuccess.productId}`);
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    setSubmissionProgress("Creating product record...");

    try {
      // 1. Parse and sanitize form inputs
      const sellingPriceNum = Number(data.selling_price);
      if (isNaN(sellingPriceNum) || sellingPriceNum < 0) {
        setFormError("Selling price must be a valid non-negative number.");
        setIsSubmitting(false);
        setSubmissionProgress(null);
        return;
      }

      let costPriceNum: number | undefined = undefined;
      if (canReadCost && data.cost_price !== undefined && data.cost_price !== "") {
        costPriceNum = Number(data.cost_price);
        if (isNaN(costPriceNum) || costPriceNum < 0) {
          setFormError("Cost price must be a valid non-negative number.");
          setIsSubmitting(false);
          setSubmissionProgress(null);
          return;
        }
      }

      // If external HTTPS URL is used, pass it directly; if local file, image is staged and passed as null
      const imageUrlToPersist =
        imageState.source === "url" && imageState.url ? imageState.url.trim() : null;

      const createPayload: CreateProductInput = {
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        selling_price: sellingPriceNum,
        unit_of_measure: data.unit_of_measure,
        barcode: data.barcode?.trim() || null,
        description: data.description?.trim() || null,
        category_id: data.category_id || null,
        image_url: imageUrlToPersist,
        ...(canReadCost && costPriceNum !== undefined ? { cost_price: costPriceNum } : {}),
      };

      // 2. Validate with CreateProductSchema on the client
      const parsed = CreateProductSchema.safeParse(createPayload);
      if (!parsed.success) {
        const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
        setFormError(firstError || "Invalid product parameters provided.");
        setIsSubmitting(false);
        setSubmissionProgress(null);
        return;
      }

      // 3. Step 1: Create Product Record via Server Action
      const createRes = await createProductAction(slug, createPayload);

      if (!createRes.success) {
        setFormError(createRes.error.message || "Failed to create product.");
        setIsSubmitting(false);
        setSubmissionProgress(null);
        return;
      }

      const createdProduct = createRes.data;

      // 4. Step 2: Handle Staged Image Upload (if local file was staged)
      if (imageState.source === "file" && imageState.file) {
        setSubmissionProgress("Product created. Uploading product image...");

        const supabase = createClient();
        const uploadResult = await uploadProductImage(
          supabase,
          organizationId,
          createdProduct.id,
          imageState.file
        );

        if (!uploadResult.success) {
          // Upload failed: inform user that product was created without image
          setIsSubmitting(false);
          setSubmissionProgress(null);
          setPartialSuccess({
            productId: createdProduct.id,
            productName: createdProduct.name,
            message: `Product was registered successfully, but the image could not be uploaded (${uploadResult.error}). You can attach an image later in the product editor.`,
          });
          return;
        }

        // 5. Step 3: Associate Uploaded Storage Path via updateProductAction
        setSubmissionProgress("Attaching image to product...");
        const storagePath = uploadResult.path;

        const updateRes = await updateProductAction(slug, createdProduct.id, {
          expected_version: 1,
          name: createdProduct.name,
          sku: createdProduct.sku,
          selling_price: createdProduct.selling_price,
          unit_of_measure: createdProduct.unit_of_measure,
          barcode: createdProduct.barcode ?? null,
          description: createPayload.description ?? null,
          category_id: createdProduct.category_id ?? null,
          cost_operation: "unchanged",
          image_url: storagePath,
        });

        if (!updateRes.success) {
          // Association failed: attempt rollback removal of uploaded storage object
          await removeProductImage(supabase, storagePath);

          setIsSubmitting(false);
          setSubmissionProgress(null);
          setPartialSuccess({
            productId: createdProduct.id,
            productName: createdProduct.name,
            message: `Product was registered successfully, but associating the image failed (${updateRes.error.message}). You can add an image in the product editor.`,
          });
          return;
        }
      }

      // 6. Complete Success: Navigate to product detail page
      setSubmissionProgress("Redirecting to product...");
      if (onSuccess) {
        onSuccess(createdProduct.id);
      } else {
        router.push(`/${slug}/products/${createdProduct.id}`);
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected server error occurred.";
      setFormError(msg);
      setIsSubmitting(false);
      setSubmissionProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Partial Success Alert (Product created, image failed) */}
      {partialSuccess && (
        <div
          role="alert"
          className="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-900/60 space-y-3"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Product &ldquo;{partialSuccess.productName}&rdquo; Registered
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {partialSuccess.message}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Link
              href={`/${slug}/products/${partialSuccess.productId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors"
            >
              <span>View Product</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={`/${slug}/products/${partialSuccess.productId}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
            >
              <span>Go to Image Editor</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Main Error Alert */}
      {formError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-3 text-red-800 dark:text-red-300 text-sm"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="font-medium">{formError}</div>
        </div>
      )}

      {/* Product Registration Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
        {/* Section 1: General Product Information */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-500" />
            <span>General Information</span>
          </h2>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label
                htmlFor="product-name"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                id="product-name"
                type="text"
                maxLength={150}
                disabled={isSubmitting || !!partialSuccess}
                placeholder="e.g. Organic Almond Milk 1L"
                {...register("name", { required: "Product name is required" })}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              />
              {errors.name && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="product-description"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Description
              </label>
              <textarea
                id="product-description"
                rows={3}
                maxLength={2000}
                disabled={isSubmitting || !!partialSuccess}
                placeholder="Detailed retail item description, ingredients, or storage guidelines (optional)"
                {...register("description")}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              />
              {errors.description && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {errors.description.message}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Identifiers & Categorization */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Tag className="h-4 w-4 text-zinc-500" />
            <span>Identifiers &amp; Classification</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="product-sku"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Stock Keeping Unit (SKU) <span className="text-red-500">*</span>
              </label>
              <input
                id="product-sku"
                type="text"
                maxLength={50}
                disabled={isSubmitting || !!partialSuccess}
                placeholder="e.g. MILK-ALM-001"
                {...register("sku", { required: "SKU is required" })}
                onChange={(e) => setValue("sku", e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2 text-sm font-mono uppercase rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                Unique identifier permanently reserved for this product.
              </p>
              {errors.sku && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.sku.message}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="product-barcode"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Barcode (UPC / EAN / GTIN)
              </label>
              <input
                id="product-barcode"
                type="text"
                maxLength={50}
                disabled={isSubmitting || !!partialSuccess}
                placeholder="Optional (3-50 alphanumeric or hyphen)"
                {...register("barcode")}
                className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              />
              {errors.barcode && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {errors.barcode.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="product-category"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Category
              </label>
              <select
                id="product-category"
                disabled={isSubmitting || !!partialSuccess}
                {...register("category_id")}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              >
                <option value="">Uncategorized (None)</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {categories.length === 0 && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  No active categories created yet. You can assign a category later.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="product-uom"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Unit of Measure (UOM) <span className="text-red-500">*</span>
              </label>
              <select
                id="product-uom"
                disabled={isSubmitting || !!partialSuccess}
                {...register("unit_of_measure")}
                className="w-full px-3.5 py-2 text-sm capitalize rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
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

        {/* Section 3: Pricing & Confidential Cost */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Pricing &amp; Valuation</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="product-selling-price"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
              >
                Selling Price ({currency.toUpperCase()}) <span className="text-red-500">*</span>
              </label>
              <input
                id="product-selling-price"
                type="number"
                step="0.0001"
                min="0"
                disabled={isSubmitting || !!partialSuccess}
                placeholder="0.00"
                {...register("selling_price", { required: "Selling price is required" })}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
              />
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                Retail price charged to customers at point of sale.
              </p>
              {errors.selling_price && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  {errors.selling_price.message}
                </p>
              )}
            </div>

            {/* Confidential Cost Price Field (Strictly Gated by canReadCost) */}
            {canReadCost && (
              <div>
                <label
                  htmlFor="product-cost-price"
                  className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1"
                >
                  Cost Price ({currency.toUpperCase()}){" "}
                  <span className="text-zinc-400 font-normal lowercase">(confidential)</span>
                </label>
                <input
                  id="product-cost-price"
                  type="number"
                  step="0.0001"
                  min="0"
                  disabled={isSubmitting || !!partialSuccess}
                  placeholder="Optional (unrecorded if omitted)"
                  {...register("cost_price")}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50"
                />
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                  Internal unit cost for margin analysis. Hidden from Cashiers.
                </p>
                {errors.cost_price && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {errors.cost_price.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 4: Product Media (ProductImageUploader) */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Package className="h-4 w-4 text-zinc-500" />
            <span>Product Media</span>
          </h2>

          <ProductImageUploader
            mode="registration"
            slug={slug}
            organizationId={organizationId}
            disabled={isSubmitting || !!partialSuccess}
            value={imageState}
            onChange={(val) => setImageState(val)}
          />
        </div>

        {/* Form Action Controls */}
        <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-5">
          <Link
            href={`/${slug}/products`}
            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </Link>

          <div className="flex items-center gap-3">
            {submissionProgress && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 animate-in fade-in">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                <span>{submissionProgress}</span>
              </span>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !!partialSuccess}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Registering...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>Register Product</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
