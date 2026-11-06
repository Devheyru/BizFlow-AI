# Server Actions Contract: Feature 003 — Products & Categories

**Feature Branch**: `003-products-categories`  
**Date**: 2026-11-06 (Reconciled with Approved Specification)  
**Status**: Authoritative Action Contracts  
**Governing Documents**:
- [BizFlow AI Constitution v1.1.0](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/.specify/memory/constitution.md)
- [Feature 003 Specification](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/spec.md)
- [Feature 003 Database RPCs](file:///c:/Users/Heyru/Desktop/projects/BizFlow-AI/specs/003-products-categories/contracts/database-rpcs.md)

---

## 1. Architectural Standards & Common Flow

Every Server Action in `src/actions/product-actions.ts` and `src/actions/category-actions.ts` executes the following invariant pipeline:

1. **Directive**: Mandatory `'use server'` at file root; imports `import 'server-only'`.
2. **Tenant Context Resolution**:
   ```typescript
   const { organization, membership, user } = await resolveTenantContext(slug);
   ```
   Throws or redirects to 404 if tenant context or active membership cannot be established.
3. **Application Permission Guard**:
   ```typescript
   if (!hasPermission({ organization, membership }, requiredPermission)) {
     return { success: false, error: 'Unauthorized: insufficient permissions.', code: 'FORBIDDEN' };
   }
   ```
4. **Zod Input Validation**:
   - Parses incoming payload against strict schemas (defined in `src/lib/validations/product.ts` and `src/lib/validations/category.ts`).
   - Normalizes SKU via `.trim().toUpperCase()`.
   - Validates UOM against the 13 allowed retail values.
   - Enforces monetary decimal precision against `SUPPORTED_CURRENCIES[organization.currency]`.
5. **Database RPC Invocation**:
   - Executes via authenticated Supabase server client: `const supabase = await createServerClient()`.
   - Invokes target `SECURITY DEFINER` function with tenant ID and named parameters matching database RPC signatures.
6. **Unified Error Code Mapping**:
   - Catches PostgreSQL error codes (`P0001`-`P0016`) and maps each code to exactly one application error constant:
     - `P0001` $\rightarrow$ `EMAIL_UNVERIFIED`
     - `P0002` $\rightarrow$ `RESOURCE_NOT_FOUND`
     - `P0003` $\rightarrow$ `UNAUTHENTICATED`
     - `P0004` $\rightarrow$ `UNAUTHORIZED_MEMBERSHIP`
     - `P0005` $\rightarrow$ `FORBIDDEN`
     - `P0006` $\rightarrow$ `IDENTIFIER_EXISTS`
     - `P0007` $\rightarrow$ `NEGATIVE_PRICE`
     - `P0008` $\rightarrow$ `MISSING_REQUIRED_PRICE`
     - `P0009` $\rightarrow$ `VALIDATION_ERROR`
     - `P0010` $\rightarrow$ `CONCURRENCY_CONFLICT`
     - `P0015` $\rightarrow$ `STATE_CONFLICT`
     - `P0016` $\rightarrow$ `INVALID_COST_OPERATION`
7. **Confidential Projection Stripping**:
   - Evaluates `hasPermission({ organization, membership }, 'products:read_cost')`.
   - If false, strips `cost_price` and derived `gross_margin` before serialization.
8. **Cache Invalidation**:
   - Calls `revalidatePath('/[slug]/products', 'page')`, `revalidatePath('/[slug]/products/[productId]', 'page')`, etc.
9. **Return Payload**:
   - Typed discriminated union: `{ success: true, data: T } | { success: false, error: string, code?: string, fieldErrors?: Record<string, string[]> }`.

---

## 2. Category Server Actions (`src/actions/category-actions.ts`)

### 2.1 `createCategoryAction`

- **Signature**:
  ```typescript
  export async function createCategoryAction(
    slug: string,
    rawInput: unknown
  ): Promise<ActionResult<CategoryResponse>>;
  ```
- **Required Permission**: `categories:create`
- **Zod Schema**:
  ```typescript
  export const CreateCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required').max(100, 'Name must be 100 characters or less'),
    description: z.string().trim().max(500, 'Description must be 500 characters or less').optional().nullable(),
  });
  ```
- **RPC Invocation**:
  ```typescript
  supabase.rpc('create_product_category', {
    p_org_id: organization.id,
    p_name: input.name,
    p_description: input.description ?? null,
  });
  ```
- **Cache Invalidation**: `revalidatePath('/[slug]/products', 'layout')`, `revalidatePath('/[slug]/products/categories', 'page')`

---

### 2.2 `updateCategoryAction`

- **Signature**:
  ```typescript
  export async function updateCategoryAction(
    slug: string,
    categoryId: string,
    rawInput: unknown
  ): Promise<ActionResult<CategoryResponse>>;
  ```
- **Required Permission**: `categories:update`
- **Zod Schema**:
  ```typescript
  export const UpdateCategorySchema = z.object({
    name: z.string().trim().min(1, 'Category name is required').max(100, 'Name must be 100 characters or less'),
    description: z.string().trim().max(500, 'Description must be 500 characters or less').optional().nullable(),
  });
  ```
- **RPC Invocation**:
  ```typescript
  supabase.rpc('update_product_category', {
    p_org_id: organization.id,
    p_category_id: categoryId,
    p_name: input.name,
    p_description: input.description ?? null,
  });
  ```
- **Cache Invalidation**: `revalidatePath('/[slug]/products', 'layout')`

---

### 2.3 `archiveCategoryAction`

- **Signature**:
  ```typescript
  export async function archiveCategoryAction(
    slug: string,
    categoryId: string
  ): Promise<ActionResult<{ id: string; status: 'archived'; archived_at: string }>>;
  ```
- **Required Permission**: `categories:archive`
- **RPC Invocation**:
  ```typescript
  supabase.rpc('archive_product_category', {
    p_org_id: organization.id,
    p_category_id: categoryId,
  });
  ```
- **Cache Invalidation**: `revalidatePath('/[slug]/products', 'layout')`

---

### 2.4 `restoreCategoryAction`

- **Signature**:
  ```typescript
  export async function restoreCategoryAction(
    slug: string,
    categoryId: string
  ): Promise<ActionResult<{ id: string; status: 'active'; archived_at: null }>>;
  ```
- **Required Permission**: `categories:archive`
- **RPC Invocation**:
  ```typescript
  supabase.rpc('restore_product_category', {
    p_org_id: organization.id,
    p_category_id: categoryId,
  });
  ```
- **Cache Invalidation**: `revalidatePath('/[slug]/products', 'layout')`

---

## 3. Product Server Actions (`src/actions/product-actions.ts`)

### 3.1 `createProductAction`

- **Signature**:
  ```typescript
  export async function createProductAction(
    slug: string,
    rawInput: unknown
  ): Promise<ActionResult<ProductDetailResponse>>;
  ```
- **Required Permissions**:
  - `products:create`
  - If `cost_price` is provided (not null/undefined), additionally requires `products:read_cost`
- **Zod Schema (No cost_operation)**:
  ```typescript
  export const ALLOWED_UOM = [
    'piece', 'unit', 'kg', 'g', 'mg', 'liter', 'ml', 'meter', 'cm', 'box', 'pack', 'pair', 'set'
  ] as const;

  export const CreateProductSchema = z.object({
    name: z.string().trim().min(1, 'Product name is required').max(150, 'Name must be 150 characters or less'),
    sku: z.string().trim().min(1, 'SKU is required').max(50, 'SKU must be 50 characters or less').regex(/^[A-Za-z0-9._-]+$/, 'SKU contains invalid characters').transform((v) => v.toUpperCase()),
    selling_price: z.number().min(0, 'Selling price must be greater than or equal to 0'),
    unit_of_measure: z.enum(ALLOWED_UOM).default('piece'),
    barcode: z.string().trim().min(3, 'Barcode must be at least 3 characters').max(50, 'Barcode must be 50 characters or less').regex(/^[A-Za-z0-9-]{3,50}$/, 'Barcode contains invalid characters').optional().nullable(),
    description: z.string().trim().max(2000, 'Description must be 2000 characters or less').optional().nullable(),
    category_id: z.string().uuid('Invalid category ID').optional().nullable(),
    cost_price: z.number().min(0, 'Cost price must be greater than or equal to 0').optional().nullable(),
    image_url: z.string().trim().refine(
      (val) => /^https:\/\/.+/.test(val) || /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(val),
      { message: 'Image URL must be a valid external HTTPS URL or internal storage object name' }
    ).optional().nullable(),
  });
  ```
- **Authorization & Pre-Flight Logic**:
  ```typescript
  if (!hasPermission({ organization, membership }, 'products:create')) {
    return { success: false, error: 'Unauthorized: missing products:create permission.', code: 'FORBIDDEN' };
  }

  // Enforce products:read_cost whenever a cost price is supplied
  if (input.cost_price !== undefined && input.cost_price !== null) {
    if (!hasPermission({ organization, membership }, 'products:read_cost')) {
      return { success: false, error: 'Unauthorized: setting product cost requires products:read_cost permission.', code: 'FORBIDDEN' };
    }
  }
  ```
- **RPC Invocation (Explicit Initial Status 'active', No cost_operation)**:
  ```typescript
  const { data, error } = await supabase.rpc('create_product', {
    p_org_id: organization.id,
    p_name: input.name,
    p_sku: input.sku,
    p_selling_price: input.selling_price,
    p_unit_of_measure: input.unit_of_measure,
    p_status: 'active',
    p_barcode: input.barcode ?? null,
    p_description: input.description ?? null,
    p_category_id: input.category_id ?? null,
    p_cost_price: input.cost_price ?? null,
    p_image_url: input.image_url ?? null,
  });
  ```
- **Cache Invalidation**: `revalidatePath('/[slug]/products', 'page')`

---

### 3.2 `updateProductAction`

- **Signature**:
  ```typescript
  export async function updateProductAction(
    slug: string,
    productId: string,
    rawInput: unknown
  ): Promise<ActionResult<ProductDetailResponse>>;
  ```
- **Required Permissions**:
  - `products:update`
  - If `cost_operation IN ('set', 'clear')`, requires `products:read_cost`
- **Zod Schema**:
  ```typescript
  export const UpdateProductSchema = z.object({
    expected_version: z.number().int().min(1, 'Expected version is required'),
    name: z.string().trim().min(1, 'Product name is required').max(150),
    sku: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/).transform((v) => v.toUpperCase()),
    selling_price: z.number().min(0),
    unit_of_measure: z.enum(ALLOWED_UOM).default('piece'),
    barcode: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9-]{3,50}$/).optional().nullable(),
    description: z.string().trim().max(2000).optional().nullable(),
    category_id: z.string().uuid().optional().nullable(),
    cost_operation: z.enum(['unchanged', 'set', 'clear']).default('unchanged'),
    cost_price: z.number().min(0).optional().nullable(),
    image_url: z.string().trim().refine(
      (val) => /^https:\/\/.+/.test(val) || /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(val),
      { message: 'Image URL must be a valid external HTTPS URL or internal storage object name' }
    ).optional().nullable(),
  }).refine((data) => {
    if (data.cost_operation === 'set' && (data.cost_price === undefined || data.cost_price === null)) {
      return false;
    }
    return true;
  }, {
    message: 'Cost price is required when cost operation is set',
    path: ['cost_price'],
  });
  ```
- **RPC Invocation**:
  ```typescript
  const { data, error } = await supabase.rpc('update_product', {
    p_org_id: organization.id,
    p_product_id: productId,
    p_expected_version: input.expected_version,
    p_name: input.name,
    p_sku: input.sku,
    p_selling_price: input.selling_price,
    p_unit_of_measure: input.unit_of_measure,
    p_barcode: input.barcode ?? null,
    p_description: input.description ?? null,
    p_category_id: input.category_id ?? null,
    p_cost_price: input.cost_price ?? null,
    p_cost_operation: input.cost_operation,
    p_image_url: input.image_url ?? null,
  });
  ```
- **Image Replacement Cleanup**:
  - If `input.image_url` replaced an existing Storage object name, upon successful RPC commit, invoke:
    `supabase.storage.from('product-images').remove([oldImagePath])`.
- **Cache Invalidation**:
  `revalidatePath('/[slug]/products', 'page')`, `revalidatePath('/[slug]/products/' + productId, 'page')`

---

### 3.3 `toggleProductStatusAction`

- **Signature**:
  ```typescript
  export async function toggleProductStatusAction(
    slug: string,
    productId: string,
    expectedVersion: number,
    newStatus: 'active' | 'inactive'
  ): Promise<ActionResult<{ id: string; status: 'active' | 'inactive'; version: number }>>;
  ```
- **Required Permission**: `products:update`
- **RPC Invocation**:
  ```typescript
  supabase.rpc('toggle_product_status', {
    p_org_id: organization.id,
    p_product_id: productId,
    p_expected_version: expectedVersion,
    p_new_status: newStatus,
  });
  ```
- **Cache Invalidation**:
  `revalidatePath('/[slug]/products', 'page')`, `revalidatePath('/[slug]/products/' + productId, 'page')`

---

### 3.4 `archiveProductAction`

- **Signature**:
  ```typescript
  export async function archiveProductAction(
    slug: string,
    productId: string,
    expectedVersion: number
  ): Promise<ActionResult<{ id: string; status: 'archived'; version: number; archived_at: string }>>;
  ```
- **Required Permission**: `products:archive`
- **RPC Invocation**:
  ```typescript
  supabase.rpc('archive_product', {
    p_org_id: organization.id,
    p_product_id: productId,
    p_expected_version: expectedVersion,
  });
  ```
- **Cache Invalidation**:
  `revalidatePath('/[slug]/products', 'page')`, `revalidatePath('/[slug]/products/' + productId, 'page')`

---

### 3.5 `restoreProductAction`

- **Signature**:
  ```typescript
  export async function restoreProductAction(
    slug: string,
    productId: string,
    expectedVersion: number
  ): Promise<ActionResult<{ id: string; status: 'active'; version: number; archived_at: null }>>;
  ```
- **Required Permission**: `products:archive`
- **RPC Invocation**:
  ```typescript
  supabase.rpc('restore_product', {
    p_org_id: organization.id,
    p_product_id: productId,
    p_expected_version: expectedVersion,
  });
  ```
- **Cache Invalidation**:
  `revalidatePath('/[slug]/products', 'page')`, `revalidatePath('/[slug]/products/' + productId, 'page')`

---

### 3.6 `getSignedProductImageUrlAction`

- **Signature**:
  ```typescript
  export async function getSignedProductImageUrlAction(
    slug: string,
    imagePath: string
  ): Promise<ActionResult<{ signedUrl: string; expiresIn: number }>>;
  ```
- **Required Permission**: `products:read`
- **Dual URL Protocol**:
  ```typescript
  // 1. External HTTPS URL: return as-is without invoking Storage API
  if (imagePath.startsWith('https://')) {
    return { success: true, data: { signedUrl: imagePath, expiresIn: 0 } };
  }

  // 2. Internal Storage relative object name: verify tenant folder prefix
  if (!imagePath.startsWith(`${organization.id}/`)) {
    return { success: false, error: 'Unauthorized image path', code: 'FORBIDDEN' };
  }

  // 3. Generate short-lived signed URL (3600 seconds = 1 hour)
  const { data, error } = await supabase.storage
    .from('product-images')
    .createSignedUrl(imagePath, 3600);

  if (error || !data?.signedUrl) {
    return { success: false, error: 'Failed to generate signed image URL', code: 'STORAGE_ERROR' };
  }

  return { success: true, data: { signedUrl: data.signedUrl, expiresIn: 3600 } };
  ```
