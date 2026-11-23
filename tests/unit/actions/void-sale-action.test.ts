import { describe, it, expect, vi, beforeEach } from "vitest";
import { voidSaleAction } from "@/actions/sales-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("voidSaleAction Unit Tests (T066, US6)", () => {
  const mockSlug = "test-store";
  const mockOrgId = "11111111-1111-1111-1111-111111111111";
  const mockSaleId = "22222222-2222-2222-2222-222222222222";
  const mockIdempotencyKey = "33333333-3333-3333-3333-333333333333";
  const mockPaymentId = "44444444-4444-4444-4444-444444444444";

  const managerContext = {
    user: { id: "user-mgr-1", email: "mgr@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager",
    permissions: ["sales:read", "sales:create", "sales:void"],
  };

  const cashierContext = {
    user: { id: "user-cashier-1", email: "cashier@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier",
    permissions: ["sales:read", "sales:create"], // Lacks sales:void
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns UNAUTHENTICATED when tenant resolution fails", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: false,
      error: "unauthenticated",
    });

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Customer cancellation",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns FORBIDDEN when user lacks sales:void permission (Cashier)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: cashierContext as any,
    });

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Attempted cashier void",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("FORBIDDEN");
    expect(res.error.message).toContain("permission");
  });

  it("returns VALIDATION_ERROR when input parameters are invalid", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    // Reason too short (< 3 chars)
    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "no",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("VALIDATION_ERROR");
    expect(res.error.message).toContain("at least 3 characters");
  });

  it("successfully invokes public.void_sale RPC with cash tender and returns VoidResult", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: false,
        sale_id: mockSaleId,
        sale_number: "SO-20261122-0001",
        status: "voided",
        payment_status: "refunded",
        voided_at: "2026-11-22T12:00:00Z",
        voided_by: managerContext.user.id,
      },
      error: null,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Customer returned full cart immediately",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success: " + res.error.message);
    expect(res.data).toBeDefined();
    expect(res.data.success).toBe(true);
    expect(res.data.isReplay).toBe(false);
    expect(res.data.saleId).toBe(mockSaleId);
    expect(res.data.saleNumber).toBe("SO-20261122-0001");
    expect(res.data.status).toBe("voided");
    expect(res.data.paymentStatus).toBe("refunded");

    expect(mockRpc).toHaveBeenCalledWith("void_sale", {
      p_org_id: mockOrgId,
      p_sale_id: mockSaleId,
      p_void_reason: "Customer returned full cart immediately",
      p_idempotency_key: mockIdempotencyKey,
      p_reversal_references: null,
    });
  });

  it("correctly maps and forwards optional reversal references for external card void", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: false,
        sale_id: mockSaleId,
        sale_number: "SO-20261122-0002",
        status: "voided",
        payment_status: "partially_refunded",
        voided_at: "2026-11-22T12:05:00Z",
        voided_by: managerContext.user.id,
      },
      error: null,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Void card payment with reversal auth code",
      idempotencyKey: mockIdempotencyKey,
      reversalReferences: [
        { paymentId: mockPaymentId, referenceNo: "REV-CODE-9876" },
      ],
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success: " + res.error.message);
    expect(res.data.status).toBe("voided");
    expect(res.data.paymentStatus).toBe("partially_refunded");

    expect(mockRpc).toHaveBeenCalledWith("void_sale", {
      p_org_id: mockOrgId,
      p_sale_id: mockSaleId,
      p_void_reason: "Void card payment with reversal auth code",
      p_idempotency_key: mockIdempotencyKey,
      p_reversal_references: [
        { payment_id: mockPaymentId, reference_no: "REV-CODE-9876" },
      ],
    });
  });

  it("handles idempotent replay (is_replay = true)", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        is_replay: true,
        sale_id: mockSaleId,
        sale_number: "SO-20261122-0001",
        status: "voided",
        payment_status: "refunded",
        voided_at: "2026-11-22T12:00:00Z",
        voided_by: managerContext.user.id,
      },
      error: null,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: mockRpc,
    } as any);

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Customer cancellation",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("Expected success: " + res.error.message);
    expect(res.data.isReplay).toBe(true);
  });

  it("maps database errors using mapSalesError()", async () => {
    vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
      ok: true,
      context: managerContext as any,
    });

    vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0051", message: "SALE_VOID_HAS_RETURNS_BLOCKED" },
      }),
    } as any);

    const res = await voidSaleAction(mockSlug, {
      saleId: mockSaleId,
      voidReason: "Cannot void with returns",
      idempotencyKey: mockIdempotencyKey,
    });

    expect(res.success).toBe(false);
    if (res.success) throw new Error("Expected failure");
    expect(res.error.code).toBe("SALE_VOID_HAS_RETURNS_BLOCKED");
    expect(res.error.message).toContain("returns have been processed");
  });
});
