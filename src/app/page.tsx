import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ShieldCheck, ArrowRight, Store, Zap } from "lucide-react";
import { createClient, getSafeCookieStore } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    if (!user.email_confirmed_at) {
      redirect("/verify-email");
    }

    // Check organizations with deterministic ordering (oldest active membership first)
    const { data: memberships, error: memError } = await supabase
      .from("organization_memberships")
      .select("organization_id, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (memError || !memberships || memberships.length === 0) {
      redirect("/onboarding/create-organization");
    }

    const orderedOrgIds = Array.from(new Set(memberships.map((m) => m.organization_id)));
    let activeOrgs: Array<{ id: string; slug: string }> = [];

    if (orderedOrgIds.length > 0) {
      const { data: orgs, error: orgError } = await supabase
        .from("organizations")
        .select("id, slug, created_at")
        .in("id", orderedOrgIds)
        .eq("is_active", true);

      if (!orgError && orgs) {
        const orgMap = new Map(orgs.map((o) => [o.id, o]));
        activeOrgs = orderedOrgIds
          .map((id) => orgMap.get(id))
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map((o) => ({ id: o.id, slug: o.slug }));
      }
    }

    const fallbackOrg = activeOrgs[0];
    if (!fallbackOrg || activeOrgs.length === 0) {
      redirect("/onboarding/create-organization");
    }

    const cookieStore = await getSafeCookieStore();
    const preferredSlug = cookieStore.get("bizflow_active_org")?.value;
    const chosen =
      (preferredSlug ? activeOrgs.find((o) => o.slug === preferredSlug) : null) || fallbackOrg;

    redirect(`/${chosen.slug}/dashboard`);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-950">
      <header className="border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-xl text-gray-900 dark:text-gray-100">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Building2 className="h-5 w-5" />
          </div>
          <span>BizFlow AI</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button>Get Started</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 mb-6">
          <ShieldCheck className="h-4 w-4" /> Multi-Tenant Retail Cloud Engine
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100 leading-tight">
          Modern Retail Management, <br />
          <span className="text-blue-600">Powered by Autonomous AI</span>
        </h1>

        <p className="mt-6 text-lg text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
          From multi-tenant point-of-sale and atomic stock movements to automated auditing
          and multi-store management. Built with PostgreSQL Row-Level Security.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
          <Link href="/sign-up">
            <Button size="lg" className="gap-2">
              Start Free Trial <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline">
              Sign In to Store
            </Button>
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 w-full text-left">
          <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <Store className="h-6 w-6 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Multi-Tenancy</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              PostgreSQL Row-Level Security guarantees strict data isolation across independent organizations.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <ShieldCheck className="h-6 w-6 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Audit & Security</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Atomic owner protections, restricted lifecycle fields, and immutable audit event logging.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <Zap className="h-6 w-6 text-blue-600 mb-3" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Real-Time Sync</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Live inventory tracking and offline-resilient cashier POS powered by Supabase.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 dark:border-gray-800 py-6 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} BizFlow AI. All rights reserved.
      </footer>
    </div>
  );
}
