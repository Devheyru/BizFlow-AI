import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductTable, ProductThumbnail } from "@/components/products/ProductTable";
import type { ProductListItem } from "@/types/product";
import * as productActions from "@/actions/product-actions";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/test-org/products",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock product actions
vi.mock("@/actions/product-actions", () => ({
  getSignedProductImageUrlAction: vi.fn(),
  toggleProductStatusAction: vi.fn(),
  archiveProductAction: vi.fn(),
  restoreProductAction: vi.fn(),
  getProductStateAction: vi.fn(),
}));

describe("ProductTable & ProductThumbnail Component Unit Tests (Image Rendering Fix)", () => {
  const mockSlug = "test-store";
  const mockOrgId = "11111111-1111-4111-8111-111111111111";

  const baseProduct: ProductListItem = {
    id: "prod-1",
    organizationId: mockOrgId,
    name: "Espresso Dark Roast Beans",
    description: "Premium whole bean coffee",
    sku: "COF-ESP-001",
    barcode: "BAR0001",
    categoryId: "cat-1",
    categoryName: "Coffee & Tea",
    sellingPrice: 14.99,
    unitOfMeasure: "pack",
    imageUrl: null,
    signedImageUrl: null,
    status: "active",
    version: 1,
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ProductThumbnail Subcomponent", () => {
    it("1. Renders pre-signed image URL provided by server without client action calls", () => {
      const productWithSigned: ProductListItem = {
        ...baseProduct,
        imageUrl: `${mockOrgId}/prod-1/espresso.png`,
        signedImageUrl: "https://storage.supabase.co/product-images/signed-token-12345",
      };

      render(<ProductThumbnail product={productWithSigned} slug={mockSlug} />);

      const img = screen.getByRole("img", { name: "Espresso Dark Roast Beans" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://storage.supabase.co/product-images/signed-token-12345");
      expect(screen.queryByTestId(`product-thumbnail-placeholder-${productWithSigned.id}`)).toBeNull();
      expect(productActions.getSignedProductImageUrlAction).not.toHaveBeenCalled();
    });

    it("2. Renders external HTTPS image URL directly as display image", () => {
      const productWithExternalUrl: ProductListItem = {
        ...baseProduct,
        imageUrl: "https://images.unsplash.com/photo-coffee.jpg",
        signedImageUrl: "https://images.unsplash.com/photo-coffee.jpg",
      };

      render(<ProductThumbnail product={productWithExternalUrl} slug={mockSlug} />);

      const img = screen.getByRole("img", { name: "Espresso Dark Roast Beans" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://images.unsplash.com/photo-coffee.jpg");
      expect(productActions.getSignedProductImageUrlAction).not.toHaveBeenCalled();
    });

    it("3. Falls back to client-side signing when signedImageUrl is missing for an internal storage path", async () => {
      vi.mocked(productActions.getSignedProductImageUrlAction).mockResolvedValueOnce({
        success: true,
        data: {
          signedUrl: "https://storage.supabase.co/product-images/dynamically-signed-abc",
          expiresIn: 3600,
        },
      });

      const productWithoutPreSign: ProductListItem = {
        ...baseProduct,
        imageUrl: `${mockOrgId}/prod-1/espresso.png`,
        signedImageUrl: null,
      };

      render(<ProductThumbnail product={productWithoutPreSign} slug={mockSlug} />);

      expect(productActions.getSignedProductImageUrlAction).toHaveBeenCalledWith(
        mockSlug,
        `${mockOrgId}/prod-1/espresso.png`
      );

      await waitFor(() => {
        const img = screen.getByRole("img", { name: "Espresso Dark Roast Beans" });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute(
          "src",
          "https://storage.supabase.co/product-images/dynamically-signed-abc"
        );
      });
    });

    it("4. Renders placeholder Package icon when product genuinely has no image (imageUrl is null)", () => {
      const productNoImage: ProductListItem = {
        ...baseProduct,
        imageUrl: null,
        signedImageUrl: null,
      };

      render(<ProductThumbnail product={productNoImage} slug={mockSlug} />);

      expect(screen.queryByRole("img")).toBeNull();
      expect(screen.getByTestId(`product-thumbnail-placeholder-${productNoImage.id}`)).toBeInTheDocument();
      expect(productActions.getSignedProductImageUrlAction).not.toHaveBeenCalled();
    });

    it("5. Gracefully switches to placeholder Package icon when image fails to load (onError triggered)", () => {
      const productWithBrokenImage: ProductListItem = {
        ...baseProduct,
        imageUrl: "https://broken-link.internal/missing.png",
        signedImageUrl: "https://broken-link.internal/missing.png",
      };

      render(<ProductThumbnail product={productWithBrokenImage} slug={mockSlug} />);

      const img = screen.getByRole("img", { name: "Espresso Dark Roast Beans" });
      expect(img).toBeInTheDocument();

      // Trigger image error
      fireEvent.error(img);

      // Should now display Package placeholder icon instead of broken image
      expect(screen.queryByRole("img")).toBeNull();
      expect(
        screen.getByTestId(`product-thumbnail-placeholder-${productWithBrokenImage.id}`)
      ).toBeInTheDocument();
    });
  });

  describe("ProductTable Integration Rendering", () => {
    it("6. Renders products in the table with correct image thumbnails and placeholders", () => {
      const products: ProductListItem[] = [
        {
          ...baseProduct,
          id: "prod-image",
          name: "Product With Image",
          sku: "SKU-IMG-001",
          imageUrl: `${mockOrgId}/prod-image/item.png`,
          signedImageUrl: "https://storage.supabase.co/signed/item.png",
        },
        {
          ...baseProduct,
          id: "prod-no-image",
          name: "Product Without Image",
          sku: "SKU-NOIMG-002",
          imageUrl: null,
          signedImageUrl: null,
        },
      ];

      render(
        <ProductTable
          products={products}
          canReadCost={false}
          canCreate={true}
          canUpdate={true}
          canArchive={false}
          currency="USD"
          slug={mockSlug}
        />
      );

      // Verify product with image has img element
      const img = screen.getByRole("img", { name: "Product With Image" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://storage.supabase.co/signed/item.png");

      // Verify product without image renders placeholder
      expect(screen.getByTestId("product-thumbnail-placeholder-prod-no-image")).toBeInTheDocument();
    });
  });
});

