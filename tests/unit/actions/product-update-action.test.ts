import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateProductAction } from "@/actions/product-actions";
import * as authContext from "@/lib/auth/context";
import * as supabaseServer from "@/lib/supabase/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({
  resolveTenantContext: vi.fn(),
  requireTenantContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Task 1: updateProductAction Storage Cleanup Observability Unit Tests", () => {
  const mockOrgId = "c0000000-0000-4000-8000-000000000001";
  const mockProductId = "b0000000-0000-4000-8000-000000000001";
  const mockSlug = "test-store";

  const ownerContext = {
    user: { id: "u0000000-0000-4000-8000-000000000001", email: "owner@retail.com" },
    organization: { id: mockOrgId, name: "Test Store", slug: mockSlug, currency: "USD", is_active: true },
    membership: { role: "owner", status: "active" },
    role: "owner" as const,
    activeOrganizations: [],
    permissions: [
      "products:read",
      "products:read_cost",
      "products:create",
      "products:update",
      "products:archive",
    ] as any,
  } as any;

  const oldImagePath = `${mockOrgId}/${mockProductId}/old_image.png`;
  const newImagePath = `${mockOrgId}/${mockProductId}/new_image.png`;

  const validUpdateInput = {
    expected_version: 1,
    name: "Updated Product Name",
    sku: "SKU-UPDATE-001",
    selling_price: 25.0,
    unit_of_measure: "piece",
    barcode: "12345678",
    description: "Updated description",
    category_id: null,
    cost_operation: "set" as const,
    cost_price: 15.0,
    image_url: newImagePath,
  };

  const mockRpcSuccessData = {
    id: mockProductId,
    organization_id: mockOrgId,
    name: "Updated Product Name",
    sku: "SKU-UPDATE-001",
    barcode: "12345678",
    category_id: null,
    selling_price: 25.0,
    unit_of_measure: "piece",
    status: "active",
    version: 2,
    image_url: newImagePath,
    created_at: new Date().toISOString(),
    cost_price: 15.0,
  };

  let mockStorageRemove: ReturnType<typeof vi.fn>;
  let mockSupabase: any;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(authContext.resolveTenantContext).mockResolvedValue({
      ok: true,
      context: ownerContext,
    });

    mockStorageRemove = vi.fn().mockResolvedValue({ data: [], error: null });

    mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { image_url: oldImagePath },
                error: null,
              }),
            }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({
        data: { success: true, data: mockRpcSuccessData },
        error: null,
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          remove: mockStorageRemove,
        }),
      },
    };

    vi.mocked(supabaseServer.createClient).mockResolvedValue(mockSupabase);
  });

  it("removes previous image post-commit on successful update and succeeds without errors logged", async () => {
    const result = await updateProductAction(mockSlug, mockProductId, validUpdateInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe(2);

    // Verify storage removal was called on the old image path
    expect(mockStorageRemove).toHaveBeenCalledWith([oldImagePath]);

    // No cleanup error should be logged
    const cleanupErrors = consoleErrorSpy.mock.calls.filter(
      (call) => call[0] === "[STORAGE_CLEANUP_FAILURE]" || call[0] === "[STORAGE_CLEANUP_EXCEPTION]"
    );
    expect(cleanupErrors).toHaveLength(0);
  });

  it("preserves successful DB update even if post-commit cleanup of previous image fails, and logs structured diagnostic", async () => {
    // Storage remove returns an API error
    mockStorageRemove.mockResolvedValueOnce({
      data: null,
      error: { message: "Storage backend connection timeout" },
    });

    const result = await updateProductAction(mockSlug, mockProductId, validUpdateInput);

    // CRITICAL INVARIANT: DB update succeeded, so user action must still succeed!
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(mockProductId);

    // Structured diagnostic MUST be logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[STORAGE_CLEANUP_FAILURE]",
      expect.objectContaining({
        operation: "post_commit_superseded_image",
        organizationId: mockOrgId,
        productId: mockProductId,
        storagePath: oldImagePath,
        errorCategory: "storage_api_error",
        error: "Storage backend connection timeout",
      })
    );
  });

  it("rolls back newly uploaded image when update_product RPC fails with OCC conflict (P0010)", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0010",
        message: "STALE_UPDATE_CONFLICT",
      },
    });

    const result = await updateProductAction(mockSlug, mockProductId, validUpdateInput);

    // Must return the original OCC conflict error
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CONCURRENCY_CONFLICT");

    // Must have attempted to roll back the newly uploaded image
    expect(mockStorageRemove).toHaveBeenCalledWith([newImagePath]);

    // Old image must NOT have been removed
    expect(mockStorageRemove).not.toHaveBeenCalledWith([oldImagePath]);
  });

  it("preserves original RPC conflict error when rollback cleanup fails, and logs structured diagnostic", async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "P0010",
        message: "STALE_UPDATE_CONFLICT",
      },
    });

    // Rollback deletion throws or fails
    mockStorageRemove.mockResolvedValueOnce({
      data: null,
      error: { message: "Internal server error 500" },
    });

    const result = await updateProductAction(mockSlug, mockProductId, validUpdateInput);

    // CRITICAL: Must not overwrite the original P0010 error with a storage error
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("CONCURRENCY_CONFLICT");

    // Diagnostic must be logged for rollback failure
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[STORAGE_CLEANUP_FAILURE]",
      expect.objectContaining({
        operation: "rollback_new_image",
        organizationId: mockOrgId,
        productId: mockProductId,
        storagePath: newImagePath,
        errorCategory: "storage_api_error",
        error: "Internal server error 500",
      })
    );
  });

  it("handles network exceptions thrown during removal and logs [STORAGE_CLEANUP_EXCEPTION]", async () => {
    mockStorageRemove.mockRejectedValueOnce(new Error("Network ECONNRESET"));

    const result = await updateProductAction(mockSlug, mockProductId, validUpdateInput);

    expect(result.success).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[STORAGE_CLEANUP_EXCEPTION]",
      expect.objectContaining({
        operation: "post_commit_superseded_image",
        organizationId: mockOrgId,
        productId: mockProductId,
        storagePath: oldImagePath,
        errorCategory: "network_exception",
        error: "Network ECONNRESET",
      })
    );
  });

  it("does not trigger Storage deletion when updating to an external HTTPS URL", async () => {
    const inputWithExternalUrl = {
      ...validUpdateInput,
      image_url: "https://images.unsplash.com/photo-1546868871-7041f2a55e12",
    };

    const result = await updateProductAction(mockSlug, mockProductId, inputWithExternalUrl);

    expect(result.success).toBe(true);
    // Old image is internal, so it should be removed post commit
    expect(mockStorageRemove).toHaveBeenCalledWith([oldImagePath]);
    // But external URL should never be passed to storage remove
    expect(mockStorageRemove).not.toHaveBeenCalledWith([inputWithExternalUrl.image_url]);
  });

  it("does not trigger Storage deletion when image_url is unchanged", async () => {
    const inputWithUnchangedImage = {
      ...validUpdateInput,
      image_url: oldImagePath,
    };

    const result = await updateProductAction(mockSlug, mockProductId, inputWithUnchangedImage);

    expect(result.success).toBe(true);
    // No storage removal should occur when image is unchanged
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });
});
