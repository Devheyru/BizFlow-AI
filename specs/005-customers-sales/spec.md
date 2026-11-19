# Feature Specification: Customers & Sales Management

**Feature Branch**: `005-customers-sales`  
**Created**: 2026-11-17  
**Updated**: 2026-11-17 (Revision 2.6 -- Obligation Lock & Canonical Normalization Hardening)  
**Status**: Ready for Planning  
**Input**: User description: `# BIZFLOW AI -- FEATURE 005: CUSTOMERS & SALES`

---

## Executive Summary

Feature 005 introduces comprehensive **Customer Management** and **Point-of-Sale (POS) Sales Management** to BizFlow AI. It connects the product catalog (Feature 003) and the immutable stock ledger (Feature 004) to the commercial revenue engine of the business.

This specification establishes an atomic, multi-item checkout transaction engine (`public.execute_sale`), an atomic return and inventory restock engine (`public.execute_sale_return`), an atomic sale void engine (`public.void_sale`), and an external reimbursement confirmation procedure (`public.confirm_refund_reimbursement`). All inventory mutations deduct or restore stock strictly via Feature 004's internal `_execute_inventory_mutation_core` routine under deterministic ascending alphanumeric row locking to eliminate ABBA deadlocks. 

The engine snapshots historical selling prices, tax parameters (inclusive/exclusive modes, rates, and allocated tax), and acquisition costs to insulate historical records from future catalog or tax edits. It manages multi-tender split payments, enforces cash change calculation, records transaction references for non-cash tenders, isolates customer reimbursements into a dedicated `public.refunds` ledger, enforces server-side role-based authorization (cashiers vs. managers), provides line-item returns with operator-controlled restock restoration, and preserves strict multi-tenant Row-Level Security (RLS) across all entities without relying on client-supplied claims.

---

## Clarifications

### Session 2026-11-17
- Q: When processing returns in POS, should the system enforce a calendar-based return cutoff (e.g., 30 days from sale date) at the database level, or should return eligibility be governed by manager authorization and remaining unreturned quantity? Ã¢â€ â€™ A: Option A (Manager Discretion Ã¢â‚¬â€ No Hardcoded Date Limit): Any completed sale with remaining unreturned quantity is eligible for return when authorized by an operator holding `returns:create`. No hardcoded system calendar cutoff is enforced in MVP; configurable return policy settings are deferred.
- Q: How should cashier discount authority and discount caps be handled at POS checkout? Ã¢â€ â€™ A: Option A (Open Cashier Discounts Ã¢â‚¬â€ Subtotal-Bounded): Cashiers holding `sales:create` can apply line-item and order discounts directly in the POS cart, bounded so that line discounts cannot exceed line totals (`line_discount_amount <= quantity * unit_price`) and cart discounts cannot exceed order subtotal (`order_discount_amount <= subtotal`), guaranteeing non-negative totals. Dedicated manager override workflows are deferred.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 Ã¢â‚¬â€ POS Cart & Atomic Multi-Item Checkout (Priority: P1)

As a store cashier, I need to look up sellable products, add them to a shopping cart, specify quantities, optionally attach a registered customer (or proceed as a walk-in guest), and complete the checkout in a single atomic transaction so that stock is accurately decremented and a completed sale record is immediately generated.

**Why this priority**: POS checkout is the primary commercial revenue function of any retail management system. Without this, organizations cannot conduct commercial retail operations or decrement stock via sales.

**Independent Test**: Can be fully tested by selecting two active products with known inventory balances, adding them to a cart for a walk-in guest, supplying a valid client-generated UUID idempotency key, tendering full cash payment, and confirming: (1) sale status becomes `completed`, (2) two line items are persisted with snapshotted prices and taxes, (3) inventory balances for both products decrease by the exact sale quantities, and (4) corresponding `sale` records appear in `public.stock_movements`.

**Acceptance Scenarios**:

1. **Walk-in Guest Sale with Available Stock (Tax-Exclusive)**:
   - **Given** Cashier is logged into an active organization with `sales:create` permission, organization tax setting is 10% exclusive,
   - **And** Product A has current stock of 10 units at selling price $15.00,
   - **When** Cashier adds 2 units of Product A to the cart with no customer selected, submits a valid UUID idempotency key, and tenders full cash payment of $33.00 ($30.00 subtotal + $3.00 tax),
   - **Then** System generates a completed sale with `customer_id = NULL`, creates a `sale_items` record snapshotting $15.00 unit price and $3.00 allocated tax, deducts 2 units from Product A inventory (new balance 8), records payment of $33.00, and writes an immutable stock movement of type `sale`.

2. **Registered Customer Sale with Customer Association (Tax-Inclusive)**:
   - **Given** Active registered customer "Jane Doe" exists in the organization, organization tax setting is 10% inclusive,
   - **And** Product B has current stock of 5 units at selling price $22.00 (tax inclusive),
   - **When** Cashier attaches "Jane Doe" to the cart, adds 1 unit of Product B, supplies an idempotency key, and tenders exact card payment of $22.00 with reference number "AUTH-9912",
   - **Then** System persists the sale linked to Jane Doe's customer ID, snapshots gross total $22.00, extracted taxable base $20.00, and extracted tax $2.00, increments her purchase history, and decrements Product B stock to 4 units.

3. **Insufficient Stock Rejection & Atomic Rollback**:
   - **Given** Product A has 5 units in stock and Product B has 1 unit in stock,
   - **When** Cashier attempts checkout of 2 units of Product A and 2 units of Product B,
   - **Then** System rejects the entire transaction with error `INSUFFICIENT_STOCK` (SQLSTATE `P0011`, identifying Product B), rolls back all database modifications, and deducts zero stock from both Product A and Product B.

4. **Archived or Inactive Product Protection**:
   - **Given** Product C is marked `is_active = false` or has been archived,
   - **When** Cashier attempts to checkout a cart containing Product C,
   - **Then** System prevents checkout with error `PRODUCT_INACTIVE_SALE_BLOCKED` (SQLSTATE `P0031`) or `PRODUCT_ARCHIVED_STOCK_FORBIDDEN` (SQLSTATE `P0021`), requiring removal of Product C before proceeding.

5. **Mandatory Idempotency Key Validation**:
   - **Given** Cashier attempts to submit a checkout without an idempotency key or with a null key,
   - **When** The request reaches the database RPC,
   - **Then** System rejects the transaction with error `IDEMPOTENCY_KEY_REQUIRED` (SQLSTATE `P0055`, HTTP 422).

6. **Zero-Value Promotional Sale**:
   - **Given** Product A selling price is $10.00, and cashier applies a $10.00 discount (making payable total $0.00),
   - **When** Cashier submits checkout with empty payments array and valid idempotency key,
   - **Then** System creates a completed sale record with `total_amount = 0.0000`, `payment_status = 'paid'`, and deducts 1 unit of stock atomically.

---

### User Story 2 Ã¢â‚¬â€ Customer Profile Management & Purchase History (Priority: P1)

As a store cashier or manager, I need to create customer profiles with contact details, look up customers during or outside checkout by name or phone, view their lifetime purchase history, and update their details so that our business can cultivate customer loyalty and maintain accurate relationship records.

**Why this priority**: Identifying customers enables targeted retail services, dispute resolution, receipt lookups, customer transaction statements, and repeat business tracking.

**Independent Test**: Can be fully tested by creating a customer "John Smith" with phone "+15550199" and email "John.Smith@Example.COM", confirming case normalization to "john.smith@example.com", retrieving his profile, performing a sale linked to him, and verifying that his purchase history tab lists the completed sale with full receipt details.

**Acceptance Scenarios**:

1. **Authorized Customer Creation with Case Normalization**:
   - **Given** User has `customers:create` permission,
   - **When** User submits name "Sarah Connor", phone "+15550144", and email "Sarah.Connor@SKYNET.COM",
   - **Then** System trims the name, formats the phone, normalizes the email to "sarah.connor@skynet.com", creates an active customer record scoped to the organization, and makes it immediately searchable in POS checkout.

2. **Duplicate Phone Prevention within Organization**:
   - **Given** Customer A exists with phone "+15550144" in Organization 1,
   - **When** User in Organization 1 attempts to create another active customer with phone "+15550144",
   - **Then** System rejects the submission with validation error `CUSTOMER_PHONE_EXISTS` (SQLSTATE `23505`).
   - **And** An organization in Organization 2 can create a customer with phone "+15550144" without conflict (tenant-scoped uniqueness).

3. **Customer Archival with History Preservation**:
   - **Given** Customer "Bob" has 3 historical completed sales,
   - **When** Authorized manager archives Bob's customer profile via `archive_customer`,
   - **Then** Bob's status becomes `archived`, his record is hidden from default POS checkout search, past sales remain linked to his ID with full historical fidelity, and hard deletion of Bob is strictly blocked (`CUSTOMER_HAS_SALES_DELETE_BLOCKED`, SQLSTATE `P0042`).

4. **Inline Customer Creation During Checkout**:
   - **Given** Cashier is on the POS checkout screen with items in the cart,
   - **When** Cashier creates a customer via the inline customer modal,
   - **Then** System invokes `public.create_customer`, persists the new customer, and automatically attaches their UUID to the current active cart without clearing cart items.

---

### User Story 3 Ã¢â‚¬â€ Multi-Method & Split Payments (Priority: P1)

As a store cashier, I need to tender payments using multiple payment methods (Cash, Card, Bank Transfer, Other) for a single sale, record tendered cash amounts with automatic change calculation, capture external transaction references for non-cash methods, and ensure that the sale is only completed when total payments equal the sale payable amount.

**Why this priority**: In modern retail, customers frequently split bills (e.g., paying part cash and part card) or pay cash requiring change. Restricting POS to single exact payment causes transaction abandonment at checkout.

**Independent Test**: Can be fully tested by creating a sale with total payable $100.00, tendering $40.00 Card (with terminal auth code "CARD-8841") and $60.00 Cash (with $70.00 cash tendered, showing $10.00 change due), verifying two `payments` records are persisted totaling exactly $100.00, and confirming the sale completes successfully.

**Acceptance Scenarios**:

1. **Cash Tender with Automatic Change Calculation**:
   - **Given** Sale total payable amount is $43.50,
   - **When** Cashier tenders Cash with `amount_tendered = $50.00`,
   - **Then** System displays `change_due = $6.50`, records a payment of $43.50 with `amount_tendered = $50.00`, and completes the sale.

2. **Split Payment Across Two Methods**:
   - **Given** Sale total payable amount is $120.00,
   - **When** Cashier enters Payment 1 of $50.00 (Card, reference "TXN-01") and Payment 2 of $70.00 (Bank Transfer, reference "WIRE-88"),
   - **Then** System persists both payment records linked to the sale, verifies total payments ($120.00) equals total payable ($120.00), and transitions sale status to `completed`.

3. **Underpayment Rejection**:
   - **Given** Sale total payable amount is $50.00,
   - **When** Cashier attempts to complete checkout with only $35.00 recorded,
   - **Then** System blocks completion with error `PAYMENT_INCOMPLETE` (SQLSTATE `P0045`), displaying remaining balance due of $15.00.

4. **Overpayment Rejection on Non-Cash Methods**:
   - **Given** Sale total payable amount is $50.00,
   - **When** Cashier attempts to record a Card payment of $60.00,
   - **Then** System rejects the entry with error `PAYMENT_EXCEEDS_PAYABLE_AMOUNT` (SQLSTATE `P0046`). Overpayment is only valid for cash tender with change calculation.

5. **Missing Reference on Non-Cash Payments**:
   - **Given** Cashier submits a Card or Bank Transfer payment without a transaction reference number,
   - **When** The payment array is validated,
   - **Then** System rejects checkout with error `PAYMENT_REFERENCE_REQUIRED` (SQLSTATE `P0057`).

---

### User Story 4 Ã¢â‚¬â€ Line-Item Returns, Restock Restoration & Refunds (Priority: P2)

As a store manager, I need to process customer returns against an existing completed sale, select specific line items and quantities being returned, determine whether each returned item is returned to inventory or written off as damaged, and issue an audited refund record so that inventory levels and financial accounts reflect the return accurately.

**Why this priority**: Returns are a routine retail requirement. Without a structured returns engine, returned goods cannot be restored to sellable stock without error-prone manual inventory adjustments, and customer refund audit trails are lost.

**Independent Test**: Can be fully tested by referencing a completed sale of 3 units of Product A, initiating a return for 1 unit with `restock_to_inventory = true` and a client idempotency key, verifying that a `sale_returns` record is created, a dedicated `refunds` disbursement record is persisted, Product A inventory increments by 1 unit via an immutable `return` stock movement referencing `return:{return_id}`, and any subsequent attempt to return 3 units against the original sale is rejected.

**Acceptance Scenarios**:

1. **Partial Return with Inventory Restock**:
   - **Given** Completed sale S-001 contains 5 units of Product A ($10.00 each),
   - **And** Manager with `returns:create` initiates a return for 2 units marked `restock_to_inventory = true`,
   - **When** Manager confirms the return with reason "Customer changed mind", supplies a non-cash refund reference "REF-101", and supplies a UUID idempotency key,
   - **Then** System generates return UUID `v_return_id`, inserts the return header, creates a `refunds` disbursement record for $20.00 with `status = 'completed'`, creates `sale_return_items`, increments Product A inventory balance by 2 units via an immutable stock movement of type `return` (referencing `return:{return_id}`), and updates sale returned-quantity tracking.

2. **Partial Return without Inventory Restock (Damaged Item)**:
   - **Given** Completed sale S-001 contains 2 units of Product B ($30.00 each),
   - **When** Manager processes return for 1 unit marked `restock_to_inventory = false` with reason "Defective item",
   - **Then** System issues refund record of $30.00, creates return records, but does NOT increment Product B inventory balance (zero stock movement generated).

3. **Excess Return Quantity Rejection Across Multiple Lines**:
   - **Given** Sale S-002 sold 2 units of Product X and 1 unit was previously returned,
   - **When** User submits a return request with 2 units of Product X, or submits duplicate lines for Product X totaling 2 units,
   - **Then** System rejects the return with error `RETURN_QUANTITY_EXCEEDS_SOLD` (SQLSTATE `P0052`) or `DUPLICATE_RETURN_ITEM` (SQLSTATE `P0060`).

4. **Return Against Inactive Product**:
   - **Given** Product D was deactivated (`is_active = false`) after the sale was completed,
   - **When** User attempts to process a return restoring Product D to stock (`restock_to_inventory = true`),
   - **Then** System rejects stock restoration with error `PRODUCT_INACTIVE_RETURN_BLOCKED` (SQLSTATE `P0056`). The item may only be returned without restocking (`restock_to_inventory = false`) or after product reactivation.

5. **Cross-Sale Return Item Rejection via Database Foreign Key Integrity**:
   - **Given** Return R-001 was initiated for Sale S-001 in Organization O-001, and Sale S-002 also exists in Organization O-001 with Sale Item SI-999,
   - **When** An operator or API client attempts to submit a return item for Return R-001 referencing Sale Item SI-999 from Sale S-002,
   - **Then** PostgreSQL database foreign key constraint `fk_return_items_org_sale_item_prod` strictly rejects the insertion (`23503 foreign_key_violation`), guaranteeing that return items can never reference sale items belonging to a different sale, even within the same organization.

---

### User Story 5 Ã¢â‚¬â€ Sales Transaction History, Filtering & Printable Receipt (Priority: P2)

As a cashier or manager, I need to view a filterable log of historical sales transactions, inspect line items and payment breakdowns, search sales by sale number, date range, customer, or cashier, and display/print a standardized thermal receipt format so that customer inquiries and audit checks can be resolved quickly.

**Why this priority**: Cashiers need immediate access to past receipts when customers return to the counter with questions, and store accountants require searchable sales archives.

**Independent Test**: Can be fully tested by navigating to the Sales History view, filtering by date range and cashier, clicking a specific sale to view full line-item breakdowns, and generating the printable receipt view formatted with organization header, currency, taxes, and payment details.

**Acceptance Scenarios**:

1. **Sales List Filtering**:
   - **Given** 50 historical sales exist across diverse dates and cashiers,
   - **When** User filters by Cashier "Alex" and Date Range "Today",
   - **Then** System renders only the matching sales with accurate subtotal, payment method summary, and status badges.

2. **Thermal Receipt Generation**:
   - **Given** A completed sale with 3 items, tax, discount, and cash payment,
   - **When** Cashier clicks "View / Print Receipt",
   - **Then** System renders an optimized 80mm thermal receipt layout displaying organization name, currency, receipt number, date/time in organization timezone, cashier name, customer name (if registered), line items with unit price snapshots, subtotal, discount, tax, final total, tender amount, change due, and return policy notice.

3. **Multi-Tenant Sales Isolation**:
   - **Given** Cashier belongs to Organization A,
   - **When** Cashier queries sales history or attempts to view a sale by ID belonging to Organization B,
   - **Then** System returns zero rows or 404 Not Found via PostgreSQL Row-Level Security.

---

### User Story 6 Ã¢â‚¬â€ Sale Void / Cancellation by Authorized Managers (Priority: P3)

As a store manager or owner, I need to void an erroneous sale immediately after checkout if the customer cancels the purchase before leaving the counter, so that the commercial transaction is cancelled, deducted inventory is restored atomically, and reversing financial records are generated.

**Why this priority**: Human errors occur at the register (e.g., cashier scanned wrong barcode, customer card declined after partial cash entry, customer forgot wallet). A void mechanism preserves auditability while reverting inventory and balancing payments.

**Independent Test**: Can be fully tested by completing a sale of 2 units of Product A with cash payment, immediately executing a void as a Manager with reason "Cashier error" and a UUID idempotency key, confirming the sale status transitions to `voided`, payment status transitions to `refunded`, a reversing cash reimbursement row is entered into `public.refunds`, immutable stock movements of type `return` restore 2 units to Product A inventory, and subsequent return operations against the sale are prevented.

**Acceptance Scenarios**:

1. **Cash Void Reimbursement (Immediate Completion)**:
   - **Given** Sale S-005 was completed 5 minutes ago with $50.00 cash payment and has no associated returns,
   - **When** Store Manager with `sales:void` submits a void request with reason "Wrong items rung up" and an idempotency key,
   - **Then** System transitions sale status to `voided`, payment status to `refunded`, creates a corresponding cash reversal record in `public.refunds` for $50.00 with `status = 'completed'` and `reference_no = NULL`, records void metadata (timestamp, manager ID, reason), and restores all line item quantities to inventory via atomic stock movements of type `return` with reference `void:{sale_id}`.

2. **External Void with Supplied Reference (Pending Reimbursement)**:
   - **Given** Sale S-006 was completed with $100.00 card payment,
   - **When** Store Manager voids Sale S-006 providing terminal reversal intent reference "TERM-REV-9912",
   - **Then** System transitions sale status to `voided`, payment status to `partially_refunded`, creates a refund record in `public.refunds` for $100.00 with `status = 'pending'` and `reference_no = 'TERM-REV-9912'`, and restores stock to inventory immediately, treating the reference as supporting trace data rather than proof of reimbursement.

3. **External Void without Supplied Reference (Pending Reimbursement)**:
   - **Given** Sale S-007 was completed with $75.00 bank transfer payment,
   - **When** Store Manager voids Sale S-007 without supplying any reversal reference (`p_reversal_references = NULL`),
   - **Then** System transitions sale status to `voided`, payment status to `partially_refunded`, creates a refund record in `public.refunds` for $75.00 with `status = 'pending'` and `reference_no = NULL`, and restores stock to inventory immediately without error.

4. **Successful External Confirmation Workflow**:
   - **Given** Voided Sale S-006 has a pending card refund of $100.00,
   - **When** Card processor settlement confirmation arrives ("GATEWAY-AUTH-8821") and Manager invokes `confirm_refund_reimbursement` with mandatory external reference and confirmation idempotency key,
   - **Then** System transitions the refund record to `status = 'completed'`, updates `reference_no = 'GATEWAY-AUTH-8821'`, and recalculates sale payment status to `refunded` because all required reimbursement obligations are fully completed.

5. **Failed External Reimbursement & Replacement Workflow**:
   - **Given** Voided Sale S-006 has a pending card refund of $100.00,
   - **When** External card processor rejects the reimbursement due to card expiration, and Manager invokes `record_refund_failure` with reason "Card account closed",
   - **Then** System transitions the refund record to `status = 'failed'`, records the failure reason, and preserves sale payment status as `paid` (zero completed reimbursements),
   - **When** Manager invokes `issue_replacement_refund` with `p_refund_method = 'cash'`,
   - **Then** System creates a linked replacement refund record (`parent_refund_id` pointing to the failed refund) with `status = 'completed'`, and transitions sale payment status to `refunded` without duplicate inventory movements or duplicate return items.

6. **Cashier Void Attempt Rejected**:
   - **Given** Cashier has `sales:create` but lacks `sales:void`,
   - **When** Cashier attempts to void Sale S-005,
   - **Then** System rejects the request with HTTP 403 Forbidden (`INSUFFICIENT_PERMISSIONS`, SQLSTATE `42501`).

7. **Void Blocked if Returns Already Processed**:
   - **Given** Sale S-007 already has an associated partial return,
   - **When** Manager attempts to void Sale S-007,
   - **Then** System rejects the request with error `SALE_VOID_HAS_RETURNS_BLOCKED` (SQLSTATE `P0051`).
---

### User Story 7 — Replacement Reimbursement Lifecycle & Idempotency Safeguards (Priority: P2)

As a store manager or financial auditor, I need to reliably issue replacement reimbursements when external refund disbursements fail, while preventing duplicate payouts, enforcing parent-sale integrity across returns and replacement refunds, and guaranteeing strict idempotency conflict handling across all payment and confirmation parameters.

**Why this priority**: Payment gateway timeouts, expired cards, or account closures can cause external refund attempts to fail. When retrying reimbursements, the financial ledger must strictly guarantee that exactly one active reimbursement attempt exists per reimbursement obligation, that replacement records cannot be cross-linked to unrelated sales, and that idempotency keys cannot be cross-reused across different records.

**Independent Test**: Can be fully tested by creating a void or return with an external card refund R1, transitioning R1 to `failed`, issuing replacement R2, attempting a concurrent or duplicate replacement (verifying rejection with `P0064`), transitioning R2 to `failed`, issuing replacement R3 (verifying R3 shares R1's `obligation_refund_id`), confirming R3 as `completed`, attempting another replacement against R1 (verifying rejection with `P0067`), attempting to confirm a different refund with the same confirmation key (verifying `P0024`), and executing checkout with altered `amount_tendered` under the same key (verifying `P0024`).

**Acceptance Scenarios**:

1. **Replacement Refund Lineage Across Multiple Failures**:
   - **Given** External refund R1 ($100.00) fails and is marked `status = 'failed'` via `record_refund_failure`,
   - **And** Manager issues replacement card refund R2 which subsequently fails and is marked `status = 'failed'`,
   - **When** Manager invokes `issue_replacement_refund` to disburse cash refund R3,
   - **Then** System sets R3's `parent_refund_id = R2.id`, inherits `obligation_refund_id = R1.obligation_refund_id`, sets `status = 'completed'`, and preserves complete immutable audit lineage across R1 -> R2 -> R3.

2. **Duplicate Active Attempt Blocked (Pending Replacement Exists)**:
   - **Given** Failed refund R1 has an active replacement R2 in `status = 'pending'`,
   - **When** Manager attempts to issue another replacement referencing R1 or R2,
   - **Then** System rejects the request with error `REPLACEMENT_REFUND_ALREADY_EXISTS` (SQLSTATE `P0064`, HTTP 409), enforced by database partial unique index `UNIQUE (organization_id, obligation_refund_id) WHERE status IN ('pending', 'completed')`.

3. **Attempted Replacement on Completed Obligation Rejected**:
   - **Given** Replacement R3 for obligation R1 has reached `status = 'completed'`,
   - **When** An operator attempts to invoke `issue_replacement_refund` referencing earlier failed refund R1 or R2,
   - **Then** System rejects the request with error `OBLIGATION_ALREADY_COMPLETED` (SQLSTATE `P0067`, HTTP 422), mathematically preventing duplicate reimbursement payouts.

4. **Concurrent Replacement Serialization**:
   - **Given** Failed refund R1 has no active replacements,
   - **When** Two concurrent manager sessions simultaneously submit `issue_replacement_refund` for R1,
   - **Then** Advisory lock on `(organization_id, obligation_refund_id)` serializes the transactions; one succeeds and the other receives `REPLACEMENT_REFUND_ALREADY_EXISTS` (`P0064`), with zero duplicate refunds created.

5. **Cross-Sale Return Foreign Key Enforcement**:
   - **Given** Sale S-001 and Sale S-002 exist in Organization 1, and Return RET-001 belongs to Sale S-001,
   - **When** A database transaction attempts to insert a refund row with `sale_id = S-002` and `return_id = RET-001`,
   - **Then** PostgreSQL composite foreign key `fk_refunds_org_sale_return (organization_id, sale_id, return_id)` rejects the insertion with foreign key violation (`23503`), preventing cross-sale return linking.

6. **Cross-Sale Parent Refund Foreign Key Enforcement**:
   - **Given** Failed refund R-001 belongs to Sale S-001,
   - **When** An operator or script attempts to insert a replacement refund with `sale_id = S-002` and `parent_refund_id = R-001`,
   - **Then** PostgreSQL composite foreign key `fk_refunds_org_sale_parent (organization_id, sale_id, parent_refund_id)` rejects the insertion with foreign key violation (`23503`), preventing cross-sale replacement lineage.

7. **Cross-Refund Confirmation Idempotency Key Reuse Conflict (Case C)**:
   - **Given** Refund R-001 was confirmed via `confirm_refund_reimbursement` using idempotency key K-1,
   - **When** Operator invokes `confirm_refund_reimbursement` on a different refund R-002 using the same idempotency key K-1,
   - **Then** System checks for cross-refund key collision under advisory lock and raises `IDEMPOTENCY_CONFLICT` (SQLSTATE `P0024`, HTTP 409) rather than leaking a raw `23505` unique constraint violation.

8. **Payment Canonicalization Sensitivity to Tendered Amount and Change Due**:
   - **Given** A cashier submits checkout for a $50 sale with Cash payment ($50 amount, $50 tendered, $0 change) under idempotency key K-2,
   - **When** A retried request is submitted under key K-2 with Cash payment ($50 amount, $100 tendered, $50 change),
   - **Then** Canonical sorting and hashing over all material fields detects the payload change and raises `IDEMPOTENCY_CONFLICT` (SQLSTATE `P0024`, HTTP 409).

---

### Edge Cases

1. **Concurrent Checkout on Last Inventory Unit**:
   - Terminal 1 and Terminal 2 attempt to sell the final 1 unit of Product A at the exact same millisecond.
   - *System Behavior*: Database row locks on `public.inventory` FOR UPDATE in deterministic ascending `product_id` order ensure Terminal 1 secures the unit; Terminal 2 receives error `INSUFFICIENT_STOCK` (SQLSTATE `P0011`), rolling back Terminal 2 cleanly without allowing inventory balance to drop below zero.

2. **Network Disconnection / Retry on Checkout Submission**:
   - Cashier clicks "Charge $50", client sends request with UUID `idempotency_key`, but network drops before client receives response. Cashier re-clicks "Charge $50" with the same key.
   - *System Behavior*: Transaction-scoped advisory lock serializes the retry. The database procedure detects identical `idempotency_key` and matching canonical payload hash, returning the existing completed sale record without deducting duplicate inventory or creating duplicate payments (`is_replay = true`).

3. **Idempotency Key Conflict with Altered Payload**:
   - Client sends an identical `idempotency_key` but with different cart line items, discounts, or payments.
   - *System Behavior*: Server detects payload hash mismatch and rejects the request with error `IDEMPOTENCY_CONFLICT` (SQLSTATE `P0024`, HTTP 409 Conflict).

4. **Archived Customer Checkout**:
   - Customer profile was archived while cashier had them selected in an idle cart.
   - *System Behavior*: Checkout validation checks customer status; if `archived`, checkout fails with error `CUSTOMER_ARCHIVED` (SQLSTATE `P0041`).

5. **Partial Cash Overpayment with Multi-Tender**:
   - Total is $100. Customer pays $40 Card and offers $100 cash for the remaining $60.
   - *System Behavior*: System records Card payment of $40.00 (with auth code), records Cash payment of $60.00 (with `amount_tendered = $100.00`, `change_due = $40.00`). Total payments recorded equal exactly $100.00.

6. **Catalog Selling Price or Cost Edit After Sale**:
   - Product selling price is changed from $10.00 to $15.00 tomorrow, and supplier cost changes from $6.00 to $9.00.
   - *System Behavior*: Historical sale line items retain snapshotted `unit_price = 10.0000` and `unit_cost = 6.0000`. Historical margin reports, receipts, and returns calculate against original snapshots, not current catalog values.

7. **Zero-Item Cart Checkout**:
   - Client sends checkout request with empty items array.
   - *System Behavior*: Server validation rejects request with error `SALE_EMPTY_CART` (SQLSTATE `P0043`, HTTP 422 Unprocessable Entity).

8. **Duplicate Product Lines in Single Cart**:
   - Client submits a cart containing the same `product_id` on multiple lines.
   - *System Behavior*: Checkout validation rejects with `DUPLICATE_CART_PRODUCT` (SQLSTATE `P0044`), requiring the client to aggregate item quantities before submission.

---

## Requirements *(mandatory)*

### Functional Requirements

#### A. Customer Management
- **CUS-001**: System MUST allow users with `customers:create` to create a customer profile scoped to their active organization via trusted procedure `public.create_customer`. Direct client table INSERT is strictly denied by RLS.
- **CUS-002**: Customer profiles MUST include required field `name` (string, 1Ã¢â‚¬â€œ255 characters) and optional fields `phone` (E.164 string format), `email` (valid email format), and `notes` (string, max 1000 characters).
- **CUS-003**: System MUST normalize customer emails to lowercase and trim whitespace (`lower(trim(email))`). Emails MUST be unique within the organization among non-archived customers when provided (`WHERE status <> 'archived'`).
- **CUS-004**: System MUST trim and validate customer phones against E.164 regex (`^\+[1-9]\d{6,14}$`). Phones MUST be unique within the organization among non-archived customers when provided (`WHERE status <> 'archived'`).
- **CUS-005**: System MUST allow users with `customers:read` to search active customers by name, phone, or email with server-side pagination and debounce.
- **CUS-006**: System MUST allow users with `customers:update` to modify customer contact details and notes via trusted procedure `public.update_customer`. If a customer is reactivated from `archived` to `active`, uniqueness constraints on phone and email MUST be re-verified; if a collision exists with an active record, update MUST fail with `CUSTOMER_PHONE_EXISTS` or `CUSTOMER_EMAIL_EXISTS` (`23505`).
- **CUS-007**: System MUST allow users with `customers:archive` to soft-delete (archive) a customer (`status = 'archived'`) via `public.archive_customer`.
- **CUS-008**: System MUST strictly prohibit hard deletion of customer records that have associated historical sales or returns (`CUSTOMER_HAS_SALES_DELETE_BLOCKED`, SQLSTATE `P0042`).
- **CUS-009**: System MUST allow sales without an associated customer record (`customer_id = NULL`) to support walk-in guest transactions.
- **CUS-010**: System MUST allow cashiers to create a customer inline during checkout by calling `public.create_customer` and attaching the returned `customer_id` to the active cart without losing cart state.

#### B. Sales Lifecycle & POS Cart
- **SAL-001**: POS cart state prior to checkout completion MUST be managed as client-side session state; unfinished carts MUST NOT be persisted as database records. The `public.sales` table MUST store only committed transactions with status `completed`, `voided`, `partially_returned`, or `returned`.
- **SAL-002**: System MUST validate that each line item quantity is strictly positive (`quantity > 0.0000`) and does not exceed maximum allowable quantity (`999,999,999.9999`, SQLSTATE `P0028`).
- **SAL-003**: System MUST enforce unit-of-measure (UOM) precision rules from Feature 004 (discrete UOMs such as `unit`, `piece`, `box` must be whole integers, SQLSTATE `P0015`; continuous UOMs such as `kg`, `meter`, `liter` permit up to 4 decimal places, SQLSTATE `P0016`).
- **SAL-004**: System MUST look up server-authoritative `unit_price` from `public.products.selling_price` at the moment of checkout; client-supplied unit prices MUST be completely ignored or rejected.
- **SAL-005**: System MUST look up server-authoritative `unit_cost` from `public.product_costs.cost_price` at the moment of checkout. If no cost price exists in `public.product_costs`, `sale_items.unit_cost` MUST be set to `NULL` (unknown cost); it MUST NOT be silently converted to `0.0000`.
- **SAL-006**: System MUST calculate line item gross subtotal as `quantity * unit_price`. Cashiers with `sales:create` can apply line discounts directly up to the gross line total (`line_discount_amount <= quantity * unit_price`), preventing negative line totals (`DISCOUNT_EXCEEDS_MAXIMUM`, SQLSTATE `P0047`).
- **SAL-007**: System MUST calculate sale `subtotal` as the exact sum of all line item gross subtotals minus line discounts before order discounts and taxes.
- **SAL-008**: System MUST calculate `total_amount = subtotal - order_discount_amount + tax_amount` (tax-exclusive) or `total_amount = subtotal - order_discount_amount` (tax-inclusive). Order-level discounts applied by cashiers are bounded by the subtotal (`order_discount_amount <= subtotal`), guaranteeing `total_amount >= 0.0000`.
- **SAL-009**: System MUST generate sequential, unique `sale_number` atomically inside the database transaction using an organization-scoped counter table (`public.sale_sequences`) dated according to the organization's configured IANA timezone (`public.organizations.timezone`) formatted as `SAL-{YYYYMMDD}-{XXXX}` (e.g., `SAL-20261117-0001`). Numbers are unique and sequentially allocated; voids preserve their numbers and numbers are not reused. Client-supplied sale numbers MUST NOT be accepted.
- **SAL-010**: System MUST execute sale completion inside a single atomic PostgreSQL transaction function (`public.execute_sale`).
- **SAL-011**: System MUST record the cashier user ID (`created_by REFERENCES profiles(id)`) derived from `auth.uid()` for every completed sale.
- **SAL-012**: System MUST allow users with `sales:read` to view sale lists, filter by date range, customer, cashier, and status, and view detailed sale receipts.
- **SAL-013**: System MUST allow users with `sales:void` (Owner, Admin, Manager) to void a completed sale that has no returns via `public.void_sale`, atomically reversing stock deductions and creating balancing reversal records in `public.refunds`.
- **SAL-014**: System MUST strictly prohibit modification or deletion of completed sale records once committed.
- **SAL-015**: Each sale item MUST reference its associated inventory stock deduction movement via foreign key `sale_items.movement_id REFERENCES public.stock_movements(id) ON DELETE RESTRICT`.

#### C. Payment Processing
- **PAY-001**: System MUST record payment records in `public.payments` linked to the sale and scoped to the organization via composite foreign key `(organization_id, sale_id) REFERENCES public.sales (organization_id, id)`.
- **PAY-002**: System MUST support standard payment methods: `'cash'`, `'card'`, `'bank_transfer'`, and `'other'`.
- **PAY-003**: System MUST permit split payments where multiple payment records satisfy the sale total.
- **PAY-004**: System MUST verify that `sum(payments.amount) == sales.total_amount` before allowing a sale to commit (`PAYMENT_INCOMPLETE`, SQLSTATE `P0045`).
- **PAY-005**: For `'cash'` payments, system MUST support recording `amount_tendered` and calculating `change_due = amount_tendered - amount`.
- **PAY-006**: For non-cash payment methods (`'card'`, `'bank_transfer'`, `'other'`), system MUST strictly prohibit `amount_tendered > amount` (`PAYMENT_EXCEEDS_PAYABLE_AMOUNT`, SQLSTATE `P0046`), and MUST require a non-empty `reference_no` (`PAYMENT_REFERENCE_REQUIRED`, SQLSTATE `P0057`).
- **PAY-007**: System MUST enforce tenant-scoped reference uniqueness on non-cash payments: `UNIQUE (organization_id, payment_method, reference_no) WHERE reference_no IS NOT NULL` (`23505`) to prevent duplicate transaction recording.
- **PAY-008**: System MUST set `sales.payment_status` to `'paid'` upon sale completion.
- **PAY-009**: System MUST enforce that `public.payments` records are insert-only and immutable; payment records MUST NOT be modified or deleted.
- **PAY-010**: Checkout idempotency canonicalization MUST deterministically normalize payment objects before canonical JSON serialization and hashing. Optional `reference_no` values MUST be normalized such that missing, null, empty (`""`), or whitespace-only strings are uniformly converted to JSON `null` (`NULLIF(trim(reference_no), '')`). Normalized payment objects MUST be constructed with consistent key structure and sorted deterministically across all five material discriminating fields (`payment_method ASC`, `amount ASC`, `amount_tendered ASC`, `change_due ASC`, and `reference_no ASC NULLS LAST`), ensuring that reordered arrays or equivalent representations of optional fields produce identical SHA-256 hashes, while conflicting tender variations trigger `IDEMPOTENCY_CONFLICT` (`P0024`).

#### D. Returns, Refunds & Restocking
- **RET-001**: System MUST allow users with `returns:create` to initiate a return against a completed sale via atomic RPC `public.execute_sale_return`.
- **RET-002**: System MUST require a valid return reason (minimum 3 characters, max 255 characters, SQLSTATE `P0053`).
- **RET-003**: Returns MUST be itemized at the line-item level referencing original `sale_items.id`. Duplicate lines for the same `sale_item_id` in a single return submission are rejected (`DUPLICATE_RETURN_ITEM`, SQLSTATE `P0060`).
- **RET-004**: System MUST enforce that returned quantity for any line item cannot exceed `sale_items.quantity - previously_returned_quantity` (`RETURN_QUANTITY_EXCEEDS_SOLD`, SQLSTATE `P0052`). Return eligibility is governed strictly by operator authorization (`returns:create`) and remaining unreturned quantity, without enforcing an automated hardcoded calendar cutoff.
- **RET-005**: System MUST allow the operator to specify whether returned goods are restored to inventory (`restock_to_inventory = true`) or written off (`restock_to_inventory = false`).
- **RET-006**: If `restock_to_inventory = true`, system MUST atomically call `_execute_inventory_mutation_core` with `movement_type = 'return'` and positive quantity delta with reference `return:{return_id}`.
- **RET-007**: Refunds MUST NOT be recorded as negative rows in `public.payments`. System MUST persist customer reimbursements in a dedicated `public.refunds` table linking to `sale_returns.id` and `sales.id` with positive amounts and audited refund methods.
- **RET-008**: Partial return refund calculations MUST proportionally allocate line discounts, order discounts, and taxes according to the authoritative mathematical formulas in Section 6, absorbing rounding residuals on the final return line.
- **RET-009**: System MUST update parent sale status to `'returned'` (if 100% of items returned) or `'partially_returned'` (if < 100% returned), and update payment status to `'refunded'` or `'partially_refunded'`.
- **RET-010**: System MUST generate sequential `return_number` atomically inside the transaction formatted as `RET-{YYYYMMDD}-{XXXX}` based on organization timezone.
- **RET-011**: System MUST require a mandatory client UUID `idempotency_key` for every return transaction (`IDEMPOTENCY_KEY_REQUIRED`, SQLSTATE `P0055`) to prevent duplicate restocking or refund disbursements on retries.
- **RET-012**: Every refund record MUST maintain an immutable `obligation_refund_id UUID NOT NULL` column. Original refunds (created during void or return) set `obligation_refund_id = id` (self-referencing). Replacement refunds created via `issue_replacement_refund` inherit `obligation_refund_id` from their failed parent's obligation root. The database MUST enforce that at most one active attempt (`status IN ('pending', 'completed')`) exists per obligation via partial unique index `UNIQUE (organization_id, obligation_refund_id) WHERE status IN ('pending', 'completed')`. Attempting to issue a replacement when an active attempt is pending raises `REPLACEMENT_REFUND_ALREADY_EXISTS` (`P0064`); attempting a replacement when the obligation is already completed raises `OBLIGATION_ALREADY_COMPLETED` (`P0067`).
- **RET-013**: Refunds MUST enforce composite foreign key integrity to prevent cross-sale linking: `fk_refunds_org_sale_return (organization_id, sale_id, return_id) REFERENCES sale_returns (organization_id, sale_id, id)` and `fk_refunds_org_sale_parent (organization_id, sale_id, parent_refund_id) REFERENCES refunds (organization_id, sale_id, id)`. When `return_id` or `parent_refund_id` is NULL (e.g. for void refunds or original returns), PostgreSQL composite foreign key semantics cleanly skip verification.
- **RET-014**: Reimbursement confirmation via `confirm_refund_reimbursement` MUST enforce organization-scoped idempotency. If an idempotency key has already been used on a different refund within the same tenant, the procedure MUST raise `IDEMPOTENCY_CONFLICT` (SQLSTATE `P0024`, HTTP 409) under transaction advisory lock rather than allowing a raw database unique constraint exception (`23505`) to leak to the caller.

#### E. Inventory Integration (Feature 004 Contract)
- **INV-001**: Checkout transactions MUST deduct stock by invoking Feature 004's internal function `_execute_inventory_mutation_core(p_org_id, p_product_id, 'sale', -abs(quantity), 'Sale ' || sale_number, 'sale:' || sale_id, NULL, NULL, auth.uid(), expected_version)` directly within the same database transaction.
- **INV-002**: Checkout procedures MUST acquire product row locks in deterministic ascending `product_id` order (`SELECT ... FROM inventory WHERE organization_id = p_org_id AND product_id = ANY(sorted_product_ids) ORDER BY product_id ASC FOR UPDATE`) to guarantee zero ABBA deadlocks across concurrent POS terminals.
- **INV-003**: If any line item has insufficient inventory balance (`balance < quantity`), the database MUST raise SQLSTATE `P0011` (`INSUFFICIENT_STOCK`) and rollback the entire checkout transaction atomically.
- **INV-004**: Every stock deduction MUST produce a corresponding record in `public.stock_movements` with `movement_type = 'sale'` and negative `quantity_delta`.
- **INV-005**: Every return with `restock_to_inventory = true` MUST produce a corresponding record in `public.stock_movements` with `movement_type = 'return'` and positive `quantity_delta`.
- **INV-006**: Every voided sale MUST produce corresponding stock movement records of type `return` restoring deducted quantities with reference `void:{sale_id}`.
- **INV-007**: Client-side code and public APIs MUST NOT be granted direct access to call `_execute_inventory_mutation_core`. All mutations must occur through the trusted `execute_sale`, `void_sale`, or `execute_sale_return` database RPCs running as `postgres`.
- **INV-008**: Inactive products MUST be blocked from sales with `PRODUCT_INACTIVE_SALE_BLOCKED` (SQLSTATE `P0031`); archived products MUST be blocked with `PRODUCT_ARCHIVED_STOCK_FORBIDDEN` (SQLSTATE `P0021`). Inactive products undergoing return with restock MUST be blocked with `PRODUCT_INACTIVE_RETURN_BLOCKED` (SQLSTATE `P0056`).

#### F. Security & Multi-Tenancy
- **SEC-001**: Every customer, tax setting, sale, sale item, payment, return, and refund table MUST include an `organization_id UUID NOT NULL` column with composite foreign keys to the parent organization.
- **SEC-002**: Every Feature 005 table MUST enable and force Row-Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
- **SEC-003**: Cross-tenant queries MUST be strictly impossible under RLS; policies MUST verify `public.check_user_permission(organization_id, auth.uid(), '<permission>')` or `public.is_org_member(organization_id, auth.uid())`. System MUST NOT rely on `auth.jwt() ->> 'organization_id'`.
- **SEC-004**: Server-side tenant resolution MUST resolve tenant context via `resolveTenantContext(slug)`. The `bizflow_active_org` cookie MUST NEVER be trusted as authorization evidence.
- **SEC-005**: In strict accordance with Feature 004 security policy, viewing unit cost data on `sale_items.unit_cost` and sales valuation/margin reports MUST require BOTH `inventory:read_valuation` AND `products:read_cost` permissions. Cashier API projections lacking either permission MUST mask `unit_cost` as `null`.
- **SEC-006**: POS Cashier role MUST be granted only: `customers:read`, `customers:create`, `customers:update`, `sales:read`, `sales:create`, `payments:read`, `returns:read`.
- **SEC-007**: Privileged operations (`sales:void`, `customers:archive`, `returns:create`, `refunds:read`) MUST be restricted to Store Manager, Admin, and Owner roles.
- **SEC-008**: Direct client INSERT, UPDATE, or DELETE on `public.customers`, `public.organization_tax_settings`, `public.sales`, `public.sale_items`, `public.payments`, `public.sale_returns`, `public.sale_return_items`, and `public.refunds` MUST be denied by RLS policies; mutations must execute through verified `SECURITY DEFINER` stored procedures.

#### G. Financial Precision & Calculations
- **FIN-001**: All monetary values (`unit_price`, `unit_cost`, `subtotal`, `tax_amount`, `order_discount_amount`, `line_discount_amount`, `total_amount`, `payment.amount`, `refund_amount`) MUST use PostgreSQL `NUMERIC(14, 4)` precision.
- **FIN-002**: Monetary rounding MUST use round-half-up semantics (`ROUND(value, exponent)`) based on the organization's currency exponent retrieved via `public.get_currency_exponent(organization_currency)`.
- **FIN-003**: Floating-point mathematics (`number` in JavaScript/TypeScript) MUST NOT be used for financial storage or authoritative calculations; all calculations must use Decimal libraries (such as `decimal.js` or `big.js`) on the client and `NUMERIC` in SQL.
- **FIN-004**: Negative unit prices or negative tender amounts MUST be rejected with error `INVALID_FINANCIAL_AMOUNT` (SQLSTATE `P0007`).
- **FIN-005**: Tax calculation MUST be computed on the server using organization tax settings from `public.organization_tax_settings`. If no tax setting exists, tax rate defaults to `0.0000%` (`tax_amount = 0.0000`). Client-supplied tax amounts MUST NOT be trusted.
- **FIN-006**: Historical sale line items and sales headers MUST snapshot the tax mode (`is_tax_inclusive`), tax rate, tax name, and allocated tax amount, insulating historical records from future tax policy changes.
- **FIN-007**: Cumulative refunds for any sale MUST NOT exceed `sales.total_amount` (`REFUND_EXCEEDS_PAYABLE`, SQLSTATE `P0054`).

#### H. Non-Functional Requirements (NFR)
- **NFR-001 (Performance)**: p95 database execution time for atomic checkout RPC (`execute_sale`) MUST be < 120 ms for carts up to 20 items.
- **NFR-002 (Throughput)**: POS checkout API MUST support sustained 50 checkouts per second per organization without row lock timeouts.
- **NFR-003 (Idempotency)**: Database RPCs MUST acquire transaction-scoped advisory locks on `(hashtext(p_org_id::text), hashtext(p_idempotency_key::text))` and generate canonical payload hashes internally using deterministic JSON formatting (sorting item array elements by `product_id` and payment elements by `payment_method`) to safely handle retries and prevent duplicate records.
- **NFR-004 (Auditability)**: System MUST record audit log entries for all sale completions, voids, customer archival, and return/refund issuances with user ID and timestamp.
- **NFR-005 (Thermal Print Standard)**: Thermal receipt output MUST format cleanly for standard 80mm and 58mm ESC/POS printers and modern web print dialogs.

---

### Key Entities

```
+---------------------------------------------------------------------------------+
|                         ORGANIZATION_TAX_SETTINGS                               |
+---------------------------------------------------------------------------------+
| organization_id  | UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASC |
| tax_name         | TEXT NOT NULL DEFAULT 'VAT' CHECK (length(trim(tax_name)) >= 1)
| default_tax_rate | NUMERIC(6, 4) NOT NULL DEFAULT 0.0000 CHECK (rate BETWEEN 0 AND 100)
| is_tax_inclusive | BOOLEAN NOT NULL DEFAULT false                              |
| updated_at       | TIMESTAMPTZ NOT NULL DEFAULT now()                           |
| updated_by       | UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT     |
+---------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------+
|                                 CUSTOMERS                                       |
+---------------------------------------------------------------------------------+
| id              | UUID PRIMARY KEY DEFAULT gen_random_uuid()                   |
| organization_id | UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE |
| name            | TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 255)   |
| phone           | TEXT NULL CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{6,14}$')|
| email           | TEXT NULL CHECK (email IS NULL OR email ~ '^.+@.+$')         |
| notes           | TEXT NULL CHECK (length(notes) <= 1000)                      |
| status          | TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
| created_at      | TIMESTAMPTZ NOT NULL DEFAULT now()                           |
| updated_at      | TIMESTAMPTZ NOT NULL DEFAULT now()                           |
+---------------------------------------------------------------------------------+
| CONSTRAINT uq_customers_org_id UNIQUE (organization_id, id)                    |
| UNIQUE (organization_id, phone) WHERE status <> 'archived' AND phone IS NOT NULL|
| UNIQUE (organization_id, email) WHERE status <> 'archived' AND email IS NOT NULL|
+---------------------------------------------------------------------------------+
                                      | 1
                                      | 
                                      | 0..*
+---------------------------------------------------------------------------------+
|                                   SALES                                         |
+---------------------------------------------------------------------------------+
| id                    | UUID PRIMARY KEY DEFAULT gen_random_uuid()             |
| organization_id       | UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
| sale_number           | TEXT NOT NULL                                          |
| customer_id           | UUID NULL                                              |
| created_by            | UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT
| subtotal              | NUMERIC(14, 4) NOT NULL CHECK (subtotal >= 0)          |
| order_discount_amount | NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (amt >= 0)|
| is_tax_inclusive      | BOOLEAN NOT NULL DEFAULT false                         |
| tax_rate              | NUMERIC(6, 4) NOT NULL DEFAULT 0.0000 CHECK (rate >= 0)|
| tax_name              | TEXT NOT NULL DEFAULT 'None'                           |
| tax_amount            | NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (amt >= 0)|
| total_amount          | NUMERIC(14, 4) NOT NULL CHECK (total_amount >= 0)      |
| currency              | TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$')          |
| status                | TEXT NOT NULL DEFAULT 'completed'                      |
|                       | CHECK (status IN ('completed','voided','partially_returned','returned'))
| payment_status        | TEXT NOT NULL DEFAULT 'paid'                           |
|                       | CHECK (payment_status IN ('paid','partially_refunded','refunded'))
| idempotency_key       | UUID NOT NULL                                          |
| idempotency_hash      | TEXT NOT NULL                                          |
| void_idempotency_key  | UUID NULL                                              |
| void_idempotency_hash | TEXT NULL                                              |
| voided_at             | TIMESTAMPTZ NULL                                       |
| voided_by             | UUID NULL REFERENCES profiles(id) ON DELETE RESTRICT   |
| void_reason           | TEXT NULL                                              |
| notes                 | TEXT NULL                                              |
| created_at            | TIMESTAMPTZ NOT NULL DEFAULT now()                     |
| updated_at            | TIMESTAMPTZ NOT NULL DEFAULT now()                     |
+---------------------------------------------------------------------------------+
| CONSTRAINT uq_sales_org_id UNIQUE (organization_id, id)                        |
| CONSTRAINT fk_sales_org_customer FOREIGN KEY (organization_id, customer_id)     |
|   REFERENCES customers (organization_id, id) ON DELETE RESTRICT                |
| UNIQUE (organization_id, sale_number)                                           |
| UNIQUE (organization_id, idempotency_key)                                       |
| UNIQUE (organization_id, void_idempotency_key)                                  |
|   WHERE void_idempotency_key IS NOT NULL                                        |
+---------------------------------------------------------------------------------+
         | 1                                               | 1
         |                                                 |
         | 1..*                                            | 1..*
+-------------------------------------------+   +---------------------------------+
|                SALE_ITEMS                 |   |            PAYMENTS             |
+-------------------------------------------+   +---------------------------------+
| id                   | UUID PRIMARY KEY   |   | id             | UUID PRIMARY KEY|
| organization_id      | UUID NOT NULL      |   | organization_id| UUID NOT NULL   |
| sale_id              | UUID NOT NULL      |   | sale_id        | UUID NOT NULL   |
| product_id           | UUID NOT NULL      |   | payment_method | TEXT NOT NULL   |
| quantity             | NUMERIC(14, 4) > 0 |   |                | ('cash','card', |
| unit_price           | NUMERIC(14, 4) >= 0|   |                |  'bank_transfer'|
| unit_cost            | NUMERIC(14, 4) NULL|   |                |  ,'other')      |
| line_discount_amount | NUMERIC(14, 4) >= 0|   | amount         | NUMERIC(14, 4)  |
| allocated_order_disc | NUMERIC(14, 4) >= 0|   | amount_tendered| NUMERIC(14, 4)  |
| taxable_amount       | NUMERIC(14, 4) >= 0|   | change_due     | NUMERIC(14, 4)  |
| allocated_tax_amount | NUMERIC(14, 4) >= 0|   | reference_no   | TEXT NULL       |
| total_price          | NUMERIC(14, 4) >= 0|   | status         | TEXT NOT NULL   |
| movement_id          | UUID NOT NULL REFS |   | created_at     | TIMESTAMPTZ     |
|                      | stock_movements(id)|   +---------------------------------+
| created_at           | TIMESTAMPTZ NOT NULL   | CONSTRAINT fk_payments_org_sale |
+-------------------------------------------+   |   FOREIGN KEY (organization_id, |
| CONSTRAINT uq_sale_items_org_id           |   |                sale_id)         |
|   UNIQUE (organization_id, id)           |   |   REFERENCES sales              |
| CONSTRAINT uq_sale_items_org_sale_item_prod|   |   (organization_id, id)         |
|   UNIQUE (organization_id, sale_id,       |   | UNIQUE (organization_id,        |
|           id, product_id)                 |   |         payment_method,         |
| CONSTRAINT fk_sale_items_org_sale         |   |         reference_no)           |
|   FOREIGN KEY (organization_id, sale_id)  |   |   WHERE reference_no IS NOT NULL|
|   REFERENCES sales (organization_id, id)  |   +---------------------------------+
|   ON DELETE CASCADE                       |
| CONSTRAINT fk_sale_items_org_product      |
|   FOREIGN KEY (organization_id,product_id)|
|   REFERENCES products (organization_id,id)|
|   ON DELETE RESTRICT                      |
| UNIQUE (sale_id, product_id)              |
+-------------------------------------------+
         | 1
         | 
         | 0..*
+---------------------------------------------------------------------------------+
|                                 SALE_RETURNS                                    |
+---------------------------------------------------------------------------------+
| id                   | UUID PRIMARY KEY DEFAULT gen_random_uuid()               |
| organization_id      | UUID NOT NULL REFERENCES organizations(id)               |
| sale_id              | UUID NOT NULL                                            |
| return_number        | TEXT NOT NULL                                            |
| reason               | TEXT NOT NULL CHECK (length(trim(reason)) >= 3)          |
| total_refund_amount  | NUMERIC(14, 4) NOT NULL CHECK (total_refund_amount >= 0) |
| idempotency_key      | UUID NOT NULL                                            |
| idempotency_hash     | TEXT NOT NULL                                            |
| created_by           | UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT |
| created_at           | TIMESTAMPTZ NOT NULL DEFAULT now()                       |
+---------------------------------------------------------------------------------+
| CONSTRAINT uq_sale_returns_org_id UNIQUE (organization_id, id)                  |
| CONSTRAINT uq_sale_returns_org_sale_id UNIQUE (organization_id, sale_id, id)    |
| CONSTRAINT fk_sale_returns_org_sale FOREIGN KEY (organization_id, sale_id)      |
|   REFERENCES sales (organization_id, id) ON DELETE RESTRICT                    |
| UNIQUE (organization_id, return_number)                                         |
| UNIQUE (organization_id, idempotency_key)                                       |
+---------------------------------------------------------------------------------+
         | 1                                               | 1
         |                                                 |
         | 1..*                                            | 1..*
+-------------------------------------------+   +---------------------------------+
|             SALE_RETURN_ITEMS             |   |             REFUNDS             |
+-------------------------------------------+   +---------------------------------+
| id                   | UUID PRIMARY KEY   |   | id             | UUID PRIMARY KEY|
| organization_id      | UUID NOT NULL      |   | organization_id| UUID NOT NULL   |
| return_id            | UUID NOT NULL      |   | return_id      | UUID NULL       |
| sale_id              | UUID NOT NULL      |   | sale_id        | UUID NOT NULL   |
| sale_item_id         | UUID NOT NULL      |   | refund_method  | TEXT NOT NULL   |
| product_id           | UUID NOT NULL      |   | amount         | NUMERIC(14, 4)  |
| quantity             | NUMERIC(14, 4) > 0 |   | reference_no   | TEXT NULL       |
| refund_amount        | NUMERIC(14, 4) >= 0|   | status         | TEXT NOT NULL   |
| restock_to_inventory | BOOLEAN NOT NULL   |   |                | ('completed',   |
| movement_id          | UUID NULL REFS     |   |                |  'pending',     |
|                      | stock_movements(id)|   |                |  'failed')      |
| created_at           | TIMESTAMPTZ NOT NULL   | reason         | TEXT NOT NULL   |
+-------------------------------------------+   | processed_by   | UUID NOT NULL   |
| CONSTRAINT fk_return_items_org_return_sale|   | created_at     | TIMESTAMPTZ     |
|   FOREIGN KEY (organization_id, sale_id,  |   | updated_at     | TIMESTAMPTZ     |
|                return_id)                 |   | confirmation_  | UUID NULL       |
|   REFERENCES sale_returns                 |   |   idempotency_key                |
|   (organization_id, sale_id, id)          |   | confirmation_  | TEXT NULL       |
|   ON DELETE CASCADE                       |   |   idempotency_hash               |
| CONSTRAINT fk_return_items_org_sale_item_ |   | parent_refund_ | UUID NULL       |
|   prod FOREIGN KEY (organization_id,      |   |   id                             |
|                sale_id, sale_item_id,     |   | obligation_    | UUID NOT NULL   |
|                product_id)                |   |   refund_id    |                 |
|   REFERENCES sale_items                   |   | idempotency_   | UUID NULL       |
|   (organization_id, sale_id, id,          |   |   key                            |
|    product_id) ON DELETE RESTRICT         |   | idempotency_   | TEXT NULL       |
| UNIQUE (return_id, sale_item_id)          |   |   hash                           |
+-------------------------------------------+   +---------------------------------+
                                                | CONSTRAINT uq_refunds_org_id    |
                                                |   UNIQUE (organization_id, id)  |
                                                | CONSTRAINT uq_refunds_org_sale_id|
                                                |   UNIQUE (organization_id,      |
                                                |           sale_id, id)          |
                                                | CONSTRAINT fk_refunds_org_sale  |
                                                |   FOREIGN KEY (organization_id, |
                                                |                sale_id)         |
                                                |   REFERENCES sales              |
                                                |   (organization_id, id)         |
                                                | CONSTRAINT                      |
                                                |  fk_refunds_org_sale_return     |
                                                |   FOREIGN KEY (organization_id, |
                                                |   sale_id, return_id)           |
                                                |   REFERENCES sale_returns       |
                                                |   (organization_id, sale_id, id)|
                                                |   [NULL return_id skips FK]     |
                                                | CONSTRAINT                      |
                                                |  fk_refunds_org_sale_parent     |
                                                |   FOREIGN KEY (organization_id, |
                                                |   sale_id, parent_refund_id)    |
                                                |   REFERENCES refunds            |
                                                |   (organization_id, sale_id, id)|
                                                |   ON DELETE RESTRICT            |
                                                |   [NULL parent_id skips FK]     |
                                                | CONSTRAINT                      |
                                                |  fk_refunds_org_obligation      |
                                                |   FOREIGN KEY (organization_id, |
                                                |   obligation_refund_id)         |
                                                |   REFERENCES refunds            |
                                                |   (organization_id, id)         |
                                                | UNIQUE (organization_id,        |
                                                |   obligation_refund_id) WHERE   |
                                                |   status IN ('pending',         |
                                                |   'completed')                  |
                                                | UNIQUE (organization_id,        |
                                                |   confirmation_idempotency_key) |
                                                |   WHERE confirmation_           |
                                                |   idempotency_key IS NOT NULL   |
                                                | UNIQUE (organization_id,        |
                                                |   idempotency_key) WHERE        |
                                                |   idempotency_key IS NOT NULL   |
                                                +---------------------------------+

+---------------------------------------------------------------------------------+
|                                SALE_SEQUENCES                                   |
+---------------------------------------------------------------------------------+
| organization_id | UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE  |
| sequence_type   | TEXT NOT NULL CHECK (sequence_type IN ('sale', 'return'))     |
| date_key        | DATE NOT NULL                                                 |
| last_number     | INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0)           |
| created_at      | TIMESTAMPTZ NOT NULL DEFAULT now()                            |
| updated_at      | TIMESTAMPTZ NOT NULL DEFAULT now()                            |
+---------------------------------------------------------------------------------+
| PRIMARY KEY (organization_id, sequence_type, date_key)                          |
+---------------------------------------------------------------------------------+
```

---

## Binding Implementation Constraints (inputs to /plan)

### 1. Database Transaction Architecture: Complete RPC Contracts

#### A. `public.execute_sale` RPC
```sql
CREATE OR REPLACE FUNCTION public.execute_sale(
    p_org_id UUID,
    p_customer_id UUID,
    p_items JSONB,
    p_payments JSONB,
    p_order_discount_amount NUMERIC,
    p_idempotency_key UUID,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale(UUID, UUID, JSONB, JSONB, NUMERIC, UUID, TEXT) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authentication & Membership Guard**:
   - Verify `auth.uid() IS NOT NULL` (else `08001 UNAUTHENTICATED`).
   - Verify `public.is_org_member(p_org_id, auth.uid())` (else `P0002 MEMBERSHIP_INACTIVE`).
   - Verify `public.check_user_permission(p_org_id, auth.uid(), 'sales:create')` (else `42501 INSUFFICIENT_PERMISSIONS`).
2. **Mandatory Idempotency & Advisory Locking**:
   - Verify `p_idempotency_key IS NOT NULL` (else `ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED'`).
   - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));`
   - Build sales canonical payload string using structured JSONB canonicalization, sorting items by `product_id` ASC and payments by `payment_method` ASC, `reference_no` ASC, and `amount` ASC:
     ```sql
     -- Sort items array deterministically
     SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'product_id')::UUID ASC), '[]'::jsonb)
     INTO v_sorted_items
     FROM jsonb_array_elements(p_items) elem;

     -- Normalize and sort payments array deterministically over ALL material fields
     -- to prevent hash collisions between payment objects that differ in amount_tendered,
     -- change_due, or alternative representations of optional reference_no (NULL vs "" vs omitted).
     -- Missing, null, empty (""), and whitespace-only reference_no values are strictly normalized
     -- to SQL NULL / JSON null via NULLIF(trim(...), '') before sorting with NULLS LAST.
     SELECT coalesce(jsonb_agg(
         jsonb_build_object(
             'amount', to_char((elem->>'amount')::NUMERIC, 'FM9999999990.0000'),
             'amount_tendered', to_char((elem->>'amount_tendered')::NUMERIC, 'FM9999999990.0000'),
             'change_due', to_char((elem->>'change_due')::NUMERIC, 'FM9999999990.0000'),
             'payment_method', lower(trim(elem->>'payment_method')),
             'reference_no', NULLIF(trim(elem->>'reference_no'), '')
         )
         ORDER BY
             lower(trim(elem->>'payment_method')) ASC,
             (elem->>'amount')::NUMERIC ASC,
             (elem->>'amount_tendered')::NUMERIC ASC,
             (elem->>'change_due')::NUMERIC ASC,
             NULLIF(trim(elem->>'reference_no'), '') ASC NULLS LAST
     ), '[]'::jsonb)
     INTO v_sorted_payments
     FROM jsonb_array_elements(p_payments) elem;

     v_canonical_jsonb := jsonb_build_object(
         'customer_id', p_customer_id::text,
         'items', v_sorted_items,
         'notes', trim(p_notes),
         'order_discount_amount', to_char(coalesce(p_order_discount_amount, 0), 'FM9999999990.0000'),
         'organization_id', p_org_id::text,
         'payments', v_sorted_payments
     );
     v_canonical_hash := encode(sha256(convert_to(v_canonical_jsonb::text, 'UTF8')), 'hex');
     ```
   - Check `public.sales WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key`.
   - If found:
     - If `idempotency_hash = v_canonical_hash`: return stored sale JSON immediately (`is_replay = true`).
     - If `idempotency_hash <> v_canonical_hash`: raise `ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT'`.
3. **Cart & Item Validation**:
   - Verify `jsonb_array_length(p_items) > 0` (else `P0043 SALE_EMPTY_CART`).
   - Verify all `product_id` values in `p_items` are distinct (else `P0044 DUPLICATE_CART_PRODUCT`).
4. **Deterministic Ascending Row Locks**:
   - Extract distinct `product_id`s from `p_items`, sort ascending alphanumeric:
     ```sql
     SELECT array_agg(DISTINCT (elem->>'product_id')::UUID ORDER BY (elem->>'product_id')::UUID ASC)
     INTO v_sorted_product_ids
     FROM jsonb_array_elements(p_items) elem;

     PERFORM id FROM public.products WHERE organization_id = p_org_id AND id = ANY(v_sorted_product_ids) ORDER BY id ASC FOR SHARE;
     PERFORM id FROM public.inventory WHERE organization_id = p_org_id AND product_id = ANY(v_sorted_product_ids) ORDER BY product_id ASC FOR UPDATE;
     ```
5. **Customer Verification**:
   - If `p_customer_id IS NOT NULL`: verify exists in `public.customers` (`P0040 CUSTOMER_NOT_FOUND`), verify `status <> 'archived'` (`P0041 CUSTOMER_ARCHIVED`).
6. **Server Pricing, Cost, Tax Mode & Subtotal Calculation**:
   - Query `public.organization_tax_settings WHERE organization_id = p_org_id` (default `tax_rate := 0.0000`, `tax_name := 'None'`, `is_tax_inclusive := false`).
   - Query currency exponent: `v_decimals := public.get_currency_exponent(v_currency)`.
   - For each item:
     - Verify product is active and not archived (`P0031 PRODUCT_INACTIVE_SALE_BLOCKED`, `P0021 PRODUCT_ARCHIVED_STOCK_FORBIDDEN`).
     - Sourced `selling_price` from `public.products.selling_price`.
     - Sourced `cost_price` from `public.product_costs.cost_price` (or `NULL` if not recorded).
     - Validate line discount `0 <= line_discount_amount <= (quantity * selling_price)` (else `P0047 DISCOUNT_EXCEEDS_MAXIMUM`).
     - Calculate `line_gross_net = round((quantity * selling_price) - line_discount_amount, v_decimals)`.
     - Accumulate `v_subtotal`.
7. **Order Discount & Sourced Tax Calculation**:
   - Validate `0 <= p_order_discount_amount <= v_subtotal` (else `P0047 DISCOUNT_EXCEEDS_MAXIMUM`).
   - If `v_subtotal = 0.0000`: `v_taxable_subtotal := 0.0000; v_tax_amount := 0.0000; v_total_amount := 0.0000;`
   - Else if `is_tax_inclusive = false` (Tax-Exclusive):
     - `v_taxable_subtotal := v_subtotal - p_order_discount_amount`.
     - `v_tax_amount := round(v_taxable_subtotal * (v_tax_rate / 100), v_decimals)`.
     - `v_total_amount := v_taxable_subtotal + v_tax_amount`.
   - Else if `is_tax_inclusive = true` (Tax-Inclusive):
     - `v_total_amount := v_subtotal - p_order_discount_amount`.
     - `v_taxable_subtotal := round(v_total_amount / (1 + (v_tax_rate / 100)), v_decimals)`.
     - `v_tax_amount := v_total_amount - v_taxable_subtotal`.
8. **Payment Validation**:
   - Verify `sum(payments.amount) == v_total_amount` (else `P0045 PAYMENT_INCOMPLETE` or `P0046 PAYMENT_EXCEEDS_PAYABLE_AMOUNT`).
   - For cash: verify `amount_tendered >= amount`; calculate `change_due := amount_tendered - amount`.
   - For non-cash (`'card'`, `'bank_transfer'`, `'other'`): verify `amount_tendered == amount`, verify `reference_no IS NOT NULL AND length(trim(reference_no)) > 0` (else `P0057 PAYMENT_REFERENCE_REQUIRED`).
9. **Organization-Timezone Sequence Generation**:
   - Query `timezone` from `public.organizations WHERE id = p_org_id` (default `'UTC'`).
   - Sourced date: `v_org_date := (now() AT TIME ZONE v_org_timezone)::DATE`.
   - Update `public.sale_sequences`:
     ```sql
     INSERT INTO public.sale_sequences (organization_id, sequence_type, date_key, last_number)
     VALUES (p_org_id, 'sale', v_org_date, 1)
     ON CONFLICT (organization_id, sequence_type, date_key)
     DO UPDATE SET last_number = sale_sequences.last_number + 1, updated_at = now()
     RETURNING last_number INTO v_seq_num;
     v_sale_number := 'SAL-' || to_char(v_org_date, 'YYYYMMDD') || '-' || lpad(v_seq_num::text, 4, '0');
     ```
10. **Insert `public.sales`**:
    - Insert sale record with `status = 'completed'`, `payment_status = 'paid'`, `idempotency_key = p_idempotency_key`, `idempotency_hash = v_canonical_hash`, `is_tax_inclusive = v_is_tax_inclusive`, `tax_rate = v_tax_rate`, `tax_name = v_tax_name`, `tax_amount = v_tax_amount`.
11. **Item Deduction via Layer 1 Core Mutation & Financial Rounding Reconciliation**:
    - Track iteration: `v_line_idx := 0; v_total_items := jsonb_array_length(p_items); v_accumulated_line_total := 0.0000; v_accumulated_tax := 0.0000;`
    - For each item:
      - `v_line_idx := v_line_idx + 1;`
      - Calculate allocated order discount and tax:
        ```sql
        IF v_subtotal = 0.0000 THEN
            v_alloc_order_disc := 0.0000;
        ELSE
            v_alloc_order_disc := round((v_line_gross_net / v_subtotal) * p_order_discount_amount, v_decimals);
        END IF;

        v_line_taxable := v_line_gross_net - v_alloc_order_disc;

        IF v_is_tax_inclusive THEN
            v_line_total := v_line_gross_net - v_alloc_order_disc;
            v_alloc_tax := round(v_line_total - (v_line_total / (1 + (v_tax_rate / 100))), v_decimals);
        ELSE
            v_alloc_tax := round(v_line_taxable * (v_tax_rate / 100), v_decimals);
            v_line_total := v_line_taxable + v_alloc_tax;
        END IF;

        -- Rounding reconciliation: Final line item absorbs minor rounding residual so sum(line_totals) == total_amount
        IF v_line_idx = v_total_items THEN
            v_line_total := v_total_amount - v_accumulated_line_total;
            v_alloc_tax := v_tax_amount - v_accumulated_tax;
            v_line_taxable := v_line_total - v_alloc_tax;
        ELSE
            v_accumulated_line_total := v_accumulated_line_total + v_line_total;
            v_accumulated_tax := v_accumulated_tax + v_alloc_tax;
        END IF;
        ```
      - Sourced `v_item_expected_version := (item->>'expected_version')::INTEGER` (optional OCC version from client cart).
      - Invoke Layer 1 core:
        ```sql
        v_mutation_result := public._execute_inventory_mutation_core(
            p_org_id := p_org_id,
            p_product_id := v_item_product_id,
            p_movement_type := 'sale',
            p_quantity_delta := -abs(v_item_quantity),
            p_reason := 'Sale ' || v_sale_number,
            p_reference_id := 'sale:' || v_sale_id::text,
            p_idempotency_key := NULL,  -- Sale-level idempotency handled at outer wrapper
            p_idempotency_payload_hash := NULL,
            p_created_by := auth.uid(),
            p_expected_version := v_item_expected_version
        );
        v_movement_id := (v_mutation_result->>'movement_id')::UUID;
        ```
      - Insert into `public.sale_items` with snapshotted `unit_price`, snapshotted `unit_cost` (NULL if none), `allocated_order_disc`, `taxable_amount = v_line_taxable`, `allocated_tax_amount = v_alloc_tax`, `total_price = v_line_total`, and `movement_id = v_movement_id`.
12. **Insert `public.payments`**:
    - Insert payment records.
13. **Commit & Return**:
    - Return consolidated sale JSON object.

---

#### B. `public.void_sale` RPC
```sql
CREATE OR REPLACE FUNCTION public.void_sale(
    p_org_id UUID,
    p_sale_id UUID,
    p_void_reason TEXT,
    p_idempotency_key UUID,
    p_reversal_references JSONB DEFAULT NULL  -- Array of { payment_id: UUID, reference_no: TEXT }
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, UUID, TEXT, UUID, JSONB) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authorization**: Caller must hold active membership and permission `sales:void` (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Mandatory Void Idempotency**:
   - Verify `p_idempotency_key IS NOT NULL` (else `P0055 IDEMPOTENCY_KEY_REQUIRED`).
   - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));`
   - Sort reversal references deterministically:
     ```sql
     SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'payment_id')::UUID ASC), '[]'::jsonb)
     INTO v_sorted_reversals
     FROM jsonb_array_elements(coalesce(p_reversal_references, '[]'::jsonb)) elem;

     v_canonical_jsonb := jsonb_build_object(
         'idempotency_key', p_idempotency_key::text,
         'organization_id', p_org_id::text,
         'reversal_references', v_sorted_reversals,
         'sale_id', p_sale_id::text,
         'void_reason', trim(p_void_reason)
     );
     v_canonical_hash := encode(sha256(convert_to(v_canonical_jsonb::text, 'UTF8')), 'hex');
     ```
   - Check if sale is already voided with this key: If `void_idempotency_key = p_idempotency_key`, replay void confirmation if hash matches; raise `P0024 IDEMPOTENCY_CONFLICT` if hash differs.
3. **Sale Row Lock & Status Validation**:
   - `SELECT * INTO v_sale FROM public.sales WHERE organization_id = p_org_id AND id = p_sale_id FOR UPDATE;`
   - If not found -> `P0048 SALE_NOT_FOUND`.
   - If `status = 'voided'` -> `P0050 SALE_ALREADY_VOIDED`.
   - If `status <> 'completed'` -> `P0049 SALE_NOT_COMPLETED`.
   - Check existing returns: `IF EXISTS (SELECT 1 FROM public.sale_returns WHERE sale_id = p_sale_id) THEN RAISE EXCEPTION USING ERRCODE = 'P0051', MESSAGE = 'SALE_VOID_HAS_RETURNS_BLOCKED'; END IF;`
4. **Deterministic Inventory Pre-locking & Reversal via Core Mutation**:
   - Extract distinct `product_id`s from sale items, sort ascending alphanumeric, and acquire inventory row locks before mutation:
     ```sql
     SELECT array_agg(DISTINCT product_id ORDER BY product_id ASC)
     INTO v_sorted_product_ids
     FROM public.sale_items WHERE organization_id = p_org_id AND sale_id = p_sale_id;

     IF v_sorted_product_ids IS NOT NULL AND array_length(v_sorted_product_ids, 1) > 0 THEN
         PERFORM id FROM public.inventory WHERE organization_id = p_org_id AND product_id = ANY(v_sorted_product_ids) ORDER BY product_id ASC FOR UPDATE;
     END IF;
     ```
   - Sourced item loop invoking Layer 1 core with `p_expected_version := NULL` (re-addition does not compete on decrement thresholds):
     ```sql
     FOR v_item IN SELECT * FROM public.sale_items WHERE organization_id = p_org_id AND sale_id = p_sale_id ORDER BY product_id ASC LOOP
         PERFORM public._execute_inventory_mutation_core(
             p_org_id := p_org_id,
             p_product_id := v_item.product_id,
             p_movement_type := 'return',
             p_quantity_delta := abs(v_item.quantity),
             p_reason := 'Void sale ' || v_sale.sale_number || ': ' || p_void_reason,
             p_reference_id := 'void:' || p_sale_id::text,
             p_idempotency_key := NULL,
             p_idempotency_payload_hash := NULL,
             p_created_by := auth.uid(),
             p_expected_version := NULL
         );
     END LOOP;
     ```
5. **Reversal Accounting in `public.refunds`**:
   - For each original payment record in `public.payments WHERE sale_id = p_sale_id`:
     - If cash: `v_status := 'completed'`, `v_ref := NULL`. Cash reimbursement is physically disbursed at the counter within the void transaction.
     - If non-cash (`'card'`, `'bank_transfer'`, `'other'`):
       - Look up optional reversal reference from `p_reversal_references`: if provided for this `payment.id`, `v_ref := trim(reference_no)`. If omitted or null, `v_ref := NULL`.
       - **F005-038 Invariant**: `v_status` is ALWAYS initialized to `'pending'` for external reimbursements! A supplied reference is supporting trace data (intent/gateway authorization code), never proof of completed reimbursement. The reimbursement becomes `'completed'` exclusively through subsequent execution of `confirm_refund_reimbursement`.
     - Insert into `public.refunds`:
       - Insert into `public.refunds` with self-referencing `obligation_refund_id` to establish obligation root identity:
         `v_refund_id := gen_random_uuid();`
         `INSERT INTO public.refunds (id, organization_id, return_id, sale_id, refund_method, amount, reference_no, status, reason, processed_by, updated_at, obligation_refund_id) VALUES (v_refund_id, p_org_id, NULL, p_sale_id, payment.payment_method, payment.amount, v_ref, v_status, 'Sale void: ' || p_void_reason, auth.uid(), now(), v_refund_id);`
         **F005-044 Invariant**: `obligation_refund_id = id` (self-referencing, UUID pre-generated) for all original refunds. Replacement refunds inherit `obligation_refund_id` from their failed parent's `obligation_refund_id`, not from `parent_refund_id`, ensuring the full replacement chain shares one canonical obligation root. The partial unique index `UNIQUE (organization_id, obligation_refund_id) WHERE status IN ('pending', 'completed')` enforces one active reimbursement attempt per obligation at the database level.
6. **Update Sale Header (F005-039 Reconciled Calculation)**:
   - Compute actual completed reimbursements:
     `SELECT coalesce(sum(amount), 0) INTO v_total_completed_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'completed';`
   - Check if any reimbursements remain pending:
     `v_has_pending_refunds := EXISTS (SELECT 1 FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'pending');`
   - Set status and aggregate payment status:
     - `status := 'voided'`
     - `payment_status := CASE WHEN v_total_completed_refunds >= v_sale.total_amount THEN 'refunded' WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded' ELSE 'paid' END`
     - `void_idempotency_key := p_idempotency_key`, `void_idempotency_hash := v_canonical_hash`, `voided_at := now()`, `voided_by := auth.uid()`, `void_reason := p_void_reason`.
7. **Return**: Consolidated void confirmation JSON.

---

#### C. `public.execute_sale_return` RPC
```sql
CREATE OR REPLACE FUNCTION public.execute_sale_return(
    p_org_id UUID,
    p_sale_id UUID,
    p_return_items JSONB,        -- Array of { sale_item_id: UUID, quantity: NUMERIC, restock_to_inventory: BOOLEAN }
    p_refund_method TEXT,        -- 'cash', 'card', 'bank_transfer', 'other'
    p_reason TEXT,
    p_idempotency_key UUID,
    p_reference_no TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.execute_sale_return(UUID, UUID, JSONB, TEXT, TEXT, UUID, TEXT) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authorization**: Caller must hold active membership and permission `returns:create` (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Mandatory Idempotency & Advisory Lock**:
   - Verify `p_idempotency_key IS NOT NULL` (else `P0055 IDEMPOTENCY_KEY_REQUIRED`).
   - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));`
   - Sort return items deterministically by `sale_item_id` ASC using structured JSONB canonicalization:
     ```sql
     SELECT jsonb_agg(elem ORDER BY (elem->>'sale_item_id')::UUID ASC) INTO v_sorted_return_items
     FROM jsonb_array_elements(p_return_items) elem;

     v_canonical_jsonb := jsonb_build_object(
         'idempotency_key', p_idempotency_key::text,
         'organization_id', p_org_id::text,
         'reason', trim(p_reason),
         'reference_no', p_reference_no,
         'refund_method', p_refund_method,
         'return_items', v_sorted_return_items,
         'sale_id', p_sale_id::text
     );
     v_canonical_hash := encode(sha256(convert_to(v_canonical_jsonb::text, 'UTF8')), 'hex');
     ```
   - Check `public.sale_returns WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key`.
   - If found: if hash matches, replay stored return JSON; if hash differs, raise `P0024 IDEMPOTENCY_CONFLICT`.
3. **Reason, Duplicate Item & Split-Tender Validation**:
   - Verify `length(trim(p_reason)) >= 3` (else `P0053 RETURN_REASON_REQUIRED`).
   - Verify no duplicate `sale_item_id` in `p_return_items`:
     `IF (SELECT count(DISTINCT (elem->>'sale_item_id')) FROM jsonb_array_elements(p_return_items) elem) <> jsonb_array_length(p_return_items) THEN RAISE EXCEPTION USING ERRCODE = 'P0060', MESSAGE = 'DUPLICATE_RETURN_ITEM'; END IF;`
   - Normalize optional external trace reference:
     `v_ref := CASE WHEN p_reference_no IS NOT NULL AND length(trim(p_reference_no)) > 0 THEN trim(p_reference_no) ELSE NULL END;`
   - `SELECT * INTO v_sale FROM public.sales WHERE organization_id = p_org_id AND id = p_sale_id FOR UPDATE;`
   - If not found -> `P0048 SALE_NOT_FOUND`.
   - If `status = 'voided'` -> `P0050 SALE_ALREADY_VOIDED`.
   - If `status NOT IN ('completed', 'partially_returned')` -> `P0049 SALE_NOT_COMPLETED`.
   - **Split-Tender Refund Policy Enforcement**:
     - Query original amount tendered for this method:
       `SELECT coalesce(sum(amount), 0) INTO v_orig_method_amt FROM public.payments WHERE organization_id = p_org_id AND sale_id = p_sale_id AND payment_method = p_refund_method;`
     - Query prior non-failed refunds for this method:
       `SELECT coalesce(sum(amount), 0) INTO v_prior_method_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND refund_method = p_refund_method AND status IN ('completed', 'pending');`
     - If `p_refund_method <> 'cash'`:
       - If `v_orig_method_amt = 0` THEN raise `ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_NOT_IN_ORIGINAL_SALE'`.
       - If `(v_prior_method_refunds + v_total_refund) > v_orig_method_amt` THEN raise `ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER'`.
     - Note: Cash reimbursement (`p_refund_method = 'cash'`) is permitted regardless of original payment methods, bounded only by overall unrefunded sale total amount (`P0054`).
4. **Header Generation & Sequence Allocation**:
   - Sourced date in organization timezone directly from `public.organizations`:
     `SELECT timezone INTO v_org_timezone FROM public.organizations WHERE id = p_org_id;`
     `v_org_date := (now() AT TIME ZONE coalesce(v_org_timezone, 'UTC'))::DATE;`
   - Update `public.sale_sequences` with `sequence_type = 'return'`:
     ```sql
     INSERT INTO public.sale_sequences (organization_id, sequence_type, date_key, last_number)
     VALUES (p_org_id, 'return', v_org_date, 1)
     ON CONFLICT (organization_id, sequence_type, date_key)
     DO UPDATE SET last_number = sale_sequences.last_number + 1, updated_at = now()
     RETURNING last_number INTO v_seq_num;
     v_return_number := 'RET-' || to_char(v_org_date, 'YYYYMMDD') || '-' || lpad(v_seq_num::text, 4, '0');
     ```
   - Generate `v_return_id := gen_random_uuid()`.
   - Insert `public.sale_returns` header with `id = v_return_id, return_number = v_return_number, total_refund_amount = 0.0000, idempotency_key = p_idempotency_key, idempotency_hash = v_canonical_hash`.
5. **Deterministic Inventory Pre-locking, Quantity Validation & Restocking**:
   - Extract distinct restocked product IDs and pre-lock inventory in ascending order to prevent deadlocks:
     ```sql
     SELECT array_agg(DISTINCT si.product_id ORDER BY si.product_id ASC)
     INTO v_sorted_restock_pids
     FROM jsonb_array_elements(p_return_items) elem
     JOIN public.sale_items si ON si.id = (elem->>'sale_item_id')::UUID AND si.organization_id = p_org_id
     WHERE (elem->>'restock_to_inventory')::BOOLEAN = true;

     IF v_sorted_restock_pids IS NOT NULL AND array_length(v_sorted_restock_pids, 1) > 0 THEN
         PERFORM id FROM public.inventory WHERE organization_id = p_org_id AND product_id = ANY(v_sorted_restock_pids) ORDER BY product_id ASC FOR UPDATE;
     END IF;
     ```
   - Sourced `v_decimals := public.get_currency_exponent(v_sale.currency)`.
   - For each return item in `v_sorted_return_items`:
     - Lock sale item: `SELECT * INTO v_sale_item FROM public.sale_items WHERE id = (item->>'sale_item_id')::UUID AND sale_id = p_sale_id FOR UPDATE;`
     - Query historical returns: `SELECT coalesce(sum(quantity), 0), coalesce(sum(refund_amount), 0) INTO v_prior_qty, v_prior_refund FROM public.sale_return_items WHERE sale_item_id = v_sale_item.id;`
     - Verify `(v_prior_qty + (item->>'quantity')::NUMERIC) <= v_sale_item.quantity` (else `P0052 RETURN_QUANTITY_EXCEEDS_SOLD`).
     - Calculate proportional refund amount:
       - `v_remaining_qty := v_sale_item.quantity - v_prior_qty`.
       - `v_ret_qty := (item->>'quantity')::NUMERIC`.
       - If `v_ret_qty = v_remaining_qty`:
         `v_item_refund := v_sale_item.total_price - v_prior_refund`.  *(Absorbs rounding residual)*
       - Else:
         `v_item_refund := round((v_sale_item.total_price / v_sale_item.quantity) * v_ret_qty, v_decimals)`.
     - Sourced `v_total_refund := v_total_refund + v_item_refund`.
     - If `(item->>'restock_to_inventory')::BOOLEAN = true`:
       - Verify product not inactive: `IF (SELECT is_active FROM public.products WHERE id = v_sale_item.product_id) = false THEN RAISE EXCEPTION USING ERRCODE = 'P0056', MESSAGE = 'PRODUCT_INACTIVE_RETURN_BLOCKED'; END IF;`
       - Sourced Layer 1 core mutation with `p_expected_version := NULL`:
         ```sql
         v_mut := public._execute_inventory_mutation_core(
             p_org_id := p_org_id,
             p_product_id := v_sale_item.product_id,
             p_movement_type := 'return',
             p_quantity_delta := abs(v_ret_qty),
             p_reason := 'Return ' || v_return_number || ': ' || p_reason,
             p_reference_id := 'return:' || v_return_id::text,
             p_idempotency_key := NULL,
             p_idempotency_payload_hash := NULL,
             p_created_by := auth.uid(),
             p_expected_version := NULL
         );
         v_movement_id := (v_mut->>'movement_id')::UUID;
         ```
     - Insert `public.sale_return_items` linking `organization_id = p_org_id`, `return_id = v_return_id`, `sale_id = p_sale_id`, `sale_item_id = v_sale_item.id`, `product_id = v_sale_item.product_id`, `quantity = v_ret_qty`, `refund_amount = v_item_refund`, `restock_to_inventory = (item->>'restock_to_inventory')::BOOLEAN`, `movement_id = v_movement_id`, `created_at = now()`.
6. **Update Return Header & Disburse Refund with Lifecycle Status**:
   - Query prior cumulative unfailed refunds: `SELECT coalesce(sum(amount), 0) INTO v_prior_total_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status IN ('completed', 'pending');`
   - Verify `(v_prior_total_refunds + v_total_refund) <= v_sale.total_amount` (else `P0054 REFUND_EXCEEDS_PAYABLE`).
   - Update `public.sale_returns SET total_refund_amount = v_total_refund WHERE id = v_return_id`.
   - If `v_total_refund > 0.0000`:
     - Sourced refund status lifecycle:
       - If `p_refund_method = 'cash'`: `v_refund_status := 'completed'`.
       - Else (`'card'`, `'bank_transfer'`, `'other'`): `v_refund_status := 'pending'` (initiates external disbursement trace; confirmed via `confirm_refund_reimbursement`).
     - Insert row into `public.refunds`:
      - Insert row into `public.refunds` with self-referencing `obligation_refund_id` (pre-generate UUID):
        `v_refund_id := gen_random_uuid();`
        `INSERT INTO public.refunds (id, organization_id, return_id, sale_id, refund_method, amount, reference_no, status, reason, processed_by, updated_at, obligation_refund_id) VALUES (v_refund_id, p_org_id, v_return_id, p_sale_id, p_refund_method, v_total_refund, v_ref, v_refund_status, p_reason, auth.uid(), now(), v_refund_id);`
        **F005-044 Invariant**: `obligation_refund_id = id` (self-referencing) for all original refunds, establishing the obligation root identity for any subsequent replacement chain.
7. **Update Sale Lifecycle Status (F005-039 Reconciled Calculation)**:
   - Check if all sale items are now 100% returned:
     `v_all_returned := NOT EXISTS (SELECT 1 FROM public.sale_items si WHERE si.sale_id = p_sale_id AND si.quantity > (SELECT coalesce(sum(sri.quantity), 0) FROM public.sale_return_items sri WHERE sri.sale_item_id = si.id));`
   - Compute actual completed reimbursements:
     `SELECT coalesce(sum(amount), 0) INTO v_total_completed_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'completed';`
   - Check if any reimbursements remain pending:
     `v_has_pending_refunds := EXISTS (SELECT 1 FROM public.refunds WHERE organization_id = p_org_id AND sale_id = p_sale_id AND status = 'pending');`
   - Update `public.sales`:
     `status := CASE WHEN v_all_returned THEN 'returned' ELSE 'partially_returned' END`,
     `payment_status := CASE WHEN v_all_returned AND v_total_completed_refunds >= v_sale.total_amount THEN 'refunded' WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded' ELSE 'paid' END`,
     `updated_at := now()`.
8. **Return**: Consolidated return confirmation JSON.
8. **Return**: Consolidated return confirmation JSON.

---

#### D. `public.confirm_refund_reimbursement` RPC
```sql
CREATE OR REPLACE FUNCTION public.confirm_refund_reimbursement(
    p_org_id UUID,
    p_refund_id UUID,
    p_external_reference TEXT,
    p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_refund_reimbursement(UUID, UUID, TEXT, UUID) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authorization**: Caller must hold active tenant membership and permission `refunds:read` AND (`sales:void` OR `returns:create`) (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Mandatory Idempotency & Advisory Lock**:
   - Verify `p_idempotency_key IS NOT NULL` (else `ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED'`).
   - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));`
   - Compute canonical hash:
     ```sql
     v_canonical_hash := encode(sha256(convert_to(
         jsonb_build_object(
             'external_reference', trim(p_external_reference),
             'idempotency_key', p_idempotency_key::text,
             'organization_id', p_org_id::text,
             'refund_id', p_refund_id::text
         )::text, 'UTF8')), 'hex');
     ```
3. **Refund Lock & State Validation (F005-046 â€” All Idempotency Cases)**:
   - `SELECT * INTO v_refund FROM public.refunds WHERE organization_id = p_org_id AND id = p_refund_id FOR UPDATE;`
   - If not found -> `ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND'`.
   - **Case C â€” Cross-refund key conflict** (same key, different refund, same org): Check BEFORE row-level replay, while advisory lock is held, to prevent raw `23505` leaking:
     ```sql
     IF EXISTS (
         SELECT 1 FROM public.refunds
         WHERE organization_id = p_org_id
           AND confirmation_idempotency_key = p_idempotency_key
           AND id <> p_refund_id
     ) THEN
         RAISE EXCEPTION USING ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT';
     END IF;
     ```
   - **Case A â€” Replay** (same key, same refund, same payload):
     - If `v_refund.confirmation_idempotency_key = p_idempotency_key`:
       - If `v_refund.confirmation_idempotency_hash = v_canonical_hash`: return stored confirmation (`is_replay = true`).
       - **Case B** â€” same key, same refund, different payload: If `v_refund.confirmation_idempotency_hash <> v_canonical_hash`: raise `ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT'`.
   - **Case D â€” Already settled** (different key, non-pending refund):
     - If `v_refund.status = 'completed'` -> `ERRCODE = 'P0062', MESSAGE = 'REFUND_ALREADY_SETTLED'`.
     - If `v_refund.status <> 'pending'` -> `ERRCODE = 'P0062', MESSAGE = 'REFUND_ALREADY_SETTLED'`.
   - **Case E â€” Concurrency**: The advisory lock on `(org_id, idempotency_key)` serializes concurrent confirmation attempts; the second concurrent request hits one of Cases Aâ€“D.
   - Verify `p_external_reference IS NOT NULL AND length(trim(p_external_reference)) > 0` (else `ERRCODE = 'P0059', MESSAGE = 'EXTERNAL_REVERSAL_REFERENCE_REQUIRED'`).
4. **Transition & Header Updates (F005-039 Reconciled Calculation)**:
   - Update `public.refunds`:
     `status := 'completed'`, `reference_no := trim(p_external_reference)`, `confirmation_idempotency_key := p_idempotency_key`, `confirmation_idempotency_hash := v_canonical_hash`, `updated_at := now()`.
   - Re-evaluate aggregate completed reimbursements:
     ```sql
     SELECT coalesce(sum(amount), 0) INTO v_total_completed_refunds
     FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

     v_has_pending_refunds := EXISTS (
         SELECT 1 FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'pending'
     );

     SELECT * INTO v_target_sale FROM public.sales WHERE organization_id = p_org_id AND id = v_refund.sale_id;

     UPDATE public.sales 
     SET payment_status = CASE 
         WHEN v_target_sale.status IN ('voided', 'returned') AND v_total_completed_refunds >= v_target_sale.total_amount THEN 'refunded'
         WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded'
         ELSE 'paid'
     END,
     updated_at = now()
     WHERE organization_id = p_org_id AND id = v_refund.sale_id;
     ```
5. **Return**: Consolidated refund confirmation JSON.

---

#### E. `public.record_refund_failure` RPC
```sql
CREATE OR REPLACE FUNCTION public.record_refund_failure(
    p_org_id UUID,
    p_refund_id UUID,
    p_failure_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.record_refund_failure(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_failure(UUID, UUID, TEXT) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authorization**: Caller must hold active tenant membership and permission `sales:void` OR `returns:create` (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Validation**: Verify `length(trim(p_failure_reason)) >= 3` (else `P0053 RETURN_REASON_REQUIRED`).
3. **Lock & State Check**:
   - `SELECT * INTO v_refund FROM public.refunds WHERE organization_id = p_org_id AND id = p_refund_id FOR UPDATE;`
   - If not found -> `ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND'`.
   - If `v_refund.status <> 'pending'` -> `ERRCODE = 'P0062', MESSAGE = 'REFUND_ALREADY_SETTLED'`.
4. **Transition to Failed & Header Re-evaluation (F005-039 Reconciled Calculation)**:
   - Update `public.refunds`: `status := 'failed'`, `reason := reason || ' | FAILURE: ' || trim(p_failure_reason)`, `updated_at := now()`.
   - Re-evaluate aggregate completed reimbursements:
     ```sql
     SELECT coalesce(sum(amount), 0) INTO v_total_completed_refunds
     FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'completed';

     v_has_pending_refunds := EXISTS (
         SELECT 1 FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_refund.sale_id AND status = 'pending'
     );

     UPDATE public.sales 
     SET payment_status = CASE 
         WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded' 
         ELSE 'paid' 
     END,
     updated_at = now() 
     WHERE organization_id = p_org_id AND id = v_refund.sale_id;
     ```
   - *Financial Invariant*: A failed refund is never counted as completed reimbursement. The unsettled balance remains outstanding on the sale, enabling the authorized operator to initiate a replacement reimbursement.
5. **Return**: Failure confirmation JSON.

---

#### F. `public.issue_replacement_refund` RPC

```sql
CREATE OR REPLACE FUNCTION public.issue_replacement_refund(
    p_org_id UUID,
    p_failed_refund_id UUID,
    p_refund_method TEXT,        -- 'cash', 'card', 'bank_transfer', 'other'
    p_idempotency_key UUID,
    p_reference_no TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_replacement_refund(UUID, UUID, TEXT, UUID, TEXT, TEXT) TO authenticated;
```

**Preconditions & Execution Logic (F005-040 Replacement Workflow)**:
1. **Authorization**: Caller must hold active tenant membership and permission `sales:void` OR `returns:create` (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Mandatory Idempotency & Advisory Lock**:
   - Verify `p_idempotency_key IS NOT NULL` (else `ERRCODE = 'P0055', MESSAGE = 'IDEMPOTENCY_KEY_REQUIRED'`).
   - Acquire transaction-scoped advisory lock: `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(p_idempotency_key::text));`
   - Compute canonical hash:
     ```sql
     v_canonical_hash := encode(sha256(convert_to(
         jsonb_build_object(
             'failed_refund_id', p_failed_refund_id::text,
             'idempotency_key', p_idempotency_key::text,
             'notes', trim(p_notes),
             'organization_id', p_org_id::text,
             'reference_no', trim(p_reference_no),
             'refund_method', p_refund_method
         )::text, 'UTF8')), 'hex');
     ```
   - Check existing replacement by idempotency key: If exists in `public.refunds WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key`:
     - If hash matches: replay stored refund JSON (`is_replay = true`).
     - Else: raise `ERRCODE = 'P0024', MESSAGE = 'IDEMPOTENCY_CONFLICT'`.
3. **Failed Refund Lock, Obligation Resolution & Immutability Guarantee (F005-044)**:
   - Lock target failed refund row:
     `SELECT * INTO v_failed_refund FROM public.refunds WHERE organization_id = p_org_id AND id = p_failed_refund_id FOR UPDATE;`
   - If not found -> `ERRCODE = 'P0058', MESSAGE = 'REFUND_NOT_FOUND'`.
   - If `v_failed_refund.status <> 'failed'` -> `ERRCODE = 'P0065', MESSAGE = 'REFUND_NOT_FAILED'`.
   - **Obligation root resolution** (traverses full replacement chain, not just immediate parent):
     `v_obligation_id := v_failed_refund.obligation_refund_id;`
   - **Unconditional Obligation Advisory Lock**: Acquire transaction-scoped advisory lock on the obligation root for EVERY replacement request (unconditionally, whether replacing the original failed refund or a descendant in the failure chain):
     `PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_obligation_id::text));`
     This serializes all concurrent replacement requests targeting the same reimbursement obligation, ensuring competing transactions evaluate the active attempt query serially and cleanly raise `P0064` instead of colliding on the database partial unique index with an unhandled `23505`.
   - Assert no active attempt exists for this obligation across the full lineage:
     ```sql
     SELECT status INTO v_existing_status
     FROM public.refunds
     WHERE organization_id = p_org_id
       AND obligation_refund_id = v_obligation_id
       AND status IN ('pending', 'completed')
     LIMIT 1;
     IF FOUND THEN
         IF v_existing_status = 'completed' THEN
             RAISE EXCEPTION USING ERRCODE = 'P0067', MESSAGE = 'OBLIGATION_ALREADY_COMPLETED';
         ELSE
             -- status = 'pending'
             RAISE EXCEPTION USING ERRCODE = 'P0064', MESSAGE = 'REPLACEMENT_REFUND_ALREADY_EXISTS';
         END IF;
     END IF;
     ```
   - *Audit Invariant*: The historical record `v_failed_refund` is strictly preserved and remains completely immutable.
4. **Parent Sale Row Lock & Method Validation**:
   - Lock parent sale row:
     `SELECT * INTO v_sale FROM public.sales WHERE organization_id = p_org_id AND id = v_failed_refund.sale_id FOR UPDATE;`
   - **Split-Tender Ceiling Enforcement**:
     - Query prior non-failed refunds for this method:
       `SELECT coalesce(sum(amount), 0) INTO v_prior_method_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND refund_method = p_refund_method AND status IN ('completed', 'pending');`
     - If `p_refund_method <> 'cash'`:
       - Query original tender for method:
         `SELECT coalesce(sum(amount), 0) INTO v_orig_method_amt FROM public.payments WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND payment_method = p_refund_method;`
       - If `v_orig_method_amt = 0` THEN raise `ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_NOT_IN_ORIGINAL_SALE'`.
       - If `(v_prior_method_refunds + v_failed_refund.amount) > v_orig_method_amt` THEN raise `ERRCODE = 'P0061', MESSAGE = 'REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER'`.
     - Overall sale refundable ceiling check:
       `SELECT coalesce(sum(amount), 0) INTO v_total_unfailed FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status IN ('completed', 'pending');`
       `IF (v_total_unfailed + v_failed_refund.amount) > v_sale.total_amount THEN RAISE EXCEPTION USING ERRCODE = 'P0054', MESSAGE = 'REFUND_EXCEEDS_PAYABLE'; END IF;`
5. **Insert Replacement Refund Record**:
   - Determine status:
     - If `p_refund_method = 'cash'`: `v_replacement_status := 'completed'`, `v_ref := NULL`.
     - Else: `v_replacement_status := 'pending'`, `v_ref := CASE WHEN p_reference_no IS NOT NULL AND length(trim(p_reference_no)) > 0 THEN trim(p_reference_no) ELSE NULL END`.
   - Pre-generate replacement UUID: `v_new_refund_id := gen_random_uuid();`
   - Insert into `public.refunds`, setting `obligation_refund_id` to the obligation root (not the immediate parent), ensuring all replacements in a chain share one canonical obligation identity:
     ```sql
     INSERT INTO public.refunds (
         id, organization_id, return_id, sale_id, refund_method, amount,
         reference_no, status, reason, processed_by, created_at, updated_at,
         parent_refund_id, obligation_refund_id, idempotency_key, idempotency_hash
     ) VALUES (
         v_new_refund_id, p_org_id, v_failed_refund.return_id, v_failed_refund.sale_id,
         p_refund_method, v_failed_refund.amount, v_ref, v_replacement_status,
         'Replacement for failed refund ' || v_failed_refund.id::text || coalesce(': ' || trim(p_notes), ''),
         auth.uid(), now(), now(),
         v_failed_refund.id, v_obligation_id, p_idempotency_key, v_canonical_hash
     );
     ```
   - *No Duplicate Movement*: Does NOT call inventory mutation engine or create return items; stock was already restored during original return/void.
6. **Update Sale Payment Status (F005-039 Reconciled Calculation)**:
   - Compute actual completed reimbursements:
     `SELECT coalesce(sum(amount), 0) INTO v_total_completed_refunds FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status = 'completed';`
   - Check if any reimbursements remain pending:
     `v_has_pending_refunds := EXISTS (SELECT 1 FROM public.refunds WHERE organization_id = p_org_id AND sale_id = v_failed_refund.sale_id AND status = 'pending');`
   - Update `public.sales`:
     ```sql
     UPDATE public.sales
     SET payment_status = CASE 
         WHEN v_sale.status IN ('voided', 'returned') AND v_total_completed_refunds >= v_sale.total_amount THEN 'refunded'
         WHEN v_total_completed_refunds > 0.0000 OR v_has_pending_refunds THEN 'partially_refunded'
         ELSE 'paid'
     END,
     updated_at = now()
     WHERE organization_id = p_org_id AND id = v_failed_refund.sale_id;
     ```
7. **Return**: Consolidated replacement refund confirmation JSON.

---

#### G. Customer Mutation Procedures

```sql
CREATE OR REPLACE FUNCTION public.create_customer(
    p_org_id UUID,
    p_name TEXT,
    p_phone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_customer(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_customer(
    p_org_id UUID,
    p_customer_id UUID,
    p_name TEXT,
    p_phone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_customer(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_customer(
    p_org_id UUID,
    p_customer_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.archive_customer(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.archive_customer(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.archive_customer(UUID, UUID) TO authenticated;
```

**Execution Contracts**:
- `create_customer`: Sourced caller must hold active membership and `customers:create`. Validates `trim(p_name)` (1Ã¢â‚¬â€œ255 chars). Normalizes `v_email := lower(trim(p_email))`, `v_phone := trim(p_phone)`. Enforces partial uniqueness against active customers (`23505 CUSTOMER_PHONE_EXISTS`, `23505 CUSTOMER_EMAIL_EXISTS`). Inserts into `public.customers` with `status = 'active'` and returns new customer JSON.
- `update_customer`: Sourced caller must hold active membership and `customers:update`. Locks customer `WHERE organization_id = p_org_id AND id = p_customer_id FOR UPDATE`. If not found -> `P0040 CUSTOMER_NOT_FOUND`. If `status = 'archived'` -> `P0041 CUSTOMER_ARCHIVED`. Normalizes inputs and checks collisions against other active customers (`23505`). Updates fields, `updated_at := now()`, and returns updated customer JSON.
- `archive_customer`: Sourced caller must hold active membership and `customers:archive`. Locks customer `WHERE organization_id = p_org_id AND id = p_customer_id FOR UPDATE`. If not found -> `P0040 CUSTOMER_NOT_FOUND`. If already archived -> returns success idempotently. Updates `status := 'archived', updated_at := now()`. Sourced phone and email uniqueness is released for active profiles. Direct hard delete is blocked by composite FK `ON DELETE RESTRICT` on `sales.customer_id`. Returns archival confirmation JSON.

---

#### H. `public.update_tax_settings` RPC

```sql
CREATE OR REPLACE FUNCTION public.update_tax_settings(
    p_org_id UUID,
    p_tax_name TEXT,
    p_default_tax_rate NUMERIC,
    p_is_tax_inclusive BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
...
$$;

ALTER FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_tax_settings(UUID, TEXT, NUMERIC, BOOLEAN) TO authenticated;
```

**Preconditions & Execution Logic**:
1. **Authorization**: Caller must hold active tenant membership AND (role in `'owner'`, `'admin'` OR permission `tax_settings:update`) (`42501 INSUFFICIENT_PERMISSIONS`).
2. **Validation**:
   - `length(trim(p_tax_name)) >= 1` (else `23514 CHECK VIOLATION`).
   - `p_default_tax_rate BETWEEN 0.0000 AND 100.0000` (else `23514 CHECK VIOLATION`).
3. **Upsert Operation**:
   ```sql
   INSERT INTO public.organization_tax_settings (
       organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_at, updated_by
   ) VALUES (
       p_org_id, trim(p_tax_name), p_default_tax_rate, p_is_tax_inclusive, now(), auth.uid()
   )
   ON CONFLICT (organization_id)
   DO UPDATE SET
       tax_name = EXCLUDED.tax_name,
       default_tax_rate = EXCLUDED.default_tax_rate,
       is_tax_inclusive = EXCLUDED.is_tax_inclusive,
       updated_at = now(),
       updated_by = auth.uid()
   RETURNING jsonb_build_object(
       'organization_id', organization_id,
       'tax_name', tax_name,
       'default_tax_rate', default_tax_rate,
       'is_tax_inclusive', is_tax_inclusive,
       'updated_at', updated_at,
       'updated_by', updated_by
   ) INTO v_result;
   ```
4. **Historical Immutability**: Historical sales retain their snapshotted tax parameters. The new configuration applies strictly to future checkout transactions.
5. **Return**: Updated tax settings JSON.

---

### 2. Comprehensive Cross-Feature Error Code Catalog

| Error Code | SQLSTATE | HTTP Status | Origin / Feature | Established Meaning & Trigger Condition |
|---|:---:|:---:|:---:|---|
| `UNAUTHENTICATED` | `08001` | 401 | Shared (F001Ã¢â‚¬â€œF004) | `auth.uid()` is NULL or missing valid session |
| `INSUFFICIENT_PERMISSIONS` | `42501` | 403 | Shared (F001Ã¢â‚¬â€œF004) | User lacks required granular permission |
| `ORGANIZATION_INACTIVE` | `P0001` | 403 | Shared (F001Ã¢â‚¬â€œF004) | Tenant has `is_active = FALSE` |
| `MEMBERSHIP_INACTIVE` | `P0002` | 403 | Shared (F001Ã¢â‚¬â€œF004) | Caller's membership in tenant is not `active` |
| `PRODUCT_NOT_FOUND` | `P0003` | 404 | Feature 003 / 004 | Product ID does not exist in active organization |
| `INVENTORY_NOT_FOUND` | `P0004` | 404 | Feature 004 | Inventory record missing for product in organization |
| `TENANT_MISMATCH` | `P0005` | 400 | Shared (F001Ã¢â‚¬â€œF004) | Tenant IDs do not match across joined records |
| `CATEGORY_NOT_FOUND` | `P0006` | 404 | Feature 003 | Category ID does not exist in organization |
| `INVALID_FINANCIAL_AMOUNT` | `P0007` | 422 | Feature 003 / 005 | Negative selling price, cost price, or tender amount |
| `COST_PRICE_REQUIRED` | `P0008` | 422 | Feature 003 | Cost price missing when cost operation is `set` |
| `INVALID_ORGANIZATION_ID` | `P0009` | 400 | Feature 001 | Organization UUID format invalid |
| `PRODUCT_SKU_EXISTS` | `P0010` | 409 | Feature 003 | Barcode or SKU already assigned to another product |
| `INSUFFICIENT_STOCK` | `P0011` | 422 | Feature 004 | Inventory balance is less than requested sale quantity |
| `NON_POSITIVE_QUANTITY` | `P0012` | 422 | Feature 004 / 005 | Quantity submitted is $\le 0.0000$ |
| `INTEGER_QUANTITY_REQUIRED` | `P0015` | 422 | Feature 004 / 005 | Fractional quantity submitted for discrete UOM |
| `DECIMAL_PRECISION_EXCEEDED` | `P0016` | 422 | Feature 004 / 005 | Quantity or price exceeds 4 decimal places of scale |
| `INVALID_MOVEMENT_TYPE` | `P0020` | 422 | Feature 004 | Unknown movement type submitted to core ledger |
| `PRODUCT_ARCHIVED_STOCK_FORBIDDEN` | `P0021` | 422 | Feature 004 | Sale or movement attempted on archived product |
| `PRODUCT_INACTIVE_RESTOCK_BLOCKED` | `P0022` | 422 | Feature 004 | Restock attempted on inactive product |
| `PRODUCT_INACTIVE_INTERNAL_USE_BLOCKED`| `P0023` | 422 | Feature 004 | Internal use attempted on inactive product |
| `IDEMPOTENCY_CONFLICT` | `P0024` | 409 | Feature 004 / 005 | Idempotency key reused with conflicting payload hash |
| `STALE_VERSION_CONFLICT` | `P0027` | 409 | Feature 004 / 005 | Optimistic concurrency mismatch on inventory version |
| `QUANTITY_EXCEEDS_MAXIMUM` | `P0028` | 422 | Feature 004 / 005 | Quantity exceeds `999,999,999.9999` limit |
| `PRODUCT_INACTIVE_SALE_BLOCKED` | `P0031` | 422 | Feature 004 / 005 | Direct sale attempted on inactive product |
| `RESERVED_MOVEMENT_TYPE_BLOCKED`| `P0032` | 422 | Feature 004 Authoritative | Direct client submission of `sale` or `return` on Layer 2 wrapper |
| `INVALID_QUANTITY_SEMANTICS` | `P0033` | 422 | Feature 004 | Unknown quantity semantics in stock movement |
| `CUSTOMER_NOT_FOUND` | `P0040` | 404 | Feature 005 New | Specified customer ID does not exist in organization |
| `CUSTOMER_ARCHIVED` | `P0041` | 422 | Feature 005 New | Archived customer cannot be attached to a new sale |
| `CUSTOMER_HAS_SALES_DELETE_BLOCKED`| `P0042` | 409 | Feature 005 New | Customer with sales history cannot be hard deleted |
| `SALE_EMPTY_CART` | `P0043` | 422 | Feature 005 New | Checkout attempted with zero line items |
| `DUPLICATE_CART_PRODUCT` | `P0044` | 422 | Feature 005 New | Cart contains duplicate entries for same product ID |
| `PAYMENT_INCOMPLETE` | `P0045` | 422 | Feature 005 New | Sum of payment tenders is less than sale total amount |
| `PAYMENT_EXCEEDS_PAYABLE_AMOUNT` | `P0046` | 422 | Feature 005 New | Non-cash tender exceeds payable amount |
| `DISCOUNT_EXCEEDS_MAXIMUM` | `P0047` | 422 | Feature 005 New | Discount exceeds line gross total or order subtotal |
| `SALE_NOT_FOUND` | `P0048` | 404 | Feature 005 New | Specified sale ID does not exist in organization |
| `SALE_NOT_COMPLETED` | `P0049` | 422 | Feature 005 New | Referenced sale status is not `completed` |
| `SALE_ALREADY_VOIDED` | `P0050` | 422 | Feature 005 New | Attempted to void or return an already voided sale |
| `SALE_VOID_HAS_RETURNS_BLOCKED` | `P0051` | 422 | Feature 005 New | Sale cannot be voided after returns have been processed |
| `RETURN_QUANTITY_EXCEEDS_SOLD` | `P0052` | 422 | Feature 005 New | Return quantity exceeds net remaining sold quantity |
| `RETURN_REASON_REQUIRED` | `P0053` | 422 | Feature 005 New | Return reason string is empty or less than 3 chars |
| `REFUND_EXCEEDS_PAYABLE` | `P0054` | 422 | Feature 005 New | Cumulative refunds exceed original charged sale amount |
| `IDEMPOTENCY_KEY_REQUIRED` | `P0055` | 422 | Feature 005 New | Missing or null UUID idempotency key on mutation |
| `PRODUCT_INACTIVE_RETURN_BLOCKED` | `P0056` | 422 | Feature 005 New | Customer return with restock attempted on inactive product |
| `PAYMENT_REFERENCE_REQUIRED` | `P0057` | 422 | Feature 005 New | Missing transaction reference on non-cash payment tender |
| `REFUND_NOT_FOUND` | `P0058` | 404 | Feature 005 New | Specified refund ID does not exist in organization |
| `EXTERNAL_REVERSAL_REFERENCE_REQUIRED`| `P0059`| 422 | Feature 005 New | Missing or empty external provider reference when executing confirm_refund_reimbursement |
| `DUPLICATE_RETURN_ITEM` | `P0060` | 422 | Feature 005 New | Duplicate entries for same sale_item_id in return request |
| `REFUND_METHOD_EXCEEDS_ORIGINAL_TENDER`| `P0061`| 422 | Feature 005 New | Refund amount exceeds original tender amount on split-tender sale |
| `REFUND_ALREADY_SETTLED` | `P0062` | 422 | Feature 005 New | Attempted to confirm or fail a non-pending refund |
| `RETURN_NOT_FOUND` | `P0063` | 404 | Feature 005 New | Specified return ID does not exist in organization |
| `REPLACEMENT_REFUND_ALREADY_EXISTS` | `P0064` | 409 | Feature 005 New | A non-failed replacement refund already exists for this failed refund |
| `REFUND_NOT_FAILED` | `P0065` | 422 | Feature 005 New | Attempted to issue replacement for a refund that is not in failed status |
| `OBLIGATION_ALREADY_COMPLETED` | `P0067` | 422 | Feature 005 New | Attempted to issue replacement for an obligation that has already been successfully reimbursed (`status = 'completed'` exists on obligation chain) |
| `CUSTOMER_PHONE_EXISTS` | `23505` | 409 | Feature 005 New | Phone number already registered to active customer |
| `CUSTOMER_EMAIL_EXISTS` | `23505` | 409 | Feature 005 New | Email address already registered to active customer |
| `PAYMENT_REFERENCE_EXISTS` | `23505` | 409 | Feature 005 New | External payment transaction reference already recorded |

---

### 3. RBAC Permission Catalog Alignment

All Feature 005 permissions strictly follow the colon-delimited `<resource>:<action>` convention:

| Permission Key | Description | Roles Assigned | Exposes Sensitive Cost? |
|---|---|---|:---:|
| `customers:read` | View customer profiles and search customers | Owner, Admin, Manager, Cashier | No |
| `customers:create` | Create customer profiles (inline or standalone) | Owner, Admin, Manager, Cashier | No |
| `customers:update` | Update customer contact information | Owner, Admin, Manager, Cashier | No |
| `customers:archive` | Archive customer profiles | Owner, Admin, Manager | No |
| `sales:read` | View sales history, search receipts, print receipts | Owner, Admin, Manager, Cashier | No |
| `sales:create` | Create carts and execute sales checkouts | Owner, Admin, Manager, Cashier | No |
| `sales:void` | Void/cancel completed sales, reverse stock, issue replacement refunds | Owner, Admin, Manager | No |
| `returns:read` | View return records and refund histories | Owner, Admin, Manager, Cashier | No |
| `returns:create` | Process returns, restore stock, disburse refunds, issue replacement refunds | Owner, Admin, Manager | No |
| `payments:read` | View payment tenders and payment methods | Owner, Admin, Manager, Cashier | No |
| `refunds:read` | View refund disbursement records | Owner, Admin, Manager | No |
| `tax_settings:update` | Update organization tax rates, naming, and inclusive/exclusive mode | Owner, Admin | No |

*Cost Visibility Restriction*: Viewing `sale_items.unit_cost` and profit margin reports requires **BOTH** `inventory:read_valuation` AND `products:read_cost` permissions. Cashier API projections lacking either permission mask `unit_cost` as `null`.

---

### 4. Table-by-Table Row-Level Security (RLS) Policy Specifications

To guarantee tenant isolation and protect immutable accounting ledgers:

1. **`public.customers`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'customers:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via trusted server procedures `create_customer`, `update_customer`, `archive_customer`).
2. **`public.organization_tax_settings`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.is_org_member(organization_id, auth.uid())`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only by Owner/Admin via trusted administrative procedure `update_tax_settings`).
3. **`public.sales`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'sales:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `execute_sale`, `void_sale`, `execute_sale_return`, `confirm_refund_reimbursement`, `record_refund_failure`, `issue_replacement_refund`).
4. **`public.sale_items`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'sales:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `execute_sale`).
5. **`public.payments`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'payments:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `execute_sale`).
6. **`public.sale_returns`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'returns:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `execute_sale_return`).
7. **`public.sale_return_items`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'returns:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `execute_sale_return`).
8. **`public.refunds`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT: `public.check_user_permission(organization_id, auth.uid(), 'refunds:read')`
   - INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Mutated only via `void_sale`, `execute_sale_return`, `confirm_refund_reimbursement`, `record_refund_failure`, `issue_replacement_refund`).
9. **`public.sale_sequences`**:
   - `ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;`
   - SELECT / INSERT / UPDATE / DELETE: `FOR ALL TO authenticated USING (false) WITH CHECK (false);` (Manipulated exclusively by trusted RPCs running as function owner `postgres`).

---

## Ambiguity Register & Clarifications

### Clarification 1: Return Window Policy
- **Context**: Retail organizations often enforce a cutoff after which items cannot be returned (e.g., 30 days from sale date).
- **Final Decision (Session 2026-11-17)**: Option A (Manager Discretion Ã¢â‚¬â€ No Hardcoded Date Limit). Return eligibility is governed strictly by operator authorization (`returns:create`) and remaining unreturned quantity (`quantity <= sold_quantity - prior_returns`). No automated calendar cutoff is enforced at the database level in MVP, allowing store managers business discretion to accept legitimate returns.
- **Impact**: Organizations have full operational flexibility; organization-configurable calendar cutoffs are cleanly deferred to future policy settings without database schema breaking changes.

### Clarification 2: Discount Authority & Caps
- **Context**: Retail organizations must balance rapid cashier checkout against unauthorized markdown risk.
- **Final Decision (Session 2026-11-17)**: Option A (Open Cashier Discounts Ã¢â‚¬â€ Subtotal-Bounded). Cashiers holding `sales:create` can apply line-item and order discounts directly in the POS cart, bounded so that line discounts cannot exceed line totals (`line_discount_amount <= quantity * unit_price`) and cart discounts cannot exceed order subtotal (`order_discount_amount <= subtotal`), guaranteeing non-negative totals. Dedicated manager override workflows and configurable percentage caps are deferred to future advanced POS policy settings.
- **Impact**: Preserves rapid cashier checkout workflow without requiring constant supervisor interruptions, while mathematically preventing negative sale totals or negative line item totals.
