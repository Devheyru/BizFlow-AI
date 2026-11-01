import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";

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
