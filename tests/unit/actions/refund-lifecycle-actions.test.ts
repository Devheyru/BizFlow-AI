import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  confirmRefundAction,
  recordRefundFailureAction,
  issueReplacementRefundAction,
} from "@/actions/sales-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe("Refund Lifecycle Server Actions Unit Tests (T072–T074, US7)", () => {
  const mockSlug = "test-store";
  const mockOrgId = "11111111-1111-1111-1111-111111111111";
  const mockRefundId = "22222222-2222-2222-2222-222222222222";
  const mockIdempotencyKey = "33333333-3333-3333-3333-333333333333";
  const mockSaleId = "44444444-4444-4444-4444-444444444444";

  // Authorized manager with refunds:read, sales:void, returns:create
  const managerContext = {
    user: { id: "user-mgr-1", email: "mgr@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager",
    permissions: ["refunds:read", "sales:void", "returns:create"],
  };

  // Cashier lacking permissions
  const cashierContext = {
    user: { id: "user-cashier-1", email: "cashier@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier",
    permissions: ["sales:read", "sales:create"],
  };

  // User with refunds:read but lacking sales:void and returns:create
  const readOnlyRefundsContext = {
    user: { id: "user-reader-1", email: "reader@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier",
    permissions: ["refunds:read"],
  };

  // User with sales:void but lacking refunds:read
  const voidOnlyContext = {
    user: { id: "user-void-1", email: "void@test.com" },
    organization: { id: mockOrgId, slug: mockSlug, is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier",
    permissions: ["sales:void"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // T072: confirmRefundAction Tests
  // ==========================================================================
  describe("confirmRefundAction (T072)", () => {
    it("returns UNAUTHENTICATED when tenant resolution fails", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: false,
        error: "unauthenticated",
      });

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns FORBIDDEN when user lacks refunds:read permission", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: voidOnlyContext as any,
      });

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("FORBIDDEN");
    });

    it("returns FORBIDDEN when user has refunds:read but lacks sales:void or returns:create", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: readOnlyRefundsContext as any,
      });

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("FORBIDDEN");
    });

    it("returns VALIDATION_ERROR when externalReference is empty or whitespace", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "   ",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when idempotencyKey is not a valid UUID", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: "invalid-uuid",
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("VALIDATION_ERROR");
    });

    it("invokes confirm_refund_reimbursement RPC and formats response on success", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          is_replay: false,
          refund_id: mockRefundId,
          sale_id: mockSaleId,
          status: "completed",
          external_reference: "REV-CARD-12345",
          reference_no: "REV-CARD-12345",
          amount: "50.0000",
          payment_status: "refunded",
          confirmed_at: "2026-11-23T20:00:00Z",
        },
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.refundId).toBe(mockRefundId);
      expect(res.data.status).toBe("completed");
      expect(res.data.externalReference).toBe("REV-CARD-12345");
      expect(res.data.isReplay).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith("confirm_refund_reimbursement", {
        p_org_id: mockOrgId,
        p_refund_id: mockRefundId,
        p_external_reference: "REV-CARD-12345",
        p_idempotency_key: mockIdempotencyKey,
      });
    });

    it("maps database error codes (e.g. P0024 IDEMPOTENCY_CONFLICT) appropriately", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0024", message: "IDEMPOTENCY_CONFLICT" },
        }),
      } as any);

      const res = await confirmRefundAction(mockSlug, {
        refundId: mockRefundId,
        externalReference: "REV-CARD-12345",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  // ==========================================================================
  // T073: recordRefundFailureAction Tests
  // ==========================================================================
  describe("recordRefundFailureAction (T073)", () => {
    it("returns FORBIDDEN when user lacks sales:void or returns:create", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await recordRefundFailureAction(mockSlug, {
        refundId: mockRefundId,
        failureReason: "Card expired on payment gateway",
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("FORBIDDEN");
    });

    it("returns VALIDATION_ERROR when failureReason has fewer than 3 characters", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await recordRefundFailureAction(mockSlug, {
        refundId: mockRefundId,
        failureReason: "no",
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("VALIDATION_ERROR");
    });

    it("invokes record_refund_failure RPC and returns formatted failure result", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          refund_id: mockRefundId,
          sale_id: mockSaleId,
          status: "failed",
          failure_reason: "Gateway timeout during reversal",
          payment_status: "partially_refunded",
          failed_at: "2026-11-23T20:00:00Z",
        },
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await recordRefundFailureAction(mockSlug, {
        refundId: mockRefundId,
        failureReason: "Gateway timeout during reversal",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.refundId).toBe(mockRefundId);
      expect(res.data.status).toBe("failed");
      expect(res.data.failureReason).toBe("Gateway timeout during reversal");
      expect(mockRpc).toHaveBeenCalledWith("record_refund_failure", {
        p_org_id: mockOrgId,
        p_refund_id: mockRefundId,
        p_failure_reason: "Gateway timeout during reversal",
      });
    });

    it("maps database P0062 REFUND_ALREADY_SETTLED error", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0062", message: "REFUND_ALREADY_SETTLED" },
        }),
      } as any);

      const res = await recordRefundFailureAction(mockSlug, {
        refundId: mockRefundId,
        failureReason: "Gateway timeout",
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("REFUND_ALREADY_SETTLED");
    });
  });

  // ==========================================================================
  // T074: issueReplacementRefundAction Tests
  // ==========================================================================
  describe("issueReplacementRefundAction (T074)", () => {
    const mockReplacementRefundId = "55555555-5555-5555-5555-555555555555";
    const mockObligationId = "66666666-6666-6666-6666-666666666666";

    it("returns FORBIDDEN when user lacks sales:void or returns:create", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await issueReplacementRefundAction(mockSlug, {
        failedRefundId: mockRefundId,
        refundMethod: "cash",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("FORBIDDEN");
    });

    it("returns VALIDATION_ERROR when refundMethod is invalid", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await issueReplacementRefundAction(mockSlug, {
        failedRefundId: mockRefundId,
        refundMethod: "crypto" as any,
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("VALIDATION_ERROR");
    });

    it("invokes issue_replacement_refund RPC and returns formatted replacement result", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          is_replay: false,
          replacement_refund_id: mockReplacementRefundId,
          refund_id: mockReplacementRefundId,
          sale_id: mockSaleId,
          obligation_refund_id: mockObligationId,
          failed_refund_id: mockRefundId,
          parent_refund_id: mockRefundId,
          status: "completed",
          refund_method: "cash",
          amount: "50.0000",
          payment_status: "refunded",
          created_at: "2026-11-23T20:30:00Z",
        },
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await issueReplacementRefundAction(mockSlug, {
        failedRefundId: mockRefundId,
        refundMethod: "cash",
        idempotencyKey: mockIdempotencyKey,
        referenceNo: "CASH-REC-101",
        notes: "Customer opted for cash payout",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.replacementRefundId).toBe(mockReplacementRefundId);
      expect(res.data.obligationRefundId).toBe(mockObligationId);
      expect(res.data.failedRefundId).toBe(mockRefundId);
      expect(res.data.status).toBe("completed");
      expect(res.data.refundMethod).toBe("cash");
      expect(res.data.amount).toBe(50.0);
      expect(mockRpc).toHaveBeenCalledWith("issue_replacement_refund", {
        p_org_id: mockOrgId,
        p_failed_refund_id: mockRefundId,
        p_refund_method: "cash",
        p_idempotency_key: mockIdempotencyKey,
        p_reference_no: "CASH-REC-101",
        p_notes: "Customer opted for cash payout",
      });
    });

    it("maps database P0064 REPLACEMENT_REFUND_ALREADY_EXISTS error", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0064", message: "REPLACEMENT_REFUND_ALREADY_EXISTS" },
        }),
      } as any);

      const res = await issueReplacementRefundAction(mockSlug, {
        failedRefundId: mockRefundId,
        refundMethod: "cash",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("REPLACEMENT_REFUND_ALREADY_EXISTS");
    });

    it("maps database P0067 OBLIGATION_ALREADY_COMPLETED error", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "P0067", message: "OBLIGATION_ALREADY_COMPLETED" },
        }),
      } as any);

      const res = await issueReplacementRefundAction(mockSlug, {
        failedRefundId: mockRefundId,
        refundMethod: "cash",
        idempotencyKey: mockIdempotencyKey,
      });

      expect(res.success).toBe(false);
      if (res.success) throw new Error("Expected failure");
      expect(res.error.code).toBe("OBLIGATION_ALREADY_COMPLETED");
    });
  });
});
