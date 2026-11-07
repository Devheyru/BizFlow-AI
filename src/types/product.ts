/**
 * Feature 003 — Products & Categories Domain Types
 * Authoritative source: specs/003-products-categories/data-model.md
 * In compliance with BizFlow AI Constitution v1.1.0 (Strict TypeScript, zero `any`)
 */

// ============================================================================
// Unit of Measure (BR-017)
// ============================================================================

/**
 * Approved retail Unit of Measure (UOM) values in compliance with BR-017.
 * Default: 'piece'
 */
export const ALLOWED_UOM = Object.freeze([
  "piece",
  "unit",
  "kg",
  "g",
  "mg",
  "liter",
  "ml",
  "meter",
  "cm",
  "box",
  "pack",
  "pair",
  "set",
] as const);

export type UnitOfMeasure = (typeof ALLOWED_UOM)[number];

// ============================================================================
// Lifecycle & Operational Statuses (BR-001, BR-002, BR-016)
// ============================================================================

/**
 * 3-state product operational and lifecycle status in compliance with BR-001.
 * Supports reversible lifecycle transitions:
 * - active ↔ inactive (operational status toggle)
 * - active → archived (reversible soft-archival)
 * - inactive → archived (reversible soft-archival)
 * - archived → active (restoration)
 *
 * States:
 * - 'active': Available for retail display and sales.
 * - 'inactive': Temporarily hidden from sales; SKU/barcode reserved.
 * - 'archived': Reversibly soft-archived; SKU and barcode identifiers remain permanently reserved.
 */
export type ProductStatus = "active" | "inactive" | "archived";

/**
 * 2-state category operational and lifecycle status in compliance with BR-002.
 * - 'active': Available for category assignment.
 * - 'archived': Soft-deleted; cannot be newly assigned to products.
 */
export type CategoryStatus = "active" | "archived";

/**
 * Explicit cost modification operations for optimistic concurrency updates (BR-021).
 */
export type CostOperation = "unchanged" | "set" | "clear";

// ============================================================================
// Category Domain Models
// ============================================================================

export interface ProductCategory {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: CategoryStatus;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategoryListItem extends ProductCategory {
  productCount: number;
}

// ============================================================================
// Product Domain Models
// ============================================================================

export interface Product {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  category?: ProductCategory | null;
  sellingPrice: number;
  /**
   * Acquisition cost price:
   * - `number (> 0)`: Recorded nonzero cost.
   * - `0`: Recorded cost of zero.
   * - `null`: Product exists but has no recorded cost record.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  costPrice?: number | null;
  /**
   * Calculated gross profit margin percentage:
   * - `number`: Margin computed from selling price and recorded cost price.
   * - `null`: Uncalculated because cost is unrecorded (`costPrice === null`) or selling price is zero.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission (prevents derivation leakage).
   */
  grossMargin?: number | null;
  unitOfMeasure: UnitOfMeasure;
  imageUrl: string | null;
  signedImageUrl?: string | null; // Short-lived 3600s dynamic signed URL for private Storage objects
  status: ProductStatus;
  version: number; // Optimistic Concurrency Control integer (BR-016)
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface ProductCost {
  productId: string;
  organizationId: string;
  costPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  sellingPrice: number;
  /**
   * Acquisition cost price:
   * - `number (> 0)`: Recorded nonzero cost.
   * - `0`: Recorded cost of zero.
   * - `null`: Product exists but has no recorded cost record.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  costPrice?: number | null;
  /**
   * Calculated gross profit margin percentage:
   * - `number`: Margin computed from selling price and recorded cost price.
   * - `null`: Uncalculated because cost is unrecorded (`costPrice === null`) or selling price is zero.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission (prevents derivation leakage).
   */
  grossMargin?: number | null;
  unitOfMeasure: UnitOfMeasure;
  imageUrl: string | null;
  signedImageUrl?: string | null;
  status: ProductStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Catalog Search, Filtering, and Pagination Types
// ============================================================================

export type ProductSortField = "name" | "sku" | "selling_price" | "created_at";
export type SortOrder = "asc" | "desc";

export interface CatalogFilterParams {
  query?: string;
  categoryId?: string;
  status?: ProductStatus | "all";
  sortBy?: ProductSortField;
  sortOrder?: SortOrder;
  page?: number;
  pageSize?: number;
}

export interface PaginatedProducts {
  items: ProductListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================================
// Financial & Margin Calculation Domain Models
// ============================================================================

export interface ProductMarginMetrics {
  sellingPrice: number;
  /**
   * Acquisition cost price:
   * - `number (> 0)`: Recorded nonzero cost.
   * - `0`: Recorded cost of zero.
   * - `null`: Product exists but has no recorded cost record.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  costPrice?: number | null;
  /**
   * Gross profit monetary value (`sellingPrice - costPrice`):
   * - `number`: Computed profit.
   * - `null`: Uncalculated because cost is unrecorded (`costPrice === null`).
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  grossProfit?: number | null;
  /**
   * Gross profit margin percentage:
   * - `number`: Computed margin percentage.
   * - `null`: Uncalculated because cost is unrecorded (`costPrice === null`) or sellingPrice is zero.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  grossMarginPercentage?: number | null;
  /**
   * Indicates whether an acquisition cost record exists in the database:
   * - `boolean`: True if cost record exists (including 0), false if unrecorded.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  hasRecordedCost?: boolean;
  /**
   * Indicates whether selling price is lower than acquisition cost:
   * - `boolean`: True if margin is negative, false otherwise.
   * - `undefined` (omitted property): Caller lacks `products:read_cost` permission.
   */
  isNegativeMargin?: boolean;
}
