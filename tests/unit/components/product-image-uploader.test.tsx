import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ProductImageUploader,
} from "@/components/products/ProductImageUploader";
import * as productActions from "@/actions/product-actions";

// Mock product-actions
vi.mock("@/actions/product-actions", () => ({
  getSignedProductImageUrlAction: vi.fn(),
}));

describe("T031: ProductImageUploader Component Unit Tests (FR-011, FR-042, BR-018)", () => {
  const mockSlug = "test-store";
  const mockOrgId = "11111111-1111-4111-a111-111111111111";
  const mockProdId = "22222222-2222-4222-a222-222222222222";

  // Mock URL.createObjectURL and URL.revokeObjectURL
  const mockCreateObjectURL = vi.fn().mockReturnValue("blob:http://localhost/fake-blob");
  const mockRevokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
  });

  describe("File Selection & Validation (Registration Mode)", () => {
    it("renders file upload dropzone and External URL tabs", () => {
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
        />
      );

      expect(screen.getByText("Upload File")).toBeInTheDocument();
      expect(screen.getByText("External HTTPS URL")).toBeInTheDocument();
      expect(screen.getByText("Click to browse or drag and drop image")).toBeInTheDocument();
      expect(screen.getByText("JPEG, PNG, WebP, or GIF up to 5 MB")).toBeInTheDocument();
    });

    it("accepts valid JPEG file, generates preview and notifies parent", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input") as HTMLInputElement;
      const validFile = new File(["sample image bytes"], "apple.jpg", { type: "image/jpeg" });

      fireEvent.change(fileInput, { target: { files: [validFile] } });

      await waitFor(() => {
        expect(screen.getByText("apple.jpg")).toBeInTheDocument();
        expect(screen.getByText("Staged for upload")).toBeInTheDocument();
      });

      expect(mockCreateObjectURL).toHaveBeenCalledWith(validFile);
      expect(handleChange).toHaveBeenCalledWith({
        file: validFile,
        url: null,
        source: "file",
      });
    });

    it("rejects files exceeding 5 MB limit with understandable error message", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input") as HTMLInputElement;
      const oversizedFile = new File([""], "huge_image.png", { type: "image/png" });
      Object.defineProperty(oversizedFile, "size", { value: 6 * 1024 * 1024 }); // 6 MB

      fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

      await waitFor(() => {
        expect(
          screen.getByText(/exceeds the maximum allowed limit of 5 MB/i)
        ).toBeInTheDocument();
      });

      // Does not stage file
      expect(screen.queryByText("Staged for upload")).not.toBeInTheDocument();
      expect(handleChange).not.toHaveBeenCalled();
    });

    it("rejects unsupported MIME types (e.g. BMP, SVG, PDF)", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input") as HTMLInputElement;
      const invalidFile = new File(["fake"], "document.pdf", { type: "application/pdf" });

      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      await waitFor(() => {
        expect(screen.getByText(/Unsupported file format/i)).toBeInTheDocument();
      });

      expect(handleChange).not.toHaveBeenCalled();
    });

    it("allows removing the staged file and resets state", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      const fileInput = screen.getByTestId("product-image-file-input");
      const validFile = new File(["bytes"], "orange.png", { type: "image/png" });
      fireEvent.change(fileInput, { target: { files: [validFile] } });

      await waitFor(() => {
        expect(screen.getByText("orange.png")).toBeInTheDocument();
      });

      // Click Remove button
      const removeBtn = screen.getByRole("button", { name: /remove product image/i });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryByText("orange.png")).not.toBeInTheDocument();
        expect(screen.getByText("Click to browse or drag and drop image")).toBeInTheDocument();
      });

      expect(handleChange).toHaveBeenLastCalledWith({
        file: null,
        url: null,
        source: "none",
      });
    });
  });

  describe("External HTTPS URL Mode", () => {
    it("switches to External URL tab and accepts valid HTTPS URL", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      fireEvent.click(screen.getByText("External HTTPS URL"));

      const urlInput = screen.getByLabelText("External product image URL");
      fireEvent.change(urlInput, {
        target: { value: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba.jpg" },
      });

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith({
          file: null,
          url: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba.jpg",
          source: "url",
        });
      });
    });

    it("rejects non-HTTPS and malformed URLs", async () => {
      const handleChange = vi.fn();
      render(
        <ProductImageUploader
          slug={mockSlug}
          organizationId={mockOrgId}
          onChange={handleChange}
        />
      );

      fireEvent.click(screen.getByText("External HTTPS URL"));

      const urlInput = screen.getByLabelText("External product image URL");
      fireEvent.change(urlInput, { target: { value: "http://insecure.com/pic.jpg" } });

      await waitFor(() => {
        expect(
          screen.getByText(/Please enter a valid external HTTPS URL/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe("Edit Mode & Signed Initial Images", () => {
    it("fetches signed URL for internal storage path and displays current image", async () => {
      const storagePath = `${mockOrgId}/${mockProdId}/existing.png`;
      vi.mocked(productActions.getSignedProductImageUrlAction).mockResolvedValueOnce({
        success: true,
        data: { signedUrl: "https://storage.supabase.co/signed/existing.png", expiresIn: 3600 },
      });

      render(
        <ProductImageUploader
          mode="edit"
          slug={mockSlug}
          organizationId={mockOrgId}
          productId={mockProdId}
          initialImageUrl={storagePath}
        />
      );

      await waitFor(() => {
        expect(productActions.getSignedProductImageUrlAction).toHaveBeenCalledWith(
          mockSlug,
          storagePath
        );
        expect(screen.getByText("Current image")).toBeInTheDocument();
        expect(screen.getByText("Stored in private product-images bucket")).toBeInTheDocument();
      });
    });
  });
});

