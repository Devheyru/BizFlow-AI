"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConcurrencyConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  currentVersion?: number;
  expectedVersion?: number;
}

/**
 * ConcurrencyConflictModal (T038, FR-023, BR-016)
 * Displayed when an update fails with P0010 (CONCURRENCY_CONFLICT).
 * Informs the user that another user modified the product, protects against
 * silent data loss, and prompts the user to refresh to view current state.
 */
export function ConcurrencyConflictModal({
  isOpen,
  onClose,
  onRefresh,
  currentVersion,
  expectedVersion,
}: ConcurrencyConflictModalProps) {
  if (!isOpen) return null;

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="concurrency-modal-title"
      aria-describedby="concurrency-modal-description"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md p-6 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-amber-200 dark:border-amber-900/50 space-y-4">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md transition-colors"
          aria-label="Close concurrency conflict alert"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Warning Icon & Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-100 dark:bg-amber-950/60 rounded-full text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3
              id="concurrency-modal-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Stale Update Conflict
            </h3>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Error Code: P0010 (CONCURRENCY_CONFLICT)
            </p>
          </div>
        </div>

        {/* Description */}
        <div id="concurrency-modal-description" className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2">
          <p>
            This product was modified by another user or session while you were editing it.
            To prevent silently overwriting their changes, your update was rejected.
          </p>
          {(expectedVersion !== undefined || currentVersion !== undefined) && (
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg text-xs space-y-1 border border-zinc-200 dark:border-zinc-700">
              {expectedVersion !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Your loaded version:</span>
                  <span className="font-mono font-medium text-zinc-700 dark:text-zinc-200">v{expectedVersion}</span>
                </div>
              )}
              {currentVersion !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Latest catalog version:</span>
                  <span className="font-mono font-medium text-amber-600 dark:text-amber-400">v{currentVersion}</span>
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Please reload the latest product data. Your typed modifications remain visible in the form so you can review or copy them before reloading.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="text-sm"
          >
            Review Changes
          </Button>
          <Button
            type="button"
            onClick={handleRefresh}
            className="bg-amber-600 hover:bg-amber-700 text-white text-sm flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Reload Latest Data
          </Button>
        </div>
      </div>
    </div>
  );
}

