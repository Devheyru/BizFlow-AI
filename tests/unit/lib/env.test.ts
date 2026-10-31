import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv } from "@/lib/env";

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
});

