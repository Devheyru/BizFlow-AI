"use client";

import React, { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  RotateCcw,
  AlertTriangle,
  X,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConcurrencyConflictModal } from "./ConcurrencyConflictModal";
import {
  toggleProductStatusAction,
  archiveProductAction,
  restoreProductAction,
  getProductStateAction,
} from "@/actions/product-actions";
import type { ProductStatus } from "@/types/product";

export interface ProductLifecycleActionsProps {
  slug: string;
  productId: string;
  productName: string;
  sku?: string;
  initialStatus: ProductStatus;
  initialVersion: number;
  canUpdate?: boolean;
  canArchive?: boolean;
  variant?: "table" | "detail";
  showStatusBadge?: boolean;
  onStatusChange?: (newStatus: ProductStatus, newVersion: number) => void;
}

/**
 * ProductLifecycleActions (T051, T052, FR-018, FR-019, FR-020, FR-021, FR-023)
 *
 * Implements accessible, resilient lifecycle action controls for products:
 * - Active <-> Inactive toggle with pending state and OCC version checking (gated by products:update)
 * - Accessible archive confirmation dialog explaining permanent SKU/barcode reservations (gated by products:archive)
 * - Accessible restore confirmation dialog returning archived product to active (gated by products:archive)
 * - Complete OCC conflict recovery (P0010): discards optimistic state, fetches authoritative database state,
 *   updates version and status in UI, informs parent, triggers router refresh, and displays ConcurrencyConflictModal
 * - Resilient failure and rollback: catches rejected promises, network failures, and structured errors without
 *   displaying false success or leaking raw server exceptions
 * - Full accessibility: focus trapping, Escape key dismissal, focus restoration to invoking trigger
 */
export function ProductLifecycleActions({
  slug,
  productId,
  productName,
  sku,
  initialStatus,
  initialVersion,
  canUpdate = false,
  canArchive = false,
  variant = "detail",
  showStatusBadge = false,
  onStatusChange,
}: ProductLifecycleActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ProductStatus>(initialStatus);
  const [version, setVersion] = useState<number>(initialVersion);
  const [isPending, startTransition] = useTransition();

  // Authoritative tracking ref to ensure optimistic status updates can always roll back cleanly
  const lastAuthoritativeStatusRef = useRef<ProductStatus>(initialStatus);

  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictStaleVersion, setConflictStaleVersion] = useState<number>(initialVersion);
  const [conflictLatestVersion, setConflictLatestVersion] = useState<number | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  // Focus management refs for accessibility (WAI-ARIA Dialog)
  const archiveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const archiveCancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreCancelRef = useRef<HTMLButtonElement | null>(null);
  const archiveDialogRef = useRef<HTMLDivElement | null>(null);
  const restoreDialogRef = useRef<HTMLDivElement | null>(null);

  // Synchronize when initialStatus or initialVersion updates externally (e.g. after router.refresh)
  useEffect(() => {
    setStatus(initialStatus);
    setVersion(initialVersion);
    lastAuthoritativeStatusRef.current = initialStatus;
  }, [initialStatus, initialVersion]);

  // Manage initial focus when archive modal opens
  useEffect(() => {
    if (showArchiveModal) {
      archiveCancelRef.current?.focus();
    }
  }, [showArchiveModal]);

  // Manage initial focus when restore modal opens
  useEffect(() => {
    if (showRestoreModal) {
      restoreCancelRef.current?.focus();
    }
  }, [showRestoreModal]);

  // Safe recovery message when record changed but latest state could not be fetched
  const CONFLICT_FETCH_FAILED_MESSAGE =
    "This product was updated by another user, but its latest state could not be retrieved. Please refresh the page before attempting another mutation.";

  // Handle OCC Conflict Recovery (P0010 / CONCURRENCY_CONFLICT)
  const handleConflictRecovery = useCallback(
    async (
      staleExpectedVersion: number,
      authoritativePreviousStatus: ProductStatus,
      authoritativePreviousVersion: number
    ) => {
      // 1 & 2. Immediately discard optimistic state and restore last known authoritative status and version
      setStatus(authoritativePreviousStatus);
      setVersion(authoritativePreviousVersion);
      lastAuthoritativeStatusRef.current = authoritativePreviousStatus;
      setConflictStaleVersion(staleExpectedVersion);
      setConflictLatestVersion(undefined);

      try {
        // 3. Invoke getProductStateAction to retrieve current product state
        const fresh = await getProductStateAction(slug, productId);

        if (fresh && fresh.success && fresh.data) {
          // 4. If retrieval succeeds:
          // - Update local status from returned database status
          // - Update local version from returned database version
          // - Propagate authoritative state to parent through onStatusChange
          // - Refresh App Router server state
          // - Display concurrency conflict dialog with actual stale and latest versions
          setStatus(fresh.data.status);
          setVersion(fresh.data.version);
          lastAuthoritativeStatusRef.current = fresh.data.status;
          setConflictLatestVersion(fresh.data.version);
          onStatusChange?.(fresh.data.status, fresh.data.version);
          router.refresh();
          setShowConflictModal(true);
        } else {
          // 5. If retrieval fails or returns an unsuccessful result:
          // - Keep last known authoritative status and version
          // - Do not use staleExpectedVersion + 1 or any other guessed version
          // - Do not leave optimistic state visible
          // - Display safe recovery message
          // - Ensure UI cannot accidentally submit another mutation using a fabricated version
          setStatus(authoritativePreviousStatus);
          setVersion(authoritativePreviousVersion);
          lastAuthoritativeStatusRef.current = authoritativePreviousStatus;
          setConflictLatestVersion(undefined);
          setShowConflictModal(false);
          setActionError(CONFLICT_FETCH_FAILED_MESSAGE);
        }
      } catch {
        // Retrieval threw network or server error
        setStatus(authoritativePreviousStatus);
        setVersion(authoritativePreviousVersion);
        lastAuthoritativeStatusRef.current = authoritativePreviousStatus;
        setConflictLatestVersion(undefined);
        setShowConflictModal(false);
        setActionError(CONFLICT_FETCH_FAILED_MESSAGE);
      }
    },
    [slug, productId, onStatusChange, router]
  );

  // Close modals and restore focus to invoking trigger
  const closeArchiveModal = useCallback(() => {
    if (isPending) return;
    setShowArchiveModal(false);
    setTimeout(() => {
      archiveTriggerRef.current?.focus();
    }, 50);
  }, [isPending]);

  const closeRestoreModal = useCallback(() => {
    if (isPending) return;
    setShowRestoreModal(false);
    setTimeout(() => {
      restoreTriggerRef.current?.focus();
    }, 50);
  }, [isPending]);

  // Keyboard navigation & focus trapping for modals (Escape to close, Tab trapping)
  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, isArchive: boolean) => {
      if (e.key === "Escape" && !isPending) {
        e.preventDefault();
        if (isArchive) {
          closeArchiveModal();
        } else {
          closeRestoreModal();
        }
        return;
      }

      // Tab key focus trap
      if (e.key === "Tab") {
        const dialogEl = isArchive ? archiveDialogRef.current : restoreDialogRef.current;
        if (!dialogEl) return;

        const focusable = dialogEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (first && last) {
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [isPending, closeArchiveModal, closeRestoreModal]
  );

  // Handle active <-> inactive toggle (requires products:update)
  const handleToggleStatus = () => {
    if (!canUpdate || isPending || status === "archived") return;

    setActionError(null);
    const authoritativePreviousStatus = lastAuthoritativeStatusRef.current;
    const authoritativePreviousVersion = version;
    const targetStatus: "active" | "inactive" =
      authoritativePreviousStatus === "active" ? "inactive" : "active";

    // Optimistic status update
    setStatus(targetStatus);

    startTransition(async () => {
      try {
        const result = await toggleProductStatusAction(
          slug,
          productId,
          authoritativePreviousVersion,
          targetStatus
        );

        if (result.success) {
          setStatus(result.data.status);
          setVersion(result.data.version);
          lastAuthoritativeStatusRef.current = result.data.status;
          onStatusChange?.(result.data.status, result.data.version);
          router.refresh();
        } else {
          const errorCode = result.error.code;
          const errorMessage = result.error.message;

          if (errorCode === "CONCURRENCY_CONFLICT" || errorCode === "P0010") {
            // Immediately discard optimistic state and restore last known authoritative status
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            await handleConflictRecovery(
              authoritativePreviousVersion,
              authoritativePreviousStatus,
              authoritativePreviousVersion
            );
          } else {
            // Rollback optimistic update
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            setActionError(errorMessage || "Failed to update product status. Please try again.");
          }
        }
      } catch {
        // Unexpected exception / network failure
        setStatus(authoritativePreviousStatus);
        setVersion(authoritativePreviousVersion);
        setActionError("A network or server error occurred. Please try again.");
      }
    });
  };

  // Handle archiving product (requires products:archive)
  const handleConfirmArchive = () => {
    if (!canArchive || isPending || status === "archived") return;

    setActionError(null);
    const authoritativePreviousStatus = lastAuthoritativeStatusRef.current;
    const authoritativePreviousVersion = version;

    // Optimistic status update
    setStatus("archived");

    startTransition(async () => {
      try {
        const result = await archiveProductAction(slug, productId, authoritativePreviousVersion);

        if (result.success) {
          setStatus("archived");
          setVersion(result.data.version);
          lastAuthoritativeStatusRef.current = "archived";
          setShowArchiveModal(false);
          onStatusChange?.("archived", result.data.version);
          router.refresh();
        } else {
          const errorCode = result.error.code;
          const errorMessage = result.error.message;
          setShowArchiveModal(false);

          if (errorCode === "CONCURRENCY_CONFLICT" || errorCode === "P0010") {
            // Immediately discard optimistic state and restore last known authoritative status
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            await handleConflictRecovery(
              authoritativePreviousVersion,
              authoritativePreviousStatus,
              authoritativePreviousVersion
            );
          } else {
            // Rollback optimistic update
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            setActionError(errorMessage || "Failed to archive product. Please try again.");
          }
        }
      } catch {
        // Unexpected exception / network failure
        setShowArchiveModal(false);
        setStatus(authoritativePreviousStatus);
        setVersion(authoritativePreviousVersion);
        setActionError("A network or server error occurred. Please try again.");
      }
    });
  };

  // Handle restoring product (requires products:archive)
  const handleConfirmRestore = () => {
    if (!canArchive || isPending || status !== "archived") return;

    setActionError(null);
    const authoritativePreviousStatus = lastAuthoritativeStatusRef.current;
    const authoritativePreviousVersion = version;

    // Optimistic status update
    setStatus("active");

    startTransition(async () => {
      try {
        const result = await restoreProductAction(slug, productId, authoritativePreviousVersion);

        if (result.success) {
          setStatus("active");
          setVersion(result.data.version);
          lastAuthoritativeStatusRef.current = "active";
          setShowRestoreModal(false);
          onStatusChange?.("active", result.data.version);
          router.refresh();
        } else {
          const errorCode = result.error.code;
          const errorMessage = result.error.message;
          setShowRestoreModal(false);

          if (errorCode === "CONCURRENCY_CONFLICT" || errorCode === "P0010") {
            // Immediately discard optimistic state and restore last known authoritative status
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            await handleConflictRecovery(
              authoritativePreviousVersion,
              authoritativePreviousStatus,
              authoritativePreviousVersion
            );
          } else {
            // Rollback optimistic update
            setStatus(authoritativePreviousStatus);
            setVersion(authoritativePreviousVersion);
            setActionError(errorMessage || "Failed to restore product. Please try again.");
          }
        }
      } catch {
        // Unexpected exception / network failure
        setShowRestoreModal(false);
        setStatus(authoritativePreviousStatus);
        setVersion(authoritativePreviousVersion);
        setActionError("A network or server error occurred. Please try again.");
      }
    });
  };

  // Render status badge helper
  const renderBadge = () => {
    const badgeColors = {
      active:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
      inactive:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
      archived:
        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
    };

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${badgeColors[status]}`}
      >
        {status}
      </span>
    );
  };

  return (
    <>
      {/* Inline error feedback if action failed */}
      {actionError && (
        <div
          role="alert"
          className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5 p-1.5 bg-red-50 dark:bg-red-950/50 rounded border border-red-200 dark:border-red-900 mb-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-300 p-0.5"
            aria-label="Dismiss error"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Variant: Table Row Actions */}
      {variant === "table" ? (
        <div className="inline-flex items-center gap-2">
          {showStatusBadge && renderBadge()}

          {status !== "archived" ? (
            <>
              {/* Toggle switch for active/inactive */}
              {canUpdate && (
                <div className="flex items-center gap-1.5" title={`Toggle status (currently ${status})`}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={status === "active"}
                    aria-label={`Toggle ${productName} status`}
                    disabled={isPending}
                    onClick={handleToggleStatus}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                      status === "active"
                        ? "bg-emerald-600"
                        : "bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        status === "active" ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                  {isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                  )}
                </div>
              )}

              {/* Archive button */}
              {canArchive && (
                <button
                  ref={archiveTriggerRef}
                  type="button"
                  onClick={() => setShowArchiveModal(true)}
                  disabled={isPending}
                  aria-label={`Archive ${productName}`}
                  title="Archive product"
                  className="p-1 rounded text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  <Archive className="h-4 w-4" />
                </button>
              )}
            </>
          ) : (
            /* Archived Product Table Actions */
            canArchive && (
              <Button
                ref={restoreTriggerRef}
                variant="outline"
                size="sm"
                onClick={() => setShowRestoreModal(true)}
                disabled={isPending}
                aria-label={`Restore ${productName}`}
                className="h-7 px-2 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1" />
                )}
                Restore
              </Button>
            )
          )}
        </div>
      ) : (
        /* Variant: Detail View Header Actions */
        <div className="flex flex-wrap items-center gap-3">
          {status !== "archived" ? (
            <>
              {/* Toggle Active/Inactive Button */}
              {canUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleStatus}
                  disabled={isPending}
                  className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                    status === "active"
                      ? "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      : "text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
                  }`}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "active" ? (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <RotateCcw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span>
                    {status === "active" ? "Set Inactive" : "Set Active"}
                  </span>
                </Button>
              )}

              {/* Archive Product Button */}
              {canArchive && (
                <Button
                  ref={archiveTriggerRef}
                  variant="outline"
                  size="sm"
                  onClick={() => setShowArchiveModal(true)}
                  disabled={isPending}
                  className="flex items-center gap-2 text-sm font-medium text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/50 transition-colors"
                >
                  <Archive className="h-4 w-4" />
                  <span>Archive</span>
                </Button>
              )}
            </>
          ) : (
            /* Archived State: Restore Button */
            canArchive && (
              <Button
                ref={restoreTriggerRef}
                variant="outline"
                size="sm"
                onClick={() => setShowRestoreModal(true)}
                disabled={isPending}
                className="flex items-center gap-2 text-sm font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50 transition-colors"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                <span>Restore Product</span>
              </Button>
            )
          )}
        </div>
      )}

      {/* Accessible Archive Confirmation Dialog (T051, FR-019, FR-021) */}
      {showArchiveModal && (
        <div
          ref={archiveDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-dialog-title"
          aria-describedby="archive-dialog-description"
          onKeyDown={(e) => handleDialogKeyDown(e, true)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-lg p-6 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-4">
            <button
              type="button"
              onClick={closeArchiveModal}
              disabled={isPending}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md transition-colors disabled:opacity-50"
              aria-label="Close archive dialog"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-100 dark:bg-amber-950/60 rounded-full text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3
                  id="archive-dialog-title"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Archive Product
                </h3>
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  {productName} {sku ? `(SKU: ${sku})` : ""}
                </p>
              </div>
            </div>

            {/* Description & Identifier Reservation Warning */}
            <div
              id="archive-dialog-description"
              className="text-sm text-zinc-600 dark:text-zinc-300 space-y-3"
            >
              <p>
                Are you sure you want to archive this product? It will be hidden from
                active catalog listings, inventory lookups, and retail operations.
              </p>

              {/* Permanent Reservation Notice (FR-021) */}
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
                <p className="font-semibold flex items-center gap-1.5">
                  <Archive className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>Permanent Identifier Reservation</span>
                </p>
                <p>
                  Archiving permanently retains the SKU {sku ? `("${sku}")` : ""} and barcode
                  reservations for this product. These identifiers <strong>cannot be reused</strong>{" "}
                  by any new or existing product within this organization to preserve historical transaction
                  and audit integrity.
                </p>
              </div>

              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                You can restore this product at any time in the future from the archived catalog view.
              </p>
            </div>

            {/* Dialog Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                ref={archiveCancelRef}
                type="button"
                variant="outline"
                onClick={closeArchiveModal}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmArchive}
                disabled={isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                <span>Archive Product</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Accessible Restore Confirmation Dialog (T051, FR-020) */}
      {showRestoreModal && (
        <div
          ref={restoreDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-dialog-title"
          aria-describedby="restore-dialog-description"
          onKeyDown={(e) => handleDialogKeyDown(e, false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-lg p-6 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 space-y-4">
            <button
              type="button"
              onClick={closeRestoreModal}
              disabled={isPending}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md transition-colors disabled:opacity-50"
              aria-label="Close restore dialog"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-950/60 rounded-full text-emerald-600 dark:text-emerald-400 shrink-0">
                <RotateCcw className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3
                  id="restore-dialog-title"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
                >
                  Restore Product
                </h3>
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  {productName} {sku ? `(SKU: ${sku})` : ""}
                </p>
              </div>
            </div>

            {/* Description */}
            <div
              id="restore-dialog-description"
              className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2"
            >
              <p>
                Are you sure you want to restore this product? It will return to{" "}
                <strong className="text-emerald-600 dark:text-emerald-400">active</strong> status
                and be immediately available in active catalog listings and retail sales.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Archival timestamps will be cleared and an audit event will record the restoration.
              </p>
            </div>

            {/* Dialog Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                ref={restoreCancelRef}
                type="button"
                variant="outline"
                onClick={closeRestoreModal}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                <span>Restore to Active</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Concurrency Conflict Modal (T038, T051, T052, FR-023, P0010) */}
      <ConcurrencyConflictModal
        isOpen={showConflictModal}
        onClose={() => {
          setShowConflictModal(false);
          router.refresh();
        }}
        onRefresh={() => {
          setShowConflictModal(false);
          router.refresh();
        }}
        expectedVersion={conflictStaleVersion}
        currentVersion={conflictLatestVersion}
      />
    </>
  );
}
