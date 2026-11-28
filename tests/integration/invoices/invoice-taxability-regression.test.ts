import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isDbAvailable = Boolean(anonKey && serviceRoleKey);
const describeIntegration = isDbAvailable ? describe : describe.skip;

interface InvoiceLineInput {
  sort_order?: number;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_discount_amount: number;
  is_taxable: boolean;
}

interface PersistedItemRow {
  sort_order: number;
  is_taxable: boolean;
  allocated_invoice_disc: string;
  taxable_amount: string;
  allocated_tax_amount: string;
  total_price: string;
}

interface PersistedHeaderRow {
  subtotal: string;
  invoice_discount_amount: string;
  taxable_amount: string;
  tax_amount: string;
  total_amount: string;
  outstanding_balance: string;
  status: string;
  is_tax_exempt: boolean;
  is_tax_inclusive: boolean;
  tax_rate: string;
}

interface DetailItemJson {
  sort_order: number;
  is_taxable: boolean;
  allocated_invoice_disc: string;
  taxable_amount: string;
  allocated_tax_amount: string;
  total_price: string;
}

function mustAt<T>(rows: readonly T[], index: number, label: string): T {
  const row = rows[index];
  if (row === undefined) {
    throw new Error(`Expected ${label} at index ${index}, got length ${rows.length}`);
  }
  return row;
}

describeIntegration("F-006-P1-01: Invoice Mixed Taxability & Tax Calculation Regression Tests", () => {
  let pgClient: PgClient;
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let ownerUserId: string;

  const createdOrgIds: string[] = [];
  let orgExcl10Id: string;
  let orgIncl10Id: string;
  let orgZeroRateId: string;

  let custExcl10Id: string;
  let custIncl10Id: string;
  let custZeroRateId: string;

  const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const password = "Password123!TaxRegTest";

  async function setupOrg(
    label: string,
    taxRate: number,
    isTaxInclusive: boolean
  ): Promise<{ orgId: string; customerId: string }> {
    const orgRes = await pgClient.query<{ id: string }>(
      `INSERT INTO public.organizations (name, slug, currency, timezone, business_type, country, is_active, created_by)
       VALUES ($1, $2, 'USD', 'UTC', 'retail', 'US', true, $3)
       RETURNING id;`,
      [`TaxReg ${label}`, `taxreg-${label.toLowerCase()}-${suffix}`, ownerUserId]
    );
    const orgId = mustAt(orgRes.rows, 0, "organization").id;
    createdOrgIds.push(orgId);

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [orgId, ownerUserId]
    );

    await pgClient.query(
      `INSERT INTO public.organization_tax_settings (organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_by)
       VALUES ($1, 'VAT', $2, $3, $4);`,
      [orgId, taxRate, isTaxInclusive, ownerUserId]
    );

    const custRes = await pgClient.query<{ id: string }>(
      `INSERT INTO public.customers (organization_id, name, email, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id;`,
      [orgId, `Customer ${label}`, `cust-${label.toLowerCase()}-${suffix}@example.com`]
    );

    return { orgId, customerId: mustAt(custRes.rows, 0, "customer").id };
  }

  async function fetchPersistedAndVerifyDetail(
    orgId: string,
    invoiceId: string
  ): Promise<{
    header: PersistedHeaderRow;
    items: PersistedItemRow[];
  }> {
    const detailRes = await ownerClient.rpc("get_invoice_detail", {
      p_org_id: orgId,
      p_invoice_id: invoiceId,
    });
    expect(detailRes.error).toBeNull();

    const headerRes = await pgClient.query<PersistedHeaderRow>(
      `SELECT subtotal::text, invoice_discount_amount::text, taxable_amount::text, tax_amount::text,
              total_amount::text, outstanding_balance::text, status, is_tax_exempt, is_tax_inclusive, tax_rate::text
       FROM public.invoices
       WHERE id = $1;`,
      [invoiceId]
    );
    const itemsRes = await pgClient.query<PersistedItemRow>(
      `SELECT sort_order, is_taxable, allocated_invoice_disc::text,
              taxable_amount::text, allocated_tax_amount::text, total_price::text
       FROM public.invoice_items
       WHERE invoice_id = $1
       ORDER BY sort_order ASC;`,
      [invoiceId]
    );

    const header = mustAt(headerRes.rows, 0, "invoice header");
    expect(detailRes.data.invoice.subtotal).toBe(header.subtotal);
    expect(detailRes.data.invoice.invoice_discount_amount).toBe(header.invoice_discount_amount);
    expect(detailRes.data.invoice.taxable_amount).toBe(header.taxable_amount);
    expect(detailRes.data.invoice.tax_amount).toBe(header.tax_amount);
    expect(detailRes.data.invoice.total_amount).toBe(header.total_amount);

    const detailItems = detailRes.data.items as DetailItemJson[];
    expect(detailItems).toHaveLength(itemsRes.rows.length);
    itemsRes.rows.forEach((row, idx) => {
      const detailItem = mustAt(detailItems, idx, "detail item");
      expect(detailItem.is_taxable).toBe(row.is_taxable);
      expect(detailItem.allocated_invoice_disc).toBe(row.allocated_invoice_disc);
      expect(detailItem.taxable_amount).toBe(row.taxable_amount);
      expect(detailItem.allocated_tax_amount).toBe(row.allocated_tax_amount);
      expect(detailItem.total_price).toBe(row.total_price);
    });

    return { header, items: itemsRes.rows };
  }

  async function createAndIssueInvoice(params: {
    orgId: string;
    customerId: string;
    items: InvoiceLineInput[];
    invoiceDiscountAmount?: number;
    isTaxExempt?: boolean;
  }): Promise<{
    invoiceId: string;
    header: PersistedHeaderRow;
    items: PersistedItemRow[];
  }> {
    const createRes = await ownerClient.rpc("create_invoice", {
      p_org_id: params.orgId,
      p_customer_id: params.customerId,
      p_issue_date: "2026-11-28",
      p_due_date: "2026-12-15",
      p_items: params.items,
      p_invoice_discount_amount: params.invoiceDiscountAmount ?? 0,
      p_is_tax_exempt: params.isTaxExempt ?? false,
      p_notes: null,
      p_payment_instructions: null,
      p_idempotency_key: randomUUID(),
    });
    expect(createRes.error).toBeNull();
    const invoiceId = createRes.data.invoice_id as string;

    const issueRes = await ownerClient.rpc("issue_invoice", {
      p_org_id: params.orgId,
      p_invoice_id: invoiceId,
      p_idempotency_key: randomUUID(),
    });
    expect(issueRes.error).toBeNull();

    const { header, items } = await fetchPersistedAndVerifyDetail(params.orgId, invoiceId);
    expect(issueRes.data.total_amount).toBe(header.total_amount);

    return { invoiceId, header, items };
  }

  beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    adminClient = createClient(supabaseUrl, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = `f006-taxreg-${suffix}@example.com`;
    const userRes = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Tax", last_name: "Regression" },
    });
    expect(userRes.error).toBeNull();
    ownerUserId = userRes.data.user!.id;

    await pgClient.query(
      "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'Tax', 'Regression') ON CONFLICT (id) DO NOTHING;",
      [ownerUserId]
    );

    ownerClient = createClient(supabaseUrl, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signInRes = await ownerClient.auth.signInWithPassword({ email, password });
    expect(signInRes.error).toBeNull();

    const excl10 = await setupOrg("Excl10", 10.0, false);
    orgExcl10Id = excl10.orgId;
    custExcl10Id = excl10.customerId;

    const incl10 = await setupOrg("Incl10", 10.0, true);
    orgIncl10Id = incl10.orgId;
    custIncl10Id = incl10.customerId;

    const zeroRate = await setupOrg("ZeroRate", 0.0, false);
    orgZeroRateId = zeroRate.orgId;
    custZeroRateId = zeroRate.customerId;
  });

  afterAll(async () => {
    const cleanupErrors: string[] = [];
    const runCleanupStep = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    try {
      if (pgClient) {
        if (createdOrgIds.length > 0) {
          // Delete dependent tenant rows in strict FK dependency order; each step runs independently
          await runCleanupStep("delete organization_audit_events", async () => {
            await pgClient.query("DELETE FROM public.organization_audit_events WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete invoice_items", async () => {
            await pgClient.query("DELETE FROM public.invoice_items WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete invoice_payments", async () => {
            await pgClient.query("DELETE FROM public.invoice_payments WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete invoices", async () => {
            await pgClient.query("DELETE FROM public.invoices WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete financial_sequences", async () => {
            await pgClient.query("DELETE FROM public.financial_sequences WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete customers", async () => {
            await pgClient.query("DELETE FROM public.customers WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });
          await runCleanupStep("delete organization_tax_settings", async () => {
            await pgClient.query("DELETE FROM public.organization_tax_settings WHERE organization_id = ANY($1::uuid[]);", [createdOrgIds]);
          });

          // Scoped transaction disabling ONLY trg_check_owner_invariant so cascading org deletion can remove the sole owner membership atomically
          await runCleanupStep("delete organizations & memberships", async () => {
            await pgClient.query("BEGIN;");
            try {
              await pgClient.query("ALTER TABLE public.organization_memberships DISABLE TRIGGER trg_check_owner_invariant;");
              await pgClient.query("DELETE FROM public.organizations WHERE id = ANY($1::uuid[]);", [createdOrgIds]);
              await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant;");
              await pgClient.query("COMMIT;");
            } catch (txErr) {
              try {
                await pgClient.query("ROLLBACK;");
              } catch (rbErr) {
                cleanupErrors.push(`rollback organizations tx: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`);
              }
              throw txErr;
            }
          });

          await runCleanupStep("verify trg_check_owner_invariant enabled", async () => {
            const trigRes = await pgClient.query<{ tgenabled: string }>(
              `SELECT tgenabled::text AS tgenabled
               FROM pg_trigger
               WHERE tgrelid = 'public.organization_memberships'::regclass
                 AND tgname = 'trg_check_owner_invariant'
                 AND NOT tgisinternal;`
            );
            const state = trigRes.rows[0]?.tgenabled;
            if (state !== "O") {
              await pgClient.query("ALTER TABLE public.organization_memberships ENABLE TRIGGER trg_check_owner_invariant;");
              throw new Error(`trg_check_owner_invariant unexpected state '${state ?? "missing"}', restored`);
            }
          });
        }

        // Independent of org cleanup failures, attempt Auth user removal and fail visibly on any returned error
        if (adminClient && ownerUserId) {
          await runCleanupStep(`delete auth user ${ownerUserId}`, async () => {
            const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(ownerUserId);
            if (deleteUserErr) {
              throw new Error(deleteUserErr.message);
            }
          });
        }

        // Verify zero residual fixture records across all org-scoped and user-scoped tables
        await runCleanupStep("verify zero leftover fixtures", async () => {
          if (createdOrgIds.length > 0) {
            const orgLeftovers = await pgClient.query<{ tbl: string; cnt: number }>(
              `SELECT 'organizations' AS tbl, count(*)::int AS cnt FROM public.organizations WHERE id = ANY($1::uuid[])
               UNION ALL SELECT 'organization_memberships', count(*)::int FROM public.organization_memberships WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'organization_tax_settings', count(*)::int FROM public.organization_tax_settings WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'customers', count(*)::int FROM public.customers WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'financial_sequences', count(*)::int FROM public.financial_sequences WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'invoices', count(*)::int FROM public.invoices WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'invoice_items', count(*)::int FROM public.invoice_items WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'invoice_payments', count(*)::int FROM public.invoice_payments WHERE organization_id = ANY($1::uuid[])
               UNION ALL SELECT 'organization_audit_events', count(*)::int FROM public.organization_audit_events WHERE organization_id = ANY($1::uuid[]);`,
              [createdOrgIds]
            );
            for (const row of orgLeftovers.rows) {
              if (row.cnt > 0) {
                cleanupErrors.push(`Leftover ${row.cnt} row(s) in ${row.tbl}`);
              }
            }
          }

          if (ownerUserId) {
            const userLeftovers = await pgClient.query<{ tbl: string; cnt: number }>(
              `SELECT 'auth.users' AS tbl, count(*)::int AS cnt FROM auth.users WHERE id = $1::uuid
               UNION ALL SELECT 'public.profiles', count(*)::int FROM public.profiles WHERE id = $1::uuid;`,
              [ownerUserId]
            );
            for (const row of userLeftovers.rows) {
              if (row.cnt > 0) {
                cleanupErrors.push(`Leftover ${row.cnt} row(s) in ${row.tbl}`);
              }
            }
          }
        });
      }
    } finally {
      if (pgClient) {
        try {
          await pgClient.end();
        } catch (endErr) {
          cleanupErrors.push(`pgClient.end: ${endErr instanceof Error ? endErr.message : String(endErr)}`);
        }
      }
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Test fixture cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  });

  it("1. Tax-exclusive mixed taxable and non-taxable lines: excludes non-taxable ($50) from taxable_amount", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgExcl10Id,
      customerId: custExcl10Id,
      items: [
        { sort_order: 0, description: "Taxable Consulting", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Exempt Pass-Through Fee", quantity: 1, unit_price: 50, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("100.0000");
    expect(line0.allocated_tax_amount).toBe("10.0000");
    expect(line0.total_price).toBe("110.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("50.0000");

    expect(header.subtotal).toBe("150.0000");
    expect(header.taxable_amount).toBe("100.0000");
    expect(header.tax_amount).toBe("10.0000");
    expect(header.total_amount).toBe("160.0000");
  });

  it("2. Multiple non-taxable lines: all contribute 0 to taxable_amount while remaining in subtotal and total_amount", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgExcl10Id,
      customerId: custExcl10Id,
      items: [
        { sort_order: 0, description: "Exempt Item A", quantity: 2, unit_price: 15, line_discount_amount: 0, is_taxable: false },
        { sort_order: 1, description: "Exempt Item B", quantity: 1, unit_price: 25, line_discount_amount: 5, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(line0.is_taxable).toBe(false);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("0.0000");
    expect(line0.allocated_tax_amount).toBe("0.0000");
    expect(line0.total_price).toBe("30.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("20.0000");

    expect(header.subtotal).toBe("50.0000");
    expect(header.taxable_amount).toBe("0.0000");
    expect(header.tax_amount).toBe("0.0000");
    expect(header.total_amount).toBe("50.0000");
  });

  it("3. Taxable line with zero tax rate retains taxable_amount while generating zero tax (unlike non-taxable line)", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgZeroRateId,
      customerId: custZeroRateId,
      items: [
        { sort_order: 0, description: "Zero-Rated Taxable Goods", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Explicitly Non-Taxable Fee", quantity: 1, unit_price: 40, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(header.tax_rate).toBe("0.0000");
    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("100.0000");
    expect(line0.allocated_tax_amount).toBe("0.0000");
    expect(line0.total_price).toBe("100.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("40.0000");

    expect(header.subtotal).toBe("140.0000");
    expect(header.taxable_amount).toBe("100.0000");
    expect(header.tax_amount).toBe("0.0000");
    expect(header.total_amount).toBe("140.0000");
  });

  it("4. Invoice-level tax exemption with taxable and non-taxable lines retains taxable line base and zeroes non-taxable base", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgExcl10Id,
      customerId: custExcl10Id,
      isTaxExempt: true,
      items: [
        { sort_order: 0, description: "Standard Taxable SKU", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Non-Taxable Freight", quantity: 1, unit_price: 50, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(header.is_tax_exempt).toBe(true);
    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("100.0000");
    expect(line0.allocated_tax_amount).toBe("0.0000");
    expect(line0.total_price).toBe("100.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("50.0000");

    expect(header.subtotal).toBe("150.0000");
    expect(header.taxable_amount).toBe("100.0000");
    expect(header.tax_amount).toBe("0.0000");
    expect(header.total_amount).toBe("150.0000");
  });

  it("5. Tax-inclusive mixed-taxability: extracts tax only from taxable line ($110 -> $100+$10) and leaves non-taxable ($50 -> taxable 0)", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgIncl10Id,
      customerId: custIncl10Id,
      items: [
        { sort_order: 0, description: "Inclusive Taxable Retail", quantity: 1, unit_price: 110, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Exempt Deposit", quantity: 1, unit_price: 50, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(header.is_tax_inclusive).toBe(true);
    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("100.0000");
    expect(line0.allocated_tax_amount).toBe("10.0000");
    expect(line0.total_price).toBe("110.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("50.0000");

    expect(header.subtotal).toBe("160.0000");
    expect(header.taxable_amount).toBe("100.0000");
    expect(header.tax_amount).toBe("10.0000");
    expect(header.total_amount).toBe("160.0000");
  });

  it("6 & 7. Invoice discount allocation across taxable & non-taxable lines applies discount to non-taxable total_price while keeping taxable_amount = 0", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgExcl10Id,
      customerId: custExcl10Id,
      invoiceDiscountAmount: 20,
      items: [
        { sort_order: 0, description: "Taxable Hardware", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Non-Taxable Training", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("10.0000");
    expect(line0.taxable_amount).toBe("90.0000");
    expect(line0.allocated_tax_amount).toBe("9.0000");
    expect(line0.total_price).toBe("99.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("10.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("90.0000");

    expect(header.subtotal).toBe("200.0000");
    expect(header.invoice_discount_amount).toBe("20.0000");
    expect(header.taxable_amount).toBe("90.0000");
    expect(header.tax_amount).toBe("9.0000");
    expect(header.total_amount).toBe("189.0000");
  });

  it("8. Zero-subtotal behavior (full line discount on taxable + $0 non-taxable line) persists all zero amounts and auto-marks paid", async () => {
    const { header, items } = await createAndIssueInvoice({
      orgId: orgExcl10Id,
      customerId: custExcl10Id,
      invoiceDiscountAmount: 0,
      items: [
        { sort_order: 0, description: "Comp Taxable Item", quantity: 1, unit_price: 50, line_discount_amount: 50, is_taxable: true },
        { sort_order: 1, description: "Free Non-Taxable Sample", quantity: 1, unit_price: 0, line_discount_amount: 0, is_taxable: false },
      ],
    });

    expect(items).toHaveLength(2);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");

    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("0.0000");
    expect(line0.taxable_amount).toBe("0.0000");
    expect(line0.allocated_tax_amount).toBe("0.0000");
    expect(line0.total_price).toBe("0.0000");

    expect(line1.is_taxable).toBe(false);
    expect(line1.allocated_invoice_disc).toBe("0.0000");
    expect(line1.taxable_amount).toBe("0.0000");
    expect(line1.allocated_tax_amount).toBe("0.0000");
    expect(line1.total_price).toBe("0.0000");

    expect(header.subtotal).toBe("0.0000");
    expect(header.taxable_amount).toBe("0.0000");
    expect(header.tax_amount).toBe("0.0000");
    expect(header.total_amount).toBe("0.0000");
    expect(header.outstanding_balance).toBe("0.0000");
    expect(header.status).toBe("paid");
  });

  it("9 & 10. Residual discount allocation on final non-taxable line + end-to-end create/update/issue/get_invoice_detail persistence & retrieval", async () => {
    // Stage 1: create_invoice draft
    const draftRes = await ownerClient.rpc("create_invoice", {
      p_org_id: orgExcl10Id,
      p_customer_id: custExcl10Id,
      p_issue_date: "2026-11-28",
      p_due_date: "2026-12-15",
      p_items: [
        { sort_order: 0, description: "Initial Draft Line", quantity: 1, unit_price: 100, line_discount_amount: 0, is_taxable: false },
      ],
      p_invoice_discount_amount: 0,
      p_is_tax_exempt: false,
      p_notes: null,
      p_payment_instructions: null,
      p_idempotency_key: randomUUID(),
    });
    expect(draftRes.error).toBeNull();
    expect(draftRes.data.subtotal).toBe("100.0000");
    expect(draftRes.data.tax_amount).toBe("0.0000");
    expect(draftRes.data.total_amount).toBe("100.0000");
    const invoiceId = draftRes.data.invoice_id as string;

    const draftCheck = await fetchPersistedAndVerifyDetail(orgExcl10Id, invoiceId);
    expect(draftCheck.header.taxable_amount).toBe("0.0000");
    expect(mustAt(draftCheck.items, 0, "draft line0").taxable_amount).toBe("0.0000");

    // Stage 2: update_invoice with 3x $10 lines (final positive line non-taxable) and $10 invoice discount
    const updateRes = await ownerClient.rpc("update_invoice", {
      p_org_id: orgExcl10Id,
      p_invoice_id: invoiceId,
      p_customer_id: custExcl10Id,
      p_issue_date: "2026-11-28",
      p_due_date: "2026-12-15",
      p_items: [
        { sort_order: 0, description: "Taxable Part 1", quantity: 1, unit_price: 10, line_discount_amount: 0, is_taxable: true },
        { sort_order: 1, description: "Taxable Part 2", quantity: 1, unit_price: 10, line_discount_amount: 0, is_taxable: true },
        { sort_order: 2, description: "Non-Taxable Final Line", quantity: 1, unit_price: 10, line_discount_amount: 0, is_taxable: false },
      ],
      p_invoice_discount_amount: 10,
      p_is_tax_exempt: false,
      p_notes: null,
      p_payment_instructions: null,
    });
    expect(updateRes.error).toBeNull();
    expect(updateRes.data.subtotal).toBe("30.0000");
    expect(updateRes.data.tax_amount).toBe("1.3400");
    expect(updateRes.data.total_amount).toBe("21.3400");

    // Verify updated draft persistence & RPC retrieval before issuance
    const updatedCheck = await fetchPersistedAndVerifyDetail(orgExcl10Id, invoiceId);
    expect(updatedCheck.header.taxable_amount).toBe("13.3400");

    // Stage 3: issue_invoice and verify persisted rows & get_invoice_detail match identically
    const issueRes = await ownerClient.rpc("issue_invoice", {
      p_org_id: orgExcl10Id,
      p_invoice_id: invoiceId,
      p_idempotency_key: randomUUID(),
    });
    expect(issueRes.error).toBeNull();
    expect(issueRes.data.total_amount).toBe("21.3400");

    const { header, items } = await fetchPersistedAndVerifyDetail(orgExcl10Id, invoiceId);
    expect(items).toHaveLength(3);
    const line0 = mustAt(items, 0, "line0");
    const line1 = mustAt(items, 1, "line1");
    const line2 = mustAt(items, 2, "line2");

    expect(line0.is_taxable).toBe(true);
    expect(line0.allocated_invoice_disc).toBe("3.3300");
    expect(line0.taxable_amount).toBe("6.6700");
    expect(line0.allocated_tax_amount).toBe("0.6700");
    expect(line0.total_price).toBe("7.3400");

    expect(line1.is_taxable).toBe(true);
    expect(line1.allocated_invoice_disc).toBe("3.3300");
    expect(line1.taxable_amount).toBe("6.6700");
    expect(line1.allocated_tax_amount).toBe("0.6700");
    expect(line1.total_price).toBe("7.3400");

    expect(line2.is_taxable).toBe(false);
    expect(line2.allocated_invoice_disc).toBe("3.3400");
    expect(line2.taxable_amount).toBe("0.0000");
    expect(line2.allocated_tax_amount).toBe("0.0000");
    expect(line2.total_price).toBe("6.6600");

    expect(header.subtotal).toBe("30.0000");
    expect(header.invoice_discount_amount).toBe("10.0000");
    expect(header.taxable_amount).toBe("13.3400");
    expect(header.tax_amount).toBe("1.3400");
    expect(header.total_amount).toBe("21.3400");
  });
});
