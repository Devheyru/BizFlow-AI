import React, { Suspense } from "react";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/SignInForm";

export const metadata: Metadata = {
  title: "Sign In | BizFlow AI",
  description: "Sign in to your BizFlow AI account to manage retail inventory and POS operations.",
};

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}>
      <SignInForm />
    </Suspense>
  );
}

