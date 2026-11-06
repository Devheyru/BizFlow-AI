import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";
import {
  issueRecoveryGrant,
  isRecoverySession,
  getSessionIdFromToken,
  setRecoveryGrantCookie,
} from "@/lib/auth/recovery";
import {
  INVITATION_COOKIE_NAME,
  getPendingInvitationCookie,
  isValidInvitationTokenFormat,
} from "@/lib/auth/invitation-cookie";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const errorParam = requestUrl.searchParams.get("error");
  let safeRedirect = sanitizeRedirectUrl(next);

  // If next target was omitted or defaulted to root, check for pending invitation context
  if (safeRedirect === "/") {
    const cookieToken =
      request.cookies.get(INVITATION_COOKIE_NAME)?.value || (await getPendingInvitationCookie());
    if (cookieToken && isValidInvitationTokenFormat(cookieToken)) {
      safeRedirect = `/invitations/accept?token=${encodeURIComponent(cookieToken.trim())}`;
    }
  }

  // If GoTrue returned an error query parameter (e.g. otp_expired, link already used)
  if (errorParam) {
    if (safeRedirect === "/reset-password") {
      return NextResponse.redirect(
        new URL("/reset-password?error=" + encodeURIComponent(errorParam), request.url)
      );
    }
    return NextResponse.redirect(
      new URL("/sign-in?error=" + encodeURIComponent(errorParam), request.url)
    );
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session && data.user) {
      const isRecovery = safeRedirect === "/reset-password" && isRecoverySession(data.session);
      const response = NextResponse.redirect(new URL(safeRedirect, request.url));

      if (isRecovery) {
        const sessionId = getSessionIdFromToken(data.session) || data.session.user.id;
        const { grantToken, error: grantError } = await issueRecoveryGrant(
          supabase,
          data.user.id,
          sessionId
        );
        if (grantError || !grantToken) {
          console.error("[auth/callback] Failed to issue recovery grant:", grantError);
          return NextResponse.redirect(
            new URL("/reset-password?error=grant_creation_failed", request.url)
          );
        }
        setRecoveryGrantCookie(response, grantToken);
      }

      return response;
    }

    // Code exchange failed (e.g. expired or already used code)
    if (safeRedirect === "/reset-password") {
      return NextResponse.redirect(
        new URL("/reset-password?error=invalid_or_expired", request.url)
      );
    }
  }

  // If code exchange failed or was not provided, redirect to sign-in with clear error query
  return NextResponse.redirect(
    new URL("/sign-in?error=auth_callback_failed", request.url)
  );
}
