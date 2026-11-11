import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  InventoryFilters,
  type CategoryOption,
} from "@/components/inventory/inventory-filters";

const mockPush = vi.fn();
const mockPathname = "/test-store/inventory";
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

describe("InventoryFilters Component (T021, FR-INV-004, US1)", () => {
  const mockCategories: CategoryOption[] = [
    { id: "cat-1", name: "Beverages", status: "active" },
    { id: "cat-2", name: "Bakery", status: "active" },
    { id: "cat-3", name: "Dairy", status: "archived" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it("1. Renders all filter inputs, dropdowns, and checkboxes", () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        currentSearch=""
        currentCategoryId=""
        currentStockStatus="all"
        currentProductStatus="all"
        includeArchived={false}
      />
    );

    // Search input
    expect(screen.getByTestId("inventory-search-input")).toBeInTheDocument();

    // Category select
    expect(screen.getByTestId("inventory-category-select")).toBeInTheDocument();
    expect(screen.getByText("All Categories")).toBeInTheDocument();
    expect(screen.getByText("Beverages")).toBeInTheDocument();
    expect(screen.getByText("Bakery")).toBeInTheDocument();
    expect(screen.getByText("Dairy (Archived)")).toBeInTheDocument();

    // Stock Status select
    expect(screen.getByTestId("inventory-stock-status-select")).toBeInTheDocument();
    expect(screen.getByText("All Stock Levels")).toBeInTheDocument();

    // Product Status select
    expect(screen.getByTestId("inventory-product-status-select")).toBeInTheDocument();
    expect(screen.getByText("All Product Statuses")).toBeInTheDocument();

    // Include Archived checkbox
    expect(screen.getByTestId("inventory-include-archived-checkbox")).toBeInTheDocument();
  });

  it("2. Debounces search input and synchronizes with URL search params", async () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        currentSearch=""
      />
    );

    const searchInput = screen.getByTestId("inventory-search-input");
    fireEvent.change(searchInput, { target: { value: "Espresso" } });

    // Wait for 300ms debounce
    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining("search=Espresso")
        );
      },
      { timeout: 1000 }
    );
  });

  it("3. Clear button resets search input and removes query param", async () => {
    mockSearchParams.set("search", "Latte");

    render(
      <InventoryFilters
        categories={mockCategories}
        currentSearch="Latte"
      />
    );

    const clearBtn = screen.getByTestId("inventory-clear-search-btn");
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);

    expect(screen.getByTestId("inventory-search-input")).toHaveValue("");
    expect(mockPush).toHaveBeenCalled();
  });

  it("4. Category selection updates categoryId param and resets page", () => {
    mockSearchParams.set("page", "3");

    render(
      <InventoryFilters
        categories={mockCategories}
        currentCategoryId=""
      />
    );

    const categorySelect = screen.getByTestId("inventory-category-select");
    fireEvent.change(categorySelect, { target: { value: "cat-1" } });

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("categoryId=cat-1")
    );
    // Page parameter should be omitted / reset
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining("page=3")
    );
  });

  it("5. Stock status selection updates stockStatus param", () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        currentStockStatus="all"
      />
    );

    const stockSelect = screen.getByTestId("inventory-stock-status-select");
    fireEvent.change(stockSelect, { target: { value: "low_stock" } });

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("stockStatus=low_stock")
    );
  });

  it("6. Product status selection updates productStatus param", () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        currentProductStatus="all"
      />
    );

    const statusSelect = screen.getByTestId("inventory-product-status-select");
    fireEvent.change(statusSelect, { target: { value: "inactive" } });

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("productStatus=inactive")
    );
  });

  it("7. Toggling 'Include Archived' sets includeArchived in URL params", () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        includeArchived={false}
      />
    );

    const checkbox = screen.getByTestId("inventory-include-archived-checkbox");
    fireEvent.click(checkbox);

    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("includeArchived=true")
    );
  });

  it("8. Shows Reset Filters button when active filters exist, and resets all upon click", () => {
    render(
      <InventoryFilters
        categories={mockCategories}
        currentSearch="Organic"
        currentCategoryId="cat-1"
        currentStockStatus="low_stock"
      />
    );

    const resetBtn = screen.getByTestId("inventory-reset-filters-btn");
    expect(resetBtn).toBeInTheDocument();

    fireEvent.click(resetBtn);

    expect(mockPush).toHaveBeenCalledWith(mockPathname);
  });
});

