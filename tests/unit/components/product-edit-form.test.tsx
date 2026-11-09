import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductEditForm } from "@/components/products/ProductEditForm";
import type { Product } from "@/types/product";
import * as productActions from "@/actions/product-actions";
import * as imageStorage from "@/lib/products/image-storage";
import { useRouter } from "next/navigation";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock actions
vi.mock("@/actions/product-actions", () => ({
  updateProductAction: vi.fn(),
  getSignedProductImageUrlAction: vi.fn(),
}));

// Mock Supabase client & image-storage
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/products/image-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof imageStorage>();
  return {
    ...actual,
    uploadProductImage: vi.fn(),
    removeProductImage: vi.fn(),
  };
});

describe("T042 / F-01: ProductEditForm Component Unit Tests", () => {
  const mockSlug = "test-store";
  const mockRouter = {
    push: vi.fn(),
    refresh: vi.fn(),
  };

  const sampleProduct: Product = {
    id: "prod-1111-2222-3333",
    organizationId: "org-aaaa-bbbb-cccc",
    name: "Original Widget",
    description: "Original description",
    sku: "WIDGET-001",
    barcode: "123456789012",
    categoryId: "cat-1",
    sellingPrice: 49.99,
    costPrice: 25.0,
    unitOfMeasure: "piece",
    imageUrl: "org-aaaa-bbbb-cccc/prod-1111-2222-3333/original.png",
    status: "active",
    version: 3,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    createdBy: "user-1",
    updatedBy: "user-1",
  };

  const sampleCategories = [
    { id: "cat-1", name: "Electronics", status: "active" as const },
    { id: "cat-2", name: "Hardware", status: "active" as const },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter as any);
    if (typeof window !== "undefined") {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/fake-edit-preview");
      window.URL.revokeObjectURL = vi.fn();
    }
    vi.mocked(productActions.getSignedProductImageUrlAction).mockResolvedValue({
      success: true,
      data: { signedUrl: "https://storage.supabase.co/signed/original.png", expiresIn: 3600 },
    });
  });

  describe("Initial Render & Field Pre-population", () => {
    it("renders pre-populated product fields, version badge, and edit mode image uploader", async () => {
      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      expect(screen.getByDisplayValue("Original Widget")).toBeInTheDocument();
      expect(screen.getByDisplayValue("WIDGET-001")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Original description")).toBeInTheDocument();
      expect(screen.getByDisplayValue("123456789012")).toBeInTheDocument();
      expect(screen.getByDisplayValue("49.99")).toBeInTheDocument();
      expect(screen.getByText("v3")).toBeInTheDocument();

      // ProductImageUploader should be present in edit mode displaying current image
      await waitFor(() => {
        expect(productActions.getSignedProductImageUrlAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.imageUrl
        );
        expect(screen.getByText("Current image")).toBeInTheDocument();
      });
    });

    it("hides cost management section when canReadCost is false", () => {
      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={false}
          slug={mockSlug}
        />
      );

      expect(screen.queryByText("Financial & Cost Management")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Cost Price/i)).not.toBeInTheDocument();
    });
  });

  describe("Submitting Without Image Change", () => {
    it("preserves existing image_url and passes expected_version when saving without image change", async () => {
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: { ...sampleProduct, name: "Updated Widget Name", version: 4 } as any,
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      const nameInput = screen.getByDisplayValue("Original Widget");
      fireEvent.change(nameInput, { target: { value: "Updated Widget Name" } });

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(imageStorage.uploadProductImage).not.toHaveBeenCalled();
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.id,
          expect.objectContaining({
            expected_version: 3,
            name: "Updated Widget Name",
            image_url: sampleProduct.imageUrl,
            cost_operation: "unchanged",
          })
        );
        expect(mockRouter.push).toHaveBeenCalledWith(`/${mockSlug}/products/${sampleProduct.id}`);
      });
    });
  });

  describe("Submitting With Replacement Image File (F-01)", () => {
    it("uploads new image to storage first, then associates new storage path via updateProductAction", async () => {
      const newStoragePath = `${sampleProduct.organizationId}/${sampleProduct.id}/replacement.png`;
      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: true,
        path: newStoragePath,
      });
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: { ...sampleProduct, version: 4, imageUrl: newStoragePath } as any,
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      // Select replacement file
      const fileInput = screen.getByTestId("product-image-file-input");
      const newFile = new File(["new image data"], "replacement.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [newFile] } });

      await waitFor(() => {
        expect(screen.getByText("replacement.png")).toBeInTheDocument();
        expect(screen.getByText("New image selected")).toBeInTheDocument();
      });

      // Submit form
      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Uploaded first
        expect(imageStorage.uploadProductImage).toHaveBeenCalledWith(
          expect.anything(),
          sampleProduct.organizationId,
          sampleProduct.id,
          newFile
        );

        // Updated with new path and OCC version
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.id,
          expect.objectContaining({
            expected_version: 3,
            image_url: newStoragePath,
          })
        );

        expect(mockRouter.push).toHaveBeenCalledWith(`/${mockSlug}/products/${sampleProduct.id}`);
      });
    });

    it("aborts and preserves existing image when file upload to storage fails", async () => {
      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: false,
        error: "Bucket storage quota exceeded",
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input");
      const newFile = new File(["bytes"], "replacement.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [newFile] } });

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Failed to upload product image: Bucket storage quota exceeded/i)).toBeInTheDocument();
        expect(productActions.updateProductAction).not.toHaveBeenCalled();
      });
    });
  });

  describe("Submitting With Image Removal (F-01)", () => {
    it("submits image_url: null when image is removed", async () => {
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: { ...sampleProduct, version: 4, imageUrl: null } as any,
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Current image")).toBeInTheDocument();
      });

      // Click Remove button
      const removeBtn = screen.getByRole("button", { name: /remove product image/i });
      fireEvent.click(removeBtn);

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.id,
          expect.objectContaining({
            expected_version: 3,
            image_url: null,
          })
        );
      });
    });
  });

  describe("OCC Conflict Handling & Rollback Deduplication (P0010)", () => {
    it("triggers ConcurrencyConflictModal on conflict and relies on server rollback to prevent duplicate cleanup", async () => {
      const newStoragePath = `${sampleProduct.organizationId}/${sampleProduct.id}/conflict-test.png`;
      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: true,
        path: newStoragePath,
      });
      vi.mocked(imageStorage.removeProductImage).mockResolvedValueOnce({
        success: true,
      });
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: false,
        error: {
          code: "P0010",
          message: "Conflict: product has been modified by another user.",
        },
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input");
      const newFile = new File(["bytes"], "conflict-test.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [newFile] } });

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Conflict modal opened
        expect(screen.getByText("Stale Update Conflict")).toBeInTheDocument();
        expect(screen.getByText(/P0010/i)).toBeInTheDocument();

        // Server action authoritatively handled rollback; client avoided duplicate deletion
        expect(imageStorage.removeProductImage).not.toHaveBeenCalled();
      });
    });

    it("triggers client-side fallback rollback cleanup when updateProductAction throws an unexpected exception", async () => {
      const newStoragePath = `${sampleProduct.organizationId}/${sampleProduct.id}/network-fail.png`;
      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: true,
        path: newStoragePath,
      });
      vi.mocked(imageStorage.removeProductImage).mockResolvedValueOnce({
        success: true,
      });
      vi.mocked(productActions.updateProductAction).mockRejectedValueOnce(
        new Error("Network connection dropped during update")
      );

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input");
      const newFile = new File(["bytes"], "network-fail.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [newFile] } });

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Client-side fallback rollback cleanup was called
        expect(imageStorage.removeProductImage).toHaveBeenCalledWith(
          expect.anything(),
          newStoragePath,
          expect.objectContaining({
            operation: "rollback_new_image",
            organizationId: sampleProduct.organizationId,
            productId: sampleProduct.id,
          })
        );

        // Error message rendered in UI
        expect(screen.getByText("Network connection dropped during update")).toBeInTheDocument();
      });
    });
  });

  describe("Cost Management Operations", () => {
    it("allows updating cost price with cost_operation: 'set'", async () => {
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: { ...sampleProduct, version: 4 } as any,
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      // Select 'Update Cost' radio button
      const setRadio = screen.getByRole("radio", { name: /(Update|Set) Cost/i });
      fireEvent.click(setRadio);

      const costInput = screen.getByLabelText(/New Cost Price/i);
      fireEvent.change(costInput, { target: { value: "29.50" } });

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.id,
          expect.objectContaining({
            cost_operation: "set",
            cost_price: 29.5,
          })
        );
      });
    });

    it("allows clearing cost price with cost_operation: 'clear'", async () => {
      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: { ...sampleProduct, version: 4 } as any,
      });

      render(
        <ProductEditForm
          product={sampleProduct}
          categories={sampleCategories}
          currency="USD"
          canReadCost={true}
          slug={mockSlug}
        />
      );

      // Select 'Clear Cost' radio button
      const clearRadio = screen.getByRole("radio", { name: /Clear Cost/i });
      fireEvent.click(clearRadio);

      const saveBtn = screen.getByRole("button", { name: /save product/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          sampleProduct.id,
          expect.objectContaining({
            cost_operation: "clear",
            cost_price: undefined,
          })
        );
      });
    });
  });
});
