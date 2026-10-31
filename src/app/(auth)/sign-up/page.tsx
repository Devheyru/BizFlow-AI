import React from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = {
  title: "Create Account | BizFlow AI",
  description: "Register your BizFlow AI account to manage retail inventory and POS operations.",
};

export default async function SignUpPage(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  const searchParams = await props.searchParams;
  return <SignUpForm invitationToken={searchParams?.token} />;
}

