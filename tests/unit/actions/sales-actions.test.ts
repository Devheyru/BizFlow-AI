import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSaleAction } from "@/actions/sales-actions";
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

describe("Feature 005 — executeSaleAction Server Action Unit Tests (T048, US1, US3)", () => {
  const mockOrgId = "00000000-0000-4000-a000-000000000001";
  const mockCustomerId = "00000000-0000-4000-a000-000000000002";
  const mockProductId1 = "00000000-0000-4000-a000-000000000011";
  const mockProductId2 = "00000000-0000-4000-a000-000000000012";
  const mockIdempotencyKey = "11111111-1111-4111-a111-111111111111";
  const mockSlug = "test-store";

  const cashierContext = {
    user: { id: "00000000-0000-4000-a000-000000000004", email: "cashier@test.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: [
      "customers:read",
      "sales:create",
      "sales:read",
    ] as any,
  };

  const unauthorizedContext = {
    user: { id: "00000000-0000-4000-a000-000000000005", email: "guest@test.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "member", status: "active" },
    role: "member" as const,
    permissions: ["sales:read"] as any,
  };

  const validSalePayload = {
    customerId: mockCustomerId,
    items: [
      {
        productId: mockProductId1,
        quantity: 2,
        lineDiscountAmount: 0,
      },
      {
        productId: mockProductId2,
        quantity: 1,
        lineDiscountAmount: 2.5,
      },
    ],
    payments: [
      {
        paymentMethod: "cash",
        amount: 25,
        amountTendered: 30,
        changeDue: 5,
      },
      {
        paymentMethod: "card",
        amount: 50,
        referenceNo: "AUTH-8821",
      },
    ],
    orderDiscountAmount: 5,
    idempotencyKey: mockIdempotencyKey,
    notes: "Special order checkout",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when tenant resolution fails", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: false,
      error: "not_found",
    });

    const res = await executeSaleAction(mockSlug, validSalePayload);
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns 403 FORBIDDEN when user lacks sales:create permission", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: unauthorizedContext as any,
    });

    const res = await executeSaleAction(mockSlug, validSalePayload);
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("FORBIDDEN");
  });

  it("returns VALIDATION_ERROR when input schema is invalid", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    // Empty items
    const res = await executeSaleAction(mockSlug, {
      ...validSalePayload,
      items: [],
    });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when duplicate products exist in cart", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const res = await executeSaleAction(mockSlug, {
      ...validSalePayload,
      items: [
        { productId: mockProductId1, quantity: 1, lineDiscountAmount: 0 },
        { productId: mockProductId1, quantity: 2, lineDiscountAmount: 0 },
      ],
    });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toMatch(/duplicate/i);
  });

  it("returns VALIDATION_ERROR when non-cash tender lacks reference", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const res = await executeSaleAction(mockSlug, {
      ...validSalePayload,
      payments: [
        {
          paymentMethod: "card",
          amount: 50,
          referenceNo: "",
        },
      ],
    });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
  });

  it("invokes execute_sale RPC with properly formatted parameters and succeeds", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: false,
        sale_id: "00000000-0000-4000-a000-000000000099",
        sale_number: "S-202611-0001",
        status: "completed",
        payment_status: "paid",
        subtotal: "75.0000",
        order_discount_amount: "5.0000",
        tax_amount: "5.0000",
        total_amount: "75.0000",
        currency: "USD",
        items_count: 2,
        created_at: "2026-11-20T12:00:00Z",
        created_by: cashierContext.user.id,
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleAction(mockSlug, validSalePayload);

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success");
    expect(res.data.saleNumber).toBe("S-202611-0001");
    expect(res.data.subtotal).toBe(75);
    expect(res.data.isReplay).toBe(false);
    expect(res.data.itemsCount).toBe(2);

    expect(mockRpc).toHaveBeenCalledWith("execute_sale", {
      p_org_id: mockOrgId,
      p_customer_id: mockCustomerId,
      p_items: [
        {
          product_id: mockProductId1,
          quantity: "2.0000",
          line_discount_amount: "0.0000",
          expected_version: null,
        },
        {
          product_id: mockProductId2,
          quantity: "1.0000",
          line_discount_amount: "2.5000",
          expected_version: null,
        },
      ],
      p_payments: [
        {
          payment_method: "cash",
          amount: "25.0000",
          amount_tendered: "30.0000",
          change_due: "5.0000",
          reference_no: null,
        },
        {
          payment_method: "card",
          amount: "50.0000",
          amount_tendered: null,
          change_due: null,
          reference_no: "AUTH-8821",
        },
      ],
      p_order_discount_amount: 5,
      p_idempotency_key: mockIdempotencyKey,
      p_notes: "Special order checkout",
    });

    expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/sales`);
    expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/pos`);
    expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/inventory`);
  });

  it("maps database RPC errors correctly (e.g. INSUFFICIENT_STOCK / P0011)", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0011",
        message: "Insufficient inventory stock for requested sale quantity.",
      },
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleAction(mockSlug, validSalePayload);
    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("INSUFFICIENT_STOCK");
    expect(res.error.message).toMatch(/insufficient/i);
  });

  it("handles replay responses faithfully (isReplay: true)", async () => {
    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: true,
        sale_id: "00000000-0000-4000-a000-000000000099",
        sale_number: "S-202611-0001",
        status: "completed",
        payment_status: "paid",
        subtotal: "75.0000",
        order_discount_amount: "5.0000",
        tax_amount: "5.0000",
        total_amount: "75.0000",
        currency: "USD",
        items_count: 2,
        created_at: "2026-11-20T12:00:00Z",
        created_by: cashierContext.user.id,
      },
      error: null,
    });

    vi.mocked(supabaseServer.createClient).mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleAction(mockSlug, validSalePayload);
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success");
    expect(res.data.isReplay).toBe(true);
    expect(res.data.saleNumber).toBe("S-202611-0001");
  });
});
