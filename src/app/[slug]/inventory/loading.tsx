import React from "react";

/**
 * Inventory Overview Loading Skeleton (T019, FR-INV-001, US1).
 *
 * Renders layout skeletons with pulse animation while the Server Component resolves
 * tenant authorization, permissions, overview metrics, and paginated inventory data.
 */
export default function InventoryLoading() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading inventory overview"
      data-testid="inventory-loading-skeleton"
    >
      {/* 1. Page Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-80 bg-gray-100 dark:bg-gray-800/60 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-9 w-32 bg-gray-200 dark:bg-gray-800 rounded-lg" />
        </div>
      </div>

      {/* 2. Metrics Tiles Skeleton (5 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-8 w-8 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
            <div className="h-7 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
            <div className="h-3 w-16 bg-gray-100 dark:bg-gray-800/60 rounded" />
          </div>
        ))}
      </div>

      {/* 3. Filter Bar Skeleton */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="h-10 w-full lg:w-96 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="flex flex-wrap gap-2.5 items-center">
            <div className="h-9 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-9 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-9 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-9 w-28 bg-gray-100 dark:bg-gray-800/60 rounded-lg" />
          </div>
        </div>
      </div>

      {/* 4. Table Skeleton */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <div className="h-12 bg-gray-50 dark:bg-gray-950/70 border-b border-gray-200 dark:border-gray-800" />
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-6 py-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="space-y-1.5">
                  <div className="h-4 w-44 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-24 bg-gray-100 dark:bg-gray-800/60 rounded" />
                </div>
              </div>
              <div className="h-4 w-20 bg-gray-100 dark:bg-gray-800/60 rounded" />
              <div className="h-6 w-20 bg-gray-200 dark:bg-gray-800 rounded-full" />
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-4 w-16 bg-gray-100 dark:bg-gray-800/60 rounded" />
              <div className="h-8 w-20 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

