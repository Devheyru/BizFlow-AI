import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SalesHistoryView } from "@/components/sales/sales-history-view";
import type { PaginatedSalesList } from "@/types/sales";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("SalesHistoryView Component (T063, US5)", () => {
  const initialData: PaginatedSalesList = {
    items: [
      {
        id: "sale-101",
        saleNumber: "SAL-20261121-0001",
        status: "completed",
        paymentStatus: "paid",
        customerId: "cust-1",
        customerName: "Emma Watson",
        itemsCount: 3,
        subtotal: 150.0,
        orderDiscountAmount: 0,
        taxAmount: 15.0,
        totalAmount: 165.0,
        currency: "USD",
        cashierId: "cashier-1",
        cashierName: "John Cashier",
        createdAt: "2026-11-21T14:30:00Z",
      },
    ],
    totalCount: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };

  it("renders transaction row with sale number, customer, status, and formatted total", () => {
    render(
      <SalesHistoryView
        slug="alpha-store"
        initialData={initialData}
        currency="USD"
      />
    );

    expect(screen.getByText("SAL-20261121-0001")).toBeDefined();
    expect(screen.getByText("Emma Watson")).toBeDefined();
    expect(screen.getByText("John Cashier")).toBeDefined();
    expect(screen.getByText("3 items")).toBeDefined();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("Paid")).toBeDefined();
    expect(screen.getByText("$165.00")).toBeDefined();
  });

  it("renders empty state placeholder when no sales match criteria", () => {
    const emptyData: PaginatedSalesList = {
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    render(
      <SalesHistoryView
        slug="alpha-store"
        initialData={emptyData}
        currency="USD"
      />
    );

    expect(screen.getByText("No sales found")).toBeDefined();
    expect(screen.getByText(/Try adjusting your filters/i)).toBeDefined();
  });

  it("submits filter updates through router.push", () => {
    render(
      <SalesHistoryView
        slug="alpha-store"
        initialData={initialData}
        currency="USD"
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search by sale number/i);
    fireEvent.change(searchInput, { target: { value: "SAL-2026" } });

    const filterBtn = screen.getByRole("button", { name: /^Filter$/i });
    fireEvent.click(filterBtn);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("search=SAL-2026"));
  });
});
