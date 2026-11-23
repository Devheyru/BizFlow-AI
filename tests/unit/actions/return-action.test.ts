import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSaleReturnAction } from "@/actions/sales-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("executeSaleReturnAction Unit Tests (T069, US4)", () => {
  const mockSlug = "test-store";
  const mockOrgId = "11111111-1111-1111-1111-111111111111";
  const mockSaleId = "22222222-2222-2222-2222-222222222222";
  const mockSaleItemId = "33333333-3333-3333-3333-333333333333";
  const mockIdempotencyKey = "44444444-4444-4444-4444-444444444444";

  const managerContext = {
    user: { id: "user-mgr-1", email: "mgr@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager",
    permissions: ["sales:read", "sales:create", "returns:create"],
  };

  const cashierContext = {
    user: { id: "user-cashier-1", email: "cashier@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier",
    permissions: ["sales:read", "sales:create"], // Lacks returns:create
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns UNAUTHENTICATED when tenant resolution fails", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: false,
      error: "unauthenticated",
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Defective merchandise",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns FORBIDDEN when user lacks returns:create permission (Cashier)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Customer changed mind",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("FORBIDDEN");
    expect(res.error.message).toContain("permission");
  });

  it("returns VALIDATION_ERROR when returnItems list is empty", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [],
      refundMethod: "cash",
      reason: "No items selected",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when item quantity is not positive integer", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 0, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Invalid quantity",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns VALIDATION_ERROR when reason is shorter than 3 characters", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1, restockToInventory: true }],
      refundMethod: "cash",
      reason: "no",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toContain("at least 3 characters");
  });

  it("successfully invokes public.execute_sale_return RPC with cash refund and returns ReturnResult", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: false,
        return_id: "55555555-5555-5555-5555-555555555555",
        return_number: "RET-20261123-0001",
        sale_id: mockSaleId,
        total_refund_amount: "50.0000",
        refund_id: "66666666-6666-6666-6666-666666666666",
        refund_status: "completed",
        sale_status: "partially_returned",
        payment_status: "partially_refunded",
      },
      error: null,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Defective piece",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success: " + res.error.message);
    expect(res.data).toBeDefined();
    expect(res.data.success).toBe(true);
    expect(res.data.isReplay).toBe(false);
    expect(res.data.returnId).toBe("55555555-5555-5555-5555-555555555555");
    expect(res.data.returnNumber).toBe("RET-20261123-0001");
    expect(res.data.totalRefundAmount).toBe(50.0);
    expect(res.data.refundId).toBe("66666666-6666-6666-6666-666666666666");
    expect(res.data.refundStatus).toBe("completed");
    expect(res.data.saleStatus).toBe("partially_returned");
    expect(res.data.paymentStatus).toBe("partially_refunded");

    expect(mockRpc).toHaveBeenCalledWith("execute_sale_return", {
      p_org_id: mockOrgId,
      p_sale_id: mockSaleId,
      p_return_items: [
        {
          sale_item_id: mockSaleItemId,
          quantity: 1,
          restock_to_inventory: true,
        },
      ],
      p_refund_method: "cash",
      p_reason: "Defective piece",
      p_idempotency_key: mockIdempotencyKey,
      p_reference_no: null,
    });
  });

  it("correctly forwards referenceNo for card or bank transfer refund", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: false,
        return_id: "55555555-5555-5555-5555-555555555555",
        return_number: "RET-20261123-0002",
        sale_id: mockSaleId,
        total_refund_amount: "120.0000",
        refund_id: "66666666-6666-6666-6666-666666666666",
        refund_status: "pending",
        sale_status: "returned",
        payment_status: "partially_refunded",
      },
      error: null,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 2, restockToInventory: true }],
      refundMethod: "card",
      reason: "Full return for defective order",
      idempotencyKey: mockIdempotencyKey,
      referenceNo: "ARN-9876543210",
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success: " + res.error.message);
    expect(res.data.refundStatus).toBe("pending");

    expect(mockRpc).toHaveBeenCalledWith("execute_sale_return", {
      p_org_id: mockOrgId,
      p_sale_id: mockSaleId,
      p_return_items: [
        {
          sale_item_id: mockSaleItemId,
          quantity: 2,
          restock_to_inventory: true,
        },
      ],
      p_refund_method: "card",
      p_reason: "Full return for defective order",
      p_idempotency_key: mockIdempotencyKey,
      p_reference_no: "ARN-9876543210",
    });
  });

  it("handles RPC database errors cleanly (e.g. P0052 excess quantity)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0052",
        message: "Return quantity exceeds available returnable quantity for item",
      },
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 10, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Attempting excess return",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("RETURN_QUANTITY_EXCEEDS_SOLD");
    expect(res.error.message).toContain("Return quantity exceeds remaining unreturned quantity");
  });

  it("handles inactive product restock error cleanly (P0056)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0056",
        message: "Cannot restock inactive or archived product to inventory",
      },
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Archived item return",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("PRODUCT_INACTIVE_RETURN_BLOCKED");
    expect(res.error.message).toContain("Cannot restock inventory for inactive product");
  });

  it("handles discrete product integer quantity requirement error (P0015)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0015",
        message: "Fractional quantities are not permitted for discrete products.",
      },
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1.5, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Fractional return on discrete product",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("INTEGER_QUANTITY_REQUIRED");
    expect(res.error.message).toContain("Fractional quantities are not permitted");
  });

  it("rejects return quantity with more than 4 decimal places via Zod schema validation", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 1.12345, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Decimal precision test",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toContain("decimal places");
  });

  it("handles split-tender ceiling exceeded error (P0061)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0061",
        message: "Refund amount exceeds original tender amount for this payment method.",
      },
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 2, restockToInventory: true }],
      refundMethod: "card",
      reason: "Excess card refund",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER");
    expect(res.error.message).toContain("Refund amount exceeds original tender amount");
  });

  it("handles cumulative refund ceiling exceeded error (P0054)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0054",
        message: "Cumulative refunds exceed sale total amount.",
      },
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await executeSaleReturnAction(mockSlug, {
      saleId: mockSaleId,
      returnItems: [{ saleItemId: mockSaleItemId, quantity: 2, restockToInventory: true }],
      refundMethod: "cash",
      reason: "Cumulative cap test",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("REFUND_EXCEEDS_PAYABLE");
    expect(res.error.message).toContain("Cumulative refunds exceed sale total amount");
  });
});
