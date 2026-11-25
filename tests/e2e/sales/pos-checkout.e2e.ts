import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

test.describe("T093: POS Checkout Flow E2E (US1, US3)", () => {
  let pgClient: PgClient;
  const timestamp = Date.now();
  const testPassword = "Password123!PosTest";

  const cashierEmail = `cashier_pos_${timestamp}@example.com`;
  let cashierUserId: string;
  let orgId: string;
  const orgSlug = `pos-org-${timestamp}`;

  let productId: string;
  const productName = `Checkout Widget ${timestamp}`;
  const productSku = `SKU-POS-${timestamp}`;

  const customerName = `Jane Customer ${timestamp}`;
  const customerPhone = `+1415555${Math.floor(1000 + Math.random() * 9000)}`;

  test.beforeAll(async () => {
    pgClient = new PgClient({ connectionString: dbUrl });
    await pgClient.connect();

    const uRes = await adminClient.auth.admin.createUser({
      email: cashierEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { first_name: "POS", last_name: "Cashier" },
    });
    cashierUserId = uRes.data.user!.id;

    await pgClient.query(
      "INSERT INTO public.profiles (id, first_name, last_name) VALUES ($1, 'POS', 'Cashier') ON CONFLICT (id) DO NOTHING;",
      [cashierUserId]
    );

    const orgRes = await pgClient.query(
      `INSERT INTO public.organizations (name, slug, currency, business_type, country, created_by)
       VALUES ('POS Test Store', $1, 'USD', 'retail', 'US', $2) RETURNING id;`,
      [orgSlug, cashierUserId]
    );
    orgId = orgRes.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
       VALUES ($1, $2, 'cashier', 'active');`,
      [orgId, cashierUserId]
    );

    // Grant cashier necessary permissions
    await pgClient.query(
      `INSERT INTO public.role_permissions (role, permission_id)
       VALUES ('cashier', 'sales:create'), ('cashier', 'sales:read'), ('cashier', 'products:read'), ('cashier', 'customers:read')
       ON CONFLICT DO NOTHING;`
    );

    // Seed customer
    await pgClient.query(
      `INSERT INTO public.customers (organization_id, name, phone, email, status)
       VALUES ($1, $2, $3, $4, 'active');`,
      [orgId, customerName, customerPhone, `jane_${timestamp}@example.com`]
    );

    // Seed product
    const prodRes = await pgClient.query(
      `INSERT INTO public.products (organization_id, name, sku, selling_price, unit_of_measure, status, created_by, updated_by)
       VALUES ($1, $2, $3, 25.0000, 'piece', 'active', $4, $4) RETURNING id;`,
      [orgId, productName, productSku, cashierUserId]
    );
    productId = prodRes.rows[0].id;

    await pgClient.query(
      "UPDATE public.inventory SET quantity = 50 WHERE organization_id = $1 AND product_id = $2;",
      [orgId, productId]
    );
  });

  test.afterAll(async () => {
    try {
      if (orgId) {
        await pgClient.query("DELETE FROM public.refunds WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_returns WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_return_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.payments WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sale_items WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.sales WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.customers WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.stock_movements WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.inventory WHERE organization_id = $1;", [orgId]);
        await pgClient.query("DELETE FROM public.products WHERE organization_id = $1;", [orgId]);
      }
    } finally {
      await pgClient.end();
    }
  });

  test("completes POS checkout with customer selection, cart editing, discount, split tender and receipt", async ({ page }) => {
    // 1. Sign in
    await page.goto("/sign-in");
    await page.fill('input[type="email"]', cashierEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]');

    await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`));

    // 2. Navigate to POS
    await page.goto(`/${orgSlug}/pos`);
    await page.waitForLoadState("networkidle");

    // 3. Attach Customer via CustomerPicker
    const customerSearchInput = page.getByPlaceholder(/Search customer/i);
    await expect(customerSearchInput).toBeVisible();
    await customerSearchInput.fill(customerName);

    const customerDropdownOption = page.getByRole("button", { name: new RegExp(customerName) });
    await expect(customerDropdownOption).toBeVisible({ timeout: 10000 });
    await customerDropdownOption.click();

    // Verify customer is attached
    await expect(page.getByText(customerName)).toBeVisible();

    // 4. Search and Add Product to Cart
    const productSearchInput = page.getByPlaceholder(/search products/i);
    await expect(productSearchInput).toBeVisible();
    await productSearchInput.fill(productSku);

    const productCard = page.getByText(productName);
    await expect(productCard).toBeVisible();
    await productCard.click();

    // 5. Verify item in cart and edit quantity (increment from 1 to 2)
    const cartItem = page.getByTestId(`cart-item-row-${productId}`);
    await expect(cartItem).toBeVisible();

    const increaseQtyBtn = cartItem.getByLabel("Increase quantity");
    await expect(increaseQtyBtn).toBeVisible();
    await increaseQtyBtn.click();

    // Verify quantity input value updated to 2
    const qtyInput = cartItem.getByLabel("Item quantity");
    await expect(qtyInput).toHaveValue("2");

    // 6. Apply Order Discount ($5.00)
    const orderDiscountInput = page.locator("#order-discount-input");
    await expect(orderDiscountInput).toBeVisible();
    await orderDiscountInput.fill("5.00");

    // 7. Open Payment Modal
    const checkoutBtn = page.getByRole("button", { name: "Proceed to Payment" });
    await expect(checkoutBtn).toBeVisible();
    await checkoutBtn.click();

    // 8. Split Tender Payment:
    // First tender: $20.00 Cash
    const amountInput = page.locator("#tender-amount-input");
    await expect(amountInput).toBeVisible();
    await amountInput.fill("20.00");

    const cashTenderedInput = page.locator("#cash-tendered-input");
    await expect(cashTenderedInput).toBeVisible();
    await cashTenderedInput.fill("20.00");

    const addTenderBtn = page.getByRole("button", { name: "Add Tender" });
    await expect(addTenderBtn).toBeVisible();
    await addTenderBtn.click();

    // Second tender: Card for remaining $25.00
    const cardMethodBtn = page.getByRole("button", { name: /^Card/i });
    await expect(cardMethodBtn).toBeVisible();
    await cardMethodBtn.click();

    const refInput = page.locator("#tender-ref-input");
    await expect(refInput).toBeVisible();
    await refInput.fill("CARD-AUTH-998877");

    await addTenderBtn.click();

    // 9. Complete Checkout
    const completePaymentBtn = page.getByRole("button", { name: /Complete Checkout/i });
    await expect(completePaymentBtn).toBeVisible();
    await completePaymentBtn.click();

    // 10. Verify Receipt
    await expect(page.getByText("Sale Completed!")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`Customer: ${customerName}`)).toBeVisible();
    const receipt = page.locator("#printable-receipt");
    await expect(receipt.getByText(/cash/i).first()).toBeVisible();
    await expect(receipt.getByText(/card/i).first()).toBeVisible();
  });
});
