/**
 * Sanitizes redirect target URLs to ensure navigation remains strictly within relative application paths.
 * Defends against open-redirect vulnerabilities including:
 * - Full external URLs (e.g., https://evil.com)
 * - Protocol-relative URLs (e.g., //evil.com, ///evil.com)
 * - Backslash evasion / scheme tricks (e.g., /\evil.com, /\\evil.com)
 * - Non-HTTP schemes (e.g., javascript:, data:)
 * - CRLF injection vectors
 */
export function sanitizeRedirectUrl(target: string | null | undefined, fallback = "/"): string {
  if (!target || typeof target !== "string") {
    return fallback;
  }

  const trimmed = target.trim();

  // Strict check: must start with single '/', and must not start with '//' or '/\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  try {
    // Parse against a fixed dummy origin to validate the URL structure
    const parsed = new URL(trimmed, "http://localhost");

    // Ensure the host and origin remain strictly local to prevent origin manipulation
    if (parsed.host !== "localhost" || parsed.origin !== "http://localhost") {
      return fallback;
    }

    // Return the safe relative path (pathname + search + hash)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

