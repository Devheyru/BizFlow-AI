"use client";

import React, { useState, useTransition, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  Search,
  Package,
  AlertCircle,
  Loader2,
  FolderTree,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import {
  createCategoryAction,
  updateCategoryAction,
  archiveCategoryAction,
  restoreCategoryAction,
  type CategoryResponse,
} from "@/actions/category-actions";

export interface CategoryItem {
  id: string;
  organization_id?: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  productCount: number;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
}

export interface CategoryManagerProps {
  slug: string;
  categories: CategoryItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  variant?: "page" | "modal";
  initialTab?: "active" | "archived";
  onCategoryCreated?: (category: CategoryResponse) => void;
  onCategoryUpdated?: (category: CategoryResponse) => void;
  onCategoryArchived?: (id: string) => void;
  onCategoryRestored?: (id: string) => void;
}

/**
 * Unified Category Management Component (T047, T048, FR-030 to FR-037)
 *
 * Provides single source of truth for category management UI across
 * dedicated page (`/categories`) and quick-access modal (`CategoryManagerModal`).
 *
 * Features:
 * - Active & Archived tabs with dynamic item counter badges
 * - Search & substring filtering across active/archived categories
 * - Active product count indicators (linked in page view, badge in modal)
 * - Inline create form with trimming, length limits, and server-side RPC validation
 * - Inline edit mode for active categories
 * - Product preservation archive confirmation dialog (FR-035)
 * - Category restoration returning archived status to active
 * - Fail-closed role-based permission controls (`canCreate`, `canUpdate`, `canArchive`)
 */
export function CategoryManager({
  slug,
  categories: initialCategories,
  canCreate,
  canUpdate,
  canArchive,
  variant = "page",
  initialTab = "active",
  onCategoryCreated,
  onCategoryUpdated,
  onCategoryArchived,
  onCategoryRestored,
}: CategoryManagerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [categories, setCategories] = useState<CategoryItem[]>(initialCategories);
  const [activeTab, setActiveTab] = useState<"active" | "archived">(() => {
    if (variant === "page" && searchParams?.get("tab") === "archived") {
      return "archived";
    }
    return initialTab;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingCategory, setArchivingCategory] = useState<CategoryItem | null>(null);

  // Form states for Create
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Form states for Edit
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Banner Notification
  const [bannerMessage, setBannerMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Sync state if props change
  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  // Tab filtered items
  const activeCategories = useMemo(
    () => categories.filter((c) => c.status === "active"),
    [categories]
  );
  const archivedCategories = useMemo(
    () => categories.filter((c) => c.status === "archived"),
    [categories]
  );

  const displayedCategories = useMemo(() => {
    const list = activeTab === "active" ? activeCategories : archivedCategories;
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description && c.description.toLowerCase().includes(q))
    );
  }, [activeTab, activeCategories, archivedCategories, searchQuery]);

  // Tab switch handler
  const handleTabChange = (tab: "active" | "archived") => {
    setActiveTab(tab);
    setEditingId(null);
    setBannerMessage(null);

    if (variant === "page" && searchParams) {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "archived") {
        params.set("tab", "archived");
      } else {
        params.delete("tab");
      }
      router.replace(`/${slug}/products/categories?${params.toString()}`, { scroll: false });
    }
  };

  // Create Category Handler
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setBannerMessage(null);

    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError("Category name is required.");
      return;
    }
    if (trimmedName.length > 100) {
      setCreateError("Category name must be 100 characters or less.");
      return;
    }
    if (createDescription.trim().length > 500) {
      setCreateError("Description must be 500 characters or less.");
      return;
    }

    startTransition(async () => {
      const res = await createCategoryAction(slug, {
        name: trimmedName,
        description: createDescription.trim() || null,
      });

      if (!res.success) {
        setCreateError(res.error.message || "Failed to create category.");
        return;
      }

      const newCat: CategoryItem = {
        id: res.data.id,
        organization_id: res.data.organization_id,
        name: res.data.name,
        description: res.data.description,
        status: "active",
        productCount: 0,
        created_at: res.data.created_at,
      };

      setCategories((prev) => [...prev, newCat]);
      setCreateName("");
      setCreateDescription("");
      setIsCreating(false);
      setBannerMessage({ type: "success", text: `Category "${newCat.name}" created successfully.` });
      onCategoryCreated?.(res.data);
    });
  };

  // Start Editing
  const startEdit = (cat: CategoryItem) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDescription(cat.description || "");
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditError(null);
  };

  // Edit Category Handler
  const handleEditSubmit = (e: React.FormEvent, catId: string) => {
    e.preventDefault();
    setEditError(null);
    setBannerMessage(null);

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError("Category name is required.");
      return;
    }
    if (trimmedName.length > 100) {
      setEditError("Category name must be 100 characters or less.");
      return;
    }
    if (editDescription.trim().length > 500) {
      setEditError("Description must be 500 characters or less.");
      return;
    }

    startTransition(async () => {
      const res = await updateCategoryAction(slug, catId, {
        name: trimmedName,
        description: editDescription.trim() || null,
      });

      if (!res.success) {
        setEditError(res.error.message || "Failed to update category.");
        return;
      }

      setCategories((prev) =>
        prev.map((c) =>
          c.id === catId
            ? { ...c, name: res.data.name, description: res.data.description, updated_at: res.data.updated_at }
            : c
        )
      );
      cancelEdit();
      setBannerMessage({ type: "success", text: `Category updated to "${res.data.name}".` });
      onCategoryUpdated?.(res.data);
    });
  };

  // Archive Category Handler
  const confirmArchive = () => {
    if (!archivingCategory) return;
    const cat = archivingCategory;
    setBannerMessage(null);

    startTransition(async () => {
      const res = await archiveCategoryAction(slug, cat.id);
      if (!res.success) {
        setBannerMessage({ type: "error", text: res.error.message || "Failed to archive category." });
        setArchivingCategory(null);
        return;
      }

      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, status: "archived", archived_at: res.data.archived_at } : c))
      );
      setArchivingCategory(null);
      setBannerMessage({
        type: "success",
        text: `Category "${cat.name}" archived. Existing products retain this category.`,
      });
      onCategoryArchived?.(cat.id);
    });
  };

  // Restore Category Handler
  const handleRestore = (cat: CategoryItem) => {
    setBannerMessage(null);

    startTransition(async () => {
      const res = await restoreCategoryAction(slug, cat.id);
      if (!res.success) {
        setBannerMessage({ type: "error", text: res.error.message || "Failed to restore category." });
        return;
      }

      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, status: "active", archived_at: null } : c))
      );
      setBannerMessage({ type: "success", text: `Category "${cat.name}" restored to active status.` });
      onCategoryRestored?.(cat.id);
    });
  };

  const isModal = variant === "modal";

  return (
    <div className={isModal ? "p-6 space-y-4" : "space-y-6"}>
      {/* Global Notification Banner */}
      {bannerMessage && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs sm:text-sm flex items-center gap-2 border ${
            bannerMessage.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50"
              : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-900/50"
          }`}
        >
          {bannerMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <span>{bannerMessage.text}</span>
        </div>
      )}

      {/* Inline Create Form (Expandable) */}
      {isCreating && (
        <form
          onSubmit={handleCreateSubmit}
          className={`p-4 rounded-xl border border-gray-200 dark:border-zinc-800 space-y-3 animate-in fade-in duration-150 ${
            isModal ? "bg-gray-50 dark:bg-zinc-800/50" : "bg-white dark:bg-zinc-900 shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-2">
            <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
              Create New Category
            </h3>
            <span className="text-[10px] text-gray-400">Flat structure (no subcategories)</span>
          </div>

          {createError && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-lg text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{createError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="create-cat-name" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Category Name <span className="text-red-500">*</span>
              </label>
              <input
                id="create-cat-name"
                type="text"
                required
                maxLength={100}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Dairy & Refrigerated"
                className="w-full px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isPending}
              />
              <p className="text-[10px] text-gray-400">1–100 characters. Uniqueness is case-insensitive.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="create-cat-desc" className="text-xs font-medium text-gray-700 dark:text-gray-300">
                Description <span className="text-gray-400 font-normal">(Optional)</span>
              </label>
              <input
                id="create-cat-desc"
                type="text"
                maxLength={500}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="e.g. Milk, cheese, butter, and yogurts"
                className="w-full px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isPending}
              />
              <p className="text-[10px] text-gray-400">Max 500 characters.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              disabled={isPending}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              <span>Save Category</span>
            </button>
          </div>
        </form>
      )}

      {/* Tabs & Search Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Active & Archived Tabs */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-zinc-800/80 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => handleTabChange("active")}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === "active"
                ? "bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            <span>Active</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-300">
              {activeCategories.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("archived")}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === "archived"
                ? "bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            <span>Archived</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-300">
              {archivedCategories.length}
            </span>
          </button>
        </div>

        {/* Right side controls: Search & Create Toggle */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial sm:justify-end">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isModal ? `Search ${activeTab} categories...` : `Filter ${activeTab} categories...`}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setIsCreating((prev) => !prev);
                setCreateError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isCreating ? "Cancel" : "New Category"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Category List */}
      <div
        className={`rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden ${
          isModal ? "bg-white dark:bg-zinc-900/60" : "bg-white dark:bg-zinc-900 shadow-sm"
        }`}
      >
        {displayedCategories.length === 0 ? (
          <div className="py-12 sm:py-16 text-center space-y-2 px-4">
            <FolderTree className="h-8 w-8 text-gray-400 mx-auto stroke-[1.5]" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {searchQuery ? "No matching categories found" : `No ${activeTab} categories`}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              {searchQuery
                ? "Try adjusting your search terms."
                : activeTab === "active"
                ? "Categories allow you to organize and group products for reporting and POS cataloging."
                : "Archived categories will appear here when archived by an organization administrator."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-zinc-800">
            {displayedCategories.map((cat) => {
              const isEditingThis = editingId === cat.id;

              return (
                <div
                  key={cat.id}
                  className={`p-3.5 sm:p-4 transition-colors ${
                    isEditingThis
                      ? "bg-blue-50/40 dark:bg-blue-950/20"
                      : "hover:bg-gray-50/80 dark:hover:bg-zinc-800/40"
                  }`}
                >
                  {isEditingThis ? (
                    /* Inline Edit Mode */
                    <form onSubmit={(e) => handleEditSubmit(e, cat.id)} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                          Edit Category
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">ID: {cat.id}</span>
                      </div>
                      {editError && (
                        <div className="p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded text-xs text-red-700 dark:text-red-300 flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{editError}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-gray-700 dark:text-gray-300">Name</label>
                          <input
                            type="text"
                            required
                            maxLength={100}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full mt-0.5 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={isPending}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                            Description
                          </label>
                          <input
                            type="text"
                            maxLength={500}
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full mt-0.5 px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={isPending}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isPending}
                          className="px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isPending}
                          className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                        >
                          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                          <span>Save Changes</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Display Mode */
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm sm:text-base text-gray-900 dark:text-gray-100 truncate">
                            {cat.name}
                          </span>
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              cat.status === "active"
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"
                            }`}
                          >
                            {cat.status === "active" ? "Active" : "Archived"}
                          </span>
                        </div>
                        {cat.description ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1">
                            {cat.description}
                          </p>
                        ) : (
                          <p className="text-[11px] text-gray-400 italic">No description provided</p>
                        )}
                      </div>

                      {/* Right side: Product Count & Actions */}
                      <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                        {/* Active Product Count Badge (FR-037) */}
                        {isModal ? (
                          <div
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40"
                            title={`${cat.productCount} active products assigned to this category`}
                          >
                            <Package className="h-3 w-3" />
                            <span>
                              {cat.productCount} {cat.productCount === 1 ? "product" : "products"}
                            </span>
                          </div>
                        ) : (
                          <Link
                            href={`/${slug}/products?category=${cat.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                            title="View products in this category"
                          >
                            <Package className="h-3.5 w-3.5" />
                            <span>
                              {cat.productCount} {cat.productCount === 1 ? "active product" : "active products"}
                            </span>
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </Link>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-1">
                          {cat.status === "active" ? (
                            <>
                              {canUpdate && (
                                <button
                                  type="button"
                                  onClick={() => startEdit(cat)}
                                  disabled={isPending}
                                  className="p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                                  title="Edit category"
                                  aria-label={`Edit category ${cat.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canArchive && (
                                <button
                                  type="button"
                                  onClick={() => setArchivingCategory(cat)}
                                  disabled={isPending}
                                  className="p-1.5 text-gray-500 hover:text-amber-600 dark:text-gray-400 dark:hover:text-amber-400 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                                  title="Archive category"
                                  aria-label={`Archive category ${cat.name}`}
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </>
                          ) : (
                            /* Archived state: Restore action */
                            canArchive && (
                              <button
                                type="button"
                                onClick={() => handleRestore(cat)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded border border-emerald-300 dark:border-emerald-800 transition-colors"
                                title="Restore category to active"
                                aria-label={`Restore category ${cat.name}`}
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Restore</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Archive Confirmation Sub-Dialog (FR-035) */}
      {archivingCategory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-confirmation-title"
          className={`${
            isModal ? "absolute inset-0 z-20 bg-black/60 rounded-xl" : "fixed inset-0 z-50 bg-black/50"
          } flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150`}
        >
          <div className="w-full max-w-md p-5 sm:p-6 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-amber-300 dark:border-amber-900/60 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-full shrink-0">
                <Archive className="h-5 w-5" />
              </div>
              <div>
                <h3 id="archive-confirmation-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Archive Category &ldquo;{archivingCategory.name}&rdquo;?
                </h3>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                  Product preservation guarantee (FR-035)
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-600 dark:text-gray-300 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/40 space-y-1.5">
              <p>
                <strong>{archivingCategory.productCount} product{archivingCategory.productCount === 1 ? "" : "s"}</strong> currently assigned to this category will <strong>retain their category reference</strong> with an <span className="font-mono text-amber-700 dark:text-amber-300">[Archived]</span> indicator.
              </p>
              <p className="text-gray-500 dark:text-gray-400">
                Archived categories cannot be newly assigned to products. You can restore this category at any time.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setArchivingCategory(null)}
                disabled={isPending}
                className="px-3.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmArchive}
                disabled={isPending}
                className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Confirm Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

