import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Storage configuration constants (specs/003-products-categories/spec.md)
 */
export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB in bytes (5,242,880)
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export const PRODUCT_IMAGES_BUCKET = "product-images";

/**
 * Validates a file for MIME type and 5 MB size limit on the client.
 */
export function validateImageFile(file: File): { valid: true } | { valid: false; error: string } {
  if (!file) {
    return { valid: false, error: "No file selected." };
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as AllowedImageMimeType)) {
    return {
      valid: false,
      error: `Unsupported file format (${file.type || "unknown"}). Allowed formats are JPEG, PNG, WebP, and GIF.`,
    };
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    const sizeInMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File size (${sizeInMb} MB) exceeds the maximum allowed limit of 5 MB.`,
    };
  }

  return { valid: true };
}

/**
 * Sanitizes a raw file name to ensure it conforms to [A-Za-z0-9._-]+
 */
export function sanitizeImageFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || "image";
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean || "product_image.png";
}

/**
 * Constructs the canonical internal relative Storage object path:
 * {organization_id}/{product_id}/{filename}
 * Note: Never prepends the bucket name `product-images/`.
 */
export function buildProductStoragePath(
  organizationId: string,
  productId: string,
  fileName: string
): string {
  const clean = sanitizeImageFileName(fileName);
  const uniqueName = `${Date.now()}_${clean}`;
  return `${organizationId}/${productId}/${uniqueName}`;
}

/**
 * Uploads an image file to the private product-images Supabase Storage bucket.
 * Must only be called after product creation has succeeded so that the product ID exists
 * and satisfies the storage.objects RLS foreign reference constraint.
 */
export async function uploadProductImage(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  file: File
): Promise<{ success: true; path: string } | { success: false; error: string }> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const storagePath = buildProductStoragePath(organizationId, productId, file.name);

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to upload image to storage.",
    };
  }

  return { success: true, path: storagePath };
}

/**
 * Context for observability during private Storage object cleanup operations.
 */
export type StorageCleanupOperation =
  | "rollback_new_image"
  | "post_commit_superseded_image"
  | "registration_rollback";

export interface StorageCleanupContext {
  operation: StorageCleanupOperation;
  organizationId: string;
  productId: string;
}

/**
 * Removes a product image object from the private product-images Storage bucket.
 * Used for rollback cleanup when post-creation association fails, or for edit-mode replacement.
 * Logs structured server-side diagnostics when cleanup fails without exposing internals or secrets.
 */
export async function removeProductImage(
  supabase: SupabaseClient,
  storagePath: string,
  context?: StorageCleanupContext
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .remove([storagePath]);

    if (error) {
      console.error("[STORAGE_CLEANUP_FAILURE]", {
        operation: context?.operation || "remove_product_image",
        organizationId: context?.organizationId || "unknown",
        productId: context?.productId || "unknown",
        storagePath,
        errorCategory: "storage_api_error",
        error: error.message,
      });
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Failed to remove image from storage.";
    console.error("[STORAGE_CLEANUP_EXCEPTION]", {
      operation: context?.operation || "remove_product_image",
      organizationId: context?.organizationId || "unknown",
      productId: context?.productId || "unknown",
      storagePath,
      errorCategory: "network_exception",
      error: errorMessage,
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

