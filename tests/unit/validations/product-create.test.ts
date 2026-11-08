import { describe, it, expect } from "vitest";
import { CreateProductSchema } from "@/lib/validations/product";
import { ALLOWED_UOM } from "@/types/product";

describe("T028: CreateProductSchema Unit Tests (FR-001 to FR-007, FR-011, BR-017)", () => {
  const validBaseInput = {
    name: "Organic Whole Milk",
    sku: "MILK-WHOLE-001",
    selling_price: 5.50,
    unit_of_measure: "liter",
  };

  // 1. All 13 approved UOM values
  describe("Unit of Measure (BR-017)", () => {
    it("accepts all 13 approved retail UOM values", () => {
      for (const uom of ALLOWED_UOM) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          unit_of_measure: uom,
        });
        expect(result.success, `Expected UOM '${uom}' to be valid`).toBe(true);
        if (result.success) {
          expect(result.data.unit_of_measure).toBe(uom);
        }
      }
    });

    it("defaults unit_of_measure to 'piece' when omitted", () => {
      const { unit_of_measure, ...withoutUom } = validBaseInput;
      const result = CreateProductSchema.safeParse(withoutUom);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unit_of_measure).toBe("piece");
      }
    });

    it("rejects unapproved UOM values", () => {
      const invalidUoms = ["bag", "barrel", "pallet", "custom", "PIECE", "box1"];
      for (const uom of invalidUoms) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          unit_of_measure: uom,
        });
        expect(result.success, `Expected UOM '${uom}' to be rejected`).toBe(false);
      }
    });
  });

  // 2. SKU Validation & Normalization
  describe("SKU Validation & Transformation", () => {
    it("trims whitespace and normalizes SKU to uppercase", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        sku: "  milk-org-001  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sku).toBe("MILK-ORG-001");
      }
    });

    it("accepts valid alphanumeric SKUs with approved symbols (., _, -)", () => {
      const validSkus = [
        "A",
        "SKU-123",
        "ITEM_A.B-C",
        "0123456789",
        "PROD.CAT_01-V2",
      ];
      for (const sku of validSkus) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          sku,
        });
        expect(result.success, `Expected SKU '${sku}' to be valid`).toBe(true);
      }
    });

    it("rejects empty or whitespace-only SKU", () => {
      const resultEmpty = CreateProductSchema.safeParse({
        ...validBaseInput,
        sku: "",
      });
      expect(resultEmpty.success).toBe(false);

      const resultWhitespace = CreateProductSchema.safeParse({
        ...validBaseInput,
        sku: "   ",
      });
      expect(resultWhitespace.success).toBe(false);
    });

    it("rejects SKUs with invalid characters", () => {
      const invalidSkus = [
        "SKU with spaces",
        "SKU@123",
        "ITEM#1",
        "PRODUCT$1",
        "SLASH/SKU",
        "PERCENT%1",
      ];
      for (const sku of invalidSkus) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          sku,
        });
        expect(result.success, `Expected SKU '${sku}' to be rejected`).toBe(false);
      }
    });

    it("rejects SKUs exceeding 50 characters", () => {
      const longSku = "A".repeat(51);
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        sku: longSku,
      });
      expect(result.success).toBe(false);
    });
  });

  // 3. Barcode Validation
  describe("Barcode Validation", () => {
    it("accepts optional barcode when omitted or null", () => {
      const resultOmitted = CreateProductSchema.safeParse({
        ...validBaseInput,
      });
      expect(resultOmitted.success).toBe(true);

      const resultNull = CreateProductSchema.safeParse({
        ...validBaseInput,
        barcode: null,
      });
      expect(resultNull.success).toBe(true);
      if (resultNull.success) {
        expect(resultNull.data.barcode).toBeNull();
      }
    });

    it("accepts valid alphanumeric barcodes with hyphens (length 3 to 50)", () => {
      const validBarcodes = [
        "123",
        "1000000001",
        "0123456789012",
        "BC-998877",
        "CODE-128-XYZ",
      ];
      for (const barcode of validBarcodes) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          barcode,
        });
        expect(result.success, `Expected barcode '${barcode}' to be valid`).toBe(true);
      }
    });

    it("rejects barcodes shorter than 3 characters", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        barcode: "12",
      });
      expect(result.success).toBe(false);
    });

    it("rejects barcodes longer than 50 characters", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        barcode: "1".repeat(51),
      });
      expect(result.success).toBe(false);
    });

    it("rejects barcodes with invalid characters", () => {
      const invalidBarcodes = [
        "123 456",
        "BC#123",
        "UPC_1234",
        "BC.123",
      ];
      for (const barcode of invalidBarcodes) {
        const result = CreateProductSchema.safeParse({
          ...validBaseInput,
          barcode,
        });
        expect(result.success, `Expected barcode '${barcode}' to be rejected`).toBe(false);
      }
    });
  });

  // 4. Selling Price Validation
  describe("Selling Price Boundaries", () => {
    it("accepts zero and positive selling prices", () => {
      const r0 = CreateProductSchema.safeParse({ ...validBaseInput, selling_price: 0 });
      expect(r0.success).toBe(true);

      const rPositive = CreateProductSchema.safeParse({ ...validBaseInput, selling_price: 19.99 });
      expect(rPositive.success).toBe(true);
    });

    it("rejects negative selling prices", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: -0.01,
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid NUMERIC(14, 4) representational values", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: 9999999999.9999,
      });
      expect(result.success).toBe(true);
    });

    it("rejects values exceeding NUMERIC(14, 4) upper bound", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: 10000000000.0,
      });
      expect(result.success).toBe(false);
    });
  });

  // 5. Cost Price Validation
  describe("Cost Price (Confidential)", () => {
    it("accepts optional cost price when omitted, null, or zero", () => {
      const rOmitted = CreateProductSchema.safeParse({ ...validBaseInput });
      expect(rOmitted.success).toBe(true);

      const rNull = CreateProductSchema.safeParse({ ...validBaseInput, cost_price: null });
      expect(rNull.success).toBe(true);

      const rZero = CreateProductSchema.safeParse({ ...validBaseInput, cost_price: 0 });
      expect(rZero.success).toBe(true);
    });

    it("accepts positive cost price", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        cost_price: 3.50,
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative cost price", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        cost_price: -1.00,
      });
      expect(result.success).toBe(false);
    });
  });

  // 6. Image URL Validation
  describe("Image URL Validation (External HTTPS Only, FR-011, FR-012)", () => {
    // 16-row matrix tests
    it("Matrix 1: accepts valid external HTTPS URL (https://example.com/image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com/image.png",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 2: accepts valid external HTTPS URL (https://cdn.example.com/products/image.webp)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://cdn.example.com/products/image.webp",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 3: accepts valid external HTTPS URL without path (https://example.com)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 3b: accepts valid external HTTPS URL with query (https://example.com/image.png?size=large)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com/image.png?size=large",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 3c: accepts valid external HTTPS URL with fragment (https://example.com/image.png#fragment)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com/image.png#fragment",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 3d: accepts valid external HTTPS URL with port (https://example.com:8443/image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com:8443/image.png",
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 4: rejects insecure HTTP URL (http://example.com/image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "http://example.com/image.png",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 5: rejects scheme-only URL (https://)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 6: rejects URL with space after scheme (https:// )", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https:// ",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 7: rejects empty authority / missing host (https:///image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https:///image.png",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 8: rejects URL with unencoded whitespace (https://example.com/path with spaces)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com/path with spaces",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 8b: rejects URL followed by newline (https://example.com\\n)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "https://example.com\n",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 9: rejects javascript: scheme (javascript:alert(1))", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "javascript:alert(1)",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 10: rejects data: URI (data:image/png;base64,...)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 11: rejects file: URI (file:///image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "file:///image.png",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 12: rejects ftp: URI (ftp://example.com/image.png)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "ftp://example.com/image.png",
      });
      expect(result.success).toBe(false);
    });

    it("Matrix 13: rejects internal own-tenant Storage path", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/photo.jpg",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 14: rejects internal foreign-tenant Storage path", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "11111111-2222-3333-4444-555555555555/66666666-7777-8888-9999-000000000000/product.png",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.image_url?.[0]).toMatch(
          /Image URL must be a valid external HTTPS URL/i
        );
      }
    });

    it("Matrix 15: accepts null image_url for staged uploads", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        image_url: null,
      });
      expect(result.success).toBe(true);
    });

    it("Matrix 16: accepts omitted image_url for staged uploads", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
      });
      expect(result.success).toBe(true);
    });
  });

  // 7. Creation Schema Invariant: NO cost_operation
  describe("Creation Schema Invariant (No cost_operation)", () => {
    it("ensures cost_operation is not a recognized property in CreateProductSchema", () => {
      const parsed = CreateProductSchema.parse({
        ...validBaseInput,
        cost_operation: "set",
      } as any);

      // Zod strips unrecognized keys by default or does not define cost_operation
      expect((parsed as any).cost_operation).toBeUndefined();
    });
  });

  // 8. Category ID Validation
  describe("Category ID", () => {
    it("accepts valid UUID for category_id", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        category_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
      expect(result.success).toBe(true);
    });

    it("accepts null for category_id (uncategorized)", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        category_id: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid UUID strings for category_id", () => {
      const result = CreateProductSchema.safeParse({
        ...validBaseInput,
        category_id: "not-a-valid-uuid",
      });
      expect(result.success).toBe(false);
    });
  });
});

