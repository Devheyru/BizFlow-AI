import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ValuationSummaryCards } from "@/components/inventory/valuation-summary-cards";

describe("ValuationSummaryCards Component (T033, Phase 9)", () => {
  const defaultProps = {
    totalValuation: {
      amount: 12500.5,
      currency: "USD",
      formatted: "$12,500.50",
    },
    totalTrackedProducts: 50,
    valuedProductsCount: 45,
    unvaluedProductsCount: 5,
    zeroStockValuedProductsCount: 3,
    currency: "USD",
  };

  it("1. Renders all 4 valuation summary metric cards", () => {
    render(<ValuationSummaryCards {...defaultProps} />);

    expect(screen.getByTestId("valuation-summary-cards")).toBeInTheDocument();
    expect(screen.getByTestId("card-total-valuation")).toBeInTheDocument();
    expect(screen.getByTestId("card-valued-coverage")).toBeInTheDocument();
    expect(screen.getByTestId("card-unvalued-products")).toBeInTheDocument();
    expect(screen.getByTestId("card-average-valuation")).toBeInTheDocument();
  });

  it("2. Formats and displays Total Valuation correctly", () => {
    render(<ValuationSummaryCards {...defaultProps} />);

    expect(screen.getByTestId("value-total-valuation")).toHaveTextContent("$12,500.50");
    expect(screen.getByText(/USD on-hand asset value/i)).toBeInTheDocument();
  });

  it("3. Displays Valued Coverage count and percentage", () => {
    render(<ValuationSummaryCards {...defaultProps} />);

    expect(screen.getByTestId("value-valued-coverage")).toHaveTextContent("45 / 50");
    expect(screen.getByText(/90% products with cost records/i)).toBeInTheDocument();
  });

  it("4. Highlights Unvalued Items when count is greater than zero", () => {
    render(<ValuationSummaryCards {...defaultProps} />);

    const unvaluedCard = screen.getByTestId("card-unvalued-products");
    expect(unvaluedCard).toHaveClass("border-amber-300");
    expect(screen.getByTestId("value-unvalued-products")).toHaveTextContent("5");
    expect(screen.getByText(/Excluded from monetary totals/i)).toBeInTheDocument();
  });

  it("5. Calculates and displays average valuation per valued item", () => {
    render(<ValuationSummaryCards {...defaultProps} />);

    // 12500.50 / 45 = 277.7888...
    expect(screen.getByTestId("value-average-valuation")).toBeInTheDocument();
  });

  it("6. Handles zero inventory gracefully without crashing or dividing by zero", () => {
    render(
      <ValuationSummaryCards
        totalValuation={{ amount: 0, currency: "USD", formatted: "$0.00" }}
        totalTrackedProducts={0}
        valuedProductsCount={0}
        unvaluedProductsCount={0}
        currency="USD"
      />
    );

    expect(screen.getByTestId("value-total-valuation")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("value-valued-coverage")).toHaveTextContent("0 / 0");
    expect(screen.getByTestId("value-unvalued-products")).toHaveTextContent("0");
    expect(screen.getByTestId("value-average-valuation")).toHaveTextContent("$0.00");
  });
});
