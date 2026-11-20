import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePosCheckout } from "@/components/pos/checkout-handler";
import * as salesActions from "@/actions/sales-actions";

vi.mock("@/actions/sales-actions", () => ({
  executeSaleAction: vi.fn(),
}));

describe("usePosCheckout Hook (T055, US1)", () => {
  const mockSlug = "test-store";

  const sampleParams = {
    customerId: "00000000-0000-4000-a000-000000000001",
    items: [
      {
        productId: "00000000-0000-4000-a000-000000000011",
        quantity: 2,
        lineDiscountAmount: 0,
      },
    ],
    payments: [
      {
        paymentMethod: "cash" as const,
        amount: 30,
        amountTendered: 30,
        changeDue: 0,
      },
    ],
    orderDiscountAmount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a UUID idempotency key on initial checkout and submits", async () => {
    vi.mocked(salesActions.executeSaleAction).mockResolvedValue({
      success: true,
      data: {
        success: true,
        isReplay: false,
        saleId: "sale-1",
        saleNumber: "S-001",
        status: "completed",
        paymentStatus: "paid",
        subtotal: 30,
        orderDiscountAmount: 0,
        taxAmount: 0,
        totalAmount: 30,
        currency: "USD",
        itemsCount: 1,
        createdAt: "2026-11-20T12:00:00Z",
        createdBy: "user-1",
      },
    });

    const { result } = renderHook(() => usePosCheckout({ slug: mockSlug }));

    let res: any;
    await act(async () => {
      res = await result.current.submitCheckout(sampleParams);
    });

    expect(res.success).toBe(true);
    expect(salesActions.executeSaleAction).toHaveBeenCalledWith(
      mockSlug,
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        ),
      })
    );
  });

  it("reuses idempotency key when retrying an identical payload after failure", async () => {
    vi.mocked(salesActions.executeSaleAction)
      .mockResolvedValueOnce({
        success: false,
        error: { code: "NETWORK_TIMEOUT", message: "Timeout" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          success: true,
          isReplay: true,
          saleId: "sale-1",
          saleNumber: "S-001",
          status: "completed",
          paymentStatus: "paid",
          subtotal: 30,
          orderDiscountAmount: 0,
          taxAmount: 0,
          totalAmount: 30,
          currency: "USD",
          itemsCount: 1,
          createdAt: "2026-11-20T12:00:00Z",
          createdBy: "user-1",
        },
      });

    const { result } = renderHook(() => usePosCheckout({ slug: mockSlug }));

    // Attempt 1 (fails)
    await act(async () => {
      await result.current.submitCheckout(sampleParams);
    });

    const call0 = vi.mocked(salesActions.executeSaleAction).mock.calls[0];
    const firstKey = (call0?.[1] as { idempotencyKey?: string })?.idempotencyKey;

    // Attempt 2 (retry identical payload)
    await act(async () => {
      await result.current.submitCheckout(sampleParams);
    });

    const call1 = vi.mocked(salesActions.executeSaleAction).mock.calls[1];
    const secondKey = (call1?.[1] as { idempotencyKey?: string })?.idempotencyKey;

    expect(firstKey).toBeDefined();
    expect(firstKey).toBe(secondKey);
  });

  it("generates a new idempotency key when payload changes between attempts", async () => {
    vi.mocked(salesActions.executeSaleAction).mockResolvedValue({
      success: false,
      error: { code: "ERROR", message: "Error" },
    });

    const { result } = renderHook(() => usePosCheckout({ slug: mockSlug }));

    // Attempt 1
    await act(async () => {
      await result.current.submitCheckout(sampleParams);
    });

    const calls = vi.mocked(salesActions.executeSaleAction).mock.calls;
    const call0 = calls[0];
    const firstKey = (call0?.[1] as { idempotencyKey?: string })?.idempotencyKey;

    // Attempt 2 with modified quantity
    await act(async () => {
      await result.current.submitCheckout({
        ...sampleParams,
        items: [{ ...sampleParams.items[0]!, quantity: 3 }],
      });
    });

    const call1 = calls[1];
    const secondKey = (call1?.[1] as { idempotencyKey?: string })?.idempotencyKey;

    expect(firstKey).not.toBe(secondKey);
  });
});
