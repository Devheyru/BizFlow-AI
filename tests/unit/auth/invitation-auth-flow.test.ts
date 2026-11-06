import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signUpAction, signInAction } from "@/actions/auth-actions";
import {
  acceptInvitationAction,
  resendInvitationAction,
  validateInvitationTokenAction,
  dismissInvitationAction,
} from "@/actions/invitation-actions";
import { GET as authCallbackGet } from "@/app/api/auth/callback/route";
import * as supabaseServer from "@/lib/supabase/server";
import * as supabaseMiddleware from "@/lib/supabase/middleware";
import * as authContext from "@/lib/auth/context";
import * as mailer from "@/lib/email/invitation-mailer";
import { middleware } from "@/middleware";
import InvitationAcceptancePage from "@/app/invitations/accept/page";
import {
  INVITATION_COOKIE_NAME,
  setPendingInvitationCookie,
  getPendingInvitationCookie,
  clearPendingInvitationCookie,
  isValidInvitationTokenFormat,
  extractInvitationToken,
} from "@/lib/auth/invitation-cookie";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";

// Mock supabase middleware
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(),
}));

// Mock auth context
vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
}));

// Mock mailer
vi.mock("@/lib/email/invitation-mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof mailer>();
  return {
    ...actual,
    sendInvitationEmail: vi.fn().mockResolvedValue({ success: true, messageId: "msg_123" }),
    buildInvitationUrl: actual.buildInvitationUrl,
    validateInvitationUrl: actual.validateInvitationUrl,
  };
});

// Mock Supabase server
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof supabaseServer>();
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

describe("Feature 002: Invitation-Aware Registration & Authentication Flow Tests", () => {
  const validToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockSlug = "retail-store";

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseServer.clearInMemoryCookieJar();
  });

  // ===========================================================================
  // Part 1: Registration and Invitation Integration (Tests 1-7)
  // ===========================================================================

  it("1. New invited employee registers using the exact invited email", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: "u-new", email: "cashier@example.com" } },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signUp: mockSignUp },
    } as any);

    const result = await signUpAction({
      email: "cashier@example.com",
      password: "StrongPassword123!",
      firstName: "Cashier",
      lastName: "User",
      invitationToken: validToken,
    });

    expect(result.success).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "cashier@example.com",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining(
            encodeURIComponent(`/invitations/accept?token=${validToken}`)
          ),
        }),
      })
    );
  });

  it("2. Invitation context survives the registration process via secure cookie", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: "u-new", email: "cashier@example.com" } },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signUp: mockSignUp },
    } as any);

    await signUpAction({
      email: "cashier@example.com",
      password: "StrongPassword123!",
      firstName: "Cashier",
      lastName: "User",
      invitationToken: validToken,
    });

    const cookieToken = await getPendingInvitationCookie();
    expect(cookieToken).toBe(validToken);
  });

  it("3. Invitation context survives email verification even if query params are stripped by GoTrue", async () => {
    // Simulate cookie set during earlier registration
    await setPendingInvitationCookie(validToken);

    const mockExchange = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: "tok", user: { id: "u-verified", email: "cashier@example.com" } },
        user: { id: "u-verified", email: "cashier@example.com" },
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
    } as any);

    // GoTrue callback link with code only (next omitted or stripped to "/")
    const req = new NextRequest("http://localhost:3000/api/auth/callback?code=gotrue-auth-code");
    const response = await authCallbackGet(req);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain(`/invitations/accept?token=${validToken}`);
  });

  it("4. Authentication callback restores the invitation flow when next query parameter is present", async () => {
    const mockExchange = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: "tok", user: { id: "u-verified", email: "cashier@example.com" } },
        user: { id: "u-verified", email: "cashier@example.com" },
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchange },
    } as any);

    const targetUrl = `/invitations/accept?token=${validToken}`;
    const req = new NextRequest(
      `http://localhost:3000/api/auth/callback?code=valid-code&next=${encodeURIComponent(targetUrl)}`
    );
    const response = await authCallbackGet(req);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(targetUrl);
  });

  it("5. Newly registered employee is routed to invitation acceptance instead of Create Retail Store", async () => {
    // When a newly registered user logs in with 0 memberships, but has pending invitation cookie
    await setPendingInvitationCookie(validToken);

    const mockSignInWithPassword = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "u-emp",
          email: "cashier@example.com",
          email_confirmed_at: "2026-11-05T00:00:00Z",
        },
        session: { access_token: "token" },
      },
      error: null,
    });

    // 0 memberships
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signInWithPassword: mockSignInWithPassword },
      from: mockFrom,
    } as any);

    const result = await signInAction({
      email: "cashier@example.com",
      password: "StrongPassword123!",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirectUrl).toBe(`/invitations/accept?token=${validToken}`);
      expect(result.data.redirectUrl).not.toBe("/onboarding/create-organization");
    }
  });

  it("6. Invitation acceptance succeeds after email verification and clears pending cookie", async () => {
    await setPendingInvitationCookie(validToken);

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        organization_id: mockOrgId,
        organization_slug: mockSlug,
        role: "cashier",
        status: "active",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("cashier");
      expect(result.data.status).toBe("active");
      expect(result.data.redirectUrl).toBe(`/${mockSlug}/dashboard`);
    }

    // Cookie must be cleared upon successful acceptance
    const remainingCookie = await getPendingInvitationCookie();
    expect(remainingCookie).toBeNull();
  });

  it("7. Employee reaches the correct role dashboard upon successful acceptance", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        organization_id: mockOrgId,
        organization_slug: "my-retail-store",
        role: "manager",
        status: "active",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirectUrl).toBe("/my-retail-store/dashboard");
      expect(result.data.role).toBe("manager");
    }
  });

  // ===========================================================================
  // Part 2: Existing Authentication Behavior (Tests 8-11)
  // ===========================================================================

  it("8. Existing verified employee accepts an invitation successfully (Scenario B)", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        organization_id: mockOrgId,
        organization_slug: mockSlug,
        role: "cashier",
        status: "active",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationSlug).toBe(mockSlug);
      expect(result.data.role).toBe("cashier");
    }
  });

  it("9. Existing login without invitation continues working and routes to active organization", async () => {
    const mockSignInWithPassword = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "u-existing",
          email: "owner@retail.com",
          email_confirmed_at: "2026-10-31T00:00:00Z",
        },
        session: { access_token: "token" },
      },
      error: null,
    });

    const mockFrom = vi.fn((table: string) => {
      if (table === "organization_memberships") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [{ organization_id: mockOrgId, role: "owner", status: "active", created_at: "2026-10-31" }],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: mockOrgId, slug: mockSlug, name: "Retail Store", created_at: "2026-10-31" }],
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signInWithPassword: mockSignInWithPassword },
      from: mockFrom,
    } as any);

    const result = await signInAction({
      email: "owner@retail.com",
      password: "StrongPassword123!",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasActiveOrganization).toBe(true);
      expect(result.data.redirectUrl).toBe(`/${mockSlug}/dashboard`);
    }
  });

  it("10. Normal registration without invitation still redirects to organization onboarding (Scenario C)", async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: "u-independent", email: "newowner@retail.com" } },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signUp: mockSignUp },
    } as any);

    const result = await signUpAction({
      email: "newowner@retail.com",
      password: "StrongPassword123!",
      firstName: "New",
      lastName: "Owner",
    });

    expect(result.success).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newowner@retail.com",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining(encodeURIComponent("/")),
        }),
      })
    );

    // No pending invitation cookie should exist
    const cookie = await getPendingInvitationCookie();
    expect(cookie).toBeNull();
  });

  it("11. Existing organization owner registration/onboarding behavior remains intact", async () => {
    const mockSignInWithPassword = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "u-newowner",
          email: "newowner@retail.com",
          email_confirmed_at: "2026-11-05T00:00:00Z",
        },
        session: { access_token: "token" },
      },
      error: null,
    });

    // 0 memberships and NO invitation cookie
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      auth: { signInWithPassword: mockSignInWithPassword },
      from: mockFrom,
    } as any);

    const result = await signInAction({
      email: "newowner@retail.com",
      password: "StrongPassword123!",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasActiveOrganization).toBe(false);
      expect(result.data.redirectUrl).toBe("/onboarding/create-organization");
    }
  });

  // ===========================================================================
  // Part 3: Security and Edge Cases (Tests 12-20)
  // ===========================================================================

  it("12. Different authenticated email cannot accept invitation (generic EMAIL_MISMATCH)", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "EMAIL_MISMATCH",
        message: "The authenticated account does not match the invitation recipient.",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("EMAIL_MISMATCH");
      expect(result.error.message).toBe("The authenticated account does not match the invitation recipient.");
      // Ensure neither email is leaked in error message
      expect(result.error.message).not.toContain("@");
    }
  });

  it("13. Unverified email cannot accept invitation", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "EMAIL_UNVERIFIED",
        message: "Email verification required before accepting invitation.",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("EMAIL_UNVERIFIED");
    }
  });

  it("14. Expired invitation is rejected and clears pending invitation cookie", async () => {
    await setPendingInvitationCookie(validToken);

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "INVITATION_EXPIRED",
        message: "This invitation has expired.",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVITATION_EXPIRED");
    }

    const cookie = await getPendingInvitationCookie();
    expect(cookie).toBeNull();
  });

  it("15. Revoked invitation is rejected and clears pending cookie", async () => {
    await setPendingInvitationCookie(validToken);

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "INVITATION_NOT_PENDING",
        message: "This invitation has already been processed.",
        status: "revoked",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVITATION_NOT_PENDING");
    }

    const cookie = await getPendingInvitationCookie();
    expect(cookie).toBeNull();
  });

  it("16. Already accepted invitation is handled safely and clears pending cookie", async () => {
    await setPendingInvitationCookie(validToken);

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "ALREADY_ACTIVE_MEMBER",
        message: "You are already an active member of this organization.",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await acceptInvitationAction({ token: validToken });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ALREADY_ACTIVE_MEMBER");
    }

    const cookie = await getPendingInvitationCookie();
    expect(cookie).toBeNull();
  });

  it("17. Resent invitation generates new token and invalidates the old token", async () => {
    const mockContext = {
      user: { id: "u-owner", email: "owner@test.com" },
      organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, is_active: true },
      membership: { role: "owner", status: "active" },
      role: "owner" as const,
      permissions: ["employees:invite"] as any,
    };

    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: mockContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: "inv-1",
        organization_id: mockOrgId,
        email: "employee@test.com",
        role: "cashier",
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await resendInvitationAction(mockSlug, {
      invitationId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "resend_organization_invitation",
      expect.objectContaining({
        p_invitation_id: "00000000-0000-4000-8000-000000000001",
        p_new_token_hash: expect.any(String),
      })
    );
  });

  it("18. Malicious external redirect URLs are rejected by sanitizeRedirectUrl", () => {
    expect(sanitizeRedirectUrl("https://evil.com/phish")).toBe("/");
    expect(sanitizeRedirectUrl("//evil.com/phish")).toBe("/");
    expect(sanitizeRedirectUrl("/\\evil.com/phish")).toBe("/");
    expect(sanitizeRedirectUrl("javascript:alert(1)")).toBe("/");
    expect(sanitizeRedirectUrl("data:text/html,evil")).toBe("/");

    // Valid relative paths must pass
    expect(sanitizeRedirectUrl(`/invitations/accept?token=${validToken}`)).toBe(
      `/invitations/accept?token=${validToken}`
    );
    expect(sanitizeRedirectUrl("/retail-store/dashboard")).toBe("/retail-store/dashboard");
  });

  it("19. Invalid or missing invitation context falls back safely", async () => {
    // Malformed token in cookie
    const cookieStore = await supabaseServer.getSafeCookieStore();
    cookieStore.set(INVITATION_COOKIE_NAME, "not-a-valid-hex-token-format");

    const retrieved = await getPendingInvitationCookie();
    expect(retrieved).toBeNull();

    // Direct validate action with malformed token
    const valResult = await validateInvitationTokenAction({ token: "short" });
    expect(valResult.success).toBe(true);
    if (valResult.success) {
      expect(valResult.data.isValid).toBe(false);
    }
  });

  it("20. Repeated callbacks or acceptance attempts do not create duplicate memberships", async () => {
    // First attempt succeeds
    const mockRpcFirst = vi.fn().mockResolvedValue({
      data: {
        success: true,
        organization_id: mockOrgId,
        organization_slug: mockSlug,
        role: "cashier",
        status: "active",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValueOnce({
      rpc: mockRpcFirst,
    } as any);

    const firstResult = await acceptInvitationAction({ token: validToken });
    expect(firstResult.success).toBe(true);

    // Second attempt fails with INVITATION_NOT_PENDING (already accepted in DB)
    const mockRpcSecond = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "INVITATION_NOT_PENDING",
        message: "This invitation has already been processed.",
        status: "accepted",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValueOnce({
      rpc: mockRpcSecond,
    } as any);

    const secondResult = await acceptInvitationAction({ token: validToken });
    expect(secondResult.success).toBe(false);
    if (!secondResult.success) {
      expect(secondResult.error.code).toBe("INVITATION_NOT_PENDING");
    }
  });

  // ===========================================================================
  // Utility and Helper Unit Tests
  // ===========================================================================

  it("extractInvitationToken extracts valid tokens from URL strings or search params", () => {
    expect(extractInvitationToken(`/invitations/accept?token=${validToken}`)).toBe(validToken);
    expect(
      extractInvitationToken(
        `http://localhost:3000/sign-in?next=%2Finvitations%2Faccept%3Ftoken%3D${validToken}`
      )
    ).toBe(validToken);
    expect(extractInvitationToken("?token=invalid")).toBeNull();
    expect(extractInvitationToken(null)).toBeNull();
    expect(extractInvitationToken("")).toBeNull();
  });

  it("isValidInvitationTokenFormat strictly validates 64-char lowercase hex strings", () => {
    expect(isValidInvitationTokenFormat(validToken)).toBe(true);
    expect(isValidInvitationTokenFormat("abcdef")).toBe(false);
    expect(isValidInvitationTokenFormat(12345)).toBe(false);
    expect(isValidInvitationTokenFormat(null)).toBe(false);
    expect(isValidInvitationTokenFormat(validToken.toUpperCase())).toBe(false); // must be lowercase hex
    expect(isValidInvitationTokenFormat(`${validToken}extra`)).toBe(false);
  });

  it("clearPendingInvitationCookie removes the invitation cookie from storage", async () => {
    await setPendingInvitationCookie(validToken);
    expect(await getPendingInvitationCookie()).toBe(validToken);

    await clearPendingInvitationCookie();
    expect(await getPendingInvitationCookie()).toBeNull();
  });

  // ===========================================================================
  // Part 4: Invalid Token Handling & Cookie Invariants
  // ===========================================================================

  describe("Invalid Token Handling & Cookie Cleanup", () => {
    it("RPC error clears the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Database connection failed", code: "PGRST000" },
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isValid).toBe(false);
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("RPC returning no data clears the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isValid).toBe(false);
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("RPC returning is_valid === false clears the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { is_valid: false, is_expired: false, status: null },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isValid).toBe(false);
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("Malformed URL token clears the cookie in validateInvitationTokenAction", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const res = await validateInvitationTokenAction({ token: "not-a-valid-64-char-hex-token" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isValid).toBe(false);
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("On invitation acceptance page, malformed token immediately clears the cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      } as any);

      await InvitationAcceptancePage({
        searchParams: Promise.resolve({ token: "invalid-token" }),
      });

      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("Expired invitation clears the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { is_valid: false, is_expired: true, status: "expired" },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isExpired).toBe(true);
        expect(res.data.status).toBe("expired");
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("Revoked invitation clears the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { is_valid: false, is_expired: false, status: "revoked" },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.status).toBe("revoked");
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("Accepted or declined invitation clears the pending invitation cookie", async () => {
      // Accepted
      await setPendingInvitationCookie(validToken);
      const mockRpcAccepted = vi.fn().mockResolvedValue({
        data: { is_valid: false, is_expired: false, status: "accepted" },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValueOnce({ rpc: mockRpcAccepted } as any);
      await validateInvitationTokenAction({ token: validToken });
      expect(await getPendingInvitationCookie()).toBeNull();

      // Declined
      await setPendingInvitationCookie(validToken);
      const mockRpcDeclined = vi.fn().mockResolvedValue({
        data: { is_valid: false, is_expired: false, status: "declined" },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValueOnce({ rpc: mockRpcDeclined } as any);
      await validateInvitationTokenAction({ token: validToken });
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("A valid pending invitation retains the pending invitation cookie", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const mockRpc = vi.fn().mockResolvedValue({
        data: { is_valid: true, is_expired: false, status: "pending" },
        error: null,
      });
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      const res = await validateInvitationTokenAction({ token: validToken });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isValid).toBe(true);
        expect(res.data.status).toBe("pending");
      }
      expect(await getPendingInvitationCookie()).toBe(validToken);
    });
  });

  // ===========================================================================
  // Part 5: Invitation Dismissal
  // ===========================================================================

  describe("Invitation Dismissal Action", () => {
    it("Dismissal clears the pending invitation cookie and redirects to onboarding", async () => {
      await setPendingInvitationCookie(validToken);
      expect(await getPendingInvitationCookie()).toBe(validToken);

      const res = await dismissInvitationAction();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.redirectUrl).toBe("/onboarding/create-organization");
      }
      expect(await getPendingInvitationCookie()).toBeNull();
    });

    it("Dismissal does not modify, accept, decline, or revoke original invitation in DB", async () => {
      const mockRpc = vi.fn();
      vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

      await dismissInvitationAction();

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("Dismissal action does not disclose invitation email or recipient details", async () => {
      const res = await dismissInvitationAction();
      expect(res.success).toBe(true);
      const json = JSON.stringify(res);
      expect(json).not.toContain("@");
      expect(json).not.toContain("email");
    });
  });

  // ===========================================================================
  // Part 6: Middleware Tests
  // ===========================================================================

  describe("Middleware Routing & Redirect Invariants", () => {
    it("/invitations/accept?token=... captures a valid token in the HTTP-only cookie", async () => {
      vi.mocked(supabaseMiddleware.updateSession).mockResolvedValue({
        supabaseResponse: NextResponse.next(),
        user: null,
      } as any);

      const req = new NextRequest(`http://localhost:3000/invitations/accept?token=${validToken}`);
      const res = await middleware(req);

      const cookie = res.cookies.get(INVITATION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      expect(cookie?.value).toBe(validToken);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
    });

    it("Authenticated users visiting /sign-in?next=... retain the sanitized destination", async () => {
      vi.mocked(supabaseMiddleware.updateSession).mockResolvedValue({
        supabaseResponse: NextResponse.next(),
        user: { id: "u-auth", email_confirmed_at: "2026-11-01T00:00:00Z" },
      } as any);

      const req = new NextRequest("http://localhost:3000/sign-in?next=/settings/profile");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/settings/profile");
    });

    it("Authenticated users visiting /sign-up?next=... retain the sanitized destination", async () => {
      vi.mocked(supabaseMiddleware.updateSession).mockResolvedValue({
        supabaseResponse: NextResponse.next(),
        user: { id: "u-auth", email_confirmed_at: "2026-11-01T00:00:00Z" },
      } as any);

      const targetPath = `/invitations/accept?token=${validToken}`;
      const req = new NextRequest(`http://localhost:3000/sign-up?next=${encodeURIComponent(targetPath)}`);
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`http://localhost:3000${targetPath}`);
    });

    it("Unsafe external redirect destinations fall back to /", async () => {
      vi.mocked(supabaseMiddleware.updateSession).mockResolvedValue({
        supabaseResponse: NextResponse.next(),
        user: { id: "u-auth", email_confirmed_at: "2026-11-01T00:00:00Z" },
      } as any);

      // Full external URL
      const req1 = new NextRequest("http://localhost:3000/sign-in?next=https://evil.com/phish");
      const res1 = await middleware(req1);
      expect(res1.headers.get("location")).toBe("http://localhost:3000/");

      // Protocol-relative URL
      const req2 = new NextRequest("http://localhost:3000/sign-in?next=//evil.com/phish");
      const res2 = await middleware(req2);
      expect(res2.headers.get("location")).toBe("http://localhost:3000/");

      // Backslash evasion URL
      const req3 = new NextRequest("http://localhost:3000/sign-in?next=/\\evil.com");
      const res3 = await middleware(req3);
      expect(res3.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("Missing next parameter falls back to /", async () => {
      vi.mocked(supabaseMiddleware.updateSession).mockResolvedValue({
        supabaseResponse: NextResponse.next(),
        user: { id: "u-auth", email_confirmed_at: "2026-11-01T00:00:00Z" },
      } as any);

      const req = new NextRequest("http://localhost:3000/sign-in");
      const res = await middleware(req);
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });
  });
});
