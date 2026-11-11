import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryMetricsTiles } from "@/components/inventory/inventory-metrics-tiles";
import type { InventoryOverviewData } from "@/types/inventory";

describe("InventoryMetricsTiles Component (T020, FR-INV-002, US1)", () => {
  const mockOverviewData: InventoryOverviewData = {
    totalTrackedProducts: 1250,
    inStockCount: 1100,
    lowStockCount: 100,
    outOfStockCount: 50,
    totalValuation: {
      amount: 45250.75,
      currency: "USD",
      formatted: "$45,250.75",
    },
  };

  it("1. Renders 4 standard metric cards with correct values and labels", () => {
    render(
      <InventoryMetricsTiles
        data={mockOverviewData}
        canViewValuation={false}
      />
    );

    // Total Products
    expect(screen.getByTestId("metric-total-products")).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("Total Products")).toBeInTheDocument();

    // In Stock
    expect(screen.getByTestId("metric-in-stock")).toBeInTheDocument();
    expect(screen.getByText("1,100")).toBeInTheDocument();
    expect(screen.getByText("In Stock")).toBeInTheDocument();

    // Low Stock
    expect(screen.getByTestId("metric-low-stock")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Low Stock")).toBeInTheDocument();

    // Out of Stock
    expect(screen.getByTestId("metric-out-of-stock")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("Out of Stock")).toBeInTheDocument();

    // Valuation tile MUST NOT be present
    expect(screen.queryByTestId("metric-total-valuation")).toBeNull();
  });

  it("2. Gating: Renders 5th Total Valuation tile ONLY when canViewValuation is true", () => {
    render(
      <InventoryMetricsTiles
        data={mockOverviewData}
        canViewValuation={true}
      />
    );

    const valuationTile = screen.getByTestId("metric-total-valuation");
    expect(valuationTile).toBeInTheDocument();
    expect(screen.getByText("Total Valuation")).toBeInTheDocument();
    expect(screen.getByText("$45,250.75")).toBeInTheDocument();
    expect(screen.getByText("Based on unit cost")).toBeInTheDocument();

    // SVG sparkline trend indicator is present
    expect(valuationTile.querySelector("svg")).toBeInTheDocument();
  });

  it("3. Confidentiality: Completely omits Total Valuation tile when canViewValuation is false", () => {
    render(
      <InventoryMetricsTiles
        data={mockOverviewData}
        canViewValuation={false}
      />
    );

    expect(screen.queryByTestId("metric-total-valuation")).toBeNull();
    expect(screen.queryByText("$45,250.75")).toBeNull();
    expect(screen.queryByText("Total Valuation")).toBeNull();
  });

  it("4. Gracefully handles null data by displaying zero counts and omitting valuation", () => {
    render(
      <InventoryMetricsTiles
        data={null}
        canViewValuation={true}
      />
    );

    expect(screen.getByTestId("metric-total-products")).toBeInTheDocument();
    expect(screen.getByTestId("metric-in-stock")).toBeInTheDocument();
    expect(screen.getByTestId("metric-low-stock")).toBeInTheDocument();
    expect(screen.getByTestId("metric-out-of-stock")).toBeInTheDocument();

    // All zero
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(4);

    // Valuation tile is omitted when totalValuation is null even if canViewValuation is true
    expect(screen.queryByTestId("metric-total-valuation")).toBeNull();
  });

  it("5. Highlights Low-Stock card when lowStockCount > 0", () => {
    render(
      <InventoryMetricsTiles
        data={{
          totalTrackedProducts: 10,
          inStockCount: 5,
          lowStockCount: 5,
          outOfStockCount: 0,
          totalValuation: null,
        }}
        canViewValuation={false}
      />
    );

    const lowStockCard = screen.getByTestId("metric-low-stock");
    expect(lowStockCard.className).toContain("border-amber-300");
    expect(screen.getByText("Requires reordering")).toBeInTheDocument();
  });

  it("6. Highlights Out-of-Stock card when outOfStockCount > 0", () => {
    render(
      <InventoryMetricsTiles
        data={{
          totalTrackedProducts: 10,
          inStockCount: 8,
          lowStockCount: 0,
          outOfStockCount: 2,
          totalValuation: null,
        }}
        canViewValuation={false}
      />
    );

    const outOfStockCard = screen.getByTestId("metric-out-of-stock");
    expect(outOfStockCard.className).toContain("border-red-300");
    expect(screen.getByText("Depleted inventory")).toBeInTheDocument();
  });
});

