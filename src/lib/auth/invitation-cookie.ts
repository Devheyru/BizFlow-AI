import { type CookieOptions } from "@supabase/ssr";
import { getSafeCookieStore } from "@/lib/supabase/server";

export const INVITATION_COOKIE_NAME = "bizflow_invitation_token";

export const INVITATION_COOKIE_OPTIONS: CookieOptions = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 60 * 60 * 2, // 2 hours
};

/**
 * Validates that an invitation token matches the required 64-character hex format.
 */
export function isValidInvitationTokenFormat(token: unknown): token is string {
  if (typeof token !== "string") return false;
  return /^[a-f0-9]{64}$/.test(token.trim());
}

/**
 * Extracts a valid 64-character hex invitation token from a URL string or path with query params.
 */
export function extractInvitationToken(target: string | null | undefined): string | null {
  if (!target || typeof target !== "string") return null;

  try {
    const parsed = new URL(target, "http://localhost");
    const directToken = parsed.searchParams.get("token");
    if (isValidInvitationTokenFormat(directToken)) {
      return directToken.trim();
    }

    // Check nested query parameters (e.g. ?next=/invitations/accept?token=...)
    for (const [, paramValue] of parsed.searchParams.entries()) {
      if (/^[a-f0-9]{64}$/.test(paramValue.trim())) {
        return paramValue.trim();
      }
      if (paramValue.includes("token")) {
        const nestedToken = extractInvitationToken(paramValue);
        if (nestedToken) return nestedToken;
      }
    }
  } catch {
    // URL parsing failed; proceed to decoded regex check
  }

  try {
    const decoded = decodeURIComponent(target);
    const match = decoded.match(/[?&]token=([a-f0-9]{64})(?:&|$)/i);
    if (match && match[1] && isValidInvitationTokenFormat(match[1])) {
      return match[1].toLowerCase();
    }
  } catch {
    // Ignore decoding errors
  }

  return null;
}

/**
 * Persists the pending invitation token into an HTTP-only, secure, short-lived cookie.
 */
export async function setPendingInvitationCookie(token: string): Promise<void> {
  if (!isValidInvitationTokenFormat(token)) return;

  const cookieStore = await getSafeCookieStore();
  cookieStore.set(INVITATION_COOKIE_NAME, token.trim(), INVITATION_COOKIE_OPTIONS);
}

/**
 * Retrieves and validates the pending invitation token from the request cookies.
 * Returns null if missing or malformed.
 */
export async function getPendingInvitationCookie(): Promise<string | null> {
  try {
    const cookieStore = await getSafeCookieStore();
    const cookie = cookieStore.get(INVITATION_COOKIE_NAME);
    if (!cookie?.value) return null;

    const trimmed = cookie.value.trim();
    if (isValidInvitationTokenFormat(trimmed)) {
      return trimmed;
    }
    try {
      cookieStore.delete(INVITATION_COOKIE_NAME);
    } catch {
      // Delete may be disallowed in read-only render phases
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clears the pending invitation token cookie upon acceptance, decline, or terminal failure.
 */
export async function clearPendingInvitationCookie(): Promise<void> {
  try {
    const cookieStore = await getSafeCookieStore();
    cookieStore.delete(INVITATION_COOKIE_NAME);
  } catch {
    // Ignore cookie deletion errors in non-standard request contexts
  }
}
