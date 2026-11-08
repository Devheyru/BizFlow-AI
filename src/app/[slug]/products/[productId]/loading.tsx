import React from "react";

/**
 * Product Detail Loading Skeleton (T042, FR-026)
 *
 * Renders layout skeletons with pulse animation while the Server Component resolves
 * product details, signed images, and confidential financial metrics.
 */
export default function ProductDetailLoading() {
  return (
    <div
      className="space-y-6 max-w-6xl mx-auto pb-12 animate-pulse"
      aria-busy="true"
      aria-label="Loading product details"
    >
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div className="space-y-2">
          <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
          <div className="flex items-center gap-3">
            <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
            <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
          </div>
        </div>
        <div className="h-10 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
      </div>

      {/* Main Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Image & Identifiers */}
        <div className="space-y-6 lg:col-span-1">
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
            <div className="aspect-square w-full rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm space-y-4">
            <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex justify-between items-center py-2">
                  <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
                  <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Pricing, Description & Metadata */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pricing Panel Skeleton */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-6">
            <div className="h-5 w-40 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-24 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl" />
              <div className="h-24 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl" />
            </div>
            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-10 bg-zinc-100 dark:bg-zinc-800/60 rounded" />
              <div className="h-10 bg-zinc-100 dark:bg-zinc-800/60 rounded" />
            </div>
          </div>

          {/* Description Skeleton */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-3">
            <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="space-y-2">
              <div className="h-3.5 w-full bg-zinc-100 dark:bg-zinc-800/60 rounded" />
              <div className="h-3.5 w-5/6 bg-zinc-100 dark:bg-zinc-800/60 rounded" />
            </div>
          </div>

          {/* Metadata Skeleton */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
            <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="h-14 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg" />
              <div className="h-14 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg" />
              <div className="h-14 bg-zinc-100 dark:bg-zinc-800/60 rounded-lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Audit Timeline Skeleton */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm space-y-4">
        <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" />
        <div className="space-y-3 pt-2">
          <div className="h-12 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg" />
          <div className="h-12 bg-zinc-100 dark:bg-zinc-800/50 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

