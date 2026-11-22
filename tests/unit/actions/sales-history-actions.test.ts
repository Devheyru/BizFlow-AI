import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSalesListAction,
  getSaleDetailAction,
  getReturnHistoryAction,
} from "@/actions/sales-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Feature 005 — Sales History & Detail Actions Unit Tests (T060, T061, T062, US5)", () => {
  const mockOrgId = "00000000-0000-4000-a000-000000000001";
  const mockSaleId = "00000000-0000-4000-a000-000000000002";
  const mockCustomerId = "00000000-0000-4000-a000-000000000003";
  const mockCashierId = "00000000-0000-4000-a000-000000000004";
  const mockSlug = "alpha-store";

  const cashierContext = {
    user: { id: mockCashierId, email: "cashier@test.com" },
    organization: { id: mockOrgId, name: "Alpha Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: ["sales:read", "returns:read"] as any,
  };

  const unauthorizedContext = {
    user: { id: "00000000-0000-4000-a000-000000000099", email: "guest@test.com" },
    organization: { id: mockOrgId, name: "Alpha Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "member", status: "active" },
    role: "member" as const,
    permissions: [] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSalesListAction (T060)", () => {
    it("successfully queries sales list with filters and pagination", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockDbRows = [
        {
          id: mockSaleId,
          sale_number: "SAL-20261121-0001",
          status: "completed",
          payment_status: "paid",
          customer_id: mockCustomerId,
          subtotal: "100.0000",
          order_discount_amount: "5.0000",
          tax_amount: "9.5000",
          total_amount: "104.5000",
          currency: "USD",
          created_by: mockCashierId,
          created_at: "2026-11-21T10:00:00Z",
          customers: { id: mockCustomerId, name: "Alice Smith" },
        },
      ];

      const mockQueryBuilder: any = {
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: mockDbRows,
          count: 1,
          error: null,
        }),
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "sales") {
            return {
              select: vi.fn().mockReturnValue(mockQueryBuilder),
            };
          }
          if (table === "sale_items") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({
                  data: [{ id: "item-1", sale_id: mockSaleId }],
                  error: null,
                }),
              }),
            };
          }
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: mockCashierId, first_name: "John", last_name: "Doe" }],
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(mockSupabase as any);

      const result = await getSalesListAction(mockSlug, {
        search: "SAL-20261121",
        status: "completed",
        cashierId: mockCashierId,
        page: 1,
        pageSize: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        const item0 = result.data.items[0]!;
        expect(item0.saleNumber).toBe("SAL-20261121-0001");
        expect(item0.customerName).toBe("Alice Smith");
        expect(item0.cashierName).toBe("John Doe");
        expect(item0.itemsCount).toBe(1);
        expect(item0.totalAmount).toBe(104.5);
      }
    });

    it("rejects unauthorized access when sales:read is missing", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: unauthorizedContext as any,
      });

      const result = await getSalesListAction(mockSlug, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("FORBIDDEN");
      }
    });
  });

  describe("getSaleDetailAction (T061)", () => {
    it("successfully retrieves sale breakdown via get_sale_detail RPC", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockRpcResponse = {
        sale: {
          id: mockSaleId,
          organization_id: mockOrgId,
          sale_number: "SAL-20261121-0001",
          customer_id: mockCustomerId,
          status: "completed",
          payment_status: "paid",
          subtotal: "50.0000",
          order_discount_amount: "0.0000",
          taxable_amount: "50.0000",
          tax_amount: "5.0000",
          total_amount: "55.0000",
          currency: "USD",
          is_tax_inclusive: false,
          tax_rate: "10.0000",
          tax_name: "Sales Tax",
          notes: "Walk-in purchase",
          created_at: "2026-11-21T10:00:00Z",
          created_by: mockCashierId,
        },
        customer: {
          id: mockCustomerId,
          name: "Bob Jones",
          phone: "+1234567890",
          email: "bob@example.com",
          status: "active",
        },
        items: [
          {
            id: "item-1",
            product_id: "prod-1",
            product_name: "Mechanical Keyboard",
            sku: "SKU-KEY-01",
            quantity: "1.0000",
            unit_price: "50.0000",
            unit_cost: null, // Cost is masked for cashier
            line_discount_amount: "0.0000",
            allocated_order_disc: "0.0000",
            taxable_amount: "50.0000",
            allocated_tax_amount: "5.0000",
            total_price: "55.0000",
            movement_id: "mov-1",
          },
        ],
        payments: [
          {
            id: "pay-1",
            payment_method: "cash",
            amount: "55.0000",
            amount_tendered: "60.0000",
            change_due: "5.0000",
            reference_no: null,
            created_at: "2026-11-21T10:00:00Z",
          },
        ],
        returns: [],
        refunds: [],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcResponse,
        error: null,
      });

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const result = await getSaleDetailAction(mockSlug, mockSaleId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sale.saleNumber).toBe("SAL-20261121-0001");
        expect(result.data.sale.totalAmount).toBe(55.0);
        expect(result.data.customer?.name).toBe("Bob Jones");
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0]!.unitCost).toBeNull(); // Cost protection verified
        expect(result.data.payments[0]!.changeDue).toBe(5.0);
      }

      expect(mockRpc).toHaveBeenCalledWith("get_sale_detail", {
        p_org_id: mockOrgId,
        p_sale_id: mockSaleId,
      });
    });

    it("rejects non-UUID saleId with VALIDATION_ERROR", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const result = await getSaleDetailAction(mockSlug, "invalid-sale-id");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("getReturnHistoryAction (T062)", () => {
    it("retrieves returns, return items, and refunds for a sale", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockReturnId = "00000000-0000-4000-a000-000000000020";

      const mockReturns = [
        {
          id: mockReturnId,
          return_number: "RET-20261121-0001",
          sale_id: mockSaleId,
          reason: "Defective item",
          total_refund_amount: "55.0000",
          created_at: "2026-11-21T12:00:00Z",
          created_by: mockCashierId,
        },
      ];

      const mockReturnItems = [
        {
          id: "ret-item-1",
          sale_item_id: "item-1",
          product_id: "prod-1",
          quantity: "1.0000",
          refund_amount: "55.0000",
          restock_to_inventory: true,
          movement_id: "mov-ret-1",
          return_id: mockReturnId,
          products: { name: "Mechanical Keyboard", sku: "SKU-KEY-01" },
        },
      ];

      const mockRefunds = [
        {
          id: "ref-1",
          obligation_refund_id: "ref-1",
          parent_refund_id: null,
          return_id: mockReturnId,
          refund_method: "cash",
          amount: "55.0000",
          status: "completed",
          reference_no: null,
          reason: "Cash return",
          created_at: "2026-11-21T12:00:00Z",
          updated_at: "2026-11-21T12:00:00Z",
        },
      ];

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "sale_returns") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: mockReturns,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "sale_return_items") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: mockReturnItems,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "refunds") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: mockRefunds,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "products") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [{ id: "c1111111-1111-1111-1111-111111111111", name: "Premium Widget", sku: "WIDGET-001" }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(mockSupabase as any);

      const result = await getReturnHistoryAction(mockSlug, mockSaleId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        const ret0 = result.data[0]!;
        expect(ret0.returnNumber).toBe("RET-20261121-0001");
        expect(ret0.totalRefundAmount).toBe(55.0);
        expect(ret0.items).toHaveLength(1);
        expect(ret0.items[0]!.restockToInventory).toBe(true);
        expect(ret0.refunds).toHaveLength(1);
        expect(ret0.refunds[0]!.status).toBe("completed");
      }
    });

    it("returns empty array when sale has no return records", async () => {
      vi.spyOn(authContext, "resolveTenantContext").mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      vi.spyOn(supabaseServer, "createClient").mockResolvedValue(mockSupabase as any);

      const result = await getReturnHistoryAction(mockSlug, mockSaleId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });
});
