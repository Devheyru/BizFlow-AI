import React, { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmailCard } from "@/components/auth/VerifyEmailCard";

export const metadata: Metadata = {
  title: "Verify Email | BizFlow AI",
  description: "Verify your email address to access your BizFlow AI workspace.",
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}>
      <VerifyEmailCard />
    </Suspense>
  );
}

