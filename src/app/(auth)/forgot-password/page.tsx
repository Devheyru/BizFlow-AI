import React, { Suspense } from "react";
import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot Password | BizFlow AI",
  description: "Request a password reset link for your BizFlow AI account.",
};

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="h-64 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}

