"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CategoryManager, type CategoryItem } from "./CategoryManager";

export type CategoryPageItem = CategoryItem;

export interface CategoryPageClientProps {
  slug: string;
  organizationName: string;
  categories: CategoryPageItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  initialTab?: "active" | "archived";
}

/**
 * CategoryPageClient (T048, FR-030 to FR-037)
 *
 * Dedicated category management client view composing the unified `CategoryManager`.
 * Features:
 * - Breadcrumb navigation back to Products catalog
 * - Responsive page header with total category count badge
 * - Full active and archived category workflows
 * - Active product count links to filtered catalog view
 */
export function CategoryPageClient({
  slug,
  organizationName,
  categories,
  canCreate,
  canUpdate,
  canArchive,
  initialTab = "active",
}: CategoryPageClientProps) {
  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <Link
          href={`/${slug}/products`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Products</span>
        </Link>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Categories
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40">
              {categories.length} total
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage product categories for inventory categorization, reporting, and POS organization for {organizationName}.
          </p>
        </div>
      </div>

      {/* Composed Unified Category Management */}
      <CategoryManager
        slug={slug}
        categories={categories}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canArchive={canArchive}
        variant="page"
        initialTab={initialTab}
      />
    </div>
  );
}
