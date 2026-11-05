import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendInvitationEmail,
  escapeHtml,
  sanitizeErrorMessage,
  validateInvitationUrl,
  type SendInvitationEmailParams,
} from "@/lib/email/invitation-mailer";

describe("Transactional Invitation Mailer Unit Tests", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  const validParams: SendInvitationEmailParams = {
    recipientEmail: "invitee@example.com",
    organizationName: "Acme Corp",
    role: "cashier",
    invitationUrl: "http://localhost:3000/invitations/accept?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
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
    expect(result.error).toContain("HTTP 502 Bad Gateway");
  });

  // ---------------------------------------------------------------------------
  // 5. Network failure
  // ---------------------------------------------------------------------------
  it("returns failure when network connection fails without throwing unhandled exceptions", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED 127.0.0.1:443"));

    const result = await sendInvitationEmail(validParams);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  // ---------------------------------------------------------------------------
  // 6. Correct recipient, sender, subject, and invitation URL in request body
  // ---------------------------------------------------------------------------
  it("submits the correct recipient, sender, subject, text and html content to Resend API", async () => {
    let capturedUrl = "";
    let capturedOptions: RequestInit | undefined;

    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg_verified_payload" }),
      });
    });

    await sendInvitationEmail({
      recipientEmail: "cashier.jane@example.com",
      organizationName: "Global Mart",
      role: "cashier",
      invitationUrl: "http://localhost:3000/invitations/accept?token=aabbccdd11223344",
    });

    expect(capturedUrl).toBe("https://api.resend.com/emails");
    expect(capturedOptions?.method).toBe("POST");

    const headers = capturedOptions?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_test_mock_api_key_12345");
    expect(headers["Content-Type"]).toBe("application/json");

    const payload = JSON.parse(capturedOptions?.body as string);
    expect(payload.from).toBe("BizFlow AI <noreply@bizflow.ai>");
    expect(payload.to).toEqual(["cashier.jane@example.com"]);
    expect(payload.subject).toBe("You're invited to join Global Mart on BizFlow AI");

    // Text content asserts
    expect(payload.text).toContain("Global Mart");
    expect(payload.text).toContain("cashier");
    expect(payload.text).toContain("http://localhost:3000/invitations/accept?token=aabbccdd11223344");
    expect(payload.text).toContain("7 days");

    // HTML content asserts
    expect(payload.html).toContain("Global Mart");
    expect(payload.html).toContain("cashier");
    expect(payload.html).toContain("http://localhost:3000/invitations/accept?token=aabbccdd11223344");
    expect(payload.html).toContain("7 days");
    expect(payload.html).toContain("Accept Invitation");
  });

  // ---------------------------------------------------------------------------
  // 7. HTML escaping
  // ---------------------------------------------------------------------------
  it("escapes dynamic organization, role, and inviter values in HTML body to prevent injection", async () => {
    let capturedOptions: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "msg_escape_test" }),
      });
    });

    await sendInvitationEmail({
      recipientEmail: "tester@example.com",
      organizationName: `<script>alert('xss')</script> & "Dangerous Org"`,
      role: `manager' OR '1'='1`,
      invitationUrl: "http://localhost:3000/invitations/accept?token=safe_token_12345",
    });

    const payload = JSON.parse(capturedOptions?.body as string);

    // Dynamic values must be HTML-escaped in HTML body
    expect(payload.html).not.toContain("<script>alert('xss')</script>");
    expect(payload.html).toContain("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt; &amp; &quot;Dangerous Org&quot;");
    expect(payload.html).toContain("manager&#039; OR &#039;1&#039;=&#039;1");

    // Plain text should preserve the raw names for human readability in terminal/text clients
    expect(payload.text).toContain("<script>alert('xss')</script>");
  });

  describe("escapeHtml utility", () => {
    it("escapes special HTML characters correctly", () => {
      expect(escapeHtml(`<div>"Hello" & 'World'</div>`)).toBe(
        "&lt;div&gt;&quot;Hello&quot; &amp; &#039;World&#039;&lt;/div&gt;"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Security & URL Validation
  // ---------------------------------------------------------------------------
  describe("validateInvitationUrl and origin validation", () => {
    it("validates trusted origin, correct path, and token presence", () => {
      expect(validateInvitationUrl("http://localhost:3000/invitations/accept?token=valid123")).toBe(true);
      expect(validateInvitationUrl("https://untrusted.com/invitations/accept?token=valid123")).toBe(false);
      expect(validateInvitationUrl("http://localhost:3000/wrong-route?token=valid123")).toBe(false);
      expect(validateInvitationUrl("http://localhost:3000/invitations/accept")).toBe(false);
      expect(validateInvitationUrl("not-a-valid-url")).toBe(false);
    });

    it("rejects untrusted origin that does not match NEXT_PUBLIC_APP_URL", async () => {
      global.fetch = vi.fn();

      const result = await sendInvitationEmail({
        ...validParams,
        invitationUrl: "https://evil-phishing-site.com/invitations/accept?token=12345",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid invitation URL or untrusted origin/i);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("rejects invitation URL with wrong path", async () => {
      global.fetch = vi.fn();

      const result = await sendInvitationEmail({
        ...validParams,
        invitationUrl: "http://localhost:3000/some/other/path?token=12345",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid invitation URL or untrusted origin/i);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("rejects invitation URL without token parameter", async () => {
      global.fetch = vi.fn();

      const result = await sendInvitationEmail({
        ...validParams,
        invitationUrl: "http://localhost:3000/invitations/accept",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid invitation URL or untrusted origin/i);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("sanitizeErrorMessage utility", () => {
    it("redacts Resend API keys, bearer tokens, and url tokens from error strings", () => {
      const raw = "Error: call failed with re_live_123456789 and Bearer token123 at /accept?token=abcdef0123456789";
      const sanitized = sanitizeErrorMessage(raw);

      expect(sanitized).not.toContain("re_live_123456789");
      expect(sanitized).toContain("[REDACTED_API_KEY]");
      expect(sanitized).not.toContain("Bearer token123");
      expect(sanitized).toContain("Bearer [REDACTED]");
      expect(sanitized).not.toContain("abcdef0123456789");
      expect(sanitized).toContain("?token=[REDACTED]");
    });
  });

  it("rejects invalid recipient email syntax before making network call", async () => {
    global.fetch = vi.fn();

    const result = await sendInvitationEmail({
      ...validParams,
      recipientEmail: "invalid-not-an-email",
    });

    expect(result.success).toBe(false);
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
    expect(result.error).toMatch(/Invalid provider response format/i);
  });
});
