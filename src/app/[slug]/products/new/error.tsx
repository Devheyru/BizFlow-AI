"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react";

interface NewProductErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const FIXED_SAFE_ERROR_MESSAGE =
  "An unexpected error occurred while loading the product registration form. Please try again.";

/**
 * Route-level error boundary for product registration (Task 3).
 *
 * Provides a fail-safe user recovery experience:
 * - Unconditionally displays a fixed, safe user-facing message independent of error content
 * - Strictly prevents raw exception text, credentials, SQL fragments, or stack traces from reaching the DOM
 * - Avoids logging raw error messages or sensitive parameters to browser diagnostics
 * - Provides a one-click retry trigger calling Next.js `reset()`
 * - Provides immediate navigation back to the tenant product catalog
 */
export default function NewProductError({ error, reset }: NewProductErrorProps) {
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  useEffect(() => {
    // Non-sensitive client diagnostic logging; never exposes error.message, stack traces, or credentials
    if (error?.digest) {
      console.error("[NEW_PRODUCT_ROUTE_ERROR]", {
        digest: error.digest,
      });
    } else {
      console.error("[NEW_PRODUCT_ROUTE_ERROR]");
    }
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6 space-y-6">
      {/* Breadcrumb / Back Link */}
      <div>
        <Link
          href={`/${slug}/products`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Products Catalog
        </Link>
      </div>

      {/* Error Card */}
      <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 shrink-0">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Unable to load product registration
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              We encountered an issue preparing the product form or loading catalog categories.
            </p>
          </div>
        </div>

        {/* Fixed Safe Message */}
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-4 border border-zinc-200 dark:border-zinc-800">
          <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 break-words">
            {FIXED_SAFE_ERROR_MESSAGE}
          </p>
          {error?.digest && (
            <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500 mt-2">
              Error Digest: {error.digest}
            </p>
          )}
        </div>

        {/* Recovery Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </button>
          <Link
            href={`/${slug}/products`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Return to Products
          </Link>
        </div>
      </div>
    </div>
  );
}
