import { z } from "zod";

export const recoveryGrantSecretSchema = z
  .string({
    required_error: "RECOVERY_GRANT_SECRET is required",
    invalid_type_error: "RECOVERY_GRANT_SECRET must be a string",
  })
  .min(32, "RECOVERY_GRANT_SECRET must be at least 32 characters long");

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL").default("http://localhost:3000"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required").optional(),
  RECOVERY_GRANT_SECRET: recoveryGrantSecretSchema.optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RECOVERY_GRANT_SECRET: process.env.RECOVERY_GRANT_SECRET,
  });

  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables configuration");
  }

  return parsed.data;
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
