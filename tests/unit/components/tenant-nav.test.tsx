import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TenantNav } from "@/components/layout/tenant-nav";
import { TenantHeader } from "@/components/layout/TenantHeader";
import TenantLayout from "@/app/[slug]/layout";
import type { AppRole, Organization, OrganizationMembership, OrganizationSummary, TenantContext } from "@/types/auth";
import type { User } from "@supabase/supabase-js";

let mockPathname: string | null = "/test-org/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock server action in TenantHeader
vi.mock("@/actions/auth-actions", () => ({
  signOutAction: vi.fn(),
}));

// Mock organization action in OrganizationSwitcher
vi.mock("@/actions/organization-actions", () => ({
  switchOrganizationAction: vi.fn(),
}));

// Mock getTenantContext for TenantLayout integration tests
const mockGetTenantContext = vi.fn();
vi.mock("@/lib/auth/context", () => ({
  getTenantContext: (slug: string) => mockGetTenantContext(slug),
}));

describe("TenantNav: Permission-Gated Navigation (T027, FR-026)", () => {
  const testSlug = "test-retail";

  beforeEach(() => {
    mockPathname = `/${testSlug}/dashboard`;
    vi.clearAllMocks();
  });

  describe("Products Navigation Item Visibility", () => {
    it("1. renders Products navigation item when canViewProducts is true", () => {
      render(<TenantNav slug={testSlug} role="cashier" canViewProducts={true} />);

      const productsLink = screen.getByRole("link", { name: /products/i });
      expect(productsLink).toBeInTheDocument();
      expect(productsLink).toHaveAttribute("href", `/${testSlug}/products`);
    });

    it("2. does NOT render Products navigation item when canViewProducts is false", () => {
      render(<TenantNav slug={testSlug} role="owner" canViewProducts={false} />);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("3. does NOT render Products when canViewProducts is omitted (fails closed by default)", () => {
      render(<TenantNav slug={testSlug} role="admin" />);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("3b. does NOT render Products when canViewProducts is undefined", () => {
      render(<TenantNav slug={testSlug} role="manager" canViewProducts={undefined} />);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("3c. does NOT render Products when canViewProducts is null (runtime type boundary safety)", () => {
      render(<TenantNav slug={testSlug} role="owner" canViewProducts={null as unknown as boolean} />);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("4. does NOT infer Products visibility from role name alone across all roles", () => {
      const allRoles: AppRole[] = ["owner", "admin", "manager", "cashier"];

      for (const role of allRoles) {
        const { unmount } = render(<TenantNav slug={testSlug} role={role} canViewProducts={false} />);
        expect(
          screen.queryByRole("link", { name: /products/i }),
          `Expected Products link to be hidden for role ${role} when canViewProducts is false`
        ).not.toBeInTheDocument();
        unmount();

        const { unmount: unmountOmitted } = render(<TenantNav slug={testSlug} role={role} />);
        expect(
          screen.queryByRole("link", { name: /products/i }),
          `Expected Products link to be hidden for role ${role} when canViewProducts is omitted`
        ).not.toBeInTheDocument();
        unmountOmitted();
      }
    });

    it("4b. renders Products for ANY role when canViewProducts is true", () => {
      const allRoles: AppRole[] = ["owner", "admin", "manager", "cashier"];

      for (const role of allRoles) {
        const { unmount } = render(<TenantNav slug={testSlug} role={role} canViewProducts={true} />);
        expect(
          screen.getByRole("link", { name: /products/i }),
          `Expected Products link to be visible for role ${role} when canViewProducts is true`
        ).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe("Preservation of Existing Navigation Behavior", () => {
    it("5a. renders Employees navigation item only for Owner, Admin, and Manager", () => {
      const privilegedRoles: AppRole[] = ["owner", "admin", "manager"];

      for (const role of privilegedRoles) {
        const { unmount } = render(
          <TenantNav slug={testSlug} role={role} canViewProducts={false} />
        );
        const employeesLink = screen.getByRole("link", { name: /employees/i });
        expect(employeesLink).toBeInTheDocument();
        expect(employeesLink).toHaveAttribute("href", `/${testSlug}/employees`);
        unmount();
      }
    });

    it("5b. does NOT render Employees navigation item for Cashier, regardless of canViewProducts", () => {
      const { unmount: unmountFalse } = render(
        <TenantNav slug={testSlug} role="cashier" canViewProducts={false} />
      );
      expect(screen.queryByRole("link", { name: /employees/i })).not.toBeInTheDocument();
      unmountFalse();

      const { unmount: unmountTrue } = render(
        <TenantNav slug={testSlug} role="cashier" canViewProducts={true} />
      );
      expect(screen.queryByRole("link", { name: /employees/i })).not.toBeInTheDocument();
      unmountTrue();
    });

    it("5c. always renders Dashboard link for all roles and permission states", () => {
      const allRoles: AppRole[] = ["owner", "admin", "manager", "cashier"];

      for (const role of allRoles) {
        for (const canViewProducts of [true, false, undefined]) {
          const { unmount } = render(
            <TenantNav slug={testSlug} role={role} canViewProducts={canViewProducts} />
          );
          const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
          expect(dashboardLink).toBeInTheDocument();
          expect(dashboardLink).toHaveAttribute("href", `/${testSlug}/dashboard`);
          unmount();
        }
      }
    });
  });

  describe("Route Highlighting and Styling Invariants", () => {
    it("6a. applies active highlighting to Products link when route matches /products exactly", () => {
      mockPathname = `/${testSlug}/products`;
      render(<TenantNav slug={testSlug} role="manager" canViewProducts={true} />);

      const productsLink = screen.getByRole("link", { name: /products/i });
      expect(productsLink.className).toContain("bg-blue-50");
      expect(productsLink.className).toContain("text-blue-700");
      expect(productsLink.className).toContain("font-semibold");

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink.className).toContain("text-gray-600");
      expect(dashboardLink.className).not.toContain("bg-blue-50");
    });

    it("6b. applies active highlighting to Products link when route matches a nested subpath", () => {
      mockPathname = `/${testSlug}/products/new`;
      render(<TenantNav slug={testSlug} role="admin" canViewProducts={true} />);

      const productsLink = screen.getByRole("link", { name: /products/i });
      expect(productsLink.className).toContain("bg-blue-50");
      expect(productsLink.className).toContain("text-blue-700");
      expect(productsLink.className).toContain("font-semibold");
    });

    it("6c. does NOT highlight Products link when another route is active", () => {
      mockPathname = `/${testSlug}/dashboard`;
      render(<TenantNav slug={testSlug} role="owner" canViewProducts={true} />);

      const productsLink = screen.getByRole("link", { name: /products/i });
      expect(productsLink.className).toContain("text-gray-600");
      expect(productsLink.className).not.toContain("bg-blue-50");

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink.className).toContain("bg-blue-50");
      expect(dashboardLink.className).toContain("text-blue-700");
      expect(dashboardLink.className).toContain("font-semibold");
    });

    it("6d. renders safely with inactive links when usePathname() returns null", () => {
      mockPathname = null;
      render(<TenantNav slug={testSlug} role="manager" canViewProducts={true} />);

      const productsLink = screen.getByRole("link", { name: /products/i });
      expect(productsLink).toBeInTheDocument();
      expect(productsLink.className).not.toContain("bg-blue-50");
      expect(productsLink.className).toContain("text-gray-600");

      const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
      expect(dashboardLink).toBeInTheDocument();
      expect(dashboardLink.className).not.toContain("bg-blue-50");
      expect(dashboardLink.className).toContain("text-gray-600");
    });
  });

  describe("TenantHeader Component Integration", () => {
    const mockOrg = {
      id: "org-uuid-1",
      name: "Acme Retail",
      slug: testSlug,
      business_type: "retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as Organization;

    const mockUser = {
      id: "user-uuid-1",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      email: "user@example.com",
    } as unknown as User;

    const mockSummaries: OrganizationSummary[] = [
      {
        id: "org-uuid-1",
        name: "Acme Retail",
        slug: testSlug,
        businessType: "retail",
        country: "US",
        currency: "USD",
        timezone: "America/New_York",
        isActive: true,
        role: "owner",
      },
    ];

    it("passes canViewProducts=true down to TenantNav", () => {
      render(
        <TenantHeader
          organization={mockOrg}
          role="owner"
          user={mockUser}
          activeOrganizations={mockSummaries}
          canViewProducts={true}
        />
      );

      expect(screen.getByRole("link", { name: /products/i })).toBeInTheDocument();
    });

    it("passes canViewProducts=false down to TenantNav (Products hidden)", () => {
      render(
        <TenantHeader
          organization={mockOrg}
          role="owner"
          user={mockUser}
          activeOrganizations={mockSummaries}
          canViewProducts={false}
        />
      );

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("defaults canViewProducts to false when omitted in TenantHeader (Products hidden)", () => {
      render(
        <TenantHeader
          organization={mockOrg}
          role="owner"
          user={mockUser}
          activeOrganizations={mockSummaries}
        />
      );

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });
  });

  describe("TenantLayout Server Boundary Integration", () => {
    const baseOrg = {
      id: "org-uuid-1",
      name: "Acme Retail",
      slug: testSlug,
      business_type: "retail",
      country: "US",
      currency: "USD",
      timezone: "America/New_York",
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as Organization;

    const baseUser = {
      id: "user-uuid-1",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
      email: "user@example.com",
    } as unknown as User;

    const baseMembership = {
      id: "membership-uuid-1",
      organization_id: "org-uuid-1",
      user_id: "user-uuid-1",
      role: "cashier",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as OrganizationMembership;

    it("evaluates hasPermission at server boundary and renders Products when permission is present", async () => {
      const authorizedContext: TenantContext = {
        organization: baseOrg,
        user: baseUser,
        membership: baseMembership,
        role: "cashier",
        activeOrganizations: [],
        permissions: ["products:read"],
      };

      mockGetTenantContext.mockResolvedValueOnce(authorizedContext);

      const layoutJsx = await TenantLayout({
        children: <div data-testid="child-content">Workspace Body</div>,
        params: Promise.resolve({ slug: testSlug }),
      });

      render(layoutJsx);

      expect(screen.getByRole("link", { name: /products/i })).toBeInTheDocument();
      expect(screen.getByTestId("child-content")).toBeInTheDocument();
    });

    it("evaluates hasPermission at server boundary and omits Products when permission is absent", async () => {
      const unauthorizedContext: TenantContext = {
        organization: baseOrg,
        user: baseUser,
        membership: { ...baseMembership, role: "cashier" },
        role: "cashier",
        activeOrganizations: [],
        permissions: [],
      };

      mockGetTenantContext.mockResolvedValueOnce(unauthorizedContext);

      const layoutJsx = await TenantLayout({
        children: <div data-testid="child-content">Workspace Body</div>,
        params: Promise.resolve({ slug: testSlug }),
      });

      render(layoutJsx);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
      expect(screen.getByTestId("child-content")).toBeInTheDocument();
    });

    it("omits Products when membership is suspended even if role is owner (fails closed via Rule 2)", async () => {
      const suspendedOwnerContext: TenantContext = {
        organization: baseOrg,
        user: baseUser,
        membership: { ...baseMembership, role: "owner", status: "suspended" },
        role: "owner",
        activeOrganizations: [],
        permissions: ["products:read"],
      };

      mockGetTenantContext.mockResolvedValueOnce(suspendedOwnerContext);

      const layoutJsx = await TenantLayout({
        children: <div data-testid="child-content">Workspace Body</div>,
        params: Promise.resolve({ slug: testSlug }),
      });

      render(layoutJsx);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });

    it("omits Products when organization is inactive (fails closed via Rule 2)", async () => {
      const inactiveOrgContext: TenantContext = {
        organization: { ...baseOrg, is_active: false },
        user: baseUser,
        membership: baseMembership,
        role: "owner",
        activeOrganizations: [],
        permissions: ["products:read"],
      };

      mockGetTenantContext.mockResolvedValueOnce(inactiveOrgContext);

      const layoutJsx = await TenantLayout({
        children: <div data-testid="child-content">Workspace Body</div>,
        params: Promise.resolve({ slug: testSlug }),
      });

      render(layoutJsx);

      expect(screen.queryByRole("link", { name: /products/i })).not.toBeInTheDocument();
    });
  });
});
