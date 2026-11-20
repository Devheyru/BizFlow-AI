"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Users,
  Eye,
  Edit2,
  Archive,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerForm } from "@/components/customers/customer-form";
import { archiveCustomerAction } from "@/actions/customer-actions";
import type { CustomerRecord, PaginatedCustomerResult } from "@/types/customers";

export interface CustomerListViewProps {
  slug: string;
  initialData: PaginatedCustomerResult;
  searchQuery: string;
  currentStatus: "all" | "active" | "archived";
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
}

export function CustomerListView({
  slug,
  initialData,
  searchQuery,
  currentStatus,
  canCreate,
  canUpdate,
  canArchive,
}: CustomerListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Search input state
  const [searchTerm, setSearchTerm] = useState(searchQuery);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [archivingCustomer, setArchivingCustomer] = useState<CustomerRecord | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // URL query updater
  const updateQuery = (updates: { q?: string; status?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.q !== undefined) {
      if (updates.q.trim()) {
        params.set("q", updates.q.trim());
      } else {
        params.delete("q");
      }
      params.set("page", "1");
    }

    if (updates.status !== undefined) {
      if (updates.status === "active") {
        params.delete("status");
      } else {
        params.set("status", updates.status);
      }
      params.set("page", "1");
    }

    if (updates.page !== undefined) {
      params.set("page", updates.page.toString());
    }

    startTransition(() => {
      router.push(`/${slug}/customers?${params.toString()}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateQuery({ q: searchTerm });
  };

  const handleArchiveConfirm = async () => {
    if (!archivingCustomer || isArchiving) return;
    setIsArchiving(true);
    setArchiveError(null);

    try {
      const res = await archiveCustomerAction(slug, archivingCustomer.id);
      if (!res.success) {
        setArchiveError(res.error.message || "Failed to archive customer.");
        setIsArchiving(false);
        return;
      }

      setArchivingCustomer(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setArchiveError("An unexpected error occurred while archiving.");
    } finally {
      setIsArchiving(false);
    }
  };

  const { items, totalCount, page, totalPages } = initialData;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Customer Directory
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
              {totalCount} {totalCount === 1 ? "customer" : "customers"}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage customer profiles, contact info, and purchase history.
          </p>
        </div>

        {canCreate && (
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add Customer</span>
          </Button>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-4 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="search"
            placeholder="Search by name, phone, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 w-full"
          />
        </form>

        {/* Status Filters */}
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => updateQuery({ status: "active" })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              currentStatus === "active"
                ? "bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => updateQuery({ status: "archived" })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              currentStatus === "archived"
                ? "bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            Archived
          </button>
          <button
            type="button"
            onClick={() => updateQuery({ status: "all" })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              currentStatus === "all"
                ? "bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden shadow-sm">
        {items.length === 0 ? (
          <div className="py-16 px-4 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-300 dark:text-zinc-600 mb-3" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              No customers found
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
              {searchTerm
                ? `No customers match your search query "${searchTerm}".`
                : currentStatus === "archived"
                ? "There are currently no archived customer records."
                : "Get started by registering your first customer profile."}
            </p>
            {canCreate && !searchTerm && currentStatus !== "archived" && (
              <Button
                onClick={() => setIsCreateOpen(true)}
                variant="outline"
                className="mt-4 inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                <span>Add Customer</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-3.5">
                    Customer Name
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Contact Details
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Created
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
                {items.map((customer) => {
                  const isActive = customer.status === "active";
                  const formattedDate = new Date(customer.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  });

                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      {/* Name Column */}
                      <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">
                        <Link
                          href={`/${slug}/customers/${customer.id}`}
                          className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          {customer.name}
                        </Link>
                        {customer.notes && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs font-normal mt-0.5">
                            {customer.notes}
                          </p>
                        )}
                      </td>

                      {/* Contact Column */}
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-300">
                        <div className="flex flex-col gap-1">
                          {customer.phone ? (
                            <span className="flex items-center gap-1.5 text-xs">
                              <Phone className="h-3 w-3 text-gray-400" />
                              <a
                                href={`tel:${customer.phone}`}
                                className="hover:underline"
                              >
                                {customer.phone}
                              </a>
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                          {customer.email && (
                            <span className="flex items-center gap-1.5 text-xs">
                              <Mail className="h-3 w-3 text-gray-400" />
                              <a
                                href={`mailto:${customer.email}`}
                                className="hover:underline"
                              >
                                {customer.email}
                              </a>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status Column */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            isActive
                              ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                              : "bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-gray-400"
                          }`}
                        >
                          {isActive ? "Active" : "Archived"}
                        </span>
                      </td>

                      {/* Created Date */}
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                        {formattedDate}
                      </td>

                      {/* Actions Column */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/${slug}/customers/${customer.id}`}
                            className="p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                            title="View Customer Profile"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>

                          {canUpdate && isActive && (
                            <button
                              type="button"
                              onClick={() => setEditingCustomer(customer)}
                              className="p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                              title="Edit Customer"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                          )}

                          {canArchive && isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                setArchivingCustomer(customer);
                                setArchiveError(null);
                              }}
                              className="p-1.5 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
                              title="Archive Customer"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-zinc-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages} ({totalCount} total)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isPending}
                onClick={() => updateQuery({ page: page - 1 })}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Previous</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isPending}
                onClick={() => updateQuery({ page: page + 1 })}
                className="gap-1"
              >
                <span>Next</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <CustomerForm
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          slug={slug}
          onSuccess={() => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Edit Modal */}
      {editingCustomer && (
        <CustomerForm
          isOpen={Boolean(editingCustomer)}
          onClose={() => setEditingCustomer(null)}
          slug={slug}
          customer={editingCustomer}
          onSuccess={() => {
            startTransition(() => {
              router.refresh();
            });
          }}
        />
      )}

      {/* Archive Confirmation Dialog */}
      {archivingCustomer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-800 p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-lg shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3
                  id="archive-dialog-title"
                  className="text-base font-semibold text-gray-900 dark:text-gray-100"
                >
                  Archive Customer Profile
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Are you sure you want to archive <strong>{archivingCustomer.name}</strong>?
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Archived customers cannot be selected for new sales, but all historical purchase records remain intact.
                </p>
              </div>
            </div>

            {archiveError && (
              <div
                role="alert"
                className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 p-2.5 rounded-lg border border-red-200 dark:border-red-900"
              >
                {archiveError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                disabled={isArchiving}
                onClick={() => setArchivingCustomer(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={isArchiving}
                onClick={handleArchiveConfirm}
                isLoading={isArchiving}
              >
                {isArchiving ? "Archiving..." : "Archive Customer"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
