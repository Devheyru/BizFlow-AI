"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  X,
  Plus,
  Loader2,
  Check,
  Phone,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerForm } from "@/components/customers/customer-form";
import { searchCustomersAction } from "@/actions/customer-actions";
import type { CustomerRecord } from "@/types/customers";

export interface CustomerPickerProps {
  slug: string;
  selectedCustomer: CustomerRecord | null;
  onSelectCustomer: (customer: CustomerRecord | null) => void;
  canCreateCustomer?: boolean;
  disabled?: boolean;
}

export function CustomerPicker({
  slug,
  selectedCustomer,
  onSelectCustomer,
  canCreateCustomer = true,
  disabled = false,
}: CustomerPickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced customer search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    let isSubscribed = true;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await searchCustomersAction(slug, {
          search: searchTerm.trim(),
          status: "active",
          pageSize: 5,
        });

        if (isSubscribed) {
          if (res.success) {
            setResults(res.data.items);
          } else {
            setResults([]);
          }
          setIsLoading(false);
        }
      } catch {
        if (isSubscribed) {
          setResults([]);
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [searchTerm, slug]);

  const handleSelect = (customer: CustomerRecord) => {
    onSelectCustomer(customer);
    setSearchTerm("");
    setResults([]);
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelectCustomer(null);
    setSearchTerm("");
    setResults([]);
  };

  const handleCreated = (newCustomer: CustomerRecord) => {
    onSelectCustomer(newCustomer);
    setIsCreateModalOpen(false);
    setSearchTerm("");
    setResults([]);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {selectedCustomer ? (
        // Selected Customer Display Card
        <div className="flex items-center justify-between p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {selectedCustomer.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {selectedCustomer.name}
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {selectedCustomer.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    <span>{selectedCustomer.phone}</span>
                  </span>
                )}
                {selectedCustomer.email && !selectedCustomer.phone && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{selectedCustomer.email}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors disabled:opacity-50"
            title="Remove customer from sale"
            aria-label="Remove customer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        // Search Input and Trigger
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              disabled={disabled}
              placeholder="Search customer (name, phone, email)..."
              value={searchTerm}
              onFocus={() => setIsOpen(true)}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setIsOpen(true);
              }}
              className="pl-9 pr-9"
            />
            {isLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
            )}
          </div>

          {/* Dropdown Results */}
          {isOpen && (searchTerm.trim().length > 0 || canCreateCustomer) && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
              {results.length > 0 ? (
                <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {results.map((cust) => (
                    <li key={cust.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(cust)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/60 flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {cust.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {cust.phone || cust.email || "No contact info"}
                          </p>
                        </div>
                        <Check className="h-4 w-4 text-transparent group-hover:text-gray-400 shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                searchTerm.trim().length > 0 &&
                !isLoading && (
                  <div className="p-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    No active customers match &ldquo;{searchTerm}&rdquo;
                  </div>
                )
              )}

              {canCreateCustomer && (
                <div className="p-2 border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/40">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsCreateModalOpen(true);
                      setIsOpen(false);
                    }}
                    className="w-full justify-start text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create New Customer Profile</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Inline Create Customer Modal */}
      {isCreateModalOpen && (
        <CustomerForm
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          slug={slug}
          onSuccess={handleCreated}
        />
      )}
    </div>
  );
}
