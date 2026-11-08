import React from "react";

/**
 * Product Catalog Loading Skeleton (T026, FR-026)
 *
 * Renders layout skeletons with pulse animation while the Server Component resolves
 * tenant authorization and fetches catalog products.
 */
export default function ProductsLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading products">
      {/* Page Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div className="space-y-2">
          <div className="h-8 w-40 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-72 bg-gray-100 dark:bg-gray-800/60 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-28 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-9 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg" />
        </div>
      </div>

      {/* Filter Bar Skeleton */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="h-10 w-full sm:w-96 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-10 w-full sm:w-64 bg-gray-200 dark:bg-gray-800 rounded-lg" />
        </div>

        {/* Tabs Skeleton */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 gap-6 pb-3">
          <div className="h-5 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
          <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800/60 rounded" />
          <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800/60 rounded" />
          <div className="h-5 w-16 bg-gray-100 dark:bg-gray-800/60 rounded" />
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <div className="h-12 bg-gray-50 dark:bg-gray-950/70 border-b border-gray-200 dark:border-gray-800" />
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="space-y-1.5">
                  <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
                  <div className="h-3 w-24 bg-gray-100 dark:bg-gray-800/60 rounded" />
                </div>
              </div>
              <div className="h-4 w-20 bg-gray-100 dark:bg-gray-800/60 rounded" />
              <div className="h-4 w-24 bg-gray-100 dark:bg-gray-800/60 rounded" />
              <div className="h-6 w-16 bg-gray-200 dark:bg-gray-800 rounded-full" />
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

