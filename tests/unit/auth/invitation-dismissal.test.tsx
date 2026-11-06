import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AcceptInvitationCard } from "@/components/invitations/AcceptInvitationCard";
import {
  acceptInvitationAction,
  dismissInvitationAction,
} from "@/actions/invitation-actions";
import * as supabaseServer from "@/lib/supabase/server";
import {
  setPendingInvitationCookie,
  getPendingInvitationCookie,
} from "@/lib/auth/invitation-cookie";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof supabaseServer>();
  return {
    ...actual,
    createClient: vi.fn(),
  };
});

describe("Invitation Dismissal & EMAIL_MISMATCH Resolution Tests", () => {
  const validToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseServer.clearInMemoryCookieJar();
  });

  it("Email mismatch displays the dismissal action button 'Dismiss Invitation and Set Up My Store'", async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "EMAIL_MISMATCH",
        message: "The authenticated account does not match the invitation recipient.",
      },
      error: null,
    });
    vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

    render(
      <AcceptInvitationCard
        token={validToken}
        currentUserEmail="wrong-user@example.com"
        isValidToken={true}
        isExpired={false}
        tokenStatus="pending"
      />
    );

    // Initial state: dismissal button not visible yet
    expect(
      screen.queryByRole("button", { name: /Dismiss Invitation and Set Up My Store/i })
    ).not.toBeInTheDocument();

    // User clicks Accept Invitation
    fireEvent.click(screen.getByRole("button", { name: /Accept Invitation/i }));

    // Upon EMAIL_MISMATCH, the account mismatch banner and dismissal button are displayed
    await waitFor(() => {
      expect(screen.getByText(/Account Mismatch/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Dismiss Invitation and Set Up My Store/i })
      ).toBeInTheDocument();
    });
  });

  it("Clicking dismissal clears pending invitation cookie and redirects to /onboarding/create-organization", async () => {
    await setPendingInvitationCookie(validToken);
    expect(await getPendingInvitationCookie()).toBe(validToken);

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: "EMAIL_MISMATCH",
        message: "The authenticated account does not match the invitation recipient.",
      },
      error: null,
    });
    vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

    render(
      <AcceptInvitationCard
        token={validToken}
        currentUserEmail="wrong-user@example.com"
        isValidToken={true}
        isExpired={false}
        tokenStatus="pending"
      />
    );

    // Trigger EMAIL_MISMATCH
    fireEvent.click(screen.getByRole("button", { name: /Accept Invitation/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Dismiss Invitation and Set Up My Store/i })
      ).toBeInTheDocument();
    });

    // Click dismissal
    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss Invitation and Set Up My Store/i })
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/onboarding/create-organization");
    });

    // Cookie is cleared
    expect(await getPendingInvitationCookie()).toBeNull();
  });

  it("Dismissal does not modify, accept, decline, or revoke the invitation database record", async () => {
    const mockRpc = vi.fn();
    vi.mocked(supabaseServer.createClient).mockResolvedValue({ rpc: mockRpc } as any);

    const res = await dismissInvitationAction();

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.redirectUrl).toBe("/onboarding/create-organization");
    }

    // Verified: No RPC call was made to touch the invitation table
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("Dismissal action does not disclose invitation recipient email address", async () => {
    const res = await dismissInvitationAction();
    expect(res.success).toBe(true);
    const json = JSON.stringify(res);
    expect(json).not.toContain("@");
    expect(json).not.toContain("email");
  });

  it("After a mismatched user dismisses, the intended recipient can still accept the original invitation", async () => {
    // 1. Mismatched user dismisses
    await setPendingInvitationCookie(validToken);
    const dismissRes = await dismissInvitationAction();
    expect(dismissRes.success).toBe(true);
    expect(await getPendingInvitationCookie()).toBeNull();

    // 2. The intended recipient accesses the invitation
    const mockRpcAccept = vi.fn().mockResolvedValue({
      data: {
        success: true,
        invitation_id: "inv-123",
        organization_id: "org-123",
        organization_slug: "my-retail-store",
        role: "cashier",
        status: "active",
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpcAccept,
    } as any);

    // Intended recipient accepts
    const acceptRes = await acceptInvitationAction({ token: validToken });
    expect(acceptRes.success).toBe(true);
    if (acceptRes.success) {
      expect(acceptRes.data.organizationSlug).toBe("my-retail-store");
      expect(acceptRes.data.redirectUrl).toBe("/my-retail-store/dashboard");
    }

    expect(mockRpcAccept).toHaveBeenCalledWith(
      "accept_organization_invitation",
      expect.objectContaining({
        p_token_hash: expect.any(String),
      })
    );
  });
});
