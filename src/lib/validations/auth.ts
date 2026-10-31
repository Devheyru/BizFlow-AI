import { z } from "zod";

/**
 * Password complexity requirements according to Constitutional Security & FR-002:
 * - Minimum 8 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character or symbol (!@#$%^&*(),.?":{}|<>)
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character or symbol");

/**
 * Registration validation schema (FR-001, FR-002)
 */
export const signUpSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  password: passwordSchema,
  firstName: z.string().trim().min(1, "First name is required").max(50, "First name cannot exceed 50 characters"),
  lastName: z.string().trim().min(1, "Last name is required").max(50, "Last name cannot exceed 50 characters"),
  phone: z
    .string()
    .trim()
    .max(20, "Phone number cannot exceed 20 characters")
    .optional()
    .or(z.literal("")),
  invitationToken: z.string().trim().optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Sign-in validation schema (FR-004)
 */
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Resend email verification validation schema
 */
export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

/**
 * Password recovery request schema
 */
export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email address is required")
    .email("Please enter a valid email address")
    .toLowerCase(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Password update / reset schema
 */
export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

