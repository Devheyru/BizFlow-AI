"use client";

import React, { useState } from "react";
import { FolderTree } from "lucide-react";
import { CategoryManagerModal, type CategoryModalItem } from "./CategoryManagerModal";

export interface CategoryModalTriggerProps {
  slug: string;
  categories: CategoryModalItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
}

/**
 * CategoryModalTrigger
 *
 * Client trigger button that mounts and opens `CategoryManagerModal` directly from
 * the Product Catalog page (`/[slug]/products`), giving store managers instant quick-access
 * category management without navigating away from their product inventory table.
 */
export function CategoryModalTrigger({
  slug,
  categories,
  canCreate,
  canUpdate,
  canArchive,
}: CategoryModalTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
        aria-label="Quick manage categories"
      >
        <FolderTree className="h-4 w-4" aria-hidden="true" />
        <span>Quick Categories</span>
      </button>

      <CategoryManagerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        slug={slug}
        categories={categories}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canArchive={canArchive}
      />
    </>
  );
}

