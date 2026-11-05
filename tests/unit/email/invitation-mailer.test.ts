import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendInvitationEmail,
  escapeHtml,
  sanitizeErrorMessage,
  validateInvitationUrl,
  inspectInvitationUrl,
  buildInvitationUrl,
  resolveApplicationBaseUrl,
  type SendInvitationEmailParams,
} from "@/lib/email/invitation-mailer";

describe("Transactional Invitation Mailer Unit Tests", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  const validParams: SendInvitationEmailParams = {
    recipientEmail: "invitee@example.com",
    organizationName: "Acme Corp",
    role: "cashier",
    invitationUrl: "https://biz-flow-ai-one.vercel.app/invitations/accept?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://biz-flow-ai-one.vercel.app",
      RESEND_API_KEY: "re_test_mock_api_key_12345",
      EMAIL_FROM: "BizFlow AI <noreply@bizflow.ai>",
    };
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  // ---------------------------------------------------------------------------
  // 1. Successful Resend API response
  // ---------------------------------------------------------------------------
  it("returns success with messageId when Resend API accepts the email (200 OK)", async () => {
    const mockResponse = { id: "resend_msg_abcdef123456" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("resend_msg_abcdef123456");
    expect(result.error).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Missing API key in production
  // ---------------------------------------------------------------------------
  it("fails safely when RESEND_API_KEY is missing in production", async () => {
    delete process.env.RESEND_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    global.fetch = vi.fn();

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PREFLIGHT_MISSING_RESEND_API_KEY");
    expect(result.error).toMatch(/Missing RESEND_API_KEY in production/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 3. Missing sender configuration in production
  // ---------------------------------------------------------------------------
  it("fails safely when EMAIL_FROM is missing in production and does not use an unverified fallback", async () => {
    delete process.env.EMAIL_FROM;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    global.fetch = vi.fn();

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PREFLIGHT_MISSING_EMAIL_FROM");
    expect(result.error).toMatch(/Missing EMAIL_FROM in production/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 4. Provider HTTP rejection
  // ---------------------------------------------------------------------------
  it("returns failure when Resend rejects request with 422 Unprocessable Entity", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: vi.fn().mockResolvedValue({
        statusCode: 422,
        name: "validation_error",
        message: "The domain is not verified. Please verify your domain in Resend.",
      }),
    });

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_HTTP_422");
    expect(result.error).toContain("The domain is not verified");
  });

  it("returns failure when Resend rejects request with 401 Unauthorized", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: vi.fn().mockResolvedValue({
        message: "Invalid API key provided",
      }),
    });

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_HTTP_401");
    expect(result.error).toBe("Invalid API key provided");
  });

  it("handles non-JSON error response from provider gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
    });

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_HTTP_502");
    expect(result.error).toContain("HTTP 502 Bad Gateway");
  });

  // ---------------------------------------------------------------------------
  // 5. Network failure
  // ---------------------------------------------------------------------------
  it("handles complete network failure gracefully without throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 198.51.100.1:443"));

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("NETWORK_DISPATCH_ERROR");
    expect(result.error).toContain("connect ECONNREFUSED");
  });

  // ---------------------------------------------------------------------------
  // 6. Request payload construction
  // ---------------------------------------------------------------------------
  it("sends both text/plain and text/html bodies containing organization, role, and invitation link", async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse(options.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_verified_payload" }),
      };
    });

    await sendInvitationEmail({
      recipientEmail: "cashier@example.com",
      organizationName: "Global Mart",
      role: "cashier",
      invitationUrl: "https://biz-flow-ai-one.vercel.app/invitations/accept?token=tok12345",
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody.from).toBe("BizFlow AI <noreply@bizflow.ai>");
    expect(capturedBody.to).toEqual(["cashier@example.com"]);
    expect(capturedBody.subject).toBe("You're invited to join Global Mart on BizFlow AI");

    expect(capturedBody.text).toContain("Global Mart");
    expect(capturedBody.text).toContain("cashier");
    expect(capturedBody.text).toContain("https://biz-flow-ai-one.vercel.app/invitations/accept?token=tok12345");

    expect(capturedBody.html).toContain("Global Mart");
    expect(capturedBody.html).toContain("cashier");
    expect(capturedBody.html).toContain('href="https://biz-flow-ai-one.vercel.app/invitations/accept?token=tok12345"');
  });

  it("escapes dynamic values inserted into HTML email body to prevent XSS", async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse(options.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_xss_test" }),
      };
    });

    await sendInvitationEmail({
      recipientEmail: "safe@example.com",
      organizationName: `<script>alert("xss")</script>Corp & Co`,
      role: `manager" onclick="alert(1)`,
      invitationUrl: "https://biz-flow-ai-one.vercel.app/invitations/accept?token=token123",
    });

    expect(capturedBody.html).not.toContain("<script>alert(\"xss\")</script>");
    expect(capturedBody.html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Corp &amp; Co");
    expect(capturedBody.html).toContain("manager&quot; onclick=&quot;alert(1)");
  });

  // ---------------------------------------------------------------------------
  // 6b. escapeHtml utility
  // ---------------------------------------------------------------------------
  describe("escapeHtml utility", () => {
    it("escapes special HTML characters properly", () => {
      expect(escapeHtml("<script>alert('xss') & \"quotes\"</script>")).toBe(
        "&lt;script&gt;alert(&#039;xss&#039;) &amp; &quot;quotes&quot;&lt;/script&gt;"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6c. resolveApplicationBaseUrl utility
  // ---------------------------------------------------------------------------
  describe("resolveApplicationBaseUrl utility", () => {
    it("resolves valid production HTTPS origin", () => {
      const res = resolveApplicationBaseUrl("https://biz-flow-ai-one.vercel.app/", "production");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("https://biz-flow-ai-one.vercel.app");
      }
    });

    it("rejects missing configuration in production", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      const res = resolveApplicationBaseUrl(undefined, "production");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errorCode).toBe("PREFLIGHT_APP_BASE_URL_MISSING");
      }
    });

    it("rejects non-HTTPS configuration in production", () => {
      const res = resolveApplicationBaseUrl("http://bizflow.ai", "production");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errorCode).toBe("PREFLIGHT_APP_BASE_URL_NON_HTTPS");
      }
    });

    it("defaults to localhost:3000 in development when unset", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      const res = resolveApplicationBaseUrl(undefined, "development");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("http://localhost:3000");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. buildInvitationUrl & Production URL Handling Tests
  // ---------------------------------------------------------------------------
  describe("buildInvitationUrl & Production URL Handling", () => {
    it("constructs correct invitation URL with normal production HTTPS URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      const url = buildInvitationUrl("abc123token");
      expect(url).toBe("https://biz-flow-ai-one.vercel.app/invitations/accept?token=abc123token");
    });

    it("handles production application URL with trailing slash safely", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app/";
      (process.env as any).NODE_ENV = "production";

      const url = buildInvitationUrl("abc123token");
      expect(url).toBe("https://biz-flow-ai-one.vercel.app/invitations/accept?token=abc123token");
      expect(url).not.toContain("app//");
    });

    it("handles production application URL with multiple trailing slashes safely", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app///";
      (process.env as any).NODE_ENV = "production";

      const url = buildInvitationUrl("abc123token");
      expect(url).toBe("https://biz-flow-ai-one.vercel.app/invitations/accept?token=abc123token");
      expect(url).not.toContain("app//");
    });

    it("fails closed in production when NEXT_PUBLIC_APP_URL is missing", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      (process.env as any).NODE_ENV = "production";

      expect(() => buildInvitationUrl("abc123token")).toThrow(
        /NEXT_PUBLIC_APP_URL is required in production/i
      );
    });

    it("fails closed in production when NEXT_PUBLIC_APP_URL is empty or whitespace", () => {
      process.env.NEXT_PUBLIC_APP_URL = "   ";
      (process.env as any).NODE_ENV = "production";

      expect(() => buildInvitationUrl("abc123token")).toThrow(
        /NEXT_PUBLIC_APP_URL is required in production/i
      );
    });

    it("rejects non-HTTPS HTTP URL in production", () => {
      process.env.NEXT_PUBLIC_APP_URL = "http://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(() => buildInvitationUrl("abc123token")).toThrow(
        /Invalid application base URL protocol: "http:" \(production requires https:\)/i
      );
    });

    it("prevents bypassing production HTTPS with explicitly supplied HTTP base URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(() => buildInvitationUrl("abc123token", "http://insecure-bypass.com")).toThrow(
        /Invalid application base URL protocol: "http:" \(production requires https:\)/i
      );
    });

    it("allows localhost HTTP in development when NEXT_PUBLIC_APP_URL is unset", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      (process.env as any).NODE_ENV = "development";

      const url = buildInvitationUrl("devtoken123");
      expect(url).toBe("http://localhost:3000/invitations/accept?token=devtoken123");
    });

    it("allows configured localhost HTTP with trailing slashes in development", () => {
      process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000///";
      (process.env as any).NODE_ENV = "development";

      const url = buildInvitationUrl("devtoken123");
      expect(url).toBe("http://localhost:3000/invitations/accept?token=devtoken123");
      expect(url).not.toContain("3000//");
    });

    it("rejects application URL with missing URL protocol", () => {
      expect(() => buildInvitationUrl("abc123token", "bizflow.ai")).toThrow(
        /is not a valid absolute URL/i
      );
    });

    it("rejects invalid application URL", () => {
      expect(() => buildInvitationUrl("abc123token", "not a valid url ://")).toThrow(
        /is not a valid absolute URL/i
      );
    });

    it("rejects unsupported URL protocol", () => {
      (process.env as any).NODE_ENV = "development";
      expect(() => buildInvitationUrl("abc123token", "ftp://bizflow.ai")).toThrow(
        /Invalid application base URL protocol: "ftp:"/i
      );
    });

    it("rejects empty or whitespace invitation token", () => {
      expect(() => buildInvitationUrl("", "https://biz-flow-ai-one.vercel.app")).toThrow(
        /Invitation token cannot be empty/i
      );
      expect(() => buildInvitationUrl("   ", "https://biz-flow-ai-one.vercel.app")).toThrow(
        /Invitation token cannot be empty/i
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 8. validateInvitationUrl and inspectInvitationUrl Tests
  // ---------------------------------------------------------------------------
  describe("validateInvitationUrl and inspectInvitationUrl", () => {
    it("validates trusted origin, correct path, and token presence for production HTTPS URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123")).toBe(true);
    });

    it("safely handles configured base URL with trailing slash in production", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app/";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123")).toBe(true);
    });

    it("safely handles configured base URL with multiple trailing slashes in production", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app///";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123")).toBe(true);
    });

    it("fails validation in production when NEXT_PUBLIC_APP_URL is missing", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      (process.env as any).NODE_ENV = "production";

      const inspection = inspectInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_APP_BASE_URL_MISSING");
      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123")).toBe(false);
    });

    it("fails validation in production when NEXT_PUBLIC_APP_URL is HTTP", () => {
      process.env.NEXT_PUBLIC_APP_URL = "http://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      const inspection = inspectInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_APP_BASE_URL_NON_HTTPS");
    });

    it("rejects non-HTTPS invitation URL in production even if configured base is HTTPS", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      const inspection = inspectInvitationUrl("http://biz-flow-ai-one.vercel.app/invitations/accept?token=valid123");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_NON_HTTPS");
    });

    it("allows localhost HTTP URL in development", () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      (process.env as any).NODE_ENV = "development";

      expect(validateInvitationUrl("http://localhost:3000/invitations/accept?token=valid123")).toBe(true);
    });

    it("rejects untrusted origin that does not match configured application URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://evil-phishing-site.com/invitations/accept?token=12345")).toBe(false);
      const inspection = inspectInvitationUrl("https://evil-phishing-site.com/invitations/accept?token=12345");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_UNTRUSTED_ORIGIN");
    });

    it("rejects invitation URL with wrong path", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/some/other/path?token=12345")).toBe(false);
      const inspection = inspectInvitationUrl("https://biz-flow-ai-one.vercel.app/some/other/path?token=12345");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_INVALID_PATHNAME");
    });

    it("rejects invitation URL without token parameter or with empty token", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept")).toBe(false);
      expect(validateInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept?token=")).toBe(false);
      const inspection = inspectInvitationUrl("https://biz-flow-ai-one.vercel.app/invitations/accept");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_MISSING_TOKEN");
    });

    it("rejects missing protocol on invitation URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("biz-flow-ai-one.vercel.app/invitations/accept?token=12345")).toBe(false);
      const inspection = inspectInvitationUrl("biz-flow-ai-one.vercel.app/invitations/accept?token=12345");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_MALFORMED");
    });

    it("rejects invalid invitation URL", () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://biz-flow-ai-one.vercel.app";
      (process.env as any).NODE_ENV = "production";

      expect(validateInvitationUrl("not-a-valid-url")).toBe(false);
      const inspection = inspectInvitationUrl("not-a-valid-url");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_URL_MALFORMED");
    });

    it("rejects invalid configured application URL", () => {
      (process.env as any).NODE_ENV = "development";
      expect(validateInvitationUrl("http://localhost:3000/invitations/accept?token=valid123", "not-a-valid-app-url ://")).toBe(false);
      const inspection = inspectInvitationUrl("http://localhost:3000/invitations/accept?token=valid123", "not-a-valid-app-url ://");
      expect(inspection.valid).toBe(false);
      expect(inspection.errorCode).toBe("PREFLIGHT_APP_BASE_URL_INVALID");
    });
  });

  // ---------------------------------------------------------------------------
  // 9. sanitizeErrorMessage utility
  // ---------------------------------------------------------------------------
  describe("sanitizeErrorMessage utility", () => {
    it("redacts Resend API keys, bearer tokens, url tokens, and recipient emails from error strings", () => {
      const raw = "Error: call failed with re_live_123456789 and Bearer token123 at /accept?token=abcdef0123456789 for user user@example.com";
      const sanitized = sanitizeErrorMessage(raw);

      expect(sanitized).not.toContain("re_live_123456789");
      expect(sanitized).toContain("[REDACTED_API_KEY]");
      expect(sanitized).not.toContain("Bearer token123");
      expect(sanitized).toContain("Bearer [REDACTED]");
      expect(sanitized).not.toContain("abcdef0123456789");
      expect(sanitized).toContain("?token=[REDACTED]");
      expect(sanitized).not.toContain("user@example.com");
      expect(sanitized).toContain("[REDACTED_EMAIL]");
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Additional Pre-flight Guards in sendInvitationEmail
  // ---------------------------------------------------------------------------
  it("rejects invalid recipient email syntax before making network call", async () => {
    global.fetch = vi.fn();

    const result = await sendInvitationEmail({
      ...validParams,
      recipientEmail: "invalid-not-an-email",
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PREFLIGHT_INVALID_RECIPIENT_EMAIL");
    expect(result.error).toMatch(/Invalid recipient email address/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails when Resend returns valid HTTP status but unexpected payload missing id", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: "queued" }), // missing id
    });

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_INVALID_RESPONSE_FORMAT");
    expect(result.error).toMatch(/Invalid provider response format/i);
  });
});
