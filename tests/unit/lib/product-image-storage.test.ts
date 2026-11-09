import { describe, it, expect, vi } from "vitest";
import {
  validateImageFile,
  sanitizeImageFileName,
  buildProductStoragePath,
  uploadProductImage,
  removeProductImage,
  MAX_IMAGE_FILE_SIZE,
  PRODUCT_IMAGES_BUCKET,
} from "@/lib/products/image-storage";
import { STORAGE_OBJECT_PATH_REGEX } from "@/lib/validations/product";

describe("T031: Product Image Storage Utilities Unit Tests", () => {
  describe("validateImageFile", () => {
    it("accepts valid JPEG, PNG, WebP, and GIF files under 5 MB", () => {
      const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

      for (const type of validTypes) {
        const file = new File(["dummy content"], `test.${type.split("/")[1]}`, {
          type,
        });
        const result = validateImageFile(file);
        expect(result.valid, `Expected ${type} to be valid`).toBe(true);
      }
    });

    it("rejects files with unsupported MIME types", () => {
      const invalidTypes = [
        "image/bmp",
        "image/tiff",
        "image/svg+xml",
        "application/pdf",
        "text/plain",
        "video/mp4",
      ];

      for (const type of invalidTypes) {
        const file = new File(["dummy content"], "test.bmp", { type });
        const result = validateImageFile(file);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.error).toContain("Unsupported file format");
        }
      }
    });

    it("rejects files exceeding 5 MB limit", () => {
      // 5 MB + 1 byte
      const oversizedFile = new File([""], "huge.png", { type: "image/png" });
      Object.defineProperty(oversizedFile, "size", { value: MAX_IMAGE_FILE_SIZE + 1 });

      const result = validateImageFile(oversizedFile);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("exceeds the maximum allowed limit of 5 MB");
      }
    });

    it("accepts file exactly at 5 MB limit", () => {
      const maxFile = new File([""], "boundary.png", { type: "image/png" });
      Object.defineProperty(maxFile, "size", { value: MAX_IMAGE_FILE_SIZE });

      const result = validateImageFile(maxFile);
      expect(result.valid).toBe(true);
    });
  });

  describe("sanitizeImageFileName", () => {
    it("replaces spaces and special characters with underscores", () => {
      const input = "my product photo #1 (final)!.jpg";
      const sanitized = sanitizeImageFileName(input);
      expect(sanitized).toBe("my_product_photo__1__final__.jpg");
      expect(/^[A-Za-z0-9._-]+$/.test(sanitized)).toBe(true);
    });

    it("strips directory path traversals", () => {
      const input = "../../etc/shadow.png";
      const sanitized = sanitizeImageFileName(input);
      expect(sanitized).toBe("shadow.png");
    });
  });

  describe("buildProductStoragePath", () => {
    it("constructs canonical {organization_id}/{product_id}/{timestamp}_{filename} path matching regex", () => {
      const orgId = "11111111-1111-4111-a111-111111111111";
      const prodId = "22222222-2222-4222-a222-222222222222";
      const fileName = "product.jpg";

      const path = buildProductStoragePath(orgId, prodId, fileName);

      expect(path.startsWith(`${orgId}/${prodId}/`)).toBe(true);
      expect(path).toMatch(STORAGE_OBJECT_PATH_REGEX);
      expect(path.includes("product-images/")).toBe(false);
    });
  });

  describe("uploadProductImage and removeProductImage", () => {
    it("uploads file to product-images bucket with proper path and options", async () => {
      const mockUpload = vi.fn().mockResolvedValue({ data: { path: "some/path" }, error: null });
      const mockFrom = vi.fn().mockReturnValue({ upload: mockUpload });
      const mockSupabase = {
        storage: { from: mockFrom },
      } as any;

      const file = new File(["bytes"], "test.png", { type: "image/png" });
      const orgId = "11111111-1111-4111-a111-111111111111";
      const prodId = "22222222-2222-4222-a222-222222222222";

      const result = await uploadProductImage(mockSupabase, orgId, prodId, file);

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith(PRODUCT_IMAGES_BUCKET);
      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${orgId}/${prodId}/`)),
        file,
        { contentType: "image/png", upsert: false }
      );
    });

    it("removes storage object from product-images bucket on cleanup", async () => {
      const mockRemove = vi.fn().mockResolvedValue({ data: [], error: null });
      const mockFrom = vi.fn().mockReturnValue({ remove: mockRemove });
      const mockSupabase = {
        storage: { from: mockFrom },
      } as any;

      const storagePath = "org-id/prod-id/test.png";
      const result = await removeProductImage(mockSupabase, storagePath);

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith(PRODUCT_IMAGES_BUCKET);
      expect(mockRemove).toHaveBeenCalledWith([storagePath]);
    });
  });
});

