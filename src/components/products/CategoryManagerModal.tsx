"use client";

import React from "react";
import { X, FolderTree } from "lucide-react";
import { CategoryManager, type CategoryItem } from "./CategoryManager";
import type { CategoryResponse } from "@/actions/category-actions";

export type CategoryModalItem = CategoryItem;

export interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  slug: string;
  categories: CategoryModalItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  onCategoryCreated?: (category: CategoryResponse) => void;
  onCategoryUpdated?: (category: CategoryResponse) => void;
  onCategoryArchived?: (id: string) => void;
  onCategoryRestored?: (id: string) => void;
}

/**
 * CategoryManagerModal (T047, FR-030 to FR-037)
 *
 * Full-featured category management modal composing the unified `CategoryManager`.
 * Mounted on the Product Catalog page (`/products`) for quick category management.
 *
 * Features:
 * - Active & Archived tabs with badge counters
 * - Active product count badges per category
 * - Inline create form with trimming and validation
 * - Inline edit mode for updating name/description
 * - Archive confirmation dialog explaining product preservation guarantee (FR-035)
 * - Restore capability returning category to active state
 * - Full RBAC enforcement (`canCreate`, `canUpdate`, `canArchive`)
 */
export function CategoryManagerModal({
  isOpen,
  onClose,
  slug,
  categories,
  canCreate,
  canUpdate,
  canArchive,
  onCategoryCreated,
  onCategoryUpdated,
  onCategoryArchived,
  onCategoryRestored,
}: CategoryManagerModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-800 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
              <FolderTree className="h-5 w-5" />
            </div>
            <div>
              <h2 id="category-manager-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Category Management
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Organize retail catalog with flat product categories
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close category manager"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body composing CategoryManager */}
        <div className="overflow-y-auto flex-1">
          <CategoryManager
            slug={slug}
            categories={categories}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canArchive={canArchive}
            variant="modal"
            onCategoryCreated={onCategoryCreated}
            onCategoryUpdated={onCategoryUpdated}
            onCategoryArchived={onCategoryArchived}
            onCategoryRestored={onCategoryRestored}
          />
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/40 rounded-b-xl text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <span>Categories are strictly flat with case-insensitive unique names.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
