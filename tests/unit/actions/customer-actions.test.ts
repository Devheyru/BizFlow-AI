import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCustomerAction,
  updateCustomerAction,
  archiveCustomerAction,
  searchCustomersAction,
  getCustomerDetailAction,
  getCustomerPurchaseHistoryAction,
} from "@/actions/customer-actions";
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

describe("Feature 005 — Customer Server Actions Unit Tests (T039–T043, US2)", () => {
  const mockOrgId = "00000000-0000-4000-a000-000000000001";
  const mockCustomerId = "00000000-0000-4000-a000-000000000002";
  const mockSlug = "test-store";

  const managerContext = {
    user: { id: "00000000-0000-4000-a000-000000000003", email: "manager@test.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "manager", status: "active" },
    role: "manager" as const,
    permissions: [
      "customers:read",
      "customers:create",
      "customers:update",
      "customers:archive",
      "sales:read",
    ] as any,
  };

  const cashierContext = {
    user: { id: "00000000-0000-4000-a000-000000000004", email: "cashier@test.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "cashier", status: "active" },
    role: "cashier" as const,
    permissions: [
      "customers:read",
    ] as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. createCustomerAction (T039)
  // ==========================================================================
  describe("createCustomerAction", () => {
    it("returns error when tenant resolution fails", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: false,
        error: "not_found",
      });

      const res = await createCustomerAction(mockSlug, { name: "Acme Corp" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("NOT_FOUND");
      }
    });

    it("rejects caller without customers:create permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await createCustomerAction(mockSlug, { name: "Acme Corp" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects invalid input: empty name", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await createCustomerAction(mockSlug, { name: "   " });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.name).toBeDefined();
      }
    });

    it("rejects invalid phone format (non-E.164)", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await createCustomerAction(mockSlug, {
        name: "Acme Corp",
        phone: "12345",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.phone).toBeDefined();
      }
    });

    it("rejects invalid email format", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await createCustomerAction(mockSlug, {
        name: "Acme Corp",
        email: "not-an-email",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
        expect(res.error.details?.email).toBeDefined();
      }
    });

    it("invokes create_customer RPC and returns created record on success", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          customer_id: mockCustomerId,
          name: "Acme Corp",
          phone: "+14155552671",
          email: "contact@acme.com",
          status: "active",
          created_at: "2026-11-17T12:00:00Z",
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await createCustomerAction(mockSlug, {
        name: "Acme Corp",
        phone: "+14155552671",
        email: "CONTACT@acme.com ",
        notes: "Key retail account",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe(mockCustomerId);
        expect(res.data.name).toBe("Acme Corp");
        expect(res.data.phone).toBe("+14155552671");
        expect(res.data.email).toBe("contact@acme.com");
        expect(res.data.status).toBe("active");
      }

      expect(mockRpc).toHaveBeenCalledWith("create_customer", {
        p_org_id: mockOrgId,
        p_name: "Acme Corp",
        p_phone: "+14155552671",
        p_email: "contact@acme.com",
        p_notes: "Key retail account",
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/customers`);
    });

    it("maps database unique constraint violation (duplicate phone) to CUSTOMER_PHONE_EXISTS", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint uq_customers_org_phone_active",
        },
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await createCustomerAction(mockSlug, {
        name: "Duplicate Phone Customer",
        phone: "+14155552671",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CUSTOMER_PHONE_EXISTS");
      }
    });
  });

  // ==========================================================================
  // 2. updateCustomerAction (T040)
  // ==========================================================================
  describe("updateCustomerAction", () => {
    it("rejects non-UUID customer ID", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const res = await updateCustomerAction(mockSlug, "invalid-uuid", { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects caller without customers:update permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await updateCustomerAction(mockSlug, mockCustomerId, { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("returns CUSTOMER_NOT_FOUND if customer does not exist", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "PGRST116", message: "Not found" },
              }),
            }),
          }),
        }),
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await updateCustomerAction(mockSlug, mockCustomerId, { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CUSTOMER_NOT_FOUND");
      }
    });

    it("returns CUSTOMER_ARCHIVED if customer is archived", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: mockCustomerId,
                  organization_id: mockOrgId,
                  name: "Old Name",
                  phone: null,
                  email: null,
                  notes: null,
                  status: "archived",
                  created_at: "2026-11-17T12:00:00Z",
                  updated_at: "2026-11-17T12:00:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await updateCustomerAction(mockSlug, mockCustomerId, { name: "New Name" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CUSTOMER_ARCHIVED");
      }
    });

    it("updates customer via update_customer RPC successfully", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: mockCustomerId,
                  organization_id: mockOrgId,
                  name: "Old Name",
                  phone: "+14155551111",
                  email: "old@test.com",
                  notes: "Old notes",
                  status: "active",
                  created_at: "2026-11-17T12:00:00Z",
                  updated_at: "2026-11-17T12:00:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          customer_id: mockCustomerId,
          name: "Updated Name",
          phone: "+14155551111",
          email: "updated@test.com",
          status: "active",
          updated_at: "2026-11-18T10:00:00Z",
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
        rpc: mockRpc,
      } as any);

      const res = await updateCustomerAction(mockSlug, mockCustomerId, {
        name: "Updated Name",
        email: "updated@test.com",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Updated Name");
        expect(res.data.email).toBe("updated@test.com");
      }

      expect(mockRpc).toHaveBeenCalledWith("update_customer", {
        p_org_id: mockOrgId,
        p_customer_id: mockCustomerId,
        p_name: "Updated Name",
        p_phone: "+14155551111",
        p_email: "updated@test.com",
        p_notes: "Old notes",
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/customers`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/customers/${mockCustomerId}`);
    });
  });

  // ==========================================================================
  // 3. archiveCustomerAction (T041)
  // ==========================================================================
  describe("archiveCustomerAction", () => {
    it("rejects caller without customers:archive permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const res = await archiveCustomerAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("invokes archive_customer RPC and revalidates paths on success", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          success: true,
          customer_id: mockCustomerId,
          status: "archived",
          is_noop: false,
          updated_at: "2026-11-18T10:00:00Z",
        },
        error: null,
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        rpc: mockRpc,
      } as any);

      const res = await archiveCustomerAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.archived).toBe(true);
      }

      expect(mockRpc).toHaveBeenCalledWith("archive_customer", {
        p_org_id: mockOrgId,
        p_customer_id: mockCustomerId,
      });

      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/customers`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${mockSlug}/customers/${mockCustomerId}`);
    });
  });

  // ==========================================================================
  // 4. searchCustomersAction (T042)
  // ==========================================================================
  describe("searchCustomersAction", () => {
    it("rejects caller without customers:read permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: {
          ...cashierContext,
          permissions: [],
        } as any,
      });

      const res = await searchCustomersAction(mockSlug, {});
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("applies status and search filters correctly", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockSelect = vi.fn().mockReturnThis();
      const mockOr = vi.fn().mockReturnThis();
      const mockRange = vi.fn().mockResolvedValue({
        data: [
          {
            id: mockCustomerId,
            organization_id: mockOrgId,
            name: "John Doe",
            phone: "+14155551234",
            email: "john@doe.com",
            notes: null,
            status: "active",
            created_at: "2026-11-17T12:00:00Z",
            updated_at: "2026-11-17T12:00:00Z",
          },
        ],
        count: 1,
        error: null,
      });

      const mockQueryBuilder: any = {
        select: mockSelect,
        eq: vi.fn().mockImplementation((col, _val) => {
          if (col === "organization_id") return mockQueryBuilder;
          if (col === "status") return mockQueryBuilder;
          return mockQueryBuilder;
        }),
        or: mockOr,
        order: vi.fn().mockImplementation(() => mockQueryBuilder),
        range: mockRange,
      };

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: vi.fn().mockReturnValue(mockQueryBuilder),
      } as any);

      const res = await searchCustomersAction(mockSlug, {
        search: "John",
        status: "active",
        page: 1,
        pageSize: 10,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.items).toHaveLength(1);
        expect(res.data.items[0]!.name).toBe("John Doe");
        expect(res.data.totalCount).toBe(1);
        expect(res.data.totalPages).toBe(1);
      }
    });
  });

  // ==========================================================================
  // 5. getCustomerDetailAction (T043)
  // ==========================================================================
  describe("getCustomerDetailAction", () => {
    it("aggregates customer details and sales metrics when sales:read is present", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockCustomerRow = {
        id: mockCustomerId,
        organization_id: mockOrgId,
        name: "VIP Customer",
        phone: "+14155559999",
        email: "vip@customer.com",
        notes: "Preferred customer",
        status: "active",
        created_at: "2026-11-10T12:00:00Z",
        updated_at: "2026-11-10T12:00:00Z",
      };

      const mockSalesRows = [
        { id: "s1", total_amount: 150.50, created_at: "2026-11-15T14:00:00Z", status: "completed" },
        { id: "s2", total_amount: 49.50, created_at: "2026-11-12T10:00:00Z", status: "completed" },
      ];

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockCustomerRow,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "sales") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: mockSalesRows,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getCustomerDetailAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("VIP Customer");
        expect(res.data.purchaseCount).toBe(2);
        expect(res.data.totalSpent).toBe(200.00);
        expect(res.data.lastPurchaseAt).toBe("2026-11-15T14:00:00Z");
        expect(res.data.salesMetricsRestricted).toBe(false);
      }
    });

    it("handles customer with 0 sales gracefully when sales:read is present", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockCustomerRow = {
        id: mockCustomerId,
        organization_id: mockOrgId,
        name: "New Customer",
        phone: null,
        email: null,
        notes: null,
        status: "active",
        created_at: "2026-11-17T12:00:00Z",
        updated_at: "2026-11-17T12:00:00Z",
      };

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockCustomerRow,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "sales") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getCustomerDetailAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.purchaseCount).toBe(0);
        expect(res.data.totalSpent).toBe(0);
        expect(res.data.lastPurchaseAt).toBeNull();
        expect(res.data.salesMetricsRestricted).toBe(false);
      }
    });

    it("restricts sales metrics and does not query sales when caller lacks sales:read", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: cashierContext as any,
      });

      const mockCustomerRow = {
        id: mockCustomerId,
        organization_id: mockOrgId,
        name: "Standard Customer",
        phone: "+14155551122",
        email: "standard@customer.com",
        notes: null,
        status: "active",
        created_at: "2026-11-10T12:00:00Z",
        updated_at: "2026-11-10T12:00:00Z",
      };

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockCustomerRow,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getCustomerDetailAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Standard Customer");
        expect(res.data.purchaseCount).toBeNull();
        expect(res.data.totalSpent).toBeNull();
        expect(res.data.lastPurchaseAt).toBeNull();
        expect(res.data.salesMetricsRestricted).toBe(true);
        expect(mockFrom).not.toHaveBeenCalledWith("sales");
      }
    });
  });

  // ==========================================================================
  // 6. getCustomerPurchaseHistoryAction (T046 Purchase History Tab)
  // ==========================================================================
  describe("getCustomerPurchaseHistoryAction", () => {
    it("rejects caller without sales:read permission", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: {
          ...cashierContext,
          permissions: ["customers:read"],
        } as any,
      });

      const res = await getCustomerPurchaseHistoryAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("FORBIDDEN");
      }
    });

    it("returns CUSTOMER_NOT_FOUND when customer does not exist in organization", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "Row not found" },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getCustomerPurchaseHistoryAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe("CUSTOMER_NOT_FOUND");
        expect(res.error.message).toBe("Customer not found.");
      }
    });

    it("returns formatted purchase history items with deterministic ordering and no unit cost or profit exposure", async () => {
      vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
        ok: true,
        context: managerContext as any,
      });

      const mockSales = [
        {
          id: "s1",
          sale_number: "S-20261117-0001",
          status: "completed",
          payment_status: "paid",
          subtotal: 100,
          order_discount_amount: 10,
          tax_amount: 9,
          total_amount: 99,
          currency: "USD",
          created_at: "2026-11-17T15:30:00Z",
          created_by: "u1",
        },
      ];

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: mockCustomerId },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "sales") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      order: vi.fn().mockResolvedValue({
                        data: mockSales,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      vi.mocked(supabaseServer.createClient).mockResolvedValue({
        from: mockFrom,
      } as any);

      const res = await getCustomerPurchaseHistoryAction(mockSlug, mockCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toHaveLength(1);
        expect(res.data[0]!.saleNumber).toBe("S-20261117-0001");
        expect(res.data[0]!.totalAmount).toBe(99);
        // Sensitive cost / margin values are not present
        expect((res.data[0] as any).unit_cost).toBeUndefined();
        expect((res.data[0] as any).profit_margin).toBeUndefined();
      }
    });
  });
});
