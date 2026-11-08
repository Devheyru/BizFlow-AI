/**
 * Feature 003 — Products & Categories Zod Validations
 * Authoritative sources:
 * - specs/003-products-categories/spec.md
 * - specs/003-products-categories/contracts/server-actions.md
 * In compliance with BizFlow AI Constitution v1.1.0 (Strict TypeScript, zero `any`)
 */

import { z } from "zod";
import { ALLOWED_UOM } from "@/types/product";

export { ALLOWED_UOM };

/**
 * Maximum precision bound for NUMERIC(14, 4) columns:
 * 10 integer digits and 4 decimal digits = 9,999,999,999.9999
 */
export const MAX_MONETARY_NUMERIC_VALUE = 9999999999.9999;

/**
 * Regex for internal Supabase storage object path:
 * {org_id}/{product_id}/{filename}
 * org_id and product_id must be valid UUIDs.
 */
export const STORAGE_OBJECT_PATH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]+$/;

/**
 * Validates that an image URL string is a valid external HTTPS URL.
 * Combines strict raw lexical checks with standards-compliant WHATWG URL parsing
 * and exact parity with PostgreSQL ARE hostname regular expression:
 * - Requires exact "https://" protocol prefix.
 * - Rejects any raw whitespace anywhere in the string (including newlines, tabs, spaces).
 * - Rejects empty authority (e.g. "https:///image.png") and empty host ("https://").
 * - Parses via WHATWG `new URL()` ensuring a valid protocol and non-empty hostname.
 * - Rejects non-HTTPS schemes (http, javascript, data, ftp, file) and internal storage paths.
 * - Enforces RFC-compliant hostname syntax with optional dot-separated labels,
 *   optional numeric port, and optional path, query, or fragment.
 */
export function isValidExternalHttpsUrl(val: string): boolean {
  if (typeof val !== "string") {
    return false;
  }
  // 1. Raw whitespace check: Reject any raw whitespace anywhere in the string
  if (/\s/.test(val)) {
    return false;
  }
  // 2. Reject internal Supabase Storage paths
  if (/^[0-9a-f-]{36}\//i.test(val)) {
    return false;
  }
  // 3. Scheme check: Must explicitly start with https://
  if (!val.startsWith("https://")) {
    return false;
  }
  const afterScheme = val.slice("https://".length);
  if (afterScheme.length === 0 || afterScheme.startsWith("/")) {
    return false;
  }

  // 4. WHATWG URL parser validation
  try {
    const parsed = new URL(val);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!parsed.hostname || parsed.hostname.trim().length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  // 5. Exact parity with PostgreSQL ARE regular expression
  const POSTGRES_ARE_URL_REGEX =
    /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]+)?([/?#][^\s]*)?$/;
  if (!POSTGRES_ARE_URL_REGEX.test(val)) {
    return false;
  }

  return true;
}

/**
 * Zod validation schema for Product Creation (T030, FR-001 - FR-007, BR-017).
 * Explicitly excludes `cost_operation` (which belongs exclusively to update operations).
 * Image URL accepts ONLY valid external HTTPS URLs or null/omitted. Internal storage paths
 * are rejected at creation and staged via updateProductAction post-creation (FR-011, FR-012).
 * Note: Does not silently trim image_url so that raw whitespace/newlines are rejected.
 */
export const CreateProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Product name is required")
    .max(150, "Name must be 150 characters or less"),
  sku: z
    .string()
    .trim()
    .min(1, "SKU is required")
    .max(50, "SKU must be 50 characters or less")
    .regex(/^[A-Za-z0-9._-]+$/, "SKU contains invalid characters")
    .transform((v) => v.toUpperCase()),
  selling_price: z
    .number({ invalid_type_error: "Selling price must be a valid number" })
    .min(0, "Selling price must be greater than or equal to 0")
    .max(MAX_MONETARY_NUMERIC_VALUE, "Selling price exceeds maximum allowed value"),
  unit_of_measure: z.enum(ALLOWED_UOM).default("piece"),
  barcode: z
    .string()
    .trim()
    .min(3, "Barcode must be at least 3 characters")
    .max(50, "Barcode must be 50 characters or less")
    .regex(/^[A-Za-z0-9-]{3,50}$/, "Barcode contains invalid characters")
    .optional()
    .nullable(),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or less")
    .optional()
    .nullable(),
  category_id: z
    .string()
    .uuid("Invalid category ID")
    .optional()
    .nullable(),
  cost_price: z
    .number({ invalid_type_error: "Cost price must be a valid number" })
    .min(0, "Cost price must be greater than or equal to 0")
    .max(MAX_MONETARY_NUMERIC_VALUE, "Cost price exceeds maximum allowed value")
    .optional()
    .nullable(),
  image_url: z
    .string()
    .refine((val) => isValidExternalHttpsUrl(val), {
      message: "Image URL must be a valid external HTTPS URL",
    })
    .optional()
    .nullable(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

