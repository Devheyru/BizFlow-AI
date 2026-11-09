import { describe, it, expect } from "vitest";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
} from "@/lib/validations/category";

describe("T043: Category Validation Schemas (US4)", () => {
  describe("CreateCategorySchema", () => {
    describe("Category Name Validation", () => {
      it("accepts a valid ordinary category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Beverages",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe("Beverages");
        }
      });

      it("trims leading and trailing whitespace from category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: "   Dairy & Refrigerated   ",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe("Dairy & Refrigerated");
        }
      });

      it("preserves display casing of category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Snacks & Confectionery",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe("Snacks & Confectionery");
        }
      });

      it("rejects an empty string for category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: "",
        });
        expect(result.success).toBe(false);
      });

      it("rejects a whitespace-only string for category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: "     ",
        });
        expect(result.success).toBe(false);
      });

      it("accepts a 1-character category name (minimum boundary)", () => {
        const result = CreateCategorySchema.safeParse({
          name: "A",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe("A");
        }
      });

      it("accepts a 100-character category name (maximum boundary)", () => {
        const name100 = "A".repeat(100);
        const result = CreateCategorySchema.safeParse({
          name: name100,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe(name100);
        }
      });

      it("rejects a 101-character category name (exceeds maximum boundary)", () => {
        const name101 = "A".repeat(101);
        const result = CreateCategorySchema.safeParse({
          name: name101,
        });
        expect(result.success).toBe(false);
      });

      it("rejects non-string input for category name", () => {
        const result = CreateCategorySchema.safeParse({
          name: 12345,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("Category Description Validation", () => {
      it("accepts when description is omitted", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
        });
        expect(result.success).toBe(true);
      });

      it("accepts a valid description", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: "Freshly baked artisan bread and pastries",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.description).toBe("Freshly baked artisan bread and pastries");
        }
      });

      it("trims whitespace from description", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: "   Freshly baked bread   ",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.description).toBe("Freshly baked bread");
        }
      });

      it("accepts null for description", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: null,
        });
        expect(result.success).toBe(true);
      });

      it("accepts empty string for description", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: "",
        });
        expect(result.success).toBe(true);
      });

      it("accepts a 500-character description (maximum boundary)", () => {
        const desc500 = "D".repeat(500);
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: desc500,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.description).toBe(desc500);
        }
      });

      it("rejects a 501-character description (exceeds maximum boundary)", () => {
        const desc501 = "D".repeat(501);
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: desc501,
        });
        expect(result.success).toBe(false);
      });

      it("rejects non-string input for description", () => {
        const result = CreateCategorySchema.safeParse({
          name: "Bakery",
          description: 9876,
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("UpdateCategorySchema", () => {
    it("accepts a valid full update (both name and description)", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "Updated Produce",
        description: "Organic fruits and vegetables",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Updated Produce");
        expect(result.data.description).toBe("Organic fruits and vegetables");
      }
    });

    it("trims leading and trailing whitespace on update", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "   Pantry Staples   ",
        description: "   Canned goods, grains, and oils   ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Pantry Staples");
        expect(result.data.description).toBe("Canned goods, grains, and oils");
      }
    });

    it("accepts name update with omitted description", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "Frozen Foods",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Frozen Foods");
      }
    });

    it("rejects an empty name on update", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "",
        description: "Some valid description",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a whitespace-only name on update", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "    ",
        description: "Some valid description",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name exceeding 100 characters on update", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "N".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("rejects description exceeding 500 characters on update", () => {
      const result = UpdateCategorySchema.safeParse({
        name: "Valid Category",
        description: "E".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});

