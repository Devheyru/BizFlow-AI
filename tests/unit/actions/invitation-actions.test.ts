import { describe, it, expect, vi, beforeEach } from "vitest";
import { inviteEmployeeAction, resendInvitationAction } from "@/actions/invitation-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";
import * as mailer from "@/lib/email/invitation-mailer";

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  getSafeCookieStore: vi.fn(),
}));

vi.mock("@/lib/email/invitation-mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof mailer>();
  return {
    ...actual,
    sendInvitationEmail: vi.fn(),
  };
});

describe("Invitation Server Actions Email Delivery Warning Tests", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockInvId = "c0000000-0000-4000-8000-000000000002";
  const mockSlug = "test-store";

  const mockContext = {
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "owner@test.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    permissions: [
      "employees:read",
      "employees:invite",
      "employees:update_role",
      "employees:suspend",
      "employees:remove",
      "employees:invitations_read",
      "employees:invitations_revoke",
    ] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: mockContext as any,
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Invite action returns the email warning
  // ---------------------------------------------------------------------------
  it("inviteEmployeeAction returns EMAIL_DELIVERY_FAILED warning when sendInvitationEmail fails", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: mockInvId,
        organization_id: mockOrgId,
        email: "newemployee@example.com",
        role: "cashier",
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    // Mock mailer failure
    vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
      success: false,
      error: "Resend domain not verified",
    });

    const result = await inviteEmployeeAction(mockSlug, {
      organizationId: mockOrgId,
      email: "newemployee@example.com",
      role: "cashier",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invitationId).toBe(mockInvId);
      expect(result.data.status).toBe("pending");
      expect(result.data.warning).toBe("EMAIL_DELIVERY_FAILED");
    }
  });

  it("inviteEmployeeAction returns clean data without warning when sendInvitationEmail succeeds", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: mockInvId,
        organization_id: mockOrgId,
        email: "newemployee@example.com",
        role: "cashier",
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    // Mock mailer success
    vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
      success: true,
      messageId: "msg_ok_123",
    });

    const result = await inviteEmployeeAction(mockSlug, {
      organizationId: mockOrgId,
      email: "newemployee@example.com",
      role: "cashier",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invitationId).toBe(mockInvId);
      expect(result.data.status).toBe("pending");
      expect(result.data.warning).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 10. Resend action returns the email warning
  // ---------------------------------------------------------------------------
  it("resendInvitationAction returns EMAIL_DELIVERY_FAILED warning when sendInvitationEmail fails", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: mockInvId,
        organization_id: mockOrgId,
        email: "existing@example.com",
        role: "manager",
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    // Mock mailer failure
    vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
      success: false,
      error: "Network timeout",
    });

    const result = await resendInvitationAction(mockSlug, {
      invitationId: mockInvId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invitationId).toBe(mockInvId);
      expect(result.data.status).toBe("pending");
      expect(result.data.warning).toBe("EMAIL_DELIVERY_FAILED");
    }
  });

  it("resendInvitationAction returns clean data without warning when sendInvitationEmail succeeds", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: mockInvId,
        organization_id: mockOrgId,
        email: "existing@example.com",
        role: "manager",
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    // Mock mailer success
    vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
      success: true,
      messageId: "msg_resend_ok",
    });

    const result = await resendInvitationAction(mockSlug, {
      invitationId: mockInvId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invitationId).toBe(mockInvId);
      expect(result.data.status).toBe("pending");
      expect(result.data.warning).toBeUndefined();
    }
  });

  // ---------------------------------------------------------------------------
  // 11. URL normalization in invite and resend actions
  // ---------------------------------------------------------------------------
  it("inviteEmployeeAction passes normalized URL without duplicate slashes when NEXT_PUBLIC_APP_URL has trailing slashes", async () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://bizflow.ai///";

    try {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          invitation_id: mockInvId,
          organization_id: mockOrgId,
          email: "newemployee@example.com",
          role: "cashier",
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
        success: true,
        messageId: "msg_norm_1",
      });

      const result = await inviteEmployeeAction(mockSlug, {
        organizationId: mockOrgId,
        email: "newemployee@example.com",
        role: "cashier",
      });

      expect(result.success).toBe(true);
      expect(mailer.sendInvitationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          invitationUrl: expect.stringMatching(/^https:\/\/bizflow\.ai\/invitations\/accept\?token=[a-f0-9]{64}$/),
        })
      );
      // Explicitly check there is no double slash before invitations
      const firstCall = vi.mocked(mailer.sendInvitationEmail).mock.calls[0];
      expect(firstCall).toBeDefined();
      const calledUrl = (firstCall?.[0] as any)?.invitationUrl;
      expect(calledUrl).not.toContain("ai//");
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  });

  it("resendInvitationAction passes normalized URL without duplicate slashes when NEXT_PUBLIC_APP_URL has trailing slashes", async () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://bizflow.ai/";

    try {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          invitation_id: mockInvId,
          organization_id: mockOrgId,
          email: "existing@example.com",
          role: "manager",
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      vi.mocked(mailer.sendInvitationEmail).mockResolvedValue({
        success: true,
        messageId: "msg_norm_2",
      });

      const result = await resendInvitationAction(mockSlug, {
        invitationId: mockInvId,
      });

      expect(result.success).toBe(true);
      expect(mailer.sendInvitationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          invitationUrl: expect.stringMatching(/^https:\/\/bizflow\.ai\/invitations\/accept\?token=[a-f0-9]{64}$/),
        })
      );
      const firstCall = vi.mocked(mailer.sendInvitationEmail).mock.calls[0];
      expect(firstCall).toBeDefined();
      const calledUrl = (firstCall?.[0] as any)?.invitationUrl;
      expect(calledUrl).not.toContain("ai//");
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  });

  // ---------------------------------------------------------------------------
  // 12. Failure handling when production URL configuration is invalid
  // ---------------------------------------------------------------------------
  it("inviteEmployeeAction safely returns EMAIL_DELIVERY_FAILED warning when NEXT_PUBLIC_APP_URL is missing in production", async () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.NEXT_PUBLIC_APP_URL;
    (process.env as any).NODE_ENV = "production";

    try {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          invitation_id: mockInvId,
          organization_id: mockOrgId,
          email: "newemployee@example.com",
          role: "cashier",
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const result = await inviteEmployeeAction(mockSlug, {
        organizationId: mockOrgId,
        email: "newemployee@example.com",
        role: "cashier",
      });

      // Invitation is created in database, but delivery returns structured warning
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invitationId).toBe(mockInvId);
        expect(result.data.status).toBe("pending");
        expect(result.data.warning).toBe("EMAIL_DELIVERY_FAILED");
      }
      expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
      (process.env as any).NODE_ENV = originalNodeEnv;
    }
  });

  it("resendInvitationAction safely returns EMAIL_DELIVERY_FAILED warning when NEXT_PUBLIC_APP_URL uses insecure HTTP in production", async () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NEXT_PUBLIC_APP_URL = "http://insecure.bizflow.ai";
    (process.env as any).NODE_ENV = "production";

    try {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          invitation_id: mockInvId,
          organization_id: mockOrgId,
          email: "existing@example.com",
          role: "manager",
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const result = await resendInvitationAction(mockSlug, {
        invitationId: mockInvId,
      });

      // Invitation record updated in DB, but email delivery returns structured warning
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invitationId).toBe(mockInvId);
        expect(result.data.status).toBe("pending");
        expect(result.data.warning).toBe("EMAIL_DELIVERY_FAILED");
      }
      expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
      (process.env as any).NODE_ENV = originalNodeEnv;
    }
  });
});
