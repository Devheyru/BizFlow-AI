import { describe, it, expect } from "vitest";
import { UpdateProductSchema, COST_OPERATIONS } from "@/lib/validations/product";
import { ALLOWED_UOM } from "@/types/product";

describe("T035: UpdateProductSchema Unit Tests (FR-008, FR-023)", () => {
  const validBaseInput = {
    expected_version: 1,
    name: "Updated Whole Milk",
    sku: "MILK-WHOLE-001",
    selling_price: 6.25,
    unit_of_measure: "liter",
    cost_operation: "unchanged",
  };

  // 1. Optimistic Concurrency Control (expected_version)
  describe("Optimistic Concurrency Control (expected_version)", () => {
    it("accepts valid positive integer expected_version", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        expected_version: 1,
      });
      expect(result.success).toBe(true);

      const resultHigh = UpdateProductSchema.safeParse({
        ...validBaseInput,
        expected_version: 42,
      });
      expect(resultHigh.success).toBe(true);
    });

    it("rejects missing expected_version", () => {
      const { expected_version, ...withoutVersion } = validBaseInput;
      const result = UpdateProductSchema.safeParse(withoutVersion);
      expect(result.success).toBe(false);
    });

    it("rejects non-positive and zero expected_version", () => {
      const resultZero = UpdateProductSchema.safeParse({
        ...validBaseInput,
        expected_version: 0,
      });
      expect(resultZero.success).toBe(false);

      const resultNeg = UpdateProductSchema.safeParse({
        ...validBaseInput,
        expected_version: -1,
      });
      expect(resultNeg.success).toBe(false);
    });

    it("rejects non-integer expected_version", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        expected_version: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  // 2. Unit of Measure
  describe("Unit of Measure", () => {
    it("accepts all 13 approved retail UOM values", () => {
      for (const uom of ALLOWED_UOM) {
        const result = UpdateProductSchema.safeParse({
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
      const result = UpdateProductSchema.safeParse(withoutUom);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.unit_of_measure).toBe("piece");
      }
    });

    it("rejects unapproved UOM values", () => {
      const invalidUoms = ["bag", "barrel", "pallet", "custom", "PIECE"];
      for (const uom of invalidUoms) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          unit_of_measure: uom,
        });
        expect(result.success, `Expected UOM '${uom}' to be rejected`).toBe(false);
      }
    });
  });

  // 3. SKU Validation & Transformation
  describe("SKU Validation & Normalization", () => {
    it("trims whitespace and normalizes SKU to uppercase", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        sku: "  milk-update-002  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sku).toBe("MILK-UPDATE-002");
      }
    });

    it("rejects invalid characters in SKU", () => {
      const invalidSkus = ["SKU with spaces", "SKU@123", "ITEM#1", "SLASH/SKU"];
      for (const sku of invalidSkus) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          sku,
        });
        expect(result.success).toBe(false);
      }
    });
  });

  // 4. Selling Price Validation
  describe("Selling Price", () => {
    it("accepts non-negative numbers", () => {
      const resultZero = UpdateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: 0,
      });
      expect(resultZero.success).toBe(true);

      const resultPositive = UpdateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: 99.99,
      });
      expect(resultPositive.success).toBe(true);
    });

    it("rejects negative selling prices", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        selling_price: -0.01,
      });
      expect(result.success).toBe(false);
    });
  });

  // 5. Cost Operations & Confidential Cost Validation
  describe("Cost Operations (FR-008, FR-023)", () => {
    it("accepts all three valid cost operations: unchanged, set, clear", () => {
      for (const op of COST_OPERATIONS) {
        const input: any = {
          ...validBaseInput,
          cost_operation: op,
        };
        if (op === "set") {
          input.cost_price = 3.5;
        }
        const result = UpdateProductSchema.safeParse(input);
        expect(result.success, `Expected cost_operation '${op}' to succeed`).toBe(true);
      }
    });

    it("defaults cost_operation to 'unchanged' when omitted", () => {
      const { cost_operation, ...withoutOp } = validBaseInput;
      const result = UpdateProductSchema.safeParse(withoutOp);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cost_operation).toBe("unchanged");
      }
    });

    it("rejects invalid cost operations", () => {
      const invalidOps = ["delete", "update", "modify", "remove", "add"];
      for (const op of invalidOps) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          cost_operation: op as any,
        });
        expect(result.success).toBe(false);
      }
    });

    it("requires cost_price when cost_operation is 'set'", () => {
      // cost_operation = 'set' without cost_price
      const resultMissing = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "set",
      });
      expect(resultMissing.success).toBe(false);
      if (!resultMissing.success) {
        expect(resultMissing.error.flatten().fieldErrors.cost_price?.[0]).toMatch(
          /Cost price is required when cost operation is set/i
        );
      }

      // cost_operation = 'set' with null cost_price
      const resultNull = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "set",
        cost_price: null,
      });
      expect(resultNull.success).toBe(false);

      // cost_operation = 'set' with valid cost_price
      const resultValid = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "set",
        cost_price: 4.5,
      });
      expect(resultValid.success).toBe(true);

      // cost_operation = 'set' with zero cost_price
      const resultZero = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "set",
        cost_price: 0,
      });
      expect(resultZero.success).toBe(true);
    });

    it("allows omitted or null cost_price when cost_operation is 'clear'", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "clear",
        cost_price: null,
      });
      expect(result.success).toBe(true);
    });

    it("allows omitted or null cost_price when cost_operation is 'unchanged'", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        cost_operation: "unchanged",
        cost_price: null,
      });
      expect(result.success).toBe(true);
    });
  });

  // 6. Image URL & Storage Object Name Validation
  describe("Image URL Validation (Dual Protocol: External HTTPS or Storage Object Name)", () => {
    it("accepts valid external HTTPS URLs", () => {
      const validUrls = [
        "https://example.com/image.png",
        "https://cdn.example.com/products/photo.webp",
        "https://example.com:8443/image.png",
        "https://example.com/image.png?size=large",
        "https://example.com/image.png#fragment",
      ];
      for (const url of validUrls) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          image_url: url,
        });
        expect(result.success, `Expected '${url}' to be valid`).toBe(true);
      }
    });

    it("accepts valid internal Supabase Storage relative object names {org_id}/{product_id}/{filename}", () => {
      const validStoragePaths = [
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/photo.jpg",
        "00000000-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111/product-image.webp",
        "12345678-1234-1234-1234-123456789abc/87654321-4321-4321-4321-cba987654321/IMG_2026.PNG",
      ];
      for (const path of validStoragePaths) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          image_url: path,
        });
        expect(result.success, `Expected storage path '${path}' to be valid`).toBe(true);
      }
    });

    it("rejects insecure HTTP URLs", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        image_url: "http://example.com/image.png",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-HTTP schemes (javascript, data, ftp, file)", () => {
      const invalidSchemes = [
        "javascript:alert(1)",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA",
        "ftp://example.com/image.png",
        "file:///image.png",
      ];
      for (const url of invalidSchemes) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          image_url: url,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects URLs or storage paths with whitespace or newlines", () => {
      const invalidWhitespace = [
        "https://example.com/path with spaces.png",
        "https://example.com\n",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/photo with spaces.jpg",
      ];
      for (const url of invalidWhitespace) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          image_url: url,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects malformed storage paths (invalid UUIDs or missing segments)", () => {
      const malformedPaths = [
        "not-a-uuid/not-a-uuid/photo.jpg",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/photo.jpg",
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      ];
      for (const path of malformedPaths) {
        const result = UpdateProductSchema.safeParse({
          ...validBaseInput,
          image_url: path,
        });
        expect(result.success).toBe(false);
      }
    });

    it("accepts null or omitted image_url (cleared image)", () => {
      const resultNull = UpdateProductSchema.safeParse({
        ...validBaseInput,
        image_url: null,
      });
      expect(resultNull.success).toBe(true);

      const { ...withoutImage } = validBaseInput;
      const resultOmitted = UpdateProductSchema.safeParse(withoutImage);
      expect(resultOmitted.success).toBe(true);
    });
  });

  // 7. Category ID Validation
  describe("Category ID", () => {
    it("accepts valid UUID for category_id", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        category_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
      expect(result.success).toBe(true);
    });

    it("accepts null for category_id (uncategorized)", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        category_id: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid UUID strings for category_id", () => {
      const result = UpdateProductSchema.safeParse({
        ...validBaseInput,
        category_id: "not-a-valid-uuid",
      });
      expect(result.success).toBe(false);
    });
  });
});

