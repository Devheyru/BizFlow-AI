"use client";

import React, { useState } from "react";
import {
  Save,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldAlert,
  Percent,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { updateTaxSettingsAction } from "@/actions/tax-settings-actions";
import { updateTaxSettingsSchema } from "@/lib/validations/sales";
import type { TaxSettings } from "@/types/sales";

export interface TaxSettingsFormProps {
  slug: string;
  initialSettings: TaxSettings | null;
  canManageTax: boolean;
}

export function TaxSettingsForm({
  slug,
  initialSettings,
  canManageTax,
}: TaxSettingsFormProps) {
  const [taxName, setTaxName] = useState<string>(
    initialSettings?.taxName ?? "Standard Tax"
  );
  const [defaultTaxRate, setDefaultTaxRate] = useState<string>(
    initialSettings ? String(initialSettings.defaultTaxRate) : "0.0000"
  );
  const [isTaxInclusive, setIsTaxInclusive] = useState<boolean>(
    initialSettings?.isTaxInclusive ?? false
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageTax || isSubmitting) return;

    setError(null);
    setSuccessMessage(null);
    setFieldErrors({});

    const numRate = parseFloat(defaultTaxRate);

    // Client-side Zod validation
    const validationResult = updateTaxSettingsSchema.safeParse({
      taxName,
      defaultTaxRate: isNaN(numRate) ? defaultTaxRate : numRate,
      isTaxInclusive,
    });

    if (!validationResult.success) {
      const flattened = validationResult.error.flatten();
      setFieldErrors(flattened.fieldErrors);
      setError(
        flattened.formErrors[0] ||
          Object.values(flattened.fieldErrors)[0]?.[0] ||
          "Please resolve the form errors before submitting."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updateTaxSettingsAction(slug, validationResult.data);
      if (!res.success) {
        setError(res.error.message || "Failed to update tax settings.");
        if (res.error.details) {
          setFieldErrors(res.error.details);
        }
      } else {
        setSuccessMessage("Tax settings successfully saved.");
        // Sync values from returned authoritative data
        setTaxName(res.data.taxName);
        setDefaultTaxRate(String(res.data.defaultTaxRate));
        setIsTaxInclusive(res.data.isTaxInclusive);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6 max-w-3xl">
      {/* Permission Warning for Unauthorized Users */}
      {!canManageTax && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <p className="font-semibold">Read-Only Mode</p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-400">
              You do not have permission to modify tax settings. Only Organization Owners and Administrators can change tax configurations.
            </p>
          </div>
        </div>
      )}

      {/* Global Status Banners */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Error saving tax settings</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400 mt-0.5" />
          <div>
            <p className="font-medium">{successMessage}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Receipt className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            General Sales Tax Configuration
          </CardTitle>
          <CardDescription>
            Configure default taxation applied to POS checkouts and printable customer receipts.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Tax Name Field */}
          <div className="space-y-1.5">
            <Label htmlFor="taxName" className="font-medium">
              Tax Display Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="taxName"
              name="taxName"
              type="text"
              disabled={!canManageTax || isSubmitting}
              value={taxName}
              onChange={(e) => setTaxName(e.target.value)}
              placeholder="e.g. VAT, Sales Tax, GST"
              className={fieldErrors.taxName ? "border-red-500" : ""}
              maxLength={100}
            />
            <p className="text-xs text-gray-500">
              The label that appears on checkout summaries, item breakdowns, and customer receipts.
            </p>
            {fieldErrors.taxName && (
              <p className="text-xs text-red-600">{fieldErrors.taxName[0]}</p>
            )}
          </div>

          {/* Default Tax Rate Field */}
          <div className="space-y-1.5">
            <Label htmlFor="defaultTaxRate" className="font-medium">
              Default Tax Rate (%) <span className="text-red-500">*</span>
            </Label>
            <div className="relative max-w-xs">
              <Input
                id="defaultTaxRate"
                name="defaultTaxRate"
                type="number"
                step="0.0001"
                min="0"
                max="100"
                disabled={!canManageTax || isSubmitting}
                value={defaultTaxRate}
                onChange={(e) => setDefaultTaxRate(e.target.value)}
                placeholder="0.0000"
                className={`pr-8 ${fieldErrors.defaultTaxRate ? "border-red-500" : ""}`}
              />
              <Percent className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-500">
              Percentage rate applied to taxable sales (0.0000% to 100.0000%, up to 4 decimal places).
            </p>
            {fieldErrors.defaultTaxRate && (
              <p className="text-xs text-red-600">{fieldErrors.defaultTaxRate[0]}</p>
            )}
          </div>

          {/* Tax Inclusivity Selection */}
          <div className="space-y-3 pt-2">
            <Label className="font-medium">Tax Mode</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option 1: Tax-Exclusive */}
              <label
                className={`flex flex-col p-4 rounded-lg border cursor-pointer transition-all ${
                  !isTaxInclusive
                    ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-800"
                } ${!canManageTax ? "cursor-not-allowed opacity-80" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="radio"
                    name="isTaxInclusive"
                    checked={!isTaxInclusive}
                    disabled={!canManageTax || isSubmitting}
                    onChange={() => setIsTaxInclusive(false)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-sm">Tax-Exclusive (Added)</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 pl-5">
                  Tax is added on top of product prices at checkout.
                  <br />
                  <span className="font-mono text-[11px] text-gray-500">
                    Example: $100.00 price + 10% tax = $110.00 total charged.
                  </span>
                </p>
              </label>

              {/* Option 2: Tax-Inclusive */}
              <label
                className={`flex flex-col p-4 rounded-lg border cursor-pointer transition-all ${
                  isTaxInclusive
                    ? "border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-800"
                } ${!canManageTax ? "cursor-not-allowed opacity-80" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    type="radio"
                    name="isTaxInclusive"
                    checked={isTaxInclusive}
                    disabled={!canManageTax || isSubmitting}
                    onChange={() => setIsTaxInclusive(true)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-sm">Tax-Inclusive (Built-in)</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 pl-5">
                  Tax is already included in advertised product prices.
                  <br />
                  <span className="font-mono text-[11px] text-gray-500">
                    Example: $100.00 price with 10% tax = $90.91 base + $9.09 tax.
                  </span>
                </p>
              </label>
            </div>
            {fieldErrors.isTaxInclusive && (
              <p className="text-xs text-red-600">{fieldErrors.isTaxInclusive[0]}</p>
            )}
          </div>

          {/* Historical Immutability Guarantee Notice */}
          <div className="flex items-start gap-2.5 rounded-md bg-gray-50 p-3.5 text-xs text-gray-600 dark:bg-gray-800/40 dark:text-gray-400 border border-gray-200 dark:border-gray-800">
            <HelpCircle className="h-4 w-4 shrink-0 text-gray-400 mt-0.5" />
            <div>
              <span className="font-semibold text-gray-700 dark:text-gray-300">
                Historical Immutability Invariant:
              </span>{" "}
              Modifying tax settings strictly affects future checkouts. Completed sales, returns, and thermal receipts permanently retain their original snapshotted tax parameters and audited financial allocations.
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-end gap-3 border-t border-gray-100 dark:border-gray-800 px-6 py-4">
          <Button
            type="submit"
            disabled={!canManageTax || isSubmitting}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {isSubmitting ? "Saving Tax Settings..." : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
