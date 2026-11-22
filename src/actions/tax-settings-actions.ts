"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { updateTaxSettingsSchema } from "@/lib/validations/sales";
import { mapSalesError } from "@/lib/sales/error-codes";
import type { ActionResult } from "@/types/auth";
import type { TaxSettings } from "@/types/sales";

interface UpdateTaxSettingsRpcResponse {
  success: boolean;
  organization_id: string;
  tax_name: string;
  default_tax_rate: string | number;
  is_tax_inclusive: boolean;
  updated_at: string;
}

/**
 * Server action to update organization tax configuration (T058, US5, US8).
 * - Enforces canonical tenant resolution via resolveTenantContext(slug).
 * - Enforces `tax_settings:update` permission (restricted to Owner and Admin).
 * - Validates input with updateTaxSettingsSchema.
 * - Invokes public.update_tax_settings SECURITY DEFINER RPC.
 * - Revalidates settings and POS routes upon success.
 */
export async function updateTaxSettingsAction(
  slug: string,
  rawInput: unknown
): Promise<ActionResult<TaxSettings>> {
  try {
    // 1. Authoritative Server-Side Tenant Resolution
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: {
          code: tenantRes.error.toUpperCase(),
          message: "Organization not found or access denied.",
        },
      };
    }
    const { context } = tenantRes;

    // 2. Application Permission Guard (tax_settings:update)
    if (!hasPermission(context, "tax_settings:update")) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions to update tax settings.",
        },
      };
    }

    // 3. Input Validation via Zod
    const parsed = updateTaxSettingsSchema.safeParse(rawInput);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            flattened.formErrors[0] ||
            Object.values(flattened.fieldErrors)[0]?.[0] ||
            "Invalid tax settings input.",
          details: flattened.fieldErrors,
        },
      };
    }

    // 4. Invoke Database RPC via Authenticated Supabase Client
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_tax_settings", {
      p_org_id: context.organization.id,
      p_tax_name: parsed.data.taxName,
      p_default_tax_rate: parsed.data.defaultTaxRate,
      p_is_tax_inclusive: parsed.data.isTaxInclusive,
    });

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    const rpcResult = data as unknown as UpdateTaxSettingsRpcResponse;

    // 5. Revalidate impacted routes
    revalidatePath(`/${slug}/settings`);
    revalidatePath(`/${slug}/settings/tax`);
    revalidatePath(`/${slug}/pos`);

    return {
      success: true,
      data: {
        organizationId: context.organization.id,
        taxName: rpcResult.tax_name,
        defaultTaxRate: Number(rpcResult.default_tax_rate),
        isTaxInclusive: Boolean(rpcResult.is_tax_inclusive),
        updatedAt: rpcResult.updated_at,
        updatedBy: context.user.id,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}

/**
 * Server action to retrieve the active organization's tax settings (T058, US5, US8).
 * - Enforces canonical tenant resolution via resolveTenantContext(slug).
 * - Accessible to active organization members (or sales:read holders).
 * - Retrieves record from public.organization_tax_settings.
 */
export async function getTaxSettingsAction(
  slug: string
): Promise<ActionResult<TaxSettings | null>> {
  try {
    // 1. Authoritative Server-Side Tenant Resolution
    const tenantRes = await resolveTenantContext(slug);
    if (!tenantRes.ok) {
      return {
        success: false,
        error: {
          code: tenantRes.error.toUpperCase(),
          message: "Organization not found or access denied.",
        },
      };
    }
    const { context } = tenantRes;

    // 2. Read Authorization: any active member or sales:read
    if (context.membership.status !== "active") {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Active organization membership required.",
        },
      };
    }

    // 3. Query PostgREST
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_tax_settings")
      .select("organization_id, tax_name, default_tax_rate, is_tax_inclusive, updated_at, updated_by")
      .eq("organization_id", context.organization.id)
      .maybeSingle();

    if (error) {
      return {
        success: false,
        error: mapSalesError(error),
      };
    }

    if (!data) {
      return {
        success: true,
        data: null,
      };
    }

    return {
      success: true,
      data: {
        organizationId: data.organization_id,
        taxName: data.tax_name,
        defaultTaxRate: Number(data.default_tax_rate),
        isTaxInclusive: Boolean(data.is_tax_inclusive),
        updatedAt: data.updated_at,
        updatedBy: data.updated_by,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: mapSalesError(err),
    };
  }
}
