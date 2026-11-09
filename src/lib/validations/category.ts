import { z } from "zod";

/**
 * Validation schema for category creation (T045, FR-030, FR-031).
 *
 * Rules:
 * - `name`: Required string, trimmed, 1–100 characters. Preserves display casing.
 * - `description`: Optional/nullable string, trimmed, $\le 500$ characters.
 */
export const CreateCategorySchema = z.object({
  name: z
    .string({ required_error: "Category name is required" })
    .trim()
    .min(1, "Category name is required")
    .max(100, "Category name must be 100 characters or less"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or less")
    .optional()
    .nullable(),
});

export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

/**
 * Validation schema for category updates (T045, FR-030, FR-031).
 *
 * Rules:
 * - `name`: Required string, trimmed, 1–100 characters. Preserves display casing.
 * - `description`: Optional/nullable string, trimmed, $\le 500$ characters.
 */
export const UpdateCategorySchema = z.object({
  name: z
    .string({ required_error: "Category name is required" })
    .trim()
    .min(1, "Category name is required")
    .max(100, "Category name must be 100 characters or less"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or less")
    .optional()
    .nullable(),
});

export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

