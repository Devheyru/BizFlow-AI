import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NewProductPage from "@/app/[slug]/products/new/page";
import * as authContext from "@/lib/auth/context";
import * as authPermissions from "@/lib/auth/permissions";
import * as supabaseServer from "@/lib/supabase/server";
import { notFound } from "next/navigation";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: vi.fn(),
}));

// Mock auth context & permissions
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: vi.fn(),
}));

vi.mock("@/lib/auth/permissions", () => ({
  hasPermission: vi.fn(),
}));

// Mock Supabase server client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// Mock ProductForm to keep page test focused
vi.mock("@/components/products/ProductForm", () => ({
  ProductForm: ({ categories, canReadCost, organizationId }: any) => (
    <div data-testid="mock-product-form">
      <span>CanReadCost: {canReadCost ? "yes" : "no"}</span>
      <span>OrgId: {organizationId}</span>
      <span>Categories: {categories.map((c: any) => c.name).join(", ")}</span>
    </div>
  ),
}));

describe("T034 / F-02: NewProductPage Server Component Unit Tests", () => {
  const mockSlug = "alpha-store";
  const mockContext = {
    organization: {
      id: "org-1111",
      name: "Alpha Retail",
      currency: "USD",
      is_active: true,
    },
    role: "manager",
    user: { id: "user-123" },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notFound).mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  it("serves 404 (notFound) when user lacks products:create permission", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValueOnce(mockContext);
    vi.mocked(authPermissions.hasPermission).mockReturnValue(false);

    await expect(
      NewProductPage({
        params: Promise.resolve({ slug: mockSlug }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders ProductForm with active tenant categories and cost gating when authorized", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValueOnce(mockContext);
    vi.mocked(authPermissions.hasPermission).mockImplementation((_ctx, perm) => {
      if (perm === "products:create") return true;
      if (perm === "products:read_cost") return true;
      return false;
    });

    const mockCategories = [
      { id: "cat-1", name: "Beverages" },
      { id: "cat-2", name: "Snacks" },
    ];

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockCategories,
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseServer.createClient).mockResolvedValueOnce(mockSupabase as any);

    const PageJsx = await NewProductPage({
      params: Promise.resolve({ slug: mockSlug }),
    });

    render(PageJsx);

    expect(screen.getByText("Register New Product")).toBeInTheDocument();
    expect(screen.getByTestId("mock-product-form")).toBeInTheDocument();
    expect(screen.getByText(/Beverages, Snacks/i)).toBeInTheDocument();
    expect(screen.getByText(/CanReadCost: yes/i)).toBeInTheDocument();
  });

  it("F-02: throws error when category query fails rather than silently rendering empty categories", async () => {
    vi.mocked(authContext.getTenantContext).mockResolvedValueOnce(mockContext);
    vi.mocked(authPermissions.hasPermission).mockImplementation((_ctx, perm) => {
      if (perm === "products:create") return true;
      return false;
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "Internal connection failure", code: "57P01" },
              }),
            }),
          }),
        }),
      }),
    };
    vi.mocked(supabaseServer.createClient).mockResolvedValueOnce(mockSupabase as any);

    await expect(
      NewProductPage({
        params: Promise.resolve({ slug: mockSlug }),
      })
    ).rejects.toThrow("Failed to load product categories for this organization.");
  });
});
