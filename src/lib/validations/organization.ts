import { z } from "zod";

/**
 * Zod validation schema for creating a new retail organization tenant (T029, FR-008, FR-010).
 * Enforces ISO 3166-1 alpha-2 country codes, ISO 4217 currency codes, and creator-bound clientMutationId.
 */
export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(100, "Organization name must not exceed 100 characters"),
  businessType: z
    .string()
    .trim()
    .min(2, "Business type is required")
    .max(50, "Business type must not exceed 50 characters"),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, "Country must be a 2-letter uppercase ISO 3166-1 alpha-2 code")
    .regex(/^[A-Z]{2}$/, "Country code must be exactly two uppercase letters"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Currency must be a 3-letter uppercase ISO 4217 code")
    .regex(/^[A-Z]{3}$/, "Currency code must be exactly three uppercase letters"),
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required"),
  clientMutationId: z
    .string()
    .uuid("Invalid client mutation identifier")
    .optional(),
  taxId: z
    .string()
    .trim()
    .max(50, "Tax ID must not exceed 50 characters")
    .optional(),
  phone: z
    .string()
    .trim()
    .max(30, "Phone number must not exceed 30 characters")
    .optional(),
  email: z
    .string()
    .trim()
    .email("Invalid business contact email")
    .optional()
    .or(z.literal("")),
  address: z
    .string()
    .trim()
    .max(255, "Address must not exceed 255 characters")
    .optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

