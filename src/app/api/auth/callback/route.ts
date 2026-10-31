import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sanitizes open redirect parameters to guarantee redirection remains within relative application paths.
 * Protects against open-redirect vectors like //evil.com, javascript:, or CRLF injections.
 */
function sanitizeRedirectUrl(target: string | null): string {
  if (!target) return "/";

  // Strict check: must start with single '/', no protocol relative '//', no schemes ':', no backslashes '\'
  if (
    target.startsWith("/") &&
    !target.startsWith("//") &&
    !target.includes(":") &&
    !target.includes("\\")
  ) {
    return target;
  }

  return "/";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const safeRedirect = sanitizeRedirectUrl(next);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(safeRedirect, request.url));
    }
  }

  // If code exchange failed or was not provided, redirect to sign-in with clear error query
  return NextResponse.redirect(
    new URL("/sign-in?error=auth_callback_failed", request.url)
  );
}

