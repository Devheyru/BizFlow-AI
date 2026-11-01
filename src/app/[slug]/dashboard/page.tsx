import React from "react";
import { getTenantContext } from "@/lib/auth/context";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Building2,
  Globe,
  Clock,
  Shield,
  Mail,
  Phone,
  MapPin,
  Receipt,
  CheckCircle2,
} from "lucide-react";

interface TenantDashboardPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Tenant Dashboard Overview Page (T039, US3).
 *
 * Server-rendered dashboard displaying store metadata and the user's actual verified role.
 * Strictly limited to data existing in the database schema without mock metrics.
 */
export default async function TenantDashboardPage({ params }: TenantDashboardPageProps) {
  const { slug } = await params;
  const { organization, role, user } = await getTenantContext(slug);

  const formattedDate = organization.created_at
    ? new Date(organization.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Recently";

  return (
    <div className="space-y-8">
      {/* Page Title & Store Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {organization.name}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Store dashboard and organization workspace. Operating since {formattedDate}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Store Active</span>
          </span>
        </div>
      </div>

      {/* Grid: Store Properties & Membership Access */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Card 1: Store Configuration */}
        <Card className="border border-gray-200 dark:border-gray-800 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Store Configuration</span>
            </CardTitle>
            <CardDescription>Regional and localization settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                Category
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {organization.business_type}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Country</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {organization.country}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Operating Currency</span>
              <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                {organization.currency}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Timezone
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                {organization.timezone}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Contact & Tax Information */}
        <Card className="border border-gray-200 dark:border-gray-800 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Receipt className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Contact & Registration</span>
            </CardTitle>
            <CardDescription>Official business details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Store Email
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                {organization.email || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Store Phone
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {organization.phone || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Address
              </span>
              <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                {organization.address || "Not specified"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 dark:text-gray-400">Tax ID / VAT</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {organization.tax_id || "Not specified"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: User Access & Role */}
        <Card className="border border-gray-200 dark:border-gray-800 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Your Access Level</span>
            </CardTitle>
            <CardDescription>Verified tenant permissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Account</span>
              <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[150px]">
                {user.email}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Assigned Role</span>
              <span className="font-semibold text-purple-600 dark:text-purple-400 capitalize">
                {role}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-800">
              <span className="text-gray-500 dark:text-gray-400">Membership</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                Active
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-gray-500 dark:text-gray-400">Workspace Slug</span>
              <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                {organization.slug}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
