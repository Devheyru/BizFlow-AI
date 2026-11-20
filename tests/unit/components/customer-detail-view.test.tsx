import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CustomerDetailView } from "@/components/customers/customer-detail-view";
import * as customerActions from "@/actions/customer-actions";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("@/actions/customer-actions", () => ({
  archiveCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
  createCustomerAction: vi.fn(),
}));

describe("CustomerDetailView Component Unit Tests (T046, US2)", () => {
  const mockSlug = "test-store";

  const mockCustomer = {
    id: "cust-999",
    organizationId: "org-1",
    name: "VIP Enterprise",
    phone: "+14155558888",
    email: "vip@enterprise.com",
    notes: "Requires net-30 terms.",
    status: "active" as const,
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    purchaseCount: 3,
    totalSpent: 450.75,
    lastPurchaseAt: "2026-11-15T16:00:00Z",
  };

  const mockHistory = [
    {
      id: "sale-1",
      saleNumber: "S-20261115-0001",
      status: "completed",
      paymentStatus: "paid",
      subtotal: 400.0,
      orderDiscountAmount: 0.0,
      taxAmount: 50.75,
      totalAmount: 450.75,
      currency: "USD",
      createdAt: "2026-11-15T16:00:00Z",
      createdBy: "u-1",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders customer header, metric cards, and profile information tab", () => {
    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={mockCustomer}
        purchaseHistory={mockHistory}
        canUpdate={true}
        canArchive={true}
        canViewSales={true}
      />
    );

    expect(screen.getAllByText("VIP Enterprise").length).toBeGreaterThan(0);
    expect(screen.getByText("Active Customer")).toBeDefined();
    expect(screen.getByText("Total Purchases")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("Total Spent")).toBeDefined();
    expect(screen.getAllByText("$450.75").length).toBeGreaterThan(0);
    expect(screen.getByText("Requires net-30 terms.")).toBeDefined();
  });

  it("switches to purchase history tab and renders sale records without financial cost leaks", () => {
    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={mockCustomer}
        purchaseHistory={mockHistory}
        canUpdate={true}
        canArchive={true}
        canViewSales={true}
      />
    );

    const historyTab = screen.getByRole("button", { name: /Purchase History/i });
    fireEvent.click(historyTab);

    expect(screen.getByText("S-20261115-0001")).toBeDefined();
    expect(screen.getByText("$400.00")).toBeDefined();
    expect(screen.getAllByText("$450.75").length).toBeGreaterThan(0);
    expect(screen.getByText("paid")).toBeDefined();

    // Verify absence of sensitive cost or margin headers
    expect(screen.queryByText(/Unit Cost/i)).toBeNull();
    expect(screen.queryByText(/Profit Margin/i)).toBeNull();
  });

  it("displays access restricted notice when user lacks sales:read permission", () => {
    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={mockCustomer}
        purchaseHistory={[]}
        canUpdate={true}
        canArchive={true}
        canViewSales={false}
      />
    );

    const historyTab = screen.getByRole("button", { name: /Purchase History/i });
    fireEvent.click(historyTab);

    expect(screen.getByText("Access Restricted")).toBeDefined();
    expect(screen.getByText(/You need the sales:read permission/i)).toBeDefined();
  });

  it("renders 'Restricted' with lock icon in metric cards when sales metrics are restricted", () => {
    const restrictedCustomer = {
      ...mockCustomer,
      purchaseCount: null,
      totalSpent: null,
      lastPurchaseAt: null,
      salesMetricsRestricted: true,
    };

    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={restrictedCustomer}
        purchaseHistory={[]}
        canUpdate={true}
        canArchive={true}
        canViewSales={false}
      />
    );

    expect(screen.getAllByText("Restricted").length).toBe(3);
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.queryByText("$450.75")).toBeNull();
  });

  it("opens edit modal when Edit Profile button is clicked", () => {
    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={mockCustomer}
        purchaseHistory={mockHistory}
        canUpdate={true}
        canArchive={true}
        canViewSales={true}
      />
    );

    const editButton = screen.getByRole("button", { name: /Edit Profile/i });
    fireEvent.click(editButton);

    expect(screen.getByText("Edit Customer Profile")).toBeDefined();
  });

  it("opens archive confirmation modal and calls archiveCustomerAction", async () => {
    vi.mocked(customerActions.archiveCustomerAction).mockResolvedValue({
      success: true,
      data: { archived: true },
    });

    render(
      <CustomerDetailView
        slug={mockSlug}
        customer={mockCustomer}
        purchaseHistory={mockHistory}
        canUpdate={true}
        canArchive={true}
        canViewSales={true}
      />
    );

    const archiveButton = screen.getByRole("button", { name: /Archive/i });
    fireEvent.click(archiveButton);

    expect(screen.getByText(/Are you sure you want to archive/i)).toBeDefined();

    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Archive Customer" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(customerActions.archiveCustomerAction).toHaveBeenCalledWith(mockSlug, "cust-999");
    });
  });
});
