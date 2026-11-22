import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getTaxSettingsAction } from "@/actions/tax-settings-actions";
import { TaxSettingsForm } from "@/components/settings/tax-settings-form";

interface TaxSettingsPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Server Component for Tax Settings Management (T059, US5, US8)
 * - Resolves authoritative tenant context via getTenantContext.
 * - Evaluates `tax_settings:update` permission to govern edit capabilities.
 * - Loads persisted tax settings from public.organization_tax_settings.
 * - Displays read-only guidance for unauthorized roles (e.g. Cashier).
 */
export default async function TaxSettingsPage({ params }: TaxSettingsPageProps) {
  const { slug } = await params;
  const context = await getTenantContext(slug);

  const canManageTax = hasPermission(context, "tax_settings:update");

  const taxSettingsRes = await getTaxSettingsAction(slug);
  const taxSettings = taxSettingsRes.success ? taxSettingsRes.data : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/${slug}/dashboard`}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Tax Settings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage sales tax rates, display names, and calculation modes for {context.organization.name}.
        </p>
      </div>

      <TaxSettingsForm
        slug={slug}
        initialSettings={taxSettings}
        canManageTax={canManageTax}
      />
    </div>
  );
}
