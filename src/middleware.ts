import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect";

const PUBLIC_AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

const API_AUTH_ROUTES = ["/api/auth/callback"];

/**
 * Next.js Middleware handling session token refresh and route protection (FR-004, FR-006, T037).
 *
 * Responsibilities:
 * - Refreshes Supabase session tokens on incoming requests.
 * - Gates unauthenticated visitors attempting to access protected routes, preserving safe return URLs.
 * - Gates unverified users, guiding them to `/verify-email`.
 * - Redirects authenticated verified users away from auth routes (`/sign-in`, `/sign-up`) to `/`.
 *
 * NOTE: Middleware is NOT the final authorization boundary. It does not perform tenant membership
 * checks or trust client-supplied tenant cookies/slugs. Tenant authorization is strictly enforced
 * server-side via `getTenantContext()` and database PostgreSQL Row-Level Security.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Refresh session and retrieve authenticated user using getUser() (FR-004)
  const { supabaseResponse, user } = await updateSession(request);

  const isPublicAuthRoute = PUBLIC_AUTH_ROUTES.some((route) => pathname.startsWith(route));
  const isApiAuthRoute = API_AUTH_ROUTES.some((route) => pathname.startsWith(route));

  // Allow API auth callbacks unconditionally
  if (isApiAuthRoute) {
    return supabaseResponse;
  }

  // 2. Unauthenticated Visitor Handling
  if (!user) {
    // If accessing root or public auth routes, allow
    if (isPublicAuthRoute || pathname === "/") {
      return supabaseResponse;
    }

    // Accessing protected workspace or onboarding route: redirect to /sign-in with safe next param
    const safeNext = sanitizeRedirectUrl(pathname + request.nextUrl.search, "/");
    const signInUrl = new URL("/sign-in", request.url);
    if (safeNext !== "/") {
      signInUrl.searchParams.set("next", safeNext);
    }
    return NextResponse.redirect(signInUrl);
  }

  // 3. Authenticated User Handling
  const isEmailVerified = !!user.email_confirmed_at;

  // If user is unverified and attempting to access protected application routes
  if (!isEmailVerified) {
    // Allow verify-email page and public auth routes
    if (pathname === "/verify-email" || isPublicAuthRoute) {
      return supabaseResponse;
    }

    // Block from workspace / onboarding routes and guide to /verify-email
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  // If authenticated and verified user accesses /sign-in or /sign-up, redirect to root
  if (isEmailVerified && (pathname === "/sign-in" || pathname === "/sign-up")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Allow request to proceed to server components where getTenantContext()
  // and PostgreSQL Row-Level Security enforce strict tenant authorization.
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images and static assets (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
