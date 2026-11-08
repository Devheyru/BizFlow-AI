import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProductAction } from "@/actions/product-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("T032: createProductAction Unit Tests (FR-001 to FR-016, FR-038, FR-040)", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockSlug = "test-retail-store";

  const ownerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "owner@retail.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    permissions: [
      "products:read",
      "products:read_cost",
      "products:create",
      "products:update",
      "products:archive",
    ] as any,
  };

  const cashierContext = {
    user: { id: "u0000000-0000-4000-8000-000000000002", email: "cashier@retail.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: ["products:read"] as any,
  };

  const validProductInput = {
    name: "Organic Honey Jar",
    sku: "HONEY-ORG-001",
    selling_price: 12.50,
    unit_of_measure: "piece",
    barcode: "HONEY-12345",
    description: "Raw wildflower honey",
    cost_price: 6.00,
  };

  const mockRpcResponseData = {
    id: "p0000000-0000-4000-8000-000000000001",
    organization_id: mockOrgId,
    name: "Organic Honey Jar",
    sku: "HONEY-ORG-001",
    barcode: "HONEY-12345",
    category_id: null,
    selling_price: 12.50,
    unit_of_measure: "piece",
    status: "active",
    version: 1,
    image_url: null,
    created_at: new Date().toISOString(),
    cost_price: 6.00,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when tenant context cannot be resolved", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: false,
      error: "not_found",
    });

    const result = await createProductAction(mockSlug, validProductInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("rejects caller lacking products:create permission (Cashier)", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const result = await createProductAction(mockSlug, validProductInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.message).toMatch(/missing products:create permission/i);
    }
  });

  it("rejects caller supplying cost_price without products:read_cost permission", async () => {
    const creatorWithoutCostPerm = {
      ...ownerContext,
      role: "manager" as const,
      membership: { role: "manager", status: "active" },
      permissions: ["products:read", "products:create", "products:update"], // missing products:read_cost
    };

    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: creatorWithoutCostPerm as any,
    });

    const result = await createProductAction(mockSlug, {
      ...validProductInput,
      cost_price: 8.00,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.message).toMatch(/requires products:read_cost permission/i);
    }
  });

  it("rejects invalid input failing CreateProductSchema validation", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: ownerContext as any,
    });

    const result = await createProductAction(mockSlug, {
      ...validProductInput,
      sku: "INVALID SKU WITH SPACES",
      selling_price: -5.00,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.details).toBeDefined();
    }
  });

  it("successfully creates product, calls RPC with explicit p_status: 'active', and revalidates path", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: ownerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: { success: true, data: mockRpcResponseData },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await createProductAction(mockSlug, validProductInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(mockRpcResponseData.id);
      expect(result.data.sku).toBe("HONEY-ORG-001");
      expect(result.data.selling_price).toBe(12.50);
      expect(result.data.cost_price).toBe(6.00);
      expect(result.data.gross_margin).toBeCloseTo(52, 0); // (12.50 - 6.00) / 12.50 * 100 = 52%
      expect(result.data.status).toBe("active");
      expect(result.data.version).toBe(1);
    }

    // Verify RPC invocation parameters
    expect(mockRpc).toHaveBeenCalledWith("create_product", {
      p_org_id: mockOrgId,
      p_name: "Organic Honey Jar",
      p_sku: "HONEY-ORG-001",
      p_selling_price: 12.50,
      p_unit_of_measure: "piece",
      p_status: "active",
      p_barcode: "HONEY-12345",
      p_description: "Raw wildflower honey",
      p_category_id: undefined,
      p_cost_price: 6.00,
      p_image_url: undefined,
    });

    // Verify cache invalidation
    expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/products`, "page");
  });

  it("correctly maps database RPC error codes (e.g. P0006 to IDENTIFIER_EXISTS)", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: ownerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0006", message: "SKU HONEY-ORG-001 already exists in organization catalog" },
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await createProductAction(mockSlug, validProductInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("IDENTIFIER_EXISTS");
      expect(result.error.message).toMatch(/already exists/i);
    }
  });

  it("strips cost_price and gross_margin from response when caller lacks products:read_cost", async () => {
    // Role with create permission but stripped cost permission
    const creatorWithoutCost = {
      ...ownerContext,
      role: "manager" as const,
      membership: { role: "manager", status: "active" },
      permissions: ["products:read", "products:create", "products:update"],
    };

    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: creatorWithoutCost as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        data: {
          ...mockRpcResponseData,
          cost_price: null, // masked by database
        },
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const result = await createProductAction(mockSlug, {
      ...validProductInput,
      cost_price: undefined,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // cost_price and gross_margin MUST be stripped / undefined
      expect(result.data.cost_price).toBeUndefined();
      expect(result.data.gross_margin).toBeUndefined();
    }
  });
});

