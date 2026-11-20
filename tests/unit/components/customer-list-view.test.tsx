import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CustomerListView } from "@/components/customers/customer-list-view";
import * as customerActions from "@/actions/customer-actions";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/actions/customer-actions", () => ({
  archiveCustomerAction: vi.fn(),
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

describe("CustomerListView Component Unit Tests (T044, US2)", () => {
  const mockSlug = "test-store";

  const mockCustomers = [
    {
      id: "c-1",
      organizationId: "org-1",
      name: "Acme Corp",
      phone: "+14155551111",
      email: "contact@acme.com",
      notes: "Wholesale client",
      status: "active" as const,
      createdAt: "2026-11-17T12:00:00Z",
      updatedAt: "2026-11-17T12:00:00Z",
    },
    {
      id: "c-2",
      organizationId: "org-1",
      name: "Old Client",
      phone: null,
      email: null,
      notes: null,
      status: "archived" as const,
      createdAt: "2026-11-10T12:00:00Z",
      updatedAt: "2026-11-15T12:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders customer directory header, table rows, and status badges", () => {
    render(
      <CustomerListView
        slug={mockSlug}
        initialData={{
          items: mockCustomers,
          totalCount: 2,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }}
        searchQuery=""
        currentStatus="active"
        canCreate={true}
        canUpdate={true}
        canArchive={true}
      />
    );

    expect(screen.getByText("Customer Directory")).toBeDefined();
    expect(screen.getByText("Acme Corp")).toBeDefined();
    expect(screen.getByText("+14155551111")).toBeDefined();
    expect(screen.getByText("contact@acme.com")).toBeDefined();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Old Client")).toBeDefined();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
  });

  it("renders empty state when no customers are found", () => {
    render(
      <CustomerListView
        slug={mockSlug}
        initialData={{
          items: [],
          totalCount: 0,
          page: 1,
          pageSize: 20,
          totalPages: 0,
        }}
        searchQuery=""
        currentStatus="active"
        canCreate={true}
        canUpdate={true}
        canArchive={true}
      />
    );

    expect(screen.getByText("No customers found")).toBeDefined();
  });

  it("opens create modal when Add Customer button is clicked", () => {
    render(
      <CustomerListView
        slug={mockSlug}
        initialData={{
          items: mockCustomers,
          totalCount: 2,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }}
        searchQuery=""
        currentStatus="active"
        canCreate={true}
        canUpdate={true}
        canArchive={true}
      />
    );

    const addButton = screen.getByRole("button", { name: /Add Customer/i });
    fireEvent.click(addButton);

    expect(screen.getByText("New Customer Profile")).toBeDefined();
  });

  it("opens archive confirmation dialog and calls archiveCustomerAction on confirm", async () => {
    vi.mocked(customerActions.archiveCustomerAction).mockResolvedValue({
      success: true,
      data: { archived: true },
    });

    render(
      <CustomerListView
        slug={mockSlug}
        initialData={{
          items: [mockCustomers[0]!],
          totalCount: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        }}
        searchQuery=""
        currentStatus="active"
        canCreate={true}
        canUpdate={true}
        canArchive={true}
      />
    );

    const archiveButton = screen.getByTitle("Archive Customer");
    fireEvent.click(archiveButton);

    expect(screen.getByText(/Are you sure you want to archive/i)).toBeDefined();

    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", { name: "Archive Customer" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(customerActions.archiveCustomerAction).toHaveBeenCalledWith(mockSlug, "c-1");
    });
  });
});
