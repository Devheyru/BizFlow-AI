import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MovementHistoryTable,
  type ProductOption,
} from "@/components/inventory/movement-history-table";
import type { MovementHistoryRow } from "@/types/inventory";

const mockPush = vi.fn();
const mockPathname = "/test-store/inventory/history";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

describe("MovementHistoryTable Component (T032, US5, Phase 8)", () => {
  const mockProducts: ProductOption[] = [
    { id: "p1", name: "Whole Milk 1L", sku: "MILK-001" },
    { id: "p2", name: "Arabica Coffee Beans", sku: "COF-001" },
  ];

  const mockRows: MovementHistoryRow[] = [
    {
      id: "m1",
      productId: "p1",
      productName: "Whole Milk 1L",
      sku: "MILK-001",
      movementType: "restock",
      quantityBefore: 10,
      quantityDelta: 25,
      quantityAfter: 35,
      reason: "Weekly dairy delivery",
      referenceId: "PO-9901",
      unitCost: 1.5,
      currency: "USD",
      performedBy: {
        id: "u1",
        fullName: "Alice Inventory",
        email: "",
      },
      createdAt: "2026-11-14T10:00:00.000Z",
    },
    {
      id: "m2",
      productId: "p2",
      productName: "Arabica Coffee Beans",
      sku: "COF-001",
      movementType: "damage",
      quantityBefore: 50,
      quantityDelta: -5,
      quantityAfter: 45,
      reason: "Bags punctured during transit",
      referenceId: "DMG-002",
      unitCost: 12.0,
      currency: "USD",
      performedBy: {
        id: "u2",
        fullName: "Bob Stock",
        email: "",
      },
      createdAt: "2026-11-14T11:30:00.000Z",
    },
    {
      id: "m3",
      productId: "p1",
      productName: "Whole Milk 1L",
      sku: "MILK-001",
      movementType: "initial",
      quantityBefore: 0,
      quantityDelta: 0,
      quantityAfter: 0,
      reason: "Zero opening balance registration",
      referenceId: null,
      unitCost: null,
      currency: null,
      performedBy: {
        id: "u1",
        fullName: null,
        email: "",
      },
      createdAt: "2026-11-10T08:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  // ==========================================================================
  // 1. Table Rendering and Layout
  // ==========================================================================
  it("1. Renders movement history rows, product information, badges, and deltas", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    expect(screen.getByTestId("movement-history-table-container")).toBeInTheDocument();
    expect(screen.getByTestId("movement-history-table")).toBeInTheDocument();

    // Check rows exist
    expect(screen.getByTestId("history-row-m1")).toBeInTheDocument();
    expect(screen.getByTestId("history-row-m2")).toBeInTheDocument();
    expect(screen.getByTestId("history-row-m3")).toBeInTheDocument();

    // Check product names and SKUs
    expect(screen.getAllByText("Whole Milk 1L")).toHaveLength(2);
    expect(screen.getAllByText("SKU: MILK-001")).toHaveLength(2);
    expect(screen.getByText("Arabica Coffee Beans")).toBeInTheDocument();
    expect(screen.getByText("SKU: COF-001")).toBeInTheDocument();

    // Check movement type badges
    expect(screen.getByTestId("movement-type-badge-m1")).toHaveTextContent("Restock");
    expect(screen.getByTestId("movement-type-badge-m2")).toHaveTextContent("Damage");
    expect(screen.getByTestId("movement-type-badge-m3")).toHaveTextContent("Opening Stock");

    // Check signed deltas
    expect(screen.getByTestId("quantity-delta-m1")).toHaveTextContent("+25");
    expect(screen.getByTestId("quantity-delta-m2")).toHaveTextContent("-5");
    expect(screen.getByTestId("quantity-delta-m3")).toHaveTextContent("0");

    // Check reasons & reference IDs
    expect(screen.getByText("Weekly dairy delivery")).toBeInTheDocument();
    expect(screen.getByText("PO-9901")).toBeInTheDocument();
    expect(screen.getByText("Bags punctured during transit")).toBeInTheDocument();
    expect(screen.getByText("DMG-002")).toBeInTheDocument();

    // Check performed by
    expect(screen.getByText("Alice Inventory")).toBeInTheDocument();
    expect(screen.getByText("Bob Stock")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument(); // Falls back to System when fullName is null
  });

  // ==========================================================================
  // 2. Valuation Column Gating (Strict Dual-Permission Enforcement)
  // ==========================================================================
  it("2. Strictly omits Unit Cost and Total Cost columns from DOM when canViewValuation is false", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    // Headers must not exist
    expect(screen.queryByTestId("col-unit-cost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("col-total-cost")).not.toBeInTheDocument();

    // Cell data must not exist
    expect(screen.queryByTestId("unit-cost-m1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("total-cost-m1")).not.toBeInTheDocument();
  });

  it("3. Renders Unit Cost and Total Cost columns when canViewValuation is true", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={true}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    // Headers must exist
    expect(screen.getByTestId("col-unit-cost")).toBeInTheDocument();
    expect(screen.getByTestId("col-total-cost")).toBeInTheDocument();

    // Check unit cost and total cost formatting
    // m1: delta=25, unitCost=1.50 -> Total = 37.50
    expect(screen.getByTestId("unit-cost-m1")).toHaveTextContent("$1.50");
    expect(screen.getByTestId("total-cost-m1")).toHaveTextContent("$37.50");

    // m2: delta=-5, unitCost=12.00 -> Total = 60.00 (absolute cost)
    expect(screen.getByTestId("unit-cost-m2")).toHaveTextContent("$12.00");
    expect(screen.getByTestId("total-cost-m2")).toHaveTextContent("$60.00");

    // m3: unitCost is null -> renders dash "—"
    expect(screen.getByTestId("unit-cost-m3")).toHaveTextContent("—");
    expect(screen.getByTestId("total-cost-m3")).toHaveTextContent("—");
  });

  // ==========================================================================
  // 3. Filter Controls Interaction
  // ==========================================================================
  it("4. Changing product filter triggers URL update with productId", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    const productSelect = screen.getByTestId("filter-product-select");
    fireEvent.change(productSelect, { target: { value: "p1" } });

    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?productId=p1");
  });

  it("5. Changing movement type filter triggers URL update with movementType", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    const typeSelect = screen.getByTestId("filter-type-select");
    fireEvent.change(typeSelect, { target: { value: "damage" } });

    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?movementType=damage");
  });

  it("6. Setting date filters triggers URL update with fromDate and toDate", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    const fromDateInput = screen.getByTestId("filter-from-date");
    fireEvent.change(fromDateInput, { target: { value: "2026-11-01" } });

    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?fromDate=2026-11-01");

    const toDateInput = screen.getByTestId("filter-to-date");
    fireEvent.change(toDateInput, { target: { value: "2026-11-14" } });

    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?toDate=2026-11-14");
  });

  it("7. Clicking Reset Filters clears filter state and routes to base pathname", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={3}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        currentFilters={{
          movementType: "restock",
          productId: "p1",
        }}
        slug="test-store"
      />
    );

    const resetBtn = screen.getByTestId("filter-reset-btn");
    fireEvent.click(resetBtn);

    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history");
  });

  // ==========================================================================
  // 4. Pagination Controls
  // ==========================================================================
  it("8. Pagination controls navigate between pages and change page sizes", () => {
    render(
      <MovementHistoryTable
        items={mockRows}
        totalCount={60}
        page={1}
        pageSize={25}
        totalPages={3}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    const prevBtn = screen.getByTestId("pagination-prev-btn");
    const nextBtn = screen.getByTestId("pagination-next-btn");

    // Page 1: Prev disabled, Next enabled
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    // Click Next
    fireEvent.click(nextBtn);
    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?page=2");

    // Change Page Size
    const pageSizeSelect = screen.getByTestId("pagination-page-size-select");
    fireEvent.change(pageSizeSelect, { target: { value: "50" } });
    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history?pageSize=50");
  });

  // ==========================================================================
  // 5. Empty States
  // ==========================================================================
  it("9. Displays clean empty state when no movements are tracked", () => {
    render(
      <MovementHistoryTable
        items={[]}
        totalCount={0}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        slug="test-store"
      />
    );

    expect(screen.getByTestId("movement-history-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No stock movements recorded")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-clear-filters-btn")).not.toBeInTheDocument();
  });

  it("10. Displays filtered empty state with reset button when filters yield no matches", () => {
    render(
      <MovementHistoryTable
        items={[]}
        totalCount={0}
        page={1}
        pageSize={25}
        totalPages={1}
        canViewValuation={false}
        currency="USD"
        products={mockProducts}
        currentFilters={{ movementType: "loss" }}
        slug="test-store"
      />
    );

    expect(screen.getByTestId("movement-history-empty-state")).toBeInTheDocument();
    expect(screen.getByText("No matching movement history")).toBeInTheDocument();
    expect(screen.getByTestId("empty-clear-filters-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("empty-clear-filters-btn"));
    expect(mockPush).toHaveBeenCalledWith("/test-store/inventory/history");
  });
});
