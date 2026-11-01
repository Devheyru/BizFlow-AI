import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTenantContext } from "@/lib/auth/context";
import * as guards from "@/lib/auth/guards";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/auth/guards", () => ({
  getUserActiveOrganizations: vi.fn(),
}));

describe("T036: resolveTenantContext Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthenticated when getUser returns null user", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("No session") }),
      },
    } as unknown as SupabaseClient;

    const result = await resolveTenantContext("test-slug", { supabaseClient: mockClient });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unauthenticated");
    }
  });

  it("returns unverified when user.email_confirmed_at is null", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "u-1", email: "unv@example.com", email_confirmed_at: null },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;

    const result = await resolveTenantContext("test-slug", { supabaseClient: mockClient });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unverified");
    }
  });

  it("returns no_organizations when user belongs to 0 active organizations", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "u-1", email: "user@example.com", email_confirmed_at: "2026-10-31" },
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;

    vi.mocked(guards.getUserActiveOrganizations).mockResolvedValue([]);

    const result = await resolveTenantContext("test-slug", { supabaseClient: mockClient });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("no_organizations");
    }
  });

  it("returns not_found when requested slug does not match any active organization", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "u-1", email: "user@example.com", email_confirmed_at: "2026-10-31" },
          },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    vi.mocked(guards.getUserActiveOrganizations).mockResolvedValue([
      {
        id: "org-1",
        name: "Store 1",
        slug: "store-1",
        businessType: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        isActive: true,
        role: "owner",
      },
    ]);

    const result = await resolveTenantContext("other-store", { supabaseClient: mockClient });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_found");
    }
  });

  it("returns forbidden when user does not have active membership in the organization", async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "u-1", email: "user@example.com", email_confirmed_at: "2026-10-31" },
          },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "org-1", name: "Store 1", slug: "store-1", is_active: true },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "organization_memberships") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    vi.mocked(guards.getUserActiveOrganizations).mockResolvedValue([
      {
        id: "org-1",
        name: "Store 1",
        slug: "store-1",
        businessType: "Retail",
        country: "US",
        currency: "USD",
        timezone: "UTC",
        isActive: true,
        role: "owner",
      },
    ]);

    const result = await resolveTenantContext("store-1", { supabaseClient: mockClient });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("forbidden");
    }
  });

  it("returns success context when user is authenticated, verified, and has active membership", async () => {
    const mockOrg = {
      id: "org-1",
      name: "Store 1",
      slug: "store-1",
      business_type: "Retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      is_active: true,
    };
    const mockMembership = {
      id: "mem-1",
      organization_id: "org-1",
      user_id: "u-1",
      role: "owner",
      status: "active",
    };

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: "u-1", email: "owner@example.com", email_confirmed_at: "2026-10-31" },
          },
          error: null,
        }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "organizations") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrg, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "organization_memberships") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockMembership, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    vi.mocked(guards.getUserActiveOrganizations).mockResolvedValue([
      {
        id: "org-1",
        name: "Store 1",
        slug: "store-1",
        businessType: "Retail",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        isActive: true,
        role: "owner",
      },
    ]);

    const result = await resolveTenantContext("store-1", { supabaseClient: mockClient });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.organization.id).toBe("org-1");
      expect(result.context.role).toBe("owner");
      expect(result.context.user.id).toBe("u-1");
      expect(result.context.activeOrganizations).toHaveLength(1);
    }
  });
});

