import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductForm, type CategoryOption } from "@/components/products/ProductForm";
import * as productActions from "@/actions/product-actions";
import * as imageStorage from "@/lib/products/image-storage";

// Mock next/navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

// Mock Supabase client
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn(),
        remove: vi.fn(),
      }),
    },
  }),
}));

// Mock product-actions
vi.mock("@/actions/product-actions", () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
  getSignedProductImageUrlAction: vi.fn(),
}));

// Mock image-storage
vi.mock("@/lib/products/image-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof imageStorage>();
  return {
    ...actual,
    uploadProductImage: vi.fn(),
    removeProductImage: vi.fn(),
  };
});

describe("T033: ProductForm Component Unit Tests (FR-001 to FR-016, FR-039, FR-042)", () => {
  const mockSlug = "organic-market";
  const mockOrgId = "11111111-1111-4111-a111-111111111111";
  const mockCurrency = "USD";

  const mockCategories: CategoryOption[] = [
    { id: "cat-1", name: "Beverages" },
    { id: "cat-2", name: "Dairy & Eggs" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== "undefined") {
      window.URL.createObjectURL = vi.fn().mockReturnValue("blob:http://localhost/fake-blob");
      window.URL.revokeObjectURL = vi.fn();
    }
  });

  describe("Form Fields & Role-Based Rendering", () => {
    it("renders all standard product inputs matching schema", () => {
      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      expect(screen.getByLabelText(/product name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/stock keeping unit/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/unit of measure/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/selling price/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/barcode/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    });

    it("renders cost price input when canReadCost is true", () => {
      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={true}
          categories={mockCategories}
        />
      );

      expect(screen.getByLabelText(/cost price/i)).toBeInTheDocument();
    });

    it("does NOT render cost price input when canReadCost is false (Cashier confidentiality)", () => {
      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      expect(screen.queryByLabelText(/cost price/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/confidential/i)).not.toBeInTheDocument();
    });

    it("normalizes SKU input to uppercase automatically", () => {
      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      const skuInput = screen.getByLabelText(/stock keeping unit/i) as HTMLInputElement;
      fireEvent.change(skuInput, { target: { value: "milk-org-001" } });

      expect(skuInput.value).toBe("MILK-ORG-001");
    });

    it("populates active categories and allows Uncategorized selection", () => {
      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      const categorySelect = screen.getByLabelText(/category/i) as HTMLSelectElement;
      expect(categorySelect).toHaveTextContent("Uncategorized (None)");
      expect(categorySelect).toHaveTextContent("Beverages");
      expect(categorySelect).toHaveTextContent("Dairy & Eggs");
    });
  });

  describe("Form Submission & Staged Image Lifecycle", () => {
    it("submits product without image and redirects on success", async () => {
      vi.mocked(productActions.createProductAction).mockResolvedValueOnce({
        success: true,
        data: {
          id: "prod-123",
          organization_id: mockOrgId,
          name: "Fresh Whole Milk",
          sku: "MILK-001",
          barcode: null,
          category_id: null,
          selling_price: 4.5,
          unit_of_measure: "piece",
          status: "active",
          version: 1,
          image_url: null,
          created_at: new Date().toISOString(),
        },
      });

      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      fireEvent.change(screen.getByLabelText(/product name/i), {
        target: { value: "Fresh Whole Milk" },
      });
      fireEvent.change(screen.getByLabelText(/stock keeping unit/i), {
        target: { value: "MILK-001" },
      });
      fireEvent.change(screen.getByLabelText(/selling price/i), {
        target: { value: "4.50" },
      });

      fireEvent.click(screen.getByRole("button", { name: /register product/i }));

      await waitFor(() => {
        expect(productActions.createProductAction).toHaveBeenCalledWith(
          mockSlug,
          expect.objectContaining({
            name: "Fresh Whole Milk",
            sku: "MILK-001",
            selling_price: 4.5,
            image_url: null,
          })
        );
        expect(mockPush).toHaveBeenCalledWith(`/${mockSlug}/products/prod-123`);
      });
    });

    it("executes canonical staged image lifecycle: create product -> upload storage -> update product OCC", async () => {
      const createdProdId = "new-prod-999";
      const uploadedPath = `${mockOrgId}/${createdProdId}/12345_apple.png`;

      vi.mocked(productActions.createProductAction).mockResolvedValueOnce({
        success: true,
        data: {
          id: createdProdId,
          organization_id: mockOrgId,
          name: "Honeycrisp Apples",
          sku: "APPLE-HONEY",
          barcode: null,
          category_id: null,
          selling_price: 3.99,
          unit_of_measure: "kg",
          status: "active",
          version: 1,
          image_url: null,
          created_at: new Date().toISOString(),
        },
      });

      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: true,
        path: uploadedPath,
      });

      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: true,
        data: {
          id: createdProdId,
          organization_id: mockOrgId,
          name: "Honeycrisp Apples",
          sku: "APPLE-HONEY",
          barcode: null,
          category_id: null,
          selling_price: 3.99,
          unit_of_measure: "kg",
          status: "active",
          version: 2,
          image_url: uploadedPath,
          created_at: new Date().toISOString(),
        },
      });

      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      // Fill in required fields
      fireEvent.change(screen.getByLabelText(/product name/i), {
        target: { value: "Honeycrisp Apples" },
      });
      fireEvent.change(screen.getByLabelText(/stock keeping unit/i), {
        target: { value: "APPLE-HONEY" },
      });
      fireEvent.change(screen.getByLabelText(/selling price/i), {
        target: { value: "3.99" },
      });

      // Stage an image file
      const fileInput = screen.getByTestId("product-image-file-input");
      const file = new File(["dummy"], "apple.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText("Staged for upload")).toBeInTheDocument();
      });

      // Submit
      fireEvent.click(screen.getByRole("button", { name: /register product/i }));

      await waitFor(() => {
        // Step 1: createProductAction called with image_url: null
        expect(productActions.createProductAction).toHaveBeenCalledWith(
          mockSlug,
          expect.objectContaining({
            image_url: null,
          })
        );

        // Step 2: Storage upload called with returned product ID
        expect(imageStorage.uploadProductImage).toHaveBeenCalledWith(
          expect.anything(),
          mockOrgId,
          createdProdId,
          file
        );

        // Step 3: updateProductAction called with expected_version: 1 and storagePath
        expect(productActions.updateProductAction).toHaveBeenCalledWith(
          mockSlug,
          createdProdId,
          expect.objectContaining({
            expected_version: 1,
            image_url: uploadedPath,
            cost_operation: "unchanged",
          })
        );

        // Redirects to product page
        expect(mockPush).toHaveBeenCalledWith(`/${mockSlug}/products/${createdProdId}`);
      });
    });

    it("handles image upload failure gracefully without deleting the created product", async () => {
      const createdProdId = "prod-fail-upload";

      vi.mocked(productActions.createProductAction).mockResolvedValueOnce({
        success: true,
        data: {
          id: createdProdId,
          organization_id: mockOrgId,
          name: "Sourdough Bread",
          sku: "BREAD-SOUR",
          barcode: null,
          category_id: null,
          selling_price: 6.0,
          unit_of_measure: "piece",
          status: "active",
          version: 1,
          image_url: null,
          created_at: new Date().toISOString(),
        },
      });

      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: false,
        error: "Storage quota exceeded",
      });

      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      fireEvent.change(screen.getByLabelText(/product name/i), {
        target: { value: "Sourdough Bread" },
      });
      fireEvent.change(screen.getByLabelText(/stock keeping unit/i), {
        target: { value: "BREAD-SOUR" },
      });
      fireEvent.change(screen.getByLabelText(/selling price/i), {
        target: { value: "6.00" },
      });

      const fileInput = screen.getByTestId("product-image-file-input");
      const file = new File(["dummy"], "bread.jpg", { type: "image/jpeg" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      fireEvent.click(screen.getByRole("button", { name: /register product/i }));

      await waitFor(() => {
        // Product was created
        expect(productActions.createProductAction).toHaveBeenCalled();
        // Upload failed
        expect(imageStorage.uploadProductImage).toHaveBeenCalled();
        // updateProductAction was NOT called
        expect(productActions.updateProductAction).not.toHaveBeenCalled();

        // Shows partial success notification with recovery links
        expect(
          screen.getByText(/Product was registered successfully, but the image could not be uploaded/i)
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /view product/i })).toHaveAttribute(
          "href",
          `/${mockSlug}/products/${createdProdId}`
        );
      });
    });

    it("cleans up uploaded storage object if updateProductAction fails", async () => {
      const createdProdId = "prod-fail-assoc";
      const uploadedPath = `${mockOrgId}/${createdProdId}/toast.png`;

      vi.mocked(productActions.createProductAction).mockResolvedValueOnce({
        success: true,
        data: {
          id: createdProdId,
          organization_id: mockOrgId,
          name: "Artisan Toast",
          sku: "TOAST-01",
          barcode: null,
          category_id: null,
          selling_price: 4.0,
          unit_of_measure: "piece",
          status: "active",
          version: 1,
          image_url: null,
          created_at: new Date().toISOString(),
        },
      });

      vi.mocked(imageStorage.uploadProductImage).mockResolvedValueOnce({
        success: true,
        path: uploadedPath,
      });

      vi.mocked(productActions.updateProductAction).mockResolvedValueOnce({
        success: false,
        error: { code: "RPC_ERROR", message: "Concurrent modification" },
      });

      render(
        <ProductForm
          slug={mockSlug}
          organizationId={mockOrgId}
          currency={mockCurrency}
          canReadCost={false}
          categories={mockCategories}
        />
      );

      fireEvent.change(screen.getByLabelText(/product name/i), {
        target: { value: "Artisan Toast" },
      });
      fireEvent.change(screen.getByLabelText(/stock keeping unit/i), {
        target: { value: "TOAST-01" },
      });
      fireEvent.change(screen.getByLabelText(/selling price/i), {
        target: { value: "4.00" },
      });

      const fileInput = screen.getByTestId("product-image-file-input");
      const file = new File(["dummy"], "toast.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [file] } });

      fireEvent.click(screen.getByRole("button", { name: /register product/i }));

      await waitFor(() => {
        // Rollback removal of storage object was executed
        expect(imageStorage.removeProductImage).toHaveBeenCalledWith(
          expect.anything(),
          uploadedPath
        );

        // Shows partial success notification
        expect(
          screen.getByText(/Product was registered successfully, but associating the image failed/i)
        ).toBeInTheDocument();
      });
    });
  });
});

