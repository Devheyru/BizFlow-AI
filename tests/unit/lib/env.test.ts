import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, validateRecoveryGrantSecret } from "@/lib/env";

describe("Environment Variable Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("successfully parses valid environment variables", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

    const env = getEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("test-anon-key");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("throws error when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    expect(() => getEnv()).toThrow("Invalid environment variables configuration");
  });

  it("throws error when NEXT_PUBLIC_SUPABASE_URL is not a valid URL", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "invalid-url";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    expect(() => getEnv()).toThrow("Invalid environment variables configuration");
  });

  it("successfully parses valid RECOVERY_GRANT_SECRET (>= 32 chars)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.RECOVERY_GRANT_SECRET = "a".repeat(32);

    const env = getEnv();
    expect(env.RECOVERY_GRANT_SECRET).toBe("a".repeat(32));
  });

  it("throws error when RECOVERY_GRANT_SECRET is present but shorter than 32 characters", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.RECOVERY_GRANT_SECRET = "too-short-secret";

    expect(() => getEnv()).toThrow("Invalid environment variables configuration");
  });

  describe("validateRecoveryGrantSecret", () => {
    it("returns valid secret when >= 32 characters", () => {
      const validSecret = "valid-secret-must-be-32-chars-long!";
      process.env.RECOVERY_GRANT_SECRET = validSecret;

      expect(validateRecoveryGrantSecret()).toBe(validSecret);
      expect(validateRecoveryGrantSecret(validSecret)).toBe(validSecret);
    });

    it("throws when secret is missing / undefined", () => {
      delete process.env.RECOVERY_GRANT_SECRET;

      expect(() => validateRecoveryGrantSecret()).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("throws when secret is shorter than 32 characters", () => {
      process.env.RECOVERY_GRANT_SECRET = "short-secret-key";

      expect(() => validateRecoveryGrantSecret()).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
      expect(() => validateRecoveryGrantSecret("12345")).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });
  });
});
