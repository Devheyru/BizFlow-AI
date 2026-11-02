import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSigningSecret,
  createRecoveryGrant,
  verifyRecoveryGrant,
  hashRecoveryNonce,
  isRecoverySession,
  getSessionIdFromToken,
} from "@/lib/auth/recovery";
import type { Session } from "@supabase/supabase-js";

describe("Recovery Grant Unit Tests (Dedicated Secret Isolation)", () => {
  const originalEnv = process.env;
  const VALID_SECRET = "test-recovery-secret-minimum-32-characters-required!";
  const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
  const TEST_SESSION_ID = "session-12345";

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.RECOVERY_GRANT_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getSigningSecret", () => {
    it("returns RECOVERY_GRANT_SECRET when properly configured (>= 32 chars)", () => {
      expect(getSigningSecret()).toBe(VALID_SECRET);
    });

    it("throws error when RECOVERY_GRANT_SECRET is missing", () => {
      delete process.env.RECOVERY_GRANT_SECRET;

      expect(() => getSigningSecret()).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("throws error when RECOVERY_GRANT_SECRET is shorter than 32 characters", () => {
      process.env.RECOVERY_GRANT_SECRET = "short-secret";

      expect(() => getSigningSecret()).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("NEVER falls back to SUPABASE_SERVICE_ROLE_KEY or SUPABASE_JWT_SECRET", () => {
      delete process.env.RECOVERY_GRANT_SECRET;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-that-should-never-be-used-here";
      process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-that-should-never-be-used-here";

      expect(() => getSigningSecret()).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });
  });

  describe("createRecoveryGrant", () => {
    it("creates a valid signed recovery grant token", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const parts = token.split(".");
      expect(parts).toHaveLength(2);

      const payloadB64 = parts[0]!;
      const signature = parts[1]!;
      expect(payloadB64).toBeTruthy();
      expect(signature).toBeTruthy();

      const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      expect(decoded.userId).toBe(TEST_USER_ID);
      expect(decoded.sessionId).toBe(TEST_SESSION_ID);
      expect(decoded.nonce).toBeDefined();
      expect(decoded.issuedAt).toBeLessThanOrEqual(Date.now());
      expect(decoded.expiresAt).toBeGreaterThan(Date.now());
    });

    it("fails securely when RECOVERY_GRANT_SECRET is missing during signing", () => {
      delete process.env.RECOVERY_GRANT_SECRET;

      expect(() => createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID)).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("fails securely when RECOVERY_GRANT_SECRET is too short during signing", () => {
      process.env.RECOVERY_GRANT_SECRET = "under-32-chars";

      expect(() => createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID)).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });
  });

  describe("verifyRecoveryGrant", () => {
    it("successfully verifies a grant signed with the matching RECOVERY_GRANT_SECRET", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      const result = verifyRecoveryGrant(token);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.payload.userId).toBe(TEST_USER_ID);
        expect(result.payload.sessionId).toBe(TEST_SESSION_ID);
        expect(result.payload.nonce).toBeDefined();
      }
    });

    it("fails securely when RECOVERY_GRANT_SECRET is missing during verification", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      delete process.env.RECOVERY_GRANT_SECRET;

      expect(() => verifyRecoveryGrant(token)).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("fails securely when RECOVERY_GRANT_SECRET is too short during verification", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      process.env.RECOVERY_GRANT_SECRET = "short";

      expect(() => verifyRecoveryGrant(token)).toThrow(
        "RECOVERY_GRANT_SECRET must be configured and be at least 32 characters long."
      );
    });

    it("rejects token signed with a different secret", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);

      // Change secret to another valid 32-char secret
      process.env.RECOVERY_GRANT_SECRET = "different-secret-that-is-also-at-least-32-chars-long";

      const result = verifyRecoveryGrant(token);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid");
      }
    });

    it("rejects tampered signature", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      const parts = token.split(".");
      const payloadB64 = parts[0]!;
      const signature = parts[1]!;
      const tamperedSignature = signature.slice(0, -4) + "AAAA";
      const tamperedToken = `${payloadB64}.${tamperedSignature}`;

      const result = verifyRecoveryGrant(tamperedToken);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid");
      }
    });

    it("rejects tampered payload", () => {
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID);
      const parts = token.split(".");
      const payloadB64 = parts[0]!;
      const signature = parts[1]!;
      const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      decoded.userId = "attacker-user-id";
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded)).toString("base64url");
      const tamperedToken = `${tamperedPayloadB64}.${signature}`;

      const result = verifyRecoveryGrant(tamperedToken);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("invalid");
      }
    });

    it("rejects expired token", () => {
      // Create grant with negative TTL (already expired)
      const token = createRecoveryGrant(TEST_USER_ID, TEST_SESSION_ID, -1000);

      const result = verifyRecoveryGrant(token);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe("expired");
      }
    });

    it("returns missing reason for empty or undefined token", () => {
      expect(verifyRecoveryGrant(undefined)).toEqual({ success: false, reason: "missing" });
      expect(verifyRecoveryGrant(null)).toEqual({ success: false, reason: "missing" });
      expect(verifyRecoveryGrant("")).toEqual({ success: false, reason: "missing" });
    });

    it("returns invalid reason for malformed token structure", () => {
      expect(verifyRecoveryGrant("single-part-token")).toEqual({ success: false, reason: "invalid" });
      expect(verifyRecoveryGrant("part1.part2.part3")).toEqual({ success: false, reason: "invalid" });
      expect(verifyRecoveryGrant(".signature-only")).toEqual({ success: false, reason: "invalid" });
      expect(verifyRecoveryGrant("payload-only.")).toEqual({ success: false, reason: "invalid" });
    });
  });

  describe("hashRecoveryNonce", () => {
    it("produces deterministic SHA-256 hex digest", () => {
      const nonce = "test-nonce-12345";
      const hash1 = hashRecoveryNonce(nonce);
      const hash2 = hashRecoveryNonce(nonce);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters (256 bits)
      expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
    });
  });

  describe("isRecoverySession & getSessionIdFromToken", () => {
    it("identifies session with recovery AMR claim", () => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
      const payload = Buffer.from(
        JSON.stringify({
          sub: TEST_USER_ID,
          session_id: TEST_SESSION_ID,
          amr: [{ method: "recovery", timestamp: 12345678 }],
        })
      ).toString("base64");
      const fakeJwt = `${header}.${payload}.signature`;

      const session = {
        access_token: fakeJwt,
      } as unknown as Session;

      expect(isRecoverySession(session)).toBe(true);
      expect(getSessionIdFromToken(session)).toBe(TEST_SESSION_ID);
    });

    it("rejects session without recovery AMR claim", () => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
      const payload = Buffer.from(
        JSON.stringify({
          sub: TEST_USER_ID,
          session_id: TEST_SESSION_ID,
          amr: [{ method: "password", timestamp: 12345678 }],
        })
      ).toString("base64");
      const fakeJwt = `${header}.${payload}.signature`;

      const session = {
        access_token: fakeJwt,
      } as unknown as Session;

      expect(isRecoverySession(session)).toBe(false);
      expect(getSessionIdFromToken(session)).toBe(TEST_SESSION_ID);
    });

    it("safely handles null or malformed sessions", () => {
      expect(isRecoverySession(null)).toBe(false);
      expect(isRecoverySession(undefined)).toBe(false);
      expect(isRecoverySession({ access_token: "invalid-jwt" } as unknown as Session)).toBe(false);

      expect(getSessionIdFromToken(null)).toBeNull();
      expect(getSessionIdFromToken(undefined)).toBeNull();
      expect(getSessionIdFromToken({ access_token: "invalid-jwt" } as unknown as Session)).toBeNull();
    });
  });
});
