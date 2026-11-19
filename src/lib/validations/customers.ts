import { z } from "zod";

/**
 * E.164 International Phone Regex:
 * Must start with '+', followed by country code (1-9), followed by 6 to 14 digits (total 8-15 chars).
 */
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Customer creation validation schema
 * Source: specs/005-customers-sales/contracts/server-actions.md §4
 */
export const createCustomerSchema = z.object({
  name: z
    .string({ required_error: "Customer name is required" })
    .trim()
    .min(1, "Customer name is required")
    .max(255, "Customer name cannot exceed 255 characters"),
  phone: z
    .string()
    .trim()
    .regex(E164_PHONE_REGEX, "Phone number must follow E.164 format (e.g., +15551234567)")
    .optional()
    .nullable(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address format")
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes cannot exceed 1000 characters")
    .optional()
    .nullable(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Customer update validation schema (supports partial updates)
 * Source: specs/005-customers-sales/contracts/server-actions.md §4
 */
export const updateCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Customer name cannot be empty")
    .max(255, "Customer name cannot exceed 255 characters")
    .optional(),
  phone: z
    .string()
    .trim()
    .regex(E164_PHONE_REGEX, "Phone number must follow E.164 format (e.g., +15551234567)")
    .optional()
    .nullable(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address format")
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes cannot exceed 1000 characters")
    .optional()
    .nullable(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/**
 * Customer search validation schema with pagination
 * Source: specs/005-customers-sales/contracts/server-actions.md §4
 */
export const customerSearchSchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["all", "active", "archived"]).default("active"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CustomerSearchInput = z.infer<typeof customerSearchSchema>;
