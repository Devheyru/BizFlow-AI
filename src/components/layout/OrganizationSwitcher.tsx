"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Store,
  ChevronsUpDown,
  Check,
  Plus,
  Loader2,
  Shield,
} from "lucide-react";
import { switchOrganizationAction } from "@/actions/organization-actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { AppRole, OrganizationSummary } from "@/types/auth";
import { cn } from "@/lib/utils";

interface OrganizationSwitcherProps {
  currentOrganization: {
    id: string;
    name: string;
    slug: string;
    business_type?: string;
  };
  currentRole: AppRole;
  activeOrganizations?: OrganizationSummary[];
  className?: string;
}

const ROLE_BADGE_STYLES: Record<AppRole, { label: string; className: string }> = {
  owner: {
    label: "Owner",
    className:
      "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  admin: {
    label: "Admin",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  manager: {
    label: "Manager",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  cashier: {
    label: "Cashier",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
};

export function OrganizationSwitcher({
  currentOrganization,
  currentRole,
  activeOrganizations = [],
  className,
}: OrganizationSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentBadge = ROLE_BADGE_STYLES[currentRole] || {
    label: currentRole,
    className: "bg-gray-100 text-gray-800 border-gray-200",
  };

  // Compile full list of organizations
  const orgList =
    activeOrganizations.length > 0
      ? activeOrganizations
      : [
          {
            id: currentOrganization.id,
            name: currentOrganization.name,
            slug: currentOrganization.slug,
            businessType: currentOrganization.business_type || "Retail Store",
            country: "US",
            currency: "USD",
            timezone: "America/New_York",
            isActive: true,
            role: currentRole,
          },
        ];

  const handleSelectOrg = (targetOrg: OrganizationSummary) => {
    // If selecting currently active organization, no transition needed
    if (targetOrg.id === currentOrganization.id) {
      return;
    }

    setErrorMsg(null);
    setSwitchingOrgId(targetOrg.id);

    startTransition(async () => {
      try {
        const result = await switchOrganizationAction({
          organizationId: targetOrg.id,
          slug: targetOrg.slug,
        });

        if (result.success) {
          router.push(result.data.redirectUrl);
          router.refresh();
        } else {
          setErrorMsg(result.error.message);
          setSwitchingOrgId(null);
        }
      } catch {
        setErrorMsg("Failed to switch organization. Please try again.");
        setSwitchingOrgId(null);
      }
    });
  };

  return (
    <div className={cn("relative flex items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shadow-sm text-left max-w-[280px] sm:max-w-[360px]"
          aria-label="Switch organization"
          data-testid="org-switcher-trigger"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white font-semibold shadow-sm">
            {switchingOrgId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Store className="h-4 w-4" />
            )}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="font-bold text-sm truncate leading-snug">
              {currentOrganization.name}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 w-fit px-1.5 py-0.2 rounded text-[11px] font-semibold border",
                currentBadge.className
              )}
              aria-label={`Your role: ${currentBadge.label}`}
            >
              <Shield className="h-2.5 w-2.5" aria-hidden="true" />
              <span>{currentBadge.label}</span>
            </span>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-gray-400 shrink-0 ml-1" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="left"
          className="w-72 p-1.5"
          data-testid="org-switcher-dropdown"
        >
          <DropdownMenuLabel className="px-2 py-1 text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Your Stores
          </DropdownMenuLabel>

          {errorMsg && (
            <div className="p-2 mb-1 rounded text-xs bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {orgList.map((org) => {
              const isSelected = org.id === currentOrganization.id;
              const isSwitching = switchingOrgId === org.id;
              const badge = ROLE_BADGE_STYLES[org.role] || {
                label: org.role,
                className: "bg-gray-100 text-gray-800 border-gray-200",
              };

              return (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => handleSelectOrg(org)}
                  disabled={isPending}
                  className={cn(
                    "flex items-center justify-between px-2.5 py-2 rounded-md cursor-pointer transition-colors text-sm",
                    isSelected
                      ? "bg-blue-50 font-medium text-blue-900 dark:bg-blue-950/50 dark:text-blue-100"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800"
                  )}
                  data-testid={`org-item-${org.slug}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <Store
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-gray-400"
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm font-medium">{org.name}</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 w-fit px-1.5 py-0.2 rounded text-[10px] font-semibold border",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center">
                    {isSwitching ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    ) : isSelected ? (
                      <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    ) : null}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>

          <DropdownMenuSeparator className="my-1" />

          <Link href="/onboarding/create-organization" className="block w-full">
            <DropdownMenuItem
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium px-2.5 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/40"
              data-testid="create-new-store-button"
            >
              <Plus className="h-4 w-4" />
              <span>Create New Store</span>
            </DropdownMenuItem>
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
