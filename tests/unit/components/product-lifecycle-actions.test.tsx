import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProductLifecycleActions } from "@/components/products/ProductLifecycleActions";
import * as productActions from "@/actions/product-actions";
import { useRouter } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/actions/product-actions", () => ({
  toggleProductStatusAction: vi.fn(),
  archiveProductAction: vi.fn(),
  restoreProductAction: vi.fn(),
  getProductStateAction: vi.fn(),
}));

describe("T051 & T052: ProductLifecycleActions Component Unit Tests (US5)", () => {
  const mockSlug = "test-store";
  const mockProductId = "prod-1111-2222-3333";
  const mockProductName = "Premium Roasted Coffee";
  const mockSku = "COF-ROAST-01";

  const mockRouter = {
    push: vi.fn(),
    refresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter as any);
  });

  describe("Permission Gating (FR-040)", () => {
    it("renders zero action buttons when caller has neither update nor archive permissions (Cashier)", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={false}
          canArchive={false}
          variant="detail"
        />
      );

      expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /set inactive/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /restore/i })).not.toBeInTheDocument();
    });

    it("renders toggle control but omits archive button when caller only has products:update (Manager)", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={false}
          variant="detail"
        />
      );

      expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /archive/i })).not.toBeInTheDocument();
    });

    it("renders both toggle and archive controls when caller has both permissions (Owner/Admin)", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
    });
  });

  describe("Toggle Product Status (FR-018)", () => {
    it("toggles active to inactive optimistically and updates state on success", async () => {
      const onStatusChange = vi.fn();
      vi.mocked(productActions.toggleProductStatusAction).mockResolvedValue({
        success: true,
        data: { id: mockProductId, status: "inactive", version: 2 },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
          onStatusChange={onStatusChange}
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(productActions.toggleProductStatusAction).toHaveBeenCalledWith(
          mockSlug,
          mockProductId,
          1,
          "inactive"
        );
      });

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith("inactive", 2);
        expect(mockRouter.refresh).toHaveBeenCalled();
      });
    });

    it("rolls back optimistic status on structured failure and displays error", async () => {
      vi.mocked(productActions.toggleProductStatusAction).mockResolvedValue({
        success: false,
        error: { code: "SERVER_ERROR", message: "Database timeout" },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Database timeout");
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();
      });
    });

    it("rolls back optimistic status on unexpected thrown exception without leaking details", async () => {
      vi.mocked(productActions.toggleProductStatusAction).mockRejectedValue(
        new Error("Fatal network crash: uncaught ECONNRESET at internal/net.ts:42")
      );

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("A network or server error occurred. Please try again.");
        expect(alert).not.toHaveTextContent("ECONNRESET");
        // Status rolled back to active (button is still "Set Inactive")
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();
      });
    });
  });

  describe("OCC Conflict Recovery — T052 (P0010)", () => {
    it("discards optimistic state, retrieves authoritative state, updates UI, and displays conflict modal", async () => {
      const onStatusChange = vi.fn();

      // Mutation fails with P0010 (OCC conflict)
      vi.mocked(productActions.toggleProductStatusAction).mockResolvedValue({
        success: false,
        error: { code: "CONCURRENCY_CONFLICT", message: "Stale version" },
      });

      // Authoritative state fetch returns updated state from database
      vi.mocked(productActions.getProductStateAction).mockResolvedValue({
        success: true,
        data: {
          id: mockProductId,
          status: "inactive",
          version: 3,
          archived_at: null,
        },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
          onStatusChange={onStatusChange}
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        // Authoritative state must be fetched
        expect(productActions.getProductStateAction).toHaveBeenCalledWith(mockSlug, mockProductId);
      });

      await waitFor(() => {
        // Parent must be informed of the fresh authoritative database state
        expect(onStatusChange).toHaveBeenCalledWith("inactive", 3);
        // Router refresh must be triggered
        expect(mockRouter.refresh).toHaveBeenCalled();
        // Concurrency conflict modal must be displayed
        expect(screen.getByText("Stale Update Conflict")).toBeInTheDocument();
        expect(screen.getByText(/Error Code: P0010/i)).toBeInTheDocument();
        expect(screen.getByText("v1")).toBeInTheDocument(); // loaded version
        expect(screen.getByText("v3")).toBeInTheDocument(); // latest version
      });

      // Crucial: No automatic retry must occur
      expect(productActions.toggleProductStatusAction).toHaveBeenCalledTimes(1);
    });

    it("restores previous authoritative status and displays safe recovery message without inventing a version when getProductStateAction fails (rejected promise)", async () => {
      const onStatusChange = vi.fn();

      // Mutation fails with P0010 (OCC conflict)
      vi.mocked(productActions.toggleProductStatusAction).mockResolvedValue({
        success: false,
        error: { code: "P0010", message: "Stale version" },
      });

      // Retrieval throws/rejects (e.g. network failure)
      vi.mocked(productActions.getProductStateAction).mockRejectedValue(
        new Error("Network connection lost during state fetch")
      );

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
          onStatusChange={onStatusChange}
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(productActions.getProductStateAction).toHaveBeenCalledWith(mockSlug, mockProductId);
      });

      await waitFor(() => {
        // 1. Optimistic status ('inactive') discarded, previous authoritative status ('active') restored
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();

        // 2. Safe recovery message is displayed in alert
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(
          "This product was updated by another user, but its latest state could not be retrieved. Please refresh the page before attempting another mutation."
        );

        // 3. Neither failure path invents a latest version (conflict modal not shown, no 'v2' displayed)
        expect(screen.queryByText("Stale Update Conflict")).not.toBeInTheDocument();
        expect(screen.queryByText("v2")).not.toBeInTheDocument();

        // 4. Pending state is cleared
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeEnabled();
      });

      // 5. No automatic retry occurred
      expect(productActions.toggleProductStatusAction).toHaveBeenCalledTimes(1);

      // 6. Subsequent user action cannot silently use a fabricated version (must use authoritative version 1)
      const currentToggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(currentToggleBtn);

      await waitFor(() => {
        expect(productActions.toggleProductStatusAction).toHaveBeenCalledTimes(2);
      });

      // Must have used authoritative version 1, NEVER fabricated version 2
      expect(productActions.toggleProductStatusAction).toHaveBeenLastCalledWith(
        mockSlug,
        mockProductId,
        1,
        "inactive"
      );
      expect(productActions.toggleProductStatusAction).not.toHaveBeenLastCalledWith(
        mockSlug,
        mockProductId,
        2,
        expect.anything()
      );
    });

    it("does not leave optimistic status visible and avoids inventing version when getProductStateAction returns unsuccessful response", async () => {
      // Mutation fails with CONCURRENCY_CONFLICT
      vi.mocked(productActions.toggleProductStatusAction).mockResolvedValue({
        success: false,
        error: { code: "CONCURRENCY_CONFLICT", message: "Stale version" },
      });

      // Retrieval returns unsuccessful action result
      vi.mocked(productActions.getProductStateAction).mockResolvedValue({
        success: false,
        error: { code: "RESOURCE_NOT_FOUND", message: "Product missing" },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={2}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const toggleBtn = screen.getByRole("button", { name: /set inactive/i });
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(productActions.getProductStateAction).toHaveBeenCalledWith(mockSlug, mockProductId);
      });

      await waitFor(() => {
        // Optimistic state discarded, previous authoritative status restored
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeInTheDocument();

        // Safe recovery message displayed
        expect(screen.getByRole("alert")).toHaveTextContent(
          "This product was updated by another user, but its latest state could not be retrieved. Please refresh the page before attempting another mutation."
        );

        // Modal NOT displayed with invented version v3
        expect(screen.queryByText("Stale Update Conflict")).not.toBeInTheDocument();
        expect(screen.queryByText("v3")).not.toBeInTheDocument();

        // Pending state cleared
        expect(screen.getByRole("button", { name: /set inactive/i })).toBeEnabled();
      });

      // Subsequent user action cannot silently use fabricated version 3 (must use 2)
      fireEvent.click(screen.getByRole("button", { name: /set inactive/i }));
      await waitFor(() => {
        expect(productActions.toggleProductStatusAction).toHaveBeenCalledTimes(2);
      });
      expect(productActions.toggleProductStatusAction).toHaveBeenLastCalledWith(
        mockSlug,
        mockProductId,
        2,
        "inactive"
      );
      expect(productActions.toggleProductStatusAction).not.toHaveBeenLastCalledWith(
        mockSlug,
        mockProductId,
        3,
        expect.anything()
      );
    });

    it("handles archive OCC conflict failure: restores previous status from optimistic 'archived', closes archive modal, and does not invent version", async () => {
      // Archive fails with OCC conflict P0010
      vi.mocked(productActions.archiveProductAction).mockResolvedValue({
        success: false,
        error: { code: "P0010", message: "Concurrent modification" },
      });

      // Retrieval fails
      vi.mocked(productActions.getProductStateAction).mockRejectedValue(
        new Error("Timeout querying product state")
      );

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      // Open archive modal and confirm
      fireEvent.click(screen.getByRole("button", { name: /archive/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^archive product$/i }));

      await waitFor(() => {
        expect(productActions.archiveProductAction).toHaveBeenCalledWith(mockSlug, mockProductId, 1);
        expect(productActions.getProductStateAction).toHaveBeenCalledWith(mockSlug, mockProductId);
      });

      await waitFor(() => {
        // Archive modal must be closed
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        // Optimistic status 'archived' discarded; product remains/restores to 'active'
        expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /restore/i })).not.toBeInTheDocument();

        // Safe recovery message displayed
        expect(screen.getByRole("alert")).toHaveTextContent(
          "This product was updated by another user, but its latest state could not be retrieved. Please refresh the page before attempting another mutation."
        );

        // No fabricated version modal
        expect(screen.queryByText("Stale Update Conflict")).not.toBeInTheDocument();
        expect(screen.queryByText("v2")).not.toBeInTheDocument();
      });

      // No automatic retry occurred
      expect(productActions.archiveProductAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Archive Product Confirmation Dialog (FR-019, FR-021)", () => {
    it("opens accessible archive dialog explaining permanent SKU reservation", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const archiveBtn = screen.getByRole("button", { name: /archive/i });
      fireEvent.click(archiveBtn);

      // Verify dialog accessibility attributes
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "archive-dialog-title");
      expect(dialog).toHaveAttribute("aria-describedby", "archive-dialog-description");

      // Verify content & permanent reservation explanation
      expect(screen.getByText("Permanent Identifier Reservation")).toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(mockSku)).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/cannot be reused/i)).toBeInTheDocument();
    });

    it("cancels archive dialog on Cancel click without calling server action", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /archive/i }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(productActions.archiveProductAction).not.toHaveBeenCalled();
    });

    it("dismisses archive dialog on Escape key and restores focus", async () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const archiveBtn = screen.getByRole("button", { name: /archive/i });
      fireEvent.click(archiveBtn);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      // Press Escape key
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(productActions.archiveProductAction).not.toHaveBeenCalled();
    });

    it("confirms archival, calls action, and updates state to archived", async () => {
      const onStatusChange = vi.fn();
      vi.mocked(productActions.archiveProductAction).mockResolvedValue({
        success: true,
        data: {
          id: mockProductId,
          status: "archived",
          version: 2,
          archived_at: "2026-11-09T12:00:00Z",
        },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="detail"
          onStatusChange={onStatusChange}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /archive/i }));

      // Click confirmation button inside dialog
      const confirmBtn = screen.getByRole("button", { name: /^archive product$/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(productActions.archiveProductAction).toHaveBeenCalledWith(
          mockSlug,
          mockProductId,
          1
        );
      });

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith("archived", 2);
        expect(mockRouter.refresh).toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        // Restore button should now be visible for the archived product
        expect(screen.getByRole("button", { name: /restore product/i })).toBeInTheDocument();
      });
    });
  });

  describe("Restore Product Confirmation Dialog (FR-020)", () => {
    it("renders Restore button for archived product and restores on confirmation", async () => {
      const onStatusChange = vi.fn();
      vi.mocked(productActions.restoreProductAction).mockResolvedValue({
        success: true,
        data: {
          id: mockProductId,
          status: "active",
          version: 3,
        },
      });

      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="archived"
          initialVersion={2}
          canUpdate={true}
          canArchive={true}
          variant="detail"
          onStatusChange={onStatusChange}
        />
      );

      const restoreBtn = screen.getByRole("button", { name: /restore product/i });
      fireEvent.click(restoreBtn);

      // Verify restore dialog opened
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-labelledby", "restore-dialog-title");

      // Confirm restore
      const confirmBtn = screen.getByRole("button", { name: /restore to active/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(productActions.restoreProductAction).toHaveBeenCalledWith(
          mockSlug,
          mockProductId,
          2
        );
      });

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith("active", 3);
        expect(mockRouter.refresh).toHaveBeenCalled();
      });
    });

    it("dismisses restore dialog on Escape key", async () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="archived"
          initialVersion={2}
          canUpdate={true}
          canArchive={true}
          variant="detail"
        />
      );

      const restoreBtn = screen.getByRole("button", { name: /restore product/i });
      fireEvent.click(restoreBtn);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(productActions.restoreProductAction).not.toHaveBeenCalled();
    });
  });

  describe("Table Variant (T052)", () => {
    it("renders compact switch and archive icon in table mode", () => {
      render(
        <ProductLifecycleActions
          slug={mockSlug}
          productId={mockProductId}
          productName={mockProductName}
          sku={mockSku}
          initialStatus="active"
          initialVersion={1}
          canUpdate={true}
          canArchive={true}
          variant="table"
        />
      );

      expect(screen.getByRole("switch", { name: new RegExp(`toggle ${mockProductName} status`, "i") })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: new RegExp(`archive ${mockProductName}`, "i") })).toBeInTheDocument();
    });
  });
});
