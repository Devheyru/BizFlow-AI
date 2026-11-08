import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { ROLE_PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/types/auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing required Supabase environment keys");
}

describe("T029: create_product RPC Execution Sequence & Identifier Integrity (US2)", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;

  // Supabase clients
  let anonClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let cashierClient: SupabaseClient;
  let unverifiedClient: SupabaseClient;
  let nonMemberClient: SupabaseClient;
  let orgBClient: SupabaseClient;

  // User IDs
  let ownerUserId: string;
  let managerUserId: string;
  let cashierUserId: string;
  let unverifiedUserId: string;
  let nonMemberUserId: string;
  let orgBUserId: string;

  // Organizations
  let orgAId: string;
  let orgBId: string;
  const orgASlug = `prod-rpc-a-${Date.now()}`;
  const orgBSlug = `prod-rpc-b-${Date.now()}`;

  // Categories
  let activeCategoryId: string;
  let archivedCategoryId: string;
  let orgBCategoryId: string;

  const testPassword = "P@ssword123!SecureTest";

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    const timestamp = Date.now();
    const ownerEmail = `owner_rpc_${timestamp}@bizflow-test.internal`;
    const mgrEmail = `mgr_rpc_${timestamp}@bizflow-test.internal`;
    const cashEmail = `cash_rpc_${timestamp}@bizflow-test.internal`;
    const unverifiedEmail = `unverified_rpc_${timestamp}@bizflow-test.internal`;
    const nonMemberEmail = `nonmember_rpc_${timestamp}@bizflow-test.internal`;
    const orgBEmail = `orgb_rpc_${timestamp}@bizflow-test.internal`;

    // 1. Create Users
    const { data: uOwner } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "RPC", last_name: "Owner" },
    });
    ownerUserId = uOwner.user!.id;

    const { data: uMgr } = await adminClient.auth.admin.createUser({
      email: mgrEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "RPC", last_name: "Manager" },
    });
    managerUserId = uMgr.user!.id;

    const { data: uCash } = await adminClient.auth.admin.createUser({
      email: cashEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "RPC", last_name: "Cashier" },
    });
    cashierUserId = uCash.user!.id;

    const { data: uUnverified } = await adminClient.auth.admin.createUser({
      email: unverifiedEmail,
      password: testPassword,
      email_confirm: true, // Created confirmed so sign-in succeeds
      user_metadata: { first_name: "RPC", last_name: "Unverified" },
    });
    unverifiedUserId = uUnverified.user!.id;

    const { data: uNonMember } = await adminClient.auth.admin.createUser({
      email: nonMemberEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "RPC", last_name: "NonMember" },
    });
    nonMemberUserId = uNonMember.user!.id;

    const { data: uOrgB } = await adminClient.auth.admin.createUser({
      email: orgBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "RPC", last_name: "OrgB" },
    });
    orgBUserId = uOrgB.user!.id;

    // 2. Authenticate clients with real JWT
    ownerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: testPassword });

    managerClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await managerClient.auth.signInWithPassword({ email: mgrEmail, password: testPassword });

    cashierClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await cashierClient.auth.signInWithPassword({ email: cashEmail, password: testPassword });

    unverifiedClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await unverifiedClient.auth.signInWithPassword({ email: unverifiedEmail, password: testPassword });

    // Clear email_confirmed_at so user has valid authenticated session but unverified email status
    await pgClient.query("UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1;", [unverifiedUserId]);

    nonMemberClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await nonMemberClient.auth.signInWithPassword({ email: nonMemberEmail, password: testPassword });

    orgBClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await orgBClient.auth.signInWithPassword({ email: orgBEmail, password: testPassword });

    // 3. Create Organizations and Memberships
    const orgARes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Product Creation Org Alpha', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgASlug, ownerUserId]);
    orgAId = orgARes.rows[0].id;

    const orgBRes = await pgClient.query(`
      INSERT INTO public.organizations (name, slug, currency, business_type, country, timezone, created_by)
      VALUES ('Product Creation Org Beta', $1, 'USD', 'retail', 'US', 'UTC', $2)
      RETURNING id;
    `, [orgBSlug, orgBUserId]);
    orgBId = orgBRes.rows[0].id;

    await pgClient.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
      VALUES
        ($1, $2, 'owner', 'active'),
        ($1, $3, 'manager', 'active'),
        ($1, $4, 'cashier', 'active'),
        ($1, $5, 'cashier', 'active'),
        ($6, $7, 'owner', 'active');
    `, [orgAId, ownerUserId, managerUserId, cashierUserId, unverifiedUserId, orgBId, orgBUserId]);

    // 4. Seed Categories for Org A
    const { data: catActive } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Active Produce",
      p_description: "Fresh vegetables and fruit",
    });
    activeCategoryId = (catActive as any).data.id;

    const { data: catArch } = await ownerClient.rpc("create_product_category", {
      p_org_id: orgAId,
      p_name: "Archived Seasonal",
      p_description: "Archived category",
    });
    archivedCategoryId = (catArch as any).data.id;

    await ownerClient.rpc("archive_product_category", {
      p_org_id: orgAId,
      p_category_id: archivedCategoryId,
    });

    // 5. Seed Category for Org B (Cross-tenant testing)
    const { data: catOrgB } = await orgBClient.rpc("create_product_category", {
      p_org_id: orgBId,
      p_name: "Org B Category",
      p_description: "Belongs to Org B",
    });
    orgBCategoryId = (catOrgB as any).data.id;
  });

  afterAll(async () => {
    try {
      if (orgAId && orgBId) {
        await pgClient.query("DELETE FROM public.products WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.product_categories WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id IN ($1, $2);", [orgAId, orgBId]);
        await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER USER;");
        await pgClient.query("DELETE FROM public.organizations WHERE id IN ($1, $2);", [orgAId, orgBId]);
      }
    } finally {
      await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER USER;");
    }

    if (ownerUserId) await adminClient.auth.admin.deleteUser(ownerUserId);
    if (managerUserId) await adminClient.auth.admin.deleteUser(managerUserId);
    if (cashierUserId) await adminClient.auth.admin.deleteUser(cashierUserId);
    if (unverifiedUserId) await adminClient.auth.admin.deleteUser(unverifiedUserId);
    if (nonMemberUserId) await adminClient.auth.admin.deleteUser(nonMemberUserId);
    if (orgBUserId) await adminClient.auth.admin.deleteUser(orgBUserId);

    await pgClient.end();
  });

  // ==========================================================================
  // Phase A: Authorization & RBAC Invariants
  // ==========================================================================
  describe("Phase A: Authorization & RBAC Invariant Verification", () => {
    it("rejects unauthenticated caller with P0003 or 42501", async () => {
      // 1. Calling via anon client fails because EXECUTE is revoked from anon (42501)
      const { data, error } = await anonClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Unauthorized Product",
        p_sku: "ANON-001",
        p_selling_price: 10.0,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(
        error?.code === "P0003" ||
        error?.code === "42501" ||
        error?.message.includes("P0003") ||
        error?.message.includes("permission denied")
      ).toBe(true);

      // 2. Direct database invocation where authenticated role is set but auth.uid() is NULL raises P0003
      await expect(
        pgClient.query(`
          DO $$
          BEGIN
            PERFORM set_config('role', 'authenticated', true);
            PERFORM set_config('request.jwt.claims', '{}', true);
            PERFORM public.create_product(
              '${orgAId}'::uuid,
              'Direct Unauth Product',
              'DIRECT-001',
              10.0
            );
          END $$;
        `)
      ).rejects.toThrow(/P0003|Authentication required/);
    });

    it("rejects unverified email caller with P0001 (EMAIL_UNVERIFIED)", async () => {
      const { data, error } = await unverifiedClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Unverified Product",
        p_sku: "UNVERIFIED-001",
        p_selling_price: 10.0,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code === "P0001" || error?.message.includes("P0001")).toBe(true);
    });

    it("rejects non-member caller with P0004 (UNAUTHORIZED_MEMBERSHIP)", async () => {
      const { data, error } = await nonMemberClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Non-Member Product",
        p_sku: "NONMEM-001",
        p_selling_price: 10.0,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code === "P0004" || error?.message.includes("P0004")).toBe(true);
    });

    it("rejects caller missing products:create (Cashier) with P0005 (FORBIDDEN)", async () => {
      const { data, error } = await cashierClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Cashier Created Product",
        p_sku: "CASHIER-001",
        p_selling_price: 10.0,
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code === "P0005" || error?.message.includes("P0005")).toBe(true);
    });

    it("enforces RBAC invariant: every role with products:create also holds products:update", async () => {
      // 1. Database table verification
      const dbRes = await pgClient.query(`
        SELECT role, permission_id
        FROM public.role_permissions
        WHERE permission_id IN ('products:create', 'products:update')
        ORDER BY role, permission_id;
      `);

      const dbRolesWithCreate = new Set(
        dbRes.rows.filter((r) => r.permission_id === "products:create").map((r) => r.role)
      );
      const dbRolesWithUpdate = new Set(
        dbRes.rows.filter((r) => r.permission_id === "products:update").map((r) => r.role)
      );

      for (const role of dbRolesWithCreate) {
        expect(
          dbRolesWithUpdate.has(role),
          `Database role '${role}' has products:create but is missing products:update`
        ).toBe(true);
      }

      // 2. Application-level verification
      const appRoles = ["owner", "admin", "manager", "cashier"] as const;
      for (const role of appRoles) {
        const mockContext = {
          role,
          organization: { id: orgAId, is_active: true },
          membership: { status: "active", role },
          permissions: ROLE_PERMISSIONS[role] || [],
          user: { id: ownerUserId, email: "owner@test.com" },
          activeOrganizations: [],
        } as unknown as TenantContext;

        const canCreate = hasPermission(mockContext, "products:create");
        const canUpdate = hasPermission(mockContext, "products:update");

        if (canCreate) {
          expect(
            canUpdate,
            `Application role '${role}' has products:create but is missing products:update`
          ).toBe(true);
        }
      }

      // Cashier possesses neither
      const cashierContext = {
        role: "cashier",
        organization: { id: orgAId, is_active: true },
        membership: { status: "active", role: "cashier" },
        permissions: ROLE_PERMISSIONS.cashier,
        user: { id: cashierUserId, email: "cashier@test.com" },
        activeOrganizations: [],
      } as unknown as TenantContext;

      expect(hasPermission(cashierContext, "products:create")).toBe(false);
      expect(hasPermission(cashierContext, "products:update")).toBe(false);
    });
  });

  // ==========================================================================
  // Phase B: Validation, Identifiers & Currency Concurrency Lock
  // ==========================================================================
  describe("Phase B: Validation, Unique Identifiers & Currency Decimal Constraints", () => {
    it("rejects initial product status other than 'active' with P0015", async () => {
      const { data: dInactive, error: eInactive } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Status Inactive Product",
        p_sku: "STATUS-INACT-001",
        p_selling_price: 10.0,
        p_status: "inactive",
      });
      expect(dInactive).toBeNull();
      expect(eInactive?.code === "P0015" || eInactive?.message.includes("P0015")).toBe(true);

      const { data: dArchived, error: eArchived } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Status Archived Product",
        p_sku: "STATUS-ARCH-001",
        p_selling_price: 10.0,
        p_status: "archived",
      });
      expect(dArchived).toBeNull();
      expect(eArchived?.code === "P0015" || eArchived?.message.includes("P0015")).toBe(true);
    });

    it("rejects unapproved Unit of Measure with P0009", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Invalid UOM Product",
        p_sku: "INVALID-UOM-001",
        p_selling_price: 10.0,
        p_unit_of_measure: "barrel",
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects invalid SKU formats with P0009", async () => {
      const invalidSkus = ["SKU WITH SPACES", "SKU#123", "", "PROD@TEST"];
      for (const sku of invalidSkus) {
        const { data, error } = await ownerClient.rpc("create_product", {
          p_org_id: orgAId,
          p_name: "Invalid SKU Product",
          p_sku: sku,
          p_selling_price: 10.0,
        });
        expect(data).toBeNull();
        expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
      }
    });

    it("rejects invalid barcode formats with P0009", async () => {
      const invalidBarcodes = ["12", "BC#1234", "BARCODE WITH SPACE"];
      for (const barcode of invalidBarcodes) {
        const { data, error } = await ownerClient.rpc("create_product", {
          p_org_id: orgAId,
          p_name: "Invalid Barcode Product",
          p_sku: `BC-TEST-${Date.now()}`,
          p_selling_price: 10.0,
          p_barcode: barcode,
        });
        expect(data).toBeNull();
        expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
      }
    });

    it("rejects prices exceeding currency minor exponent (USD = 2 decimals) with P0009", async () => {
      // Selling price with 3 decimals
      const { data: dSelling, error: eSelling } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Precision Selling Product",
        p_sku: "PRECISION-SELL-001",
        p_selling_price: 10.999,
      });
      expect(dSelling).toBeNull();
      expect(eSelling?.code === "P0009" || eSelling?.message.includes("P0009")).toBe(true);

      // Cost price with 3 decimals
      const { data: dCost, error: eCost } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Precision Cost Product",
        p_sku: "PRECISION-COST-001",
        p_selling_price: 10.99,
        p_cost_price: 5.555,
      });
      expect(dCost).toBeNull();
      expect(eCost?.code === "P0009" || eCost?.message.includes("P0009")).toBe(true);
    });

    it("rejects negative selling price and cost price with P0007", async () => {
      const { data: dNegSelling, error: eNegSelling } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Negative Selling Product",
        p_sku: "NEG-SELL-001",
        p_selling_price: -0.01,
      });
      expect(dNegSelling).toBeNull();
      expect(eNegSelling?.code === "P0007" || eNegSelling?.message.includes("P0007")).toBe(true);

      const { data: dNegCost, error: eNegCost } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Negative Cost Product",
        p_sku: "NEG-COST-001",
        p_selling_price: 10.0,
        p_cost_price: -5.0,
      });
      expect(dNegCost).toBeNull();
      expect(eNegCost?.code === "P0007" || eNegCost?.message.includes("P0007")).toBe(true);
    });

    it("enforces permanent SKU uniqueness (P0006)", async () => {
      const uniqueSku = `PERM-SKU-${Date.now()}`;
      const { data: firstProd, error: firstErr } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Original SKU Item",
        p_sku: uniqueSku,
        p_selling_price: 15.0,
      });
      expect(firstErr).toBeNull();
      expect(firstProd).not.toBeNull();

      // Duplicate attempt in same organization
      const { data: dupProd, error: dupErr } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Duplicate SKU Item",
        p_sku: uniqueSku,
        p_selling_price: 20.0,
      });
      expect(dupProd).toBeNull();
      expect(dupErr?.code === "P0006" || dupErr?.message.includes("P0006")).toBe(true);
    });

    it("enforces permanent barcode uniqueness (P0006)", async () => {
      const uniqueBarcode = `BC-DUP-${Date.now()}`;
      const { data: firstProd, error: firstErr } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Original Barcode Item",
        p_sku: `SKU-BC1-${Date.now()}`,
        p_selling_price: 15.0,
        p_barcode: uniqueBarcode,
      });
      expect(firstErr).toBeNull();
      expect(firstProd).not.toBeNull();

      // Duplicate barcode attempt in same organization
      const { data: dupProd, error: dupErr } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Duplicate Barcode Item",
        p_sku: `SKU-BC2-${Date.now()}`,
        p_selling_price: 20.0,
        p_barcode: uniqueBarcode,
      });
      expect(dupProd).toBeNull();
      expect(dupErr?.code === "P0006" || dupErr?.message.includes("P0006")).toBe(true);
    });

    it("rejects non-existent category ID with P0002", async () => {
      const randomCatId = "a0000000-0000-0000-0000-000000000099";
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Nonexistent Cat Product",
        p_sku: `NOCAT-${Date.now()}`,
        p_selling_price: 10.0,
        p_category_id: randomCatId,
      });
      expect(data).toBeNull();
      expect(error?.code === "P0002" || error?.message.includes("P0002")).toBe(true);
    });

    it("rejects cross-tenant category ID with P0002", async () => {
      // Pass category from Org B to Org A
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Cross Tenant Cat Product",
        p_sku: `CROSSCAT-${Date.now()}`,
        p_selling_price: 10.0,
        p_category_id: orgBCategoryId,
      });
      expect(data).toBeNull();
      expect(error?.code === "P0002" || error?.message.includes("P0002")).toBe(true);
    });

    it("rejects archived category assignment with P0015", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Archived Cat Product",
        p_sku: `ARCHCAT-${Date.now()}`,
        p_selling_price: 10.0,
        p_category_id: archivedCategoryId,
      });
      expect(data).toBeNull();
      expect(error?.code === "P0015" || error?.message.includes("P0015")).toBe(true);
    });

    it("rejects insecure HTTP image URLs with P0009", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Insecure Image Product",
        p_sku: `INSEC-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: "http://example.com/image.png",
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects image URLs with missing host/authority (https:///image.png) with P0009", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Missing Host Image Product",
        p_sku: `NOHOST-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: "https:///image.png",
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects scheme-only image URLs (https://) with P0009", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Scheme Only Image Product",
        p_sku: `SCHEME-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: "https://",
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
    });

    it("rejects image URLs with unencoded whitespace with P0009", async () => {
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Space Image Product",
        p_sku: `SPACE-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: "https://example.com/path with spaces",
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);

      const { data: dataNl, error: errorNl } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Newline Image Product",
        p_sku: `NL-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: "https://example.com\n",
      });
      expect(dataNl).toBeNull();
      expect(errorNl?.code === "P0009" || errorNl?.message.includes("P0009")).toBe(true);
    });

    it("rejects non-HTTP schemes (javascript, data, ftp, file) with P0009", async () => {
      const invalidSchemes = [
        "javascript:alert(1)",
        "data:image/png;base64,test",
        "ftp://example.com/image.png",
        "file:///image.png",
      ];
      for (const invalidUrl of invalidSchemes) {
        const { data, error } = await ownerClient.rpc("create_product", {
          p_org_id: orgAId,
          p_name: "Invalid Scheme Product",
          p_sku: `SCHEME-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          p_selling_price: 10.0,
          p_image_url: invalidUrl,
        });
        expect(data, `Expected ${invalidUrl} to be rejected`).toBeNull();
        expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
      }
    });

    it("rejects internal storage image paths belonging to own tenant folder with P0009", async () => {
      const ownOrgPath = `${orgAId}/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/photo.jpg`;
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Own Org Storage Image Product",
        p_sku: `OWN-STORAGE-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: ownOrgPath,
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
      expect(error?.message).toMatch(/Internal storage paths are not permitted during product creation/i);
    });

    it("rejects storage image paths belonging to a different tenant folder with P0009", async () => {
      const wrongOrgPath = `${orgBId}/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/photo.jpg`;
      const { data, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Wrong Folder Image Product",
        p_sku: `WRONG-IMG-${Date.now()}`,
        p_selling_price: 10.0,
        p_image_url: wrongOrgPath,
      });
      expect(data).toBeNull();
      expect(error?.code === "P0009" || error?.message.includes("P0009")).toBe(true);
      expect(error?.message).toMatch(/Internal storage paths are not permitted during product creation/i);
    });

    it("accepts valid external HTTPS image URLs on RPC creation (standard, CDN, bare host, query string, fragment, port)", async () => {
      const validCases = [
        "https://example.com/image.png",
        "https://cdn.example.com/image.webp",
        "https://example.com",
        "https://example.com/image.png?size=large",
        "https://example.com/image.png#fragment",
        "https://example.com:8443/image.png",
      ];
      for (const validUrl of validCases) {
        const { data: rawRes, error } = await ownerClient.rpc("create_product", {
          p_org_id: orgAId,
          p_name: `Valid Image ${validUrl.slice(-10)}`,
          p_sku: `VALID-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          p_selling_price: 12.5,
          p_image_url: validUrl,
        });
        expect(error, `Expected ${validUrl} to be accepted without error`).toBeNull();
        const res = rawRes as any;
        expect(res.success).toBe(true);
        expect(res.data.image_url).toBe(validUrl);
      }
    });

    it("accepts null or omitted image URL on RPC creation", async () => {
      // Null image URL
      const { data: resNull, error: errNull } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Null Image Product",
        p_sku: `NULL-IMG-${Date.now()}`,
        p_selling_price: 8.0,
        p_image_url: null,
      });
      expect(errNull).toBeNull();
      expect((resNull as any).success).toBe(true);
      expect((resNull as any).data.image_url).toBeNull();

      // Omitted image URL
      const { data: resOmitted, error: errOmitted } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Omitted Image Product",
        p_sku: `OMITTED-IMG-${Date.now()}`,
        p_selling_price: 8.0,
      });
      expect(errOmitted).toBeNull();
      expect((resOmitted as any).success).toBe(true);
      expect((resOmitted as any).data.image_url).toBeNull();
    });
  });

  // ==========================================================================
  // Phase C: Atomic Mutation, Confidential Cost Persistence & Audit Logging
  // ==========================================================================
  describe("Phase C: Atomic Mutation, Cost Persistence & Audit Event Logging", () => {
    it("successfully creates product with active category, cost price, and audit event", async () => {
      const sku = `PROD-ACTIVE-${Date.now()}`;
      const { data: rawRes, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Fresh Organic Apple",
        p_sku: sku,
        p_selling_price: 2.50,
        p_unit_of_measure: "kg",
        p_status: "active",
        p_barcode: "APPLE-12345",
        p_description: "Crisp honeycrisp apples",
        p_category_id: activeCategoryId,
        p_cost_price: 1.25,
        p_image_url: "https://example.com/apple.jpg",
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      const createdProd = res.data;
      expect(createdProd.id).toBeDefined();
      expect(createdProd.name).toBe("Fresh Organic Apple");
      expect(createdProd.sku).toBe(sku);
      expect(createdProd.unit_of_measure).toBe("kg");
      expect(createdProd.status).toBe("active");
      expect(createdProd.version).toBe(1);
      expect(Number(createdProd.cost_price)).toBe(1.25);

      // Verify product table record
      const prodRow = await pgClient.query(
        "SELECT * FROM public.products WHERE id = $1 AND organization_id = $2;",
        [createdProd.id, orgAId]
      );
      expect(prodRow.rows).toHaveLength(1);
      expect(prodRow.rows[0].status).toBe("active");
      expect(prodRow.rows[0].version).toBe(1);

      // Verify product_costs table record
      const costRow = await pgClient.query(
        "SELECT * FROM public.product_costs WHERE product_id = $1 AND organization_id = $2;",
        [createdProd.id, orgAId]
      );
      expect(costRow.rows).toHaveLength(1);
      expect(Number(costRow.rows[0].cost_price)).toBe(1.25);

      // Verify audit event record
      const auditRow = await pgClient.query(`
        SELECT * FROM public.organization_audit_events
        WHERE organization_id = $1 AND event_type = 'product_created'
        ORDER BY created_at DESC LIMIT 1;
      `, [orgAId]);
      expect(auditRow.rows).toHaveLength(1);
      const audit = auditRow.rows[0];
      expect(audit.actor_id).toBe(ownerUserId);
      expect(audit.metadata.product_id).toBe(createdProd.id);
      expect(audit.metadata.sku).toBe(sku);
      expect(audit.metadata.cost_set).toBe(true);
      // Plaintext numeric cost MUST NOT be stored in audit metadata
      expect(audit.metadata.cost_price).toBeUndefined();
    });

    it("creates product with null cost without creating any product_costs row", async () => {
      const sku = `PROD-NOCOST-${Date.now()}`;
      const { data: rawRes, error } = await managerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Free Drinking Water Cup",
        p_sku: sku,
        p_selling_price: 0.00,
        p_unit_of_measure: "piece",
        p_cost_price: null,
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      const prodId = res.data.id;

      // Verify product_costs row count is exactly 0
      const costRow = await pgClient.query(
        "SELECT * FROM public.product_costs WHERE product_id = $1;",
        [prodId]
      );
      expect(costRow.rows).toHaveLength(0);

      // Verify audit metadata shows cost_set = false
      const auditRow = await pgClient.query(`
        SELECT * FROM public.organization_audit_events
        WHERE organization_id = $1 AND event_type = 'product_created' AND metadata->>'product_id' = $2;
      `, [orgAId, prodId]);
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0].metadata.cost_set).toBe(false);
    });

    it("creates product with zero cost ($0.00) and persists explicit 0.00 in product_costs", async () => {
      const sku = `PROD-ZEROCOST-${Date.now()}`;
      const { data: rawRes, error } = await ownerClient.rpc("create_product", {
        p_org_id: orgAId,
        p_name: "Promotional Gift Card",
        p_sku: sku,
        p_selling_price: 0.00,
        p_unit_of_measure: "piece",
        p_cost_price: 0.00,
      });

      expect(error).toBeNull();
      const res = rawRes as any;
      expect(res.success).toBe(true);
      const prodId = res.data.id;

      // Verify product_costs row exists with 0.00
      const costRow = await pgClient.query(
        "SELECT * FROM public.product_costs WHERE product_id = $1;",
        [prodId]
      );
      expect(costRow.rows).toHaveLength(1);
      expect(Number(costRow.rows[0].cost_price)).toBe(0.00);
    });

    it("rolls back all changes atomically if a post-mutation operation fails", async () => {
      const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const testSku = `ROLLBACK-POSTMUTATION-${uniqueSuffix}`;
      const testCost = 25.00;
      const funcName = `test_fail_audit_${uniqueSuffix}`;
      const trgName = `trg_test_fail_${uniqueSuffix}`;

      try {
        // 1. Install a dynamically named temporary trigger on organization_audit_events
        // to force failure AFTER product and cost insertion, capturing the attempted product ID in the exception message
        await pgClient.query(`
          CREATE OR REPLACE FUNCTION ${funcName}()
          RETURNS TRIGGER AS $$
          BEGIN
            IF NEW.event_type = 'product_created' AND (NEW.metadata->>'sku') = '${testSku}' THEN
              RAISE EXCEPTION 'Simulated atomic rollback test failure in audit insertion: product_id=%', (NEW.metadata->>'product_id') USING ERRCODE = 'P9999';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          DROP TRIGGER IF EXISTS ${trgName} ON public.organization_audit_events;
          CREATE TRIGGER ${trgName}
          BEFORE INSERT ON public.organization_audit_events
          FOR EACH ROW
          EXECUTE FUNCTION ${funcName}();
        `);

        const { data, error } = await ownerClient.rpc("create_product", {
          p_org_id: orgAId,
          p_name: "Atomic Rollback Product",
          p_sku: testSku,
          p_selling_price: 50.00,
          p_cost_price: testCost,
        });

        expect(data).toBeNull();
        expect(error).not.toBeNull();
        expect(
          error?.code === "P9999" || error?.message.includes("Simulated atomic rollback test failure")
        ).toBe(true);

        const attemptedProductId = error?.message.match(/product_id=([0-9a-f-]{36})/i)?.[1];
        expect(attemptedProductId).toBeDefined();

        // Direct assertions against the attempted product ID
        const prodIdCheck = await pgClient.query(
          "SELECT 1 FROM public.products WHERE id = $1;",
          [attemptedProductId]
        );
        expect(prodIdCheck.rows).toHaveLength(0);

        const costProdIdCheck = await pgClient.query(
          "SELECT 1 FROM public.product_costs WHERE product_id = $1;",
          [attemptedProductId]
        );
        expect(costProdIdCheck.rows).toHaveLength(0);

        // Verify product was rolled back by SKU
        const prodCheck = await pgClient.query(
          "SELECT 1 FROM public.products WHERE organization_id = $1 AND sku = $2;",
          [orgAId, testSku]
        );
        expect(prodCheck.rows).toHaveLength(0);

        // Verify audit event was not committed
        const auditCheck = await pgClient.query(
          "SELECT 1 FROM public.organization_audit_events WHERE organization_id = $1 AND metadata->>'sku' = $2;",
          [orgAId, testSku]
        );
        expect(auditCheck.rows).toHaveLength(0);
      } finally {
        await pgClient.query(`
          DROP TRIGGER IF EXISTS ${trgName} ON public.organization_audit_events;
          DROP FUNCTION IF EXISTS ${funcName}();
        `);
      }
    });
  });
});