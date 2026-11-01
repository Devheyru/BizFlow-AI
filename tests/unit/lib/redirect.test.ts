import { describe, it, expect } from "vitest";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";

describe("Redirect Sanitization & Open-Redirect Defense", () => {
  describe("External URL & Scheme Rejection", () => {
    it("rejects absolute HTTP/HTTPS URLs", () => {
      expect(sanitizeRedirectUrl("https://evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("http://attacker.org/phish")).toBe("/");
      expect(sanitizeRedirectUrl("https://sub.evil.com/path?param=1")).toBe("/");
    });

    it("rejects protocol-relative URLs", () => {
      expect(sanitizeRedirectUrl("//evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("//evil.com/path")).toBe("/");
      expect(sanitizeRedirectUrl("///evil.com")).toBe("/");
    });

    it("rejects backslash evasion attempts", () => {
      expect(sanitizeRedirectUrl("/\\evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("/\\\\evil.com")).toBe("/");
      expect(sanitizeRedirectUrl("\\evil.com")).toBe("/");
    });

    it("rejects script and non-HTTP schemes", () => {
      expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
      expect(sanitizeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/");
      expect(sanitizeRedirectUrl("vbscript:msgbox(1)")).toBe("/");
    });

    it("handles null, undefined, empty string, or whitespace", () => {
      expect(sanitizeRedirectUrl(null)).toBe("/");
      expect(sanitizeRedirectUrl(undefined)).toBe("/");
      expect(sanitizeRedirectUrl("")).toBe("/");
      expect(sanitizeRedirectUrl("   ")).toBe("/");
    });

    it("uses custom fallback if provided", () => {
      expect(sanitizeRedirectUrl("https://evil.com", "/fallback-path")).toBe("/fallback-path");
      expect(sanitizeRedirectUrl(null, "/default-workspace")).toBe("/default-workspace");
    });
  });

  describe("Safe Relative Application Paths", () => {
    it("accepts valid root and nested application paths", () => {
      expect(sanitizeRedirectUrl("/")).toBe("/");
      expect(sanitizeRedirectUrl("/dashboard")).toBe("/dashboard");
      expect(sanitizeRedirectUrl("/acme-store/dashboard")).toBe("/acme-store/dashboard");
      expect(sanitizeRedirectUrl("/onboarding/create-organization")).toBe(
        "/onboarding/create-organization"
      );
    });

    it("preserves valid query parameters and hash fragments", () => {
      expect(sanitizeRedirectUrl("/products?page=2&sort=name")).toBe("/products?page=2&sort=name");
      expect(sanitizeRedirectUrl("/inventory?filter=category:shoes")).toBe(
        "/inventory?filter=category:shoes"
      );
      expect(sanitizeRedirectUrl("/settings#security")).toBe("/settings#security");
    });
  });
});

