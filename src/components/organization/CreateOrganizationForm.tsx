"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from "@/lib/validations/organization";
import { createOrganizationAction } from "@/actions/organization-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Store, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

const COMMON_COUNTRIES = [
  { code: "US", name: "United States (US)" },
  { code: "CA", name: "Canada (CA)" },
  { code: "GB", name: "United Kingdom (GB)" },
  { code: "DE", name: "Germany (DE)" },
  { code: "FR", name: "France (FR)" },
  { code: "AU", name: "Australia (AU)" },
  { code: "KE", name: "Kenya (KE)" },
  { code: "NG", name: "Nigeria (NG)" },
  { code: "ZA", name: "South Africa (ZA)" },
  { code: "JP", name: "Japan (JP)" },
];

const COMMON_CURRENCIES = [
  { code: "USD", name: "USD - US Dollar" },
  { code: "EUR", name: "EUR - Euro" },
  { code: "GBP", name: "GBP - British Pound" },
  { code: "CAD", name: "CAD - Canadian Dollar" },
  { code: "KES", name: "KES - Kenyan Shilling" },
  { code: "NGN", name: "NGN - Nigerian Naira" },
  { code: "ZAR", name: "ZAR - South African Rand" },
  { code: "AUD", name: "AUD - Australian Dollar" },
  { code: "JPY", name: "JPY - Japanese Yen" },
];

export function CreateOrganizationForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Generate a stable clientMutationId for idempotent request submission
  const [mutationId] = useState(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "00000000-0000-4000-8000-000000000000";
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      name: "",
      businessType: "Convenience Store",
      country: "US",
      currency: "USD",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      clientMutationId: mutationId,
      taxId: "",
      phone: "",
      email: "",
      address: "",
    },
  });

  const onSubmit = (data: CreateOrganizationInput) => {
    setServerError(null);

    startTransition(async () => {
      try {
        const result = await createOrganizationAction({
          ...data,
          clientMutationId: mutationId,
        });

        if (!result.success) {
          setServerError(result.error.message || "Failed to create organization");
          return;
        }

        setIsSuccess(true);
        const destination = result.data.redirectUrl || `/${result.data.slug}/dashboard`;
        router.push(destination);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "An unexpected network error occurred";
        setServerError(message);
      }
    });
  };

  return (
    <Card className="w-full max-w-2xl shadow-lg border-gray-200 dark:border-gray-800">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Set up your retail store</CardTitle>
            <CardDescription>
              Create your organization tenant to configure products, inventory, and point of sale.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-5">
          {serverError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Organization setup failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {isSuccess && (
            <Alert variant="default" className="border-green-600/30 bg-green-50/50 text-green-900 dark:bg-green-950/20 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Store created successfully!</AlertTitle>
              <AlertDescription>Setting up your workspace dashboard...</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Store Name */}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="name">Business / Store Name *</Label>
              <div className="relative">
                <Input
                  id="name"
                  placeholder="e.g. Downtown Market, Apex Boutique"
                  {...register("name")}
                  aria-invalid={!!errors.name}
                  disabled={isPending || isSuccess}
                />
              </div>
              {errors.name && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.name.message}</p>
              )}
            </div>

            {/* Business Type */}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="businessType">Business Category / Type *</Label>
              <Input
                id="businessType"
                placeholder="e.g. Convenience Store, Apparel, Supermarket, Pharmacy"
                {...register("businessType")}
                aria-invalid={!!errors.businessType}
                disabled={isPending || isSuccess}
              />
              {errors.businessType && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.businessType.message}</p>
              )}
            </div>

            {/* Country */}
            <div className="space-y-1.5">
              <Label htmlFor="country">Country (ISO 3166-1) *</Label>
              <select
                id="country"
                {...register("country")}
                disabled={isPending || isSuccess}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {COMMON_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.country && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.country.message}</p>
              )}
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency (ISO 4217) *</Label>
              <select
                id="currency"
                {...register("currency")}
                disabled={isPending || isSuccess}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                {COMMON_CURRENCIES.map((cur) => (
                  <option key={cur.code} value={cur.code}>
                    {cur.name}
                  </option>
                ))}
              </select>
              {errors.currency && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.currency.message}</p>
              )}
            </div>

            {/* Timezone */}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="timezone">Timezone *</Label>
              <Input
                id="timezone"
                placeholder="e.g. America/New_York, UTC, Europe/London"
                {...register("timezone")}
                aria-invalid={!!errors.timezone}
                disabled={isPending || isSuccess}
              />
              {errors.timezone && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.timezone.message}</p>
              )}
            </div>
          </div>

          {/* Optional Details Header */}
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Optional Store Contact & Tax Information
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="taxId">Tax / VAT ID</Label>
                <Input
                  id="taxId"
                  placeholder="e.g. VAT12345678"
                  {...register("taxId")}
                  disabled={isPending || isSuccess}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  placeholder="e.g. +1 555-0199"
                  {...register("phone")}
                  disabled={isPending || isSuccess}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="email">Store Contact Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="store@example.com"
                  {...register("email")}
                  aria-invalid={!!errors.email}
                  disabled={isPending || isSuccess}
                />
                {errors.email && (
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="address">Physical Address</Label>
                <Input
                  id="address"
                  placeholder="e.g. 123 Main Street, Suite 100"
                  {...register("address")}
                  disabled={isPending || isSuccess}
                />
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between border-t border-gray-100 dark:border-gray-800 pt-5">
          <p className="text-xs text-gray-500">
            You will be assigned as the primary <strong>Owner</strong> of this organization.
          </p>
          <Button type="submit" disabled={isPending || isSuccess} className="min-w-32">
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Workspace"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
