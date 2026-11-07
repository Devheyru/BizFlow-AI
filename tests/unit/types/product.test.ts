import { describe, it, expect } from "vitest";
import {
  ALLOWED_UOM,
  type UnitOfMeasure,
  type ProductStatus,
  type CategoryStatus,
  type CostOperation,
  type ProductCategory,
  type Product,
  type ProductListItem,
  type ProductMarginMetrics,
} from "@/types/product";

describe("Phase 1: Product & Category Domain Types (T003)", () => {
  // ==========================================================================
  // 1. Retail Unit of Measure (UOM) Runtime & Compile-time Verification
  // ==========================================================================
  describe("Unit of Measure (BR-017)", () => {
    it("defines exactly 13 approved retail Unit of Measure values as a runtime-frozen array", () => {
      expect(ALLOWED_UOM).toHaveLength(13);
      expect(ALLOWED_UOM).toEqual([
        "piece",
        "unit",
        "kg",
        "g",
        "mg",
        "liter",
        "ml",
        "meter",
        "cm",
        "box",
        "pack",
        "pair",
        "set",
      ]);
      expect(Object.isFrozen(ALLOWED_UOM)).toBe(true);
      expect(new Set(ALLOWED_UOM).size).toBe(13);
    });

    it("verifies UnitOfMeasure union aligns with ALLOWED_UOM values", () => {
      const sampleUom: UnitOfMeasure = "piece";
      expect(ALLOWED_UOM.includes(sampleUom)).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Lifecycle & Operation Compile-Time Union Verification
  // ==========================================================================
  describe("Lifecycle & Mutation Operation Types", () => {
    it("verifies compile-time type assignability for ProductStatus, CategoryStatus, and CostOperation", () => {
      // Note: ProductStatus, CategoryStatus, and CostOperation are TypeScript union types
      // evaluated at compile-time by `tsc --noEmit`. The assertions below demonstrate
      // type-safe literal assignment to the domain union types.
      const productStatuses: ProductStatus[] = ["active", "inactive", "archived"];
      const categoryStatuses: CategoryStatus[] = ["active", "archived"];
      const costOperations: CostOperation[] = ["unchanged", "set", "clear"];

      expect(productStatuses).toHaveLength(3);
      expect(categoryStatuses).toHaveLength(2);
      expect(costOperations).toHaveLength(3);
    });
  });

  // ==========================================================================
  // 3. Domain Entity Construction & Constraints
  // ==========================================================================
  describe("Product & Category Entity Construction", () => {
    it("supports type-safe construction of Product and ProductCategory entities", () => {
      const sampleCategory: ProductCategory = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Beverages",
        description: "Cold and hot beverages",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const sampleProduct: Product = {
        id: "770e8400-e29b-41d4-a716-446655440001",
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Sparkling Water 500ml",
        description: "Naturally carbonated mineral water",
        sku: "BEV-WAT-001",
        barcode: "012345678901",
        categoryId: sampleCategory.id,
        category: sampleCategory,
        sellingPrice: 1.99,
        costPrice: 0.85,
        grossMargin: 57.29,
        unitOfMeasure: "piece",
        imageUrl: "123e4567-e89b-12d3-a456-426614174000/770e8400-e29b-41d4-a716-446655440001/water.png",
        signedImageUrl: null,
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: "990e8400-e29b-41d4-a716-446655440099",
        updatedBy: "990e8400-e29b-41d4-a716-446655440099",
      };

      expect(sampleProduct.name).toBe("Sparkling Water 500ml");
      expect(sampleProduct.unitOfMeasure).toBe("piece");
      expect(sampleProduct.version).toBe(1);
      expect(sampleProduct.sellingPrice).toBe(1.99);
    });

    it("supports uncategorized products with explicit null categoryId and category", () => {
      const uncategorizedProduct: Product = {
        id: "770e8400-e29b-41d4-a716-446655440002",
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Generic Bag",
        description: null,
        sku: "GEN-BAG-001",
        barcode: null,
        categoryId: null, // explicit null for uncategorized
        category: null,
        sellingPrice: 0.5,
        unitOfMeasure: "piece",
        imageUrl: null,
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: "990e8400-e29b-41d4-a716-446655440099",
        updatedBy: "990e8400-e29b-41d4-a716-446655440099",
      };

      expect(uncategorizedProduct.categoryId).toBeNull();
      expect(uncategorizedProduct.category).toBeNull();
    });

    it("validates approved image URL conventions: internal relative Storage path and external HTTPS", () => {
      const internalStorageRelativePath = "123e4567-e89b-12d3-a456-426614174000/770e8400-e29b-41d4-a716-446655440001/item.jpg";
      const externalHttpsUrl = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c";

      expect(internalStorageRelativePath).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/);
      expect(externalHttpsUrl).toMatch(/^https:\/\/.+/);
    });
  });

  // ==========================================================================
  // 4. Cost Representation Contract & Confidentiality Verification
  // ==========================================================================
  describe("Cost & Margin Representation Contract", () => {
    const baseProductFields = {
      id: "770e8400-e29b-41d4-a716-446655440010",
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      name: "Standard Widget",
      description: null,
      sku: "WID-STD-001",
      barcode: null,
      categoryId: null,
      category: null,
      sellingPrice: 20.0,
      unitOfMeasure: "piece" as const,
      imageUrl: null,
      status: "active" as const,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: "990e8400-e29b-41d4-a716-446655440099",
      updatedBy: "990e8400-e29b-41d4-a716-446655440099",
    };

    it("State 1: represents a recorded cost of zero as literal 0", () => {
      const zeroCostProduct: Product = {
        ...baseProductFields,
        costPrice: 0,
        grossMargin: 100.0,
      };

      expect("costPrice" in zeroCostProduct).toBe(true);
      expect(zeroCostProduct.costPrice).toBe(0);
      expect(zeroCostProduct.costPrice).not.toBeNull();
      expect(zeroCostProduct.costPrice).not.toBeUndefined();
      expect(zeroCostProduct.grossMargin).toBe(100.0);
    });

    it("State 2: represents a recorded nonzero cost as a positive numeric value", () => {
      const nonzeroCostProduct: Product = {
        ...baseProductFields,
        costPrice: 12.5,
        grossMargin: 37.5,
      };

      expect("costPrice" in nonzeroCostProduct).toBe(true);
      expect(nonzeroCostProduct.costPrice).toBe(12.5);
      expect(nonzeroCostProduct.costPrice).toBeGreaterThan(0);
      expect(nonzeroCostProduct.grossMargin).toBe(37.5);
    });

    it("State 3: represents an unrecorded cost as explicit null when caller is authorized", () => {
      const unrecordedCostProduct: Product = {
        ...baseProductFields,
        costPrice: null, // explicit null distinguishes unrecorded cost from unauthorized omission
        grossMargin: null, // cannot calculate margin when cost is unrecorded
      };

      expect("costPrice" in unrecordedCostProduct).toBe(true);
      expect(unrecordedCostProduct.costPrice).toBeNull();
      expect("grossMargin" in unrecordedCostProduct).toBe(true);
      expect(unrecordedCostProduct.grossMargin).toBeNull();
    });

    it("State 4: strictly omits costPrice and grossMargin when caller lacks products:read_cost", () => {
      // In compliance with the cost confidentiality specification:
      // When a user lacks `products:read_cost` (e.g. Cashier), the server payload omits
      // `costPrice` and `grossMargin` entirely. It does NOT return `null` (which would falsely
      // imply the cost is unrecorded), and it does NOT return `grossMargin` (which would allow
      // back-calculating the confidential cost price).
      const unauthorizedProduct: Product = {
        ...baseProductFields,
      };

      expect("costPrice" in unauthorizedProduct).toBe(false);
      expect(unauthorizedProduct.costPrice).toBeUndefined();
      expect("grossMargin" in unauthorizedProduct).toBe(false);
      expect(unauthorizedProduct.grossMargin).toBeUndefined();
    });

    it("verifies ProductListItem follows identical cost and margin omission contracts", () => {
      const baseListItem: Omit<ProductListItem, "costPrice" | "grossMargin"> = {
        id: "770e8400-e29b-41d4-a716-446655440020",
        organizationId: "123e4567-e89b-12d3-a456-426614174000",
        name: "List Item Widget",
        description: null,
        sku: "WID-LST-001",
        barcode: null,
        categoryId: null,
        categoryName: null,
        sellingPrice: 50.0,
        unitOfMeasure: "unit",
        imageUrl: null,
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 1. Authorized with cost
      const authorizedWithCost: ProductListItem = {
        ...baseListItem,
        costPrice: 25.0,
        grossMargin: 50.0,
      };
      expect("costPrice" in authorizedWithCost).toBe(true);
      expect(authorizedWithCost.costPrice).toBe(25.0);
      expect(authorizedWithCost.grossMargin).toBe(50.0);

      // 2. Authorized unrecorded cost
      const authorizedUnrecorded: ProductListItem = {
        ...baseListItem,
        costPrice: null,
        grossMargin: null,
      };
      expect("costPrice" in authorizedUnrecorded).toBe(true);
      expect(authorizedUnrecorded.costPrice).toBeNull();
      expect(authorizedUnrecorded.grossMargin).toBeNull();

      // 3. Unauthorized caller: costPrice and grossMargin must be omitted
      const unauthorizedListItem: ProductListItem = {
        ...baseListItem,
      };
      expect("costPrice" in unauthorizedListItem).toBe(false);
      expect(unauthorizedListItem.costPrice).toBeUndefined();
      expect("grossMargin" in unauthorizedListItem).toBe(false);
      expect(unauthorizedListItem.grossMargin).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. ProductMarginMetrics Confidentiality & Representation Contract
  // ==========================================================================
  describe("ProductMarginMetrics Confidentiality Representation", () => {
    // Note: These tests verify TypeScript object representation contracts.
    // They do not claim to prove server-side authorization or payload sanitization.

    it("State 1: represents authorized caller with recorded zero cost", () => {
      const zeroCostMetrics: ProductMarginMetrics = {
        sellingPrice: 100.0,
        costPrice: 0,
        grossProfit: 100.0,
        grossMarginPercentage: 100.0,
        hasRecordedCost: true,
        isNegativeMargin: false,
      };

      expect("costPrice" in zeroCostMetrics).toBe(true);
      expect(zeroCostMetrics.costPrice).toBe(0);
      expect("grossProfit" in zeroCostMetrics).toBe(true);
      expect(zeroCostMetrics.grossProfit).toBe(100.0);
      expect("grossMarginPercentage" in zeroCostMetrics).toBe(true);
      expect(zeroCostMetrics.grossMarginPercentage).toBe(100.0);
      expect("hasRecordedCost" in zeroCostMetrics).toBe(true);
      expect(zeroCostMetrics.hasRecordedCost).toBe(true);
      expect("isNegativeMargin" in zeroCostMetrics).toBe(true);
      expect(zeroCostMetrics.isNegativeMargin).toBe(false);
    });

    it("State 2: represents authorized caller with recorded nonzero cost", () => {
      const nonzeroCostMetrics: ProductMarginMetrics = {
        sellingPrice: 100.0,
        costPrice: 40.0,
        grossProfit: 60.0,
        grossMarginPercentage: 60.0,
        hasRecordedCost: true,
        isNegativeMargin: false,
      };

      expect("costPrice" in nonzeroCostMetrics).toBe(true);
      expect(nonzeroCostMetrics.costPrice).toBe(40.0);
      expect("grossProfit" in nonzeroCostMetrics).toBe(true);
      expect(nonzeroCostMetrics.grossProfit).toBe(60.0);
      expect("grossMarginPercentage" in nonzeroCostMetrics).toBe(true);
      expect(nonzeroCostMetrics.grossMarginPercentage).toBe(60.0);
      expect("hasRecordedCost" in nonzeroCostMetrics).toBe(true);
      expect(nonzeroCostMetrics.hasRecordedCost).toBe(true);
      expect("isNegativeMargin" in nonzeroCostMetrics).toBe(true);
      expect(nonzeroCostMetrics.isNegativeMargin).toBe(false);
    });

    it("State 3: represents authorized caller with unrecorded cost", () => {
      const unrecordedMetrics: ProductMarginMetrics = {
        sellingPrice: 100.0,
        costPrice: null,
        grossProfit: null,
        grossMarginPercentage: null,
        hasRecordedCost: false,
        isNegativeMargin: false,
      };

      expect("costPrice" in unrecordedMetrics).toBe(true);
      expect(unrecordedMetrics.costPrice).toBeNull();
      expect("grossProfit" in unrecordedMetrics).toBe(true);
      expect(unrecordedMetrics.grossProfit).toBeNull();
      expect("grossMarginPercentage" in unrecordedMetrics).toBe(true);
      expect(unrecordedMetrics.grossMarginPercentage).toBeNull();
      expect("hasRecordedCost" in unrecordedMetrics).toBe(true);
      expect(unrecordedMetrics.hasRecordedCost).toBe(false);
      expect("isNegativeMargin" in unrecordedMetrics).toBe(true);
      expect(unrecordedMetrics.isNegativeMargin).toBe(false);
    });

    it("State 4: strictly omits all five cost-related properties when caller is unauthorized", () => {
      // When a caller lacks `products:read_cost`, all 5 cost-related properties
      // (costPrice, grossProfit, grossMarginPercentage, hasRecordedCost, isNegativeMargin)
      // must be omitted entirely from the representation so no cost data or derived signal leaks.
      const unauthorizedMetrics: ProductMarginMetrics = {
        sellingPrice: 100.0,
      };

      expect("costPrice" in unauthorizedMetrics).toBe(false);
      expect(unauthorizedMetrics.costPrice).toBeUndefined();

      expect("grossProfit" in unauthorizedMetrics).toBe(false);
      expect(unauthorizedMetrics.grossProfit).toBeUndefined();

      expect("grossMarginPercentage" in unauthorizedMetrics).toBe(false);
      expect(unauthorizedMetrics.grossMarginPercentage).toBeUndefined();

      expect("hasRecordedCost" in unauthorizedMetrics).toBe(false);
      expect(unauthorizedMetrics.hasRecordedCost).toBeUndefined();

      expect("isNegativeMargin" in unauthorizedMetrics).toBe(false);
      expect(unauthorizedMetrics.isNegativeMargin).toBeUndefined();

      expect(unauthorizedMetrics.sellingPrice).toBe(100.0);
    });
  });
});
