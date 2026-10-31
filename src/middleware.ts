import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

const API_AUTH_ROUTES = ["/api/auth/callback"];

/**
 * Next.js Middleware handling session token refresh and route protection (FR-004, FR-006).
 * Ensures server-side token validation on every request, routing unauthenticated visitors to sign-in
 * and gating unverified users from workspace routes.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Refresh session and retrieve authenticated user using getUser()
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

    // Accessing protected route: redirect to /sign-in preserving return target
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // 3. Authenticated User Handling
  const isEmailVerified = !!user.email_confirmed_at;

  // If user is unverified and attempting to access protected application routes
  if (!isEmailVerified) {
    // Allow verify-email page and sign-out
    if (pathname === "/verify-email" || pathname === "/sign-in") {
      return supabaseResponse;
    }

    // Block from workspace / onboarding routes and guide to /verify-email
    if (!isPublicAuthRoute) {
      return NextResponse.redirect(new URL("/verify-email", request.url));
    }
  }

  // If authenticated and verified user accesses /sign-in or /sign-up, redirect to root
  if (isEmailVerified && (pathname === "/sign-in" || pathname === "/sign-up")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

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

