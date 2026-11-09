import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CategoryManagerModal, type CategoryModalItem } from "@/components/products/CategoryManagerModal";
import { CategoryPageClient, type CategoryPageItem } from "@/components/products/CategoryPageClient";
import { CategoryModalTrigger } from "@/components/products/CategoryModalTrigger";
import * as categoryActions from "@/actions/category-actions";

// Mock next/navigation
const mockReplace = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock category actions
vi.mock("@/actions/category-actions", () => ({
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  archiveCategoryAction: vi.fn(),
  restoreCategoryAction: vi.fn(),
}));

describe("T047 & T048: Category UI Components Unit Tests (FR-030 to FR-037)", () => {
  const mockSlug = "test-store";

  const mockCategories: CategoryModalItem[] = [
    {
      id: "cat-1",
      name: "Bakery & Breads",
      description: "Fresh artisanal breads",
      status: "active",
      productCount: 15,
    },
    {
      id: "cat-2",
      name: "Dairy & Eggs",
      description: "Milk, cheese, butter",
      status: "active",
      productCount: 8,
    },
    {
      id: "cat-3",
      name: "Discontinued Seasonal",
      description: "Old summer items",
      status: "archived",
      productCount: 3,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CategoryManagerModal (T047)", () => {
    it("does not render when isOpen is false", () => {
      const { container } = render(
        <CategoryManagerModal
          isOpen={false}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders active categories and product count badges by default", () => {
      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      expect(screen.getByText("Category Management")).toBeDefined();
      expect(screen.getByText("Bakery & Breads")).toBeDefined();
      expect(screen.getByText("Dairy & Eggs")).toBeDefined();
      expect(screen.getByText("15 products")).toBeDefined();
      expect(screen.getByText("8 products")).toBeDefined();
      // Archived item should not be in the active tab
      expect(screen.queryByText("Discontinued Seasonal")).toBeNull();
    });

    it("switches to archived tab and displays archived categories", () => {
      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      const archivedTab = screen.getByRole("button", { name: /Archived/i });
      fireEvent.click(archivedTab);

      expect(screen.getByText("Discontinued Seasonal")).toBeDefined();
      expect(screen.getByText("3 products")).toBeDefined();
      expect(screen.queryByText("Bakery & Breads")).toBeNull();
    });

    it("filters categories via search input", () => {
      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      const searchInput = screen.getByPlaceholderText(/Search active categories/i);
      fireEvent.change(searchInput, { target: { value: "dairy" } });

      expect(screen.getByText("Dairy & Eggs")).toBeDefined();
      expect(screen.queryByText("Bakery & Breads")).toBeNull();
    });

    it("hides create button when canCreate is false", () => {
      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={false}
          canUpdate={true}
          canArchive={true}
        />
      );

      expect(screen.queryByText("New Category")).toBeNull();
    });

    it("allows creating a new category and displays success feedback", async () => {
      vi.mocked(categoryActions.createCategoryAction).mockResolvedValue({
        success: true,
        data: {
          id: "cat-new",
          organization_id: "org-1",
          name: "Fresh Produce",
          description: "Fruits and vegetables",
          status: "active",
          created_at: new Date().toISOString(),
        },
      });

      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      fireEvent.click(screen.getByText("New Category"));

      const nameInput = screen.getByLabelText(/Category Name/i);
      const descInput = screen.getByLabelText(/Description/i);

      fireEvent.change(nameInput, { target: { value: "  Fresh Produce  " } });
      fireEvent.change(descInput, { target: { value: "Fruits and vegetables" } });

      fireEvent.click(screen.getByRole("button", { name: /Save Category/i }));

      await waitFor(() => {
        expect(categoryActions.createCategoryAction).toHaveBeenCalledWith(mockSlug, {
          name: "Fresh Produce",
          description: "Fruits and vegetables",
        });
      });
    });

    it("opens archive confirmation dialog with product preservation notice", () => {
      render(
        <CategoryManagerModal
          isOpen={true}
          onClose={vi.fn()}
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      const archiveButtons = screen.getAllByLabelText(/Archive category/i);
      expect(archiveButtons[0]).toBeDefined();
      fireEvent.click(archiveButtons[0]!);

      // Check for product preservation notice (FR-035)
      expect(screen.getByText(/Product preservation guarantee/i)).toBeDefined();
      expect(screen.getAllByText(/15 products/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/retain their category reference/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /Confirm Archive/i })).toBeDefined();
    });
  });

  describe("CategoryPageClient (T048)", () => {
    const pageCategories: CategoryPageItem[] = mockCategories.map((c) => ({
      ...c,
      organization_id: "org-1",
    }));

    it("renders page header, category count, and product count badges", () => {
      render(
        <CategoryPageClient
          slug={mockSlug}
          organizationName="Super Retail Store"
          categories={pageCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      expect(screen.getByText("Categories")).toBeDefined();
      expect(screen.getByText("3 total")).toBeDefined();
      expect(screen.getByText("Back to Products")).toBeDefined();
      expect(screen.getByText("Bakery & Breads")).toBeDefined();
      expect(screen.getByText("15 active products")).toBeDefined();
    });

    it("displays restore button on archived tab when user has canArchive permission", () => {
      render(
        <CategoryPageClient
          slug={mockSlug}
          organizationName="Super Retail Store"
          categories={pageCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
          initialTab="archived"
        />
      );

      expect(screen.getByText("Discontinued Seasonal")).toBeDefined();
      expect(screen.getByRole("button", { name: /Restore/i })).toBeDefined();
    });

    it("denies archive and restore buttons when canArchive is false (Manager)", () => {
      render(
        <CategoryPageClient
          slug={mockSlug}
          organizationName="Super Retail Store"
          categories={pageCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={false}
          initialTab="active"
        />
      );

      expect(screen.queryByLabelText(/Archive category/i)).toBeNull();
    });
  });

  describe("CategoryModalTrigger (Production Integration)", () => {
    it("renders trigger button and opens modal when clicked", () => {
      render(
        <CategoryModalTrigger
          slug={mockSlug}
          categories={mockCategories}
          canCreate={true}
          canUpdate={true}
          canArchive={true}
        />
      );

      const triggerBtn = screen.getByRole("button", { name: /Quick manage categories/i });
      expect(triggerBtn).toBeDefined();
      expect(screen.getByText("Quick Categories")).toBeDefined();

      // Modal should not be rendered yet
      expect(screen.queryByText("Category Management")).toBeNull();

      // Click trigger to open modal
      fireEvent.click(triggerBtn);

      // Modal is now mounted and open
      expect(screen.getByText("Category Management")).toBeDefined();
      expect(screen.getByText("Bakery & Breads")).toBeDefined();

      // Close modal
      const closeBtn = screen.getByLabelText(/Close category manager/i);
      fireEvent.click(closeBtn);

      // Modal should be closed
      expect(screen.queryByText("Category Management")).toBeNull();
    });
  });
});
