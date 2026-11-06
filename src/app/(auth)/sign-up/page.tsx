import React from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/SignUpForm";
import {
  extractInvitationToken,
  getPendingInvitationCookie,
  isValidInvitationTokenFormat,
} from "@/lib/auth/invitation-cookie";

export const metadata: Metadata = {
  title: "Create Account | BizFlow AI",
  description: "Register your BizFlow AI account to manage retail inventory and POS operations.",
};

export default async function SignUpPage(props: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const searchParams = await props.searchParams;

  let token: string | undefined;

  // 1. Check direct query token
  if (isValidInvitationTokenFormat(searchParams?.token)) {
    token = searchParams.token.trim();
  } else if (searchParams?.next) {
    // 2. Extract token from next redirect target if present
    const extracted = extractInvitationToken(searchParams.next);
    if (extracted) {
      token = extracted;
    }
  }

  // 3. Fallback to pending invitation cookie
  if (!token) {
    const cookieToken = await getPendingInvitationCookie();
    if (cookieToken) {
      token = cookieToken;
    }
  }

  return <SignUpForm invitationToken={token} />;
}
