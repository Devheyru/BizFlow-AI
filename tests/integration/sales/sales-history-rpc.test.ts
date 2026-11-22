import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";
import {
  getSalesListAction,
  getReturnHistoryAction,
} from "@/actions/sales-actions";
import {
  getTaxSettingsAction,
  updateTaxSettingsAction,
} from "@/actions/tax-settings-actions";
import type { RefundRecord } from "@/types/sales";
import {
  createClient as createServerClient,
  clearInMemoryCookieJar,
} from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isDbAvailable = Boolean(anonKey && serviceRoleKey);
const describeIntegration = isDbAvailable ? describe : describe.skip;

describeIntegration(
  "Feature 005 — Phase 5 Sales History, Tax Settings & Cost Confidentiality RPC Integration (T058–T065, US5)",
  () => {
    let pgClient: PgClient;
    let adminClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let cashierClient: SupabaseClient;
    let orgBClient: SupabaseClient;

    let orgId: string;
    let orgBId: string;
    let orgSlug: string;
    let orgBSlug: string;
    let ownerUserId: string;
    let cashierUserId: string;
    let orgBUserId: string;
    let suspUserId: string;

    let ownerEmail: string;
    let cashierEmail: string;
    let orgBEmail: string;
    let suspEmail: string;

    let customerId: string;
    let productId: string;
    let saleId: string;
    let saleNumber: string;
    let saleId2: string;
    let saleNumber2: string;

    let returnId: string;
    let returnNumber: string;
    let failedRefundId: string;
    let replacementRefundId: string;

    const timestamp = Date.now();
    const testPassword = "Password123!SecureTest";

    beforeAll(async () => {
      pgClient = new PgClient({ connectionString: dbUrl });
      await pgClient.connect();

      adminClient = createClient(supabaseUrl, serviceRoleKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 1. Create Owner User
      ownerEmail = `hist-owner-${timestamp}@example.com`;
      const uOwner = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Hist", last_name: "Owner" },
      });
      ownerUserId = uOwner.data.user!.id;

      // 2. Create Cashier User
      cashierEmail = `hist-cashier-${timestamp}@example.com`;
      const uCashier = await adminClient.auth.admin.createUser({
        email: cashierEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Hist", last_name: "Cashier" },
      });
      cashierUserId = uCashier.data.user!.id;

      // 3. Create Org B User
      orgBEmail = `hist-orgb-${timestamp}@example.com`;
      const uOrgB = await adminClient.auth.admin.createUser({
        email: orgBEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "OrgB", last_name: "Owner" },
      });
      orgBUserId = uOrgB.data.user!.id;

      // 4. Create Suspended Member in Org A
      suspEmail = `hist-susp-${timestamp}@example.com`;
      const uSusp = await adminClient.auth.admin.createUser({
        email: suspEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { first_name: "Hist", last_name: "Suspended" },
      });
      suspUserId = uSusp.data.user!.id;

      // 5. Profiles
      await pgClient.query(
        `INSERT INTO public.profiles (id, first_name, last_name)
         VALUES
           ($1, 'Hist', 'Owner'),
           ($2, 'Hist', 'Cashier'),
           ($3, 'OrgB', 'Owner'),
           ($4, 'Hist', 'Suspended')
         ON CONFLICT (id) DO NOTHING;`,
        [ownerUserId, cashierUserId, orgBUserId, suspUserId]
      );

      // 6. Organizations (Org A and Org B)
      orgSlug = `sales-hist-a-${timestamp}`;
      orgBSlug = `sales-hist-b-${timestamp}`;

      const orgRes = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
         VALUES ('Sales History Org A', $1, 'USD', 'retail', 'US', 'America/New_York', $2)
         RETURNING id;`,
        [orgSlug, ownerUserId]
      );
      orgId = orgRes.rows[0].id;

      const orgBRes = await pgClient.query(
        `INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
         VALUES ('Sales History Org B', $1, 'USD', 'retail', 'US', 'UTC', $2)
         RETURNING id;`,
        [orgBSlug, orgBUserId]
      );
      orgBId = orgBRes.rows[0].id;

      // 7. Organization Memberships
      await pgClient.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
         VALUES
           ($1, $2, 'owner', 'active'),
           ($1, $3, 'cashier', 'active'),
           ($1, $4, 'cashier', 'suspended'),
           ($5, $6, 'owner', 'active');`,
        [orgId, ownerUserId, cashierUserId, suspUserId, orgBId, orgBUserId]
      );

      // 7. Initial Tax Settings (10% Tax-Exclusive "Standard VAT")
      await pgClient.query(
        `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
         VALUES ($1, 'Standard VAT', 10.0000, false, $2)
         ON CONFLICT (organization_id) DO UPDATE
         SET tax_name = 'Standard VAT', default_tax_rate = 10.0000, is_tax_inclusive = false;`,
        [orgId, ownerUserId]
      );

      // 8. Customer
      const custRes = await pgClient.query(
        `INSERT INTO public.customers (organization_id, name, phone, email)
         VALUES ($1, 'History Test Customer', $2, $3)
         RETURNING id;`,
        [orgId, `+1444${Math.floor(1000000 + Math.random() * 9000000)}`, `hist-cust-${timestamp}@example.com`]
      );
      customerId = custRes.rows[0].id;

      // 9. Product: Selling Price $50.00, Cost Price $30.00, Initial Stock 20
      const prodRes = await pgClient.query(
        `INSERT INTO public.products (
           organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by
         ) VALUES (
           $1, 'Gaming Monitor 4K', $2, 50.0000, 'piece', 'active', $3, $3
         ) RETURNING id;`,
        [orgId, `SKU-MON-${timestamp}`, ownerUserId]
      );
      productId = prodRes.rows[0].id;

      await pgClient.query(
        `INSERT INTO public.product_costs (organization_id, product_id, cost_price)
         VALUES ($1, $2, 30.0000);`,
        [orgId, productId]
      );

      await pgClient.query(
        `UPDATE public.inventory
         SET quantity = 20.0000, version = 1
         WHERE organization_id = $1 AND product_id = $2;`,
        [orgId, productId]
      );

      // 10. Authenticate Supabase clients
      ownerClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: errOwner } = await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password: testPassword,
      });
      if (errOwner) throw errOwner;

      cashierClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: errCashier } = await cashierClient.auth.signInWithPassword({
        email: cashierEmail,
        password: testPassword,
      });
      if (errCashier) throw errCashier;

      orgBClient = createClient(supabaseUrl, anonKey!, { auth: { persistSession: false } });
      const { error: errOrgB } = await orgBClient.auth.signInWithPassword({
        email: orgBEmail,
        password: testPassword,
      });
      if (errOrgB) throw errOrgB;

      // 11. Execute an initial checkout via execute_sale (Price $50, 10% tax = $55.00 total)
      const idempotencyKey = randomUUID();
      const payload = {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_items: [
          {
            product_id: productId,
            quantity: "1.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "55.0000",
            amount_tendered: "60.0000",
            change_due: "5.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0.0,
        p_idempotency_key: idempotencyKey,
        p_notes: "Phase 5 History Test Sale",
      };

      const { data: saleData, error: saleErr } = await cashierClient.rpc("execute_sale", payload);
      if (saleErr) throw saleErr;

      expect(saleData.success).toBe(true);
      saleId = saleData.sale_id;
      saleNumber = saleData.sale_number;

      // 12. Execute a second checkout via execute_sale (Price $50 * 2 = $100, 10% tax = $110.00 total)
      const idempotencyKey2 = randomUUID();
      const payload2 = {
        p_org_id: orgId,
        p_customer_id: null,
        p_items: [
          {
            product_id: productId,
            quantity: "2.0000",
            line_discount_amount: "0.0000",
          },
        ],
        p_payments: [
          {
            payment_method: "cash",
            amount: "110.0000",
            amount_tendered: "110.0000",
            change_due: "0.0000",
            reference_no: null,
          },
        ],
        p_order_discount_amount: 0.0,
        p_idempotency_key: idempotencyKey2,
        p_notes: "Phase 5 History Second Test Sale (Zero Returns)",
      };

      const { data: saleData2, error: saleErr2 } = await cashierClient.rpc("execute_sale", payload2);
      if (saleErr2) throw saleErr2;

      expect(saleData2.success).toBe(true);
      saleId2 = saleData2.sale_id;
      saleNumber2 = saleData2.sale_number;
      expect(saleNumber2).toBeDefined();

      // 13. Create return and refund lifecycle records for saleId (T062, US5, US7)
      returnNumber = `RET-${timestamp}-001`;
      const returnRes = await pgClient.query(
        `INSERT INTO public.sale_returns (
           organization_id, return_number, sale_id, reason, total_refund_amount, idempotency_key, idempotency_hash, created_by
         ) VALUES (
           $1, $2, $3, 'Customer changed mind', 25.0000, $4, 'test-return-hash', $5
         ) RETURNING id;`,
        [orgId, returnNumber, saleId, randomUUID(), cashierUserId]
      );
      returnId = returnRes.rows[0].id;

      const itemRes = await pgClient.query(
        `SELECT id, product_id FROM public.sale_items WHERE organization_id = $1 AND sale_id = $2 LIMIT 1;`,
        [orgId, saleId]
      );
      const saleItemId = itemRes.rows[0].id;
      const saleProductId = itemRes.rows[0].product_id;

      await pgClient.query(
        `INSERT INTO public.sale_return_items (
           organization_id, return_id, sale_id, sale_item_id, product_id, quantity, refund_amount, restock_to_inventory
         ) VALUES (
           $1, $2, $3, $4, $5, 0.5000, 25.0000, true
         );`,
        [orgId, returnId, saleId, saleItemId, saleProductId]
      );

      failedRefundId = randomUUID();
      await pgClient.query(
        `INSERT INTO public.refunds (
           id, organization_id, sale_id, return_id, obligation_refund_id, refund_method, amount, status, reason, processed_by
         ) VALUES (
           $1, $2, $3, $4, $1, 'card', 25.0000, 'failed', 'Card gateway timeout', $5
         );`,
        [failedRefundId, orgId, saleId, returnId, cashierUserId]
      );

      replacementRefundId = randomUUID();
      await pgClient.query(
        `INSERT INTO public.refunds (
           id, organization_id, sale_id, return_id, obligation_refund_id, parent_refund_id, refund_method, amount, status, reference_no, reason, processed_by
         ) VALUES (
           $1, $2, $3, $4, $5, $5, 'cash', 25.0000, 'completed', 'REF-CASH-001', 'Replacement for failed card refund', $6
         );`,
        [replacementRefundId, orgId, saleId, returnId, failedRefundId, cashierUserId]
      );
    });

    afterAll(async () => {
      try {
        if (pgClient) {
          // Restore role_permissions for cashier if modified during tests
          await pgClient.query(
            `DELETE FROM public.role_permissions
             WHERE role = 'cashier' AND permission_id IN ('inventory:read_valuation', 'products:read_cost');`
          );

          await pgClient.query(`ALTER TABLE public.organization_memberships DISABLE TRIGGER ALL;`);
          if (orgId) {
            await pgClient.query(`DELETE FROM public.refunds WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(
              `DELETE FROM public.sale_return_items WHERE return_id IN (
                SELECT id FROM public.sale_returns WHERE organization_id = $1
              );`,
              [orgId]
            );
            await pgClient.query(`DELETE FROM public.sale_returns WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.payments WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.sale_items WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.sales WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.stock_movements WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.inventory WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.product_costs WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.products WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.customers WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organization_tax_settings WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgId]);
            await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgId]);
          }
          if (orgBId) {
            await pgClient.query(`DELETE FROM public.organization_memberships WHERE organization_id = $1;`, [orgBId]);
            await pgClient.query(`DELETE FROM public.organizations WHERE id = $1;`, [orgBId]);
          }
          await pgClient.query(`ALTER TABLE public.organization_memberships ENABLE TRIGGER ALL;`);
        }
      } catch (_) { }

      try {
        if (ownerUserId && adminClient) {
          await adminClient.auth.admin.deleteUser(ownerUserId);
        }
        if (cashierUserId && adminClient) {
          await adminClient.auth.admin.deleteUser(cashierUserId);
        }
        if (orgBUserId && adminClient) {
          await adminClient.auth.admin.deleteUser(orgBUserId);
        }
        if (suspUserId && adminClient) {
          await adminClient.auth.admin.deleteUser(suspUserId);
        }
      } catch (_) { }

      if (pgClient) {
        await pgClient.end();
      }
    });

    // -------------------------------------------------------------------------
    // 1. Tax Settings RPC Security & Validation Tests (T058, US5, US8)
    // -------------------------------------------------------------------------
    it("1. update_tax_settings succeeds when called by Owner and persists changes", async () => {
      const { data, error } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "State Sales Tax",
        p_default_tax_rate: 8.7500,
        p_is_tax_inclusive: false,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.success).toBe(true);
      expect(data.tax_name).toBe("State Sales Tax");
      expect(data.default_tax_rate).toBe("8.7500");
      expect(data.is_tax_inclusive).toBe(false);

      // Verify direct database persistence
      const res = await pgClient.query(
        `SELECT tax_name, default_tax_rate, is_tax_inclusive FROM public.organization_tax_settings WHERE organization_id = $1;`,
        [orgId]
      );
      expect(res.rows[0].tax_name).toBe("State Sales Tax");
      expect(Number(res.rows[0].default_tax_rate)).toBe(8.75);
      expect(res.rows[0].is_tax_inclusive).toBe(false);
    });

    it("2. update_tax_settings rejected with 42501 INSUFFICIENT_PERMISSIONS for Cashier", async () => {
      const { data, error } = await cashierClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Cashier Override Tax",
        p_default_tax_rate: 0.0,
        p_is_tax_inclusive: false,
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("INSUFFICIENT_PERMISSIONS");
    });

    it("3. update_tax_settings validates constraints and rejects invalid inputs (23514)", async () => {
      // Rate > 100
      const { error: errOver100 } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Excessive Tax",
        p_default_tax_rate: 105.0,
        p_is_tax_inclusive: false,
      });
      expect(errOver100).toBeDefined();
      expect(errOver100?.code).toBe("23514");

      // Negative Rate
      const { error: errNeg } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Negative Tax",
        p_default_tax_rate: -5.0,
        p_is_tax_inclusive: false,
      });
      expect(errNeg).toBeDefined();
      expect(errNeg?.code).toBe("23514");

      // Empty Name
      const { error: errEmptyName } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "   ",
        p_default_tax_rate: 10.0,
        p_is_tax_inclusive: false,
      });
      expect(errEmptyName).toBeDefined();
      expect(errEmptyName?.code).toBe("23514");
    });

    // -------------------------------------------------------------------------
    // 2. Dual-Permission Cost Confidentiality Tests (T061, US5)
    // -------------------------------------------------------------------------
    it("4. get_sale_detail MASKS unit_cost (returns null) for Cashier", async () => {
      const { data, error } = await cashierClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.sale.sale_number).toBe(saleNumber);
      expect(data.customer.name).toBe("History Test Customer");
      expect(data.items.length).toBe(1);

      // Verify price is visible but confidential cost is masked
      const item = data.items[0];
      expect(item.product_name).toBe("Gaming Monitor 4K");
      expect(item.unit_price).toBe("50.0000");
      expect(item.unit_cost).toBeNull(); // CRITICAL CONFIDENTIALITY GUARANTEE
    });

    it("5. get_sale_detail REVEALS unit_cost for Owner holding dual valuation & cost permissions", async () => {
      const { data, error } = await ownerClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.sale.sale_number).toBe(saleNumber);
      expect(data.items.length).toBe(1);

      // Verify Owner sees unit_cost exactly matching product cost at sale time
      const item = data.items[0];
      expect(item.unit_price).toBe("50.0000");
      expect(item.unit_cost).toBe("30.0000"); // Cost confidentiality unlocked for authorized role
    });

    // -------------------------------------------------------------------------
    // 3. Multi-Tenant Isolation Tests (T060, T061)
    // -------------------------------------------------------------------------
    it("6. get_sale_detail enforces tenant isolation against cross-tenant callers", async () => {
      // Org B user attempts to pass Org A's ID
      const { data: d1, error: err1 } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });
      expect(d1).toBeNull();
      expect(err1?.code).toBe("P0002"); // MEMBERSHIP_INACTIVE in Org A

      // Org B user attempts to query Org A's sale ID under Org B's ID
      const { data: d2, error: err2 } = await orgBClient.rpc("get_sale_detail", {
        p_org_id: orgBId,
        p_sale_id: saleId,
      });
      expect(d2).toBeNull();
      expect(err2?.code).toBe("P0048"); // SALE_NOT_FOUND in Org B
    });

    it("7. update_tax_settings enforces tenant isolation against cross-tenant callers", async () => {
      const { data, error } = await orgBClient.rpc("update_tax_settings", {
        p_org_id: orgId, // Calling against foreign org
        p_tax_name: "Hostile Takeover Tax",
        p_default_tax_rate: 99.0,
        p_is_tax_inclusive: true,
      });
      expect(data).toBeNull();
      expect(error?.code).toBe("P0002");
    });

    // -------------------------------------------------------------------------
    // 4. Historical Snapshot Immutability Invariant Verification (US5)
    // -------------------------------------------------------------------------
    it("8. historical sale snapshot remains permanently immutable after organization tax settings change", async () => {
      // Step 1: Update org tax settings radically to 25% tax-inclusive
      const { error: updateErr } = await ownerClient.rpc("update_tax_settings", {
        p_org_id: orgId,
        p_tax_name: "Radical Luxury VAT",
        p_default_tax_rate: 25.0000,
        p_is_tax_inclusive: true,
      });
      expect(updateErr).toBeNull();

      // Step 2: Query historical sale detail
      const { data, error } = await ownerClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();

      // Step 3: Assert sale header permanently retained original snapshotted tax parameters
      expect(data.sale.tax_name).toBe("Standard VAT");
      expect(data.sale.tax_rate).toBe("10.0000");
      expect(data.sale.is_tax_inclusive).toBe(false);
      expect(Number(data.sale.tax_amount)).toBe(5.0);
      expect(Number(data.sale.total_amount)).toBe(55.0);

      // Step 4: Line item snapshot immutability
      expect(Number(data.items[0].taxable_amount)).toBe(50.0);
      expect(Number(data.items[0].allocated_tax_amount)).toBe(5.0);
      expect(Number(data.items[0].total_price)).toBe(55.0);
    });

    // -------------------------------------------------------------------------
    // 5. Complete Dual-Permission Matrix (Quadrants 2 & 3) (T061, US5)
    // -------------------------------------------------------------------------
    it("9. get_sale_detail MASKS unit_cost when user has inventory:read_valuation ONLY (Quadrant 2)", async () => {
      // Temporarily grant inventory:read_valuation to cashier role
      await pgClient.query(
        `INSERT INTO public.role_permissions (role, permission_id)
         VALUES ('cashier', 'inventory:read_valuation')
         ON CONFLICT (role, permission_id) DO NOTHING;`
      );

      try {
        const { data, error } = await cashierClient.rpc("get_sale_detail", {
          p_org_id: orgId,
          p_sale_id: saleId,
        });

        expect(error).toBeNull();
        expect(data).toBeDefined();
        // Since cashier has inventory:read_valuation but NOT products:read_cost,
        // v_can_view_cost evaluates to FALSE -> unit_cost MUST be null
        expect(data.items[0].unit_cost).toBeNull();
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'inventory:read_valuation';`
        );
      }
    });

    it("10. get_sale_detail MASKS unit_cost when user has products:read_cost ONLY (Quadrant 3)", async () => {
      // Temporarily grant products:read_cost to cashier role
      await pgClient.query(
        `INSERT INTO public.role_permissions (role, permission_id)
         VALUES ('cashier', 'products:read_cost')
         ON CONFLICT (role, permission_id) DO NOTHING;`
      );

      try {
        const { data, error } = await cashierClient.rpc("get_sale_detail", {
          p_org_id: orgId,
          p_sale_id: saleId,
        });

        expect(error).toBeNull();
        expect(data).toBeDefined();
        // Since cashier has products:read_cost but NOT inventory:read_valuation,
        // v_can_view_cost evaluates to FALSE -> unit_cost MUST be null
        expect(data.items[0].unit_cost).toBeNull();
      } finally {
        await pgClient.query(
          `DELETE FROM public.role_permissions
           WHERE role = 'cashier' AND permission_id = 'products:read_cost';`
        );
      }
    });

    // -------------------------------------------------------------------------
    // 6. PostgREST Sales List Filtering, Sorting & Pagination (T060, US5)
    // -------------------------------------------------------------------------
    it("11. sales list PostgREST query supports date range, status, customer, cashier, search, and deterministic pagination", async () => {
      // 1. Query with all filters active
      const now = new Date();
      const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const query = cashierClient
        .from("sales")
        .select("id, sale_number, status, customer_id, created_by, created_at, total_amount", { count: "exact" })
        .eq("organization_id", orgId)
        .eq("status", "completed")
        .eq("customer_id", customerId)
        .eq("created_by", cashierUserId)
        .gte("created_at", pastDate)
        .lte("created_at", futureDate)
        .ilike("sale_number", "%SAL-%")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(0, 9);

      const { data, count, error } = await query;
      expect(error).toBeNull();
      expect(count).toBe(1);
      expect(data).toHaveLength(1);
      const firstRow = data![0]!;
      expect(firstRow.id).toBe(saleId);
      expect(firstRow.sale_number).toBe(saleNumber);

      // 2. Cross-tenant isolation: Org B queries Org A's organization_id -> returns 0 rows (denied by RLS)
      const { data: foreignData, count: foreignCount } = await orgBClient
        .from("sales")
        .select("id", { count: "exact" })
        .eq("organization_id", orgId);

      expect(foreignCount).toBe(0);
      expect(foreignData).toHaveLength(0);

      // 3. Confidential cost column protection: direct query on sale_items (unit_cost omitted)
      const { data: safeItems } = await cashierClient
        .from("sale_items")
        .select("id, sale_id")
        .eq("organization_id", orgId)
        .eq("sale_id", saleId);

      expect(safeItems).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // 7. Return & Refund Lifecycle Integration (T062, US5, US7)
    // -------------------------------------------------------------------------
    it("12. get_sale_detail faithfully resolves partial returns, restock status, and refund hierarchies", async () => {
      // Query get_sale_detail via cashier
      const { data, error } = await cashierClient.rpc("get_sale_detail", {
        p_org_id: orgId,
        p_sale_id: saleId,
      });

      expect(error).toBeNull();
      expect(data).toBeDefined();

      // Assert returns returned by RPC
      expect(data.returns).toHaveLength(1);
      expect(data.returns[0].id).toBe(returnId);
      expect(data.returns[0].return_number).toBe(returnNumber);
      expect(data.returns[0].reason).toBe("Customer changed mind");
      expect(Number(data.returns[0].total_refund_amount)).toBe(25.0);

      // Assert refunds returned by RPC (both failed and replacement)
      expect(data.refunds).toHaveLength(2);
      const failedRefund = data.refunds.find((r: any) => r.id === failedRefundId);
      const replacementRefund = data.refunds.find((r: any) => r.id === replacementRefundId);

      expect(failedRefund).toBeDefined();
      expect(failedRefund.status).toBe("failed");
      expect(failedRefund.refund_method).toBe("card");
      expect(failedRefund.reason).toBe("Card gateway timeout");

      expect(replacementRefund).toBeDefined();
      expect(replacementRefund.status).toBe("completed");
      expect(replacementRefund.refund_method).toBe("cash");
      expect(replacementRefund.obligation_refund_id).toBe(failedRefundId);
      expect(replacementRefund.parent_refund_id).toBe(failedRefundId);
      expect(replacementRefund.reference_no).toBe("REF-CASH-001");
    });

    // -------------------------------------------------------------------------
    // 8. Server Action: getTaxSettingsAction & updateTaxSettingsAction (T058, US5)
    // -------------------------------------------------------------------------
    it("13. getTaxSettingsAction retrieves active tax settings for Owner and Cashier", async () => {
      // 1. Owner call
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      const ownerRes = await getTaxSettingsAction(orgSlug);
      expect(ownerRes.success).toBe(true);
      if (!ownerRes.success) throw new Error("Expected ownerRes success");
      expect(ownerRes.data).toBeDefined();
      expect(ownerRes.data?.organizationId).toBe(orgId);
      expect(ownerRes.data?.taxName).toBeDefined();

      // 2. Cashier call (active member has read access)
      clearInMemoryCookieJar();
      const cashierServer = await createServerClient();
      await cashierServer.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const cashierRes = await getTaxSettingsAction(orgSlug);
      expect(cashierRes.success).toBe(true);
      if (!cashierRes.success) throw new Error("Expected cashierRes success");
      expect(cashierRes.data?.organizationId).toBe(orgId);
    });

    it("14. getTaxSettingsAction rejects cross-tenant caller with NOT_FOUND / FORBIDDEN", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

      // Org B user attempts to call Org A's slug
      const foreignRes = await getTaxSettingsAction(orgSlug);
      expect(foreignRes.success).toBe(false);
      if (!foreignRes.success) {
        expect(foreignRes.error.code).toMatch(/NOT_FOUND|FORBIDDEN/i);
      }
    });

    it("15. getTaxSettingsAction rejects suspended member", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: suspEmail, password: testPassword });

      const suspRes = await getTaxSettingsAction(orgSlug);
      expect(suspRes.success).toBe(false);
      if (!suspRes.success) {
        expect(suspRes.error.code).toMatch(/NOT_FOUND|FORBIDDEN|NO_ORGANIZATIONS/i);
      }
    });

    it("16. updateTaxSettingsAction succeeds for Owner and rejects Cashier with FORBIDDEN", async () => {
      // 1. Cashier attempts to update tax settings
      clearInMemoryCookieJar();
      const cashierServer = await createServerClient();
      await cashierServer.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const cashierUpdate = await updateTaxSettingsAction(orgSlug, {
        taxName: "Hacked Tax",
        defaultTaxRate: 5.0,
        isTaxInclusive: false,
      });
      expect(cashierUpdate.success).toBe(false);
      if (!cashierUpdate.success) {
        expect(cashierUpdate.error.code).toBe("FORBIDDEN");
      }

      // 2. Owner updates tax settings
      clearInMemoryCookieJar();
      const ownerServer = await createServerClient();
      await ownerServer.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      const ownerUpdate = await updateTaxSettingsAction(orgSlug, {
        taxName: "Verified State Tax",
        defaultTaxRate: 7.25,
        isTaxInclusive: false,
      });
      expect(ownerUpdate.success).toBe(true);
      if (!ownerUpdate.success) throw new Error("Expected ownerUpdate success");
      expect(ownerUpdate.data.taxName).toBe("Verified State Tax");
      expect(ownerUpdate.data.defaultTaxRate).toBe(7.25);
    });

    // -------------------------------------------------------------------------
    // 9. Server Action: getSalesListAction Live Database Execution (T060, US5)
    // -------------------------------------------------------------------------
    it("17. getSalesListAction exercises live query with calendar date, status, customer, cashier, and search", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      // Filter with today's calendar date YYYY-MM-DD
      const today = new Date().toISOString().split("T")[0]!;

      const res = await getSalesListAction(orgSlug, {
        fromDate: today,
        toDate: today,
        status: "completed",
        customerId,
        cashierId: cashierUserId,
        search: saleNumber,
        page: 1,
        pageSize: 10,
        sortBy: "created_at",
        sortOrder: "desc",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected getSalesListAction success");
      expect(res.data).toBeDefined();
      expect(res.data.items).toHaveLength(1);
      expect(res.data.items[0]!.id).toBe(saleId);
      expect(res.data.items[0]!.saleNumber).toBe(saleNumber);
      expect(res.data.items[0]!.customerName).toBe("History Test Customer");
      expect(res.data.totalCount).toBe(1);
    });

    it("18. getSalesListAction rejects malformed and ambiguous dates with VALIDATION_ERROR", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      // Malformed date: 2026-99-99
      const resMalformed = await getSalesListAction(orgSlug, { fromDate: "2026-99-99" });
      expect(resMalformed.success).toBe(false);
      if (!resMalformed.success) {
        expect(resMalformed.error.code).toBe("VALIDATION_ERROR");
      }

      // Non-leap year: 2026-02-29
      const resLeap = await getSalesListAction(orgSlug, { fromDate: "2026-02-29" });
      expect(resLeap.success).toBe(false);
      if (!resLeap.success) {
        expect(resLeap.error.code).toBe("VALIDATION_ERROR");
      }

      // Ambiguous US date: 11/20/2026
      const resAmbiguous = await getSalesListAction(orgSlug, { fromDate: "11/20/2026" });
      expect(resAmbiguous.success).toBe(false);
      if (!resAmbiguous.success) {
        expect(resAmbiguous.error.code).toBe("VALIDATION_ERROR");
      }

      // Non-date string
      const resText = await getSalesListAction(orgSlug, { fromDate: "not-a-date" });
      expect(resText.success).toBe(false);
      if (!resText.success) {
        expect(resText.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("19. getSalesListAction supports deterministic sorting and multi-record pagination metadata", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      // We have 2 sales in Org A (saleId and saleId2)
      const res = await getSalesListAction(orgSlug, {
        page: 1,
        pageSize: 10,
        sortBy: "total_amount",
        sortOrder: "desc",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalCount).toBe(2);
        expect(res.data.totalPages).toBe(1);
        expect(res.data.items).toHaveLength(2);
        expect(res.data.items[0]!.totalAmount).toBeGreaterThan(res.data.items[1]!.totalAmount);
      }
    });

    it("20. getSalesListAction strictly enforces cross-tenant isolation", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

      const res = await getSalesListAction(orgSlug, {});
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toMatch(/NOT_FOUND|FORBIDDEN/i);
      }
    });

    // -------------------------------------------------------------------------
    // 10. Server Action: getReturnHistoryAction Live Database Execution (T062, US5)
    // -------------------------------------------------------------------------
    it("21. getReturnHistoryAction returns complete return items, restock flag, and refund hierarchy", async () => {
      // 1. Owner call: holds returns:read AND refunds:read
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

      const res = await getReturnHistoryAction(orgSlug, saleId);
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected getReturnHistoryAction success");
      expect(res.data).toBeDefined();
      expect(res.data).toHaveLength(1);

      const ret = res.data[0]!;
      expect(ret.reason).toBe("Customer changed mind");
      expect(ret.totalRefundAmount).toBe(25.0);
      expect(ret.items).toHaveLength(1);
      expect(ret.items[0]!.restockToInventory).toBe(true);
      expect(ret.items[0]!.quantity).toBe(0.5);

      // Refunds chain (1 failed card refund, 1 completed replacement cash refund)
      expect(ret.refunds).toHaveLength(2);
      const completedRefund = ret.refunds.find((r: RefundRecord) => r.status === "completed");
      const failedRefund = ret.refunds.find((r: RefundRecord) => r.status === "failed");

      expect(completedRefund).toBeDefined();
      expect(completedRefund?.refundMethod).toBe("cash");
      expect(completedRefund?.replacesRefundId).toBeDefined();
      expect(completedRefund?.obligationRefundId).toBeDefined();

      expect(failedRefund).toBeDefined();
      expect(failedRefund?.refundMethod).toBe("card");
      expect(failedRefund?.status).toBe("failed");

      // 2. Cashier call: holds returns:read, but lacks refunds:read
      clearInMemoryCookieJar();
      const cashierServer = await createServerClient();
      await cashierServer.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const resCashier = await getReturnHistoryAction(orgSlug, saleId);
      expect(resCashier.success).toBe(true);
      if (!resCashier.success) throw new Error("Expected cashier getReturnHistoryAction success");
      expect(resCashier.data).toBeDefined();
      expect(resCashier.data).toHaveLength(1);
      expect(resCashier.data[0]!.items).toHaveLength(1);
      // Refunds are empty for cashier due to public.refunds SELECT RLS requiring refunds:read
      expect(resCashier.data[0]!.refunds).toHaveLength(0);
    });

    it("22. getReturnHistoryAction returns empty array for sale with zero returns", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: cashierEmail, password: testPassword });

      const res = await getReturnHistoryAction(orgSlug, saleId2);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data).toBeDefined();
        expect(res.data).toHaveLength(0);
      }
    });

    it("23. getReturnHistoryAction rejects cross-tenant queries", async () => {
      clearInMemoryCookieJar();
      const serverClient = await createServerClient();
      await serverClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

      // Org B user attempts to query Org A's sale return history
      const res = await getReturnHistoryAction(orgSlug, saleId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toMatch(/NOT_FOUND|FORBIDDEN/i);
      }
    });
  }
);
