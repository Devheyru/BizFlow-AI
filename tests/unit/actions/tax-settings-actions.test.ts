import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateTaxSettingsAction, getTaxSettingsAction } from "@/actions/tax-settings-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Feature 005 — Tax Settings Server Actions Unit Tests (T058, US5, US8)", () => {
  const mockOrgId = "00000000-0000-4000-a000-000000000001";
  const mockSlug = "alpha-store";

  const ownerContext = {
    user: { id: "00000000-0000-4000-a000-000000000002", email: "owner@test.com" },
    organization: { id: mockOrgId, name: "Alpha Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    permissions: ["tax_settings:update", "sales:read"] as any,
  };

  const cashierContext = {
    user: { id: "00000000-0000-4000-a000-000000000003", email: "cashier@test.com" },
    organization: { id: mockOrgId, name: "Alpha Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: ["sales:read", "sales:create"] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateTaxSettingsAction", () => {
    it("successfully updates tax settings when invoked by authorized Owner", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          organization_id: mockOrgId,
          tax_name: "VAT",
          default_tax_rate: "15.0000",
          is_tax_inclusive: true,
          updated_at: new Date().toISOString(),
        },
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const result = await updateTaxSettingsAction(mockSlug, {
        taxName: "VAT",
        defaultTaxRate: 15.0,
        isTaxInclusive: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taxName).toBe("VAT");
        expect(result.data.defaultTaxRate).toBe(15.0);
        expect(result.data.isTaxInclusive).toBe(true);
      }

      expect(mockRpc).toHaveBeenCalledWith("update_tax_settings", {
        p_org_id: mockOrgId,
        p_tax_name: "VAT",
        p_default_tax_rate: 15.0,
        p_is_tax_inclusive: true,
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/settings`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/settings/tax`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/pos`);
    });

    it("rejects unauthorized cashier update attempt with FORBIDDEN error", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const result = await updateTaxSettingsAction(mockSlug, {
        taxName: "GST",
        defaultTaxRate: 10.0,
        isTaxInclusive: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FORBIDDEN");
        expect(result.error.message).toContain("Insufficient permissions");
      }
    });

    it("rejects invalid negative tax rate with VALIDATION_ERROR", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const result = await updateTaxSettingsAction(mockSlug, {
        taxName: "Sales Tax",
        defaultTaxRate: -5.0,
        isTaxInclusive: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects empty tax name with VALIDATION_ERROR", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      const result = await updateTaxSettingsAction(mockSlug, {
        taxName: "   ",
        defaultTaxRate: 5.0,
        isTaxInclusive: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("getTaxSettingsAction", () => {
    it("successfully retrieves persisted tax settings for active organization member", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockSelect = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockReturnThis();
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          organization_id: mockOrgId,
          tax_name: "State Tax",
          default_tax_rate: "8.2500",
          is_tax_inclusive: false,
          updated_at: new Date().toISOString(),
          updated_by: ownerContext.user.id,
        },
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        from: () => ({
          select: mockSelect,
          eq: mockEq,
          maybeSingle: mockMaybeSingle,
        }),
      } as any);

      const result = await getTaxSettingsAction(mockSlug);

      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.taxName).toBe("State Tax");
        expect(result.data.defaultTaxRate).toBe(8.25);
        expect(result.data.isTaxInclusive).toBe(false);
      }
    });

    it("returns null data gracefully when no tax record exists yet", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: ownerContext as any,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        from: () => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      } as any);

      const result = await getTaxSettingsAction(mockSlug);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });
  });
});
