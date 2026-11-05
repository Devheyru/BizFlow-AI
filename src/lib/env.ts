import { z } from "zod";

export const recoveryGrantSecretSchema = z
  .string({
    required_error: "RECOVERY_GRANT_SECRET is required",
    invalid_type_error: "RECOVERY_GRANT_SECRET must be a string",
  })
  .min(32, "RECOVERY_GRANT_SECRET must be at least 32 characters long");

export const resendApiKeySchema = z
  .string({
    required_error: "RESEND_API_KEY is required",
    invalid_type_error: "RESEND_API_KEY must be a string",
  })
  .min(1, "RESEND_API_KEY cannot be empty");

export const emailFromSchema = z
  .string({
    required_error: "EMAIL_FROM is required",
    invalid_type_error: "EMAIL_FROM must be a string",
  })
  .min(1, "EMAIL_FROM cannot be empty")
  .refine(
    (val) => {
      const emailRegex = /^(?:[^\r\n<]+<)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?$/;
      return emailRegex.test(val.trim());
    },
    { message: "EMAIL_FROM must be a valid email address or 'Display Name <email@domain.com>'" }
  );

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL").default("http://localhost:3000"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required").optional(),
  RECOVERY_GRANT_SECRET: recoveryGrantSecretSchema.optional(),
  RESEND_API_KEY: resendApiKeySchema.optional(),
  EMAIL_FROM: emailFromSchema.optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RECOVERY_GRANT_SECRET: process.env.RECOVERY_GRANT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables configuration");
  }

  return parsed.data;
}

/**
 * Validates production mailer configuration.
 * Fails safely if either required configuration is missing in production.
 */
export function validateMailerConfig(envOverrides?: {
  apiKey?: string;
  emailFrom?: string;
  nodeEnv?: string;
}): { apiKey: string; emailFrom: string } {
  const nodeEnv = envOverrides?.nodeEnv ?? process.env.NODE_ENV;
  const rawApiKey = envOverrides?.apiKey ?? process.env.RESEND_API_KEY;
  const rawEmailFrom = envOverrides?.emailFrom ?? process.env.EMAIL_FROM;

  const apiKeyRes = resendApiKeySchema.safeParse(rawApiKey);
  const emailFromRes = emailFromSchema.safeParse(rawEmailFrom);

  const missing: string[] = [];
  if (!apiKeyRes.success) missing.push("RESEND_API_KEY");
  if (!emailFromRes.success) missing.push("EMAIL_FROM");

  if (missing.length > 0) {
    const errorMsg = `Missing or invalid required email configuration in production: ${missing.join(", ")}`;
    if (nodeEnv === "production") {
      throw new Error(errorMsg);
    }
    throw new Error(`Email configuration error: ${missing.join(", ")}`);
  }

  return {
    apiKey: apiKeyRes.data!,
    emailFrom: emailFromRes.data!,
  };
}

/**
 * Validates and returns the dedicated server-only secret for password recovery HMAC signing.
 * Fails securely if the secret is missing or less than 32 characters (256 bits).
 */
export function validateRecoveryGrantSecret(secret?: string): string {
  const value = secret !== undefined ? secret : process.env.RECOVERY_GRANT_SECRET;
  const parsed = recoveryGrantSecretSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error(
      "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
    );
  }

  return parsed.data;
}
