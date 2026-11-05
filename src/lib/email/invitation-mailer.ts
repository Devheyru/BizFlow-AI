/**
 * Decoupled Transactional Invitation Mailer (T025, FR-015)
 *
 * Dispatches invitation emails asynchronously outside database transactions via Resend REST API.
 * Catches delivery errors gracefully so the database transaction is never rolled back,
 * returning a structured result so the caller can return a partial warning to the user.
 */

import { getSafeMailerConfig } from "@/lib/env";

export interface SendInvitationEmailParams {
  recipientEmail: string;
  organizationName: string;
  inviterName?: string;
  role: string;
  invitationUrl: string;
}

export interface SendInvitationEmailResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  messageId?: string;
}

export interface UrlInspectionResult {
  valid: boolean;
  errorCode?: string;
  reason?: string;
}

/**
 * Escapes dynamic content for safe HTML insertion to prevent injection attacks.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Sanitizes error messages to prevent leaking API keys, bearer tokens, sensitive URL params, or emails.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/re_[a-zA-Z0-9_]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/[?&]token=[^&\s]+/gi, "?token=[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
}

export type BaseUrlResolutionResult =
  | { success: true; origin: string }
  | { success: false; errorCode: string; error: string };

/**
 * Resolves and validates the application base URL origin.
 * Enforces production security invariants:
 * - Production requires a non-empty NEXT_PUBLIC_APP_URL
 * - Production strictly requires HTTPS protocol (no localhost fallback, no HTTP)
 * - Development allows http: (including localhost) or https:
 * - Safely normalizes trailing slashes to origin
 * - Ensures explicitly supplied base URLs cannot bypass production HTTPS requirements
 */
export function resolveApplicationBaseUrl(
  baseAppUrl?: string,
  nodeEnv?: string
): BaseUrlResolutionResult {
  const isProduction = (nodeEnv ?? process.env.NODE_ENV) === "production";
  const rawInput = baseAppUrl?.trim();
  const rawEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();

  let candidate: string | undefined;
  if (rawInput) {
    candidate = rawInput;
  } else if (rawEnv) {
    candidate = rawEnv;
  } else if (!isProduction) {
    candidate = "http://localhost:3000";
  } else {
    return {
      success: false,
      errorCode: "PREFLIGHT_APP_BASE_URL_MISSING",
      error: "NEXT_PUBLIC_APP_URL is required in production",
    };
  }

  if (!candidate || candidate.length === 0) {
    return {
      success: false,
      errorCode: "PREFLIGHT_APP_BASE_URL_MISSING",
      error: isProduction
        ? "NEXT_PUBLIC_APP_URL is required in production"
        : "Application base URL cannot be empty",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      success: false,
      errorCode: "PREFLIGHT_APP_BASE_URL_INVALID",
      error: `Invalid application base URL: "${candidate}" is not a valid absolute URL`,
    };
  }

  if (isProduction) {
    if (parsed.protocol !== "https:") {
      return {
        success: false,
        errorCode: "PREFLIGHT_APP_BASE_URL_NON_HTTPS",
        error: `Invalid application base URL protocol: "${parsed.protocol}" (production requires https:)`,
      };
    }
  } else {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        success: false,
        errorCode: "PREFLIGHT_APP_BASE_URL_INVALID_PROTOCOL",
        error: `Invalid application base URL protocol: "${parsed.protocol}" (must be http: or https:)`,
      };
    }
  }

  return { success: true, origin: parsed.origin };
}

/**
 * Constructs a normalized invitation URL using the JavaScript URL API.
 * Ensures the target route is strictly `/invitations/accept` with the `token` search parameter.
 * Enforces production HTTPS and origin rules.
 */
export function buildInvitationUrl(rawToken: string, baseAppUrl?: string): string {
  const token = rawToken?.trim();
  if (!token) {
    throw new Error("Invitation token cannot be empty");
  }

  const baseResult = resolveApplicationBaseUrl(baseAppUrl);
  if (!baseResult.success) {
    throw new Error(baseResult.error);
  }

  // Construct /invitations/accept on the validated origin
  const invitationUrl = new URL("/invitations/accept", baseResult.origin);
  invitationUrl.searchParams.set("token", token);

  return invitationUrl.toString();
}

/**
 * Inspects an invitation URL against strict security criteria:
 * - Absolute URL with valid protocol (strictly HTTPS in production)
 * - Exact origin matching configured application base URL (safely handling trailing slashes)
 * - Exact /invitations/accept pathname (normalizing redundant slashes)
 * - Non-empty token search parameter
 */
export function inspectInvitationUrl(urlStr: string, expectedAppUrl?: string): UrlInspectionResult {
  if (!urlStr || typeof urlStr !== "string" || urlStr.trim().length === 0) {
    return { valid: false, errorCode: "PREFLIGHT_MISSING_INVITATION_URL", reason: "Invitation URL is required" };
  }

  const isProduction = process.env.NODE_ENV === "production";

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlStr.trim());
  } catch {
    return { valid: false, errorCode: "PREFLIGHT_URL_MALFORMED", reason: "Invitation URL is not a valid absolute URL" };
  }

  if (isProduction) {
    if (parsedUrl.protocol !== "https:") {
      return {
        valid: false,
        errorCode: "PREFLIGHT_URL_NON_HTTPS",
        reason: `Invalid URL protocol: "${parsedUrl.protocol}" (production requires https:)`,
      };
    }
  } else {
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        valid: false,
        errorCode: "PREFLIGHT_URL_INVALID_PROTOCOL",
        reason: `Invalid URL protocol: "${parsedUrl.protocol}" (must be http: or https:)`,
      };
    }
  }

  const baseResult = resolveApplicationBaseUrl(expectedAppUrl);
  if (!baseResult.success) {
    return {
      valid: false,
      errorCode: baseResult.errorCode,
      reason: baseResult.error,
    };
  }

  if (parsedUrl.origin !== baseResult.origin) {
    return {
      valid: false,
      errorCode: "PREFLIGHT_URL_UNTRUSTED_ORIGIN",
      reason: "Invitation URL origin does not match trusted application origin",
    };
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+/g, "/");
  if (normalizedPath !== "/invitations/accept") {
    return {
      valid: false,
      errorCode: "PREFLIGHT_URL_INVALID_PATHNAME",
      reason: "Invitation URL pathname must be /invitations/accept",
    };
  }

  const token = parsedUrl.searchParams.get("token");
  if (!token || token.trim().length === 0) {
    return {
      valid: false,
      errorCode: "PREFLIGHT_URL_MISSING_TOKEN",
      reason: "Invitation URL is missing token parameter",
    };
  }

  return { valid: true };
}

/**
 * Validates that the invitation URL origin strictly matches the configured application origin.
 */
export function validateInvitationUrl(urlStr: string, expectedAppUrl?: string): boolean {
  return inspectInvitationUrl(urlStr, expectedAppUrl).valid;
}

/**
 * Dispatches an employee invitation email using the Resend REST API.
 */
export async function sendInvitationEmail(
  params: SendInvitationEmailParams
): Promise<SendInvitationEmailResult> {
  try {
    if (!params.recipientEmail || params.recipientEmail.trim().length === 0) {
      const diagnosticCode = "PREFLIGHT_MISSING_RECIPIENT_EMAIL";
      const errorMsg = "Recipient email and invitation URL are required";
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${errorMsg}`);
      return { success: false, error: errorMsg, errorCode: diagnosticCode };
    }

    if (!params.invitationUrl || params.invitationUrl.trim().length === 0) {
      const diagnosticCode = "PREFLIGHT_MISSING_INVITATION_URL";
      const errorMsg = "Recipient email and invitation URL are required";
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${errorMsg}`);
      return { success: false, error: errorMsg, errorCode: diagnosticCode };
    }

    // Practical recipient email format check
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(params.recipientEmail.trim())) {
      const diagnosticCode = "PREFLIGHT_INVALID_RECIPIENT_EMAIL";
      const errorMsg = "Invalid recipient email address";
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${errorMsg}`);
      return { success: false, error: errorMsg, errorCode: diagnosticCode };
    }

    // Origin and format verification for invitation link
    const urlInspection = inspectInvitationUrl(params.invitationUrl);
    if (!urlInspection.valid) {
      const diagnosticCode = urlInspection.errorCode || "PREFLIGHT_INVALID_INVITATION_URL";
      const errorMsg = "Invalid invitation URL or untrusted origin";
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${errorMsg}`);
      return { success: false, error: errorMsg, errorCode: diagnosticCode };
    }

    // Environment configuration validation
    const mailerConfig = getSafeMailerConfig();
    if (!mailerConfig.success) {
      console.error(`[INVITATION EMAIL] Delivery failed [${mailerConfig.errorCode}]: ${mailerConfig.error}`);
      return { success: false, error: mailerConfig.error, errorCode: mailerConfig.errorCode };
    }

    const { apiKey, emailFrom } = mailerConfig;

    const subject = `You're invited to join ${params.organizationName} on BizFlow AI`;

    const textContent = `You have been invited to join ${params.organizationName} as a ${params.role} on BizFlow AI.

To accept this invitation and access your workspace, please visit the following link:
${params.invitationUrl}

This invitation link is valid for 7 days. If you did not expect this invitation, you can safely ignore this email.`;

    const escapedOrg = escapeHtml(params.organizationName);
    const escapedRole = escapeHtml(params.role);
    const escapedUrl = escapeHtml(params.invitationUrl);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to join ${escapedOrg}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1f2937; margin: 0; padding: 24px; background-color: #f9fafb;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
    <h2 style="color: #111827; margin-top: 0; font-size: 20px; font-weight: 600;">You're invited to join ${escapedOrg}</h2>
    <p style="color: #4b5563; font-size: 15px;">
      You have been invited to join <strong>${escapedOrg}</strong> as a <strong>${escapedRole}</strong> on BizFlow AI.
    </p>
    <div style="margin: 28px 0; text-align: center;">
      <a href="${escapedUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; font-size: 15px; font-weight: 500; text-decoration: none; border-radius: 6px; display: inline-block;">
        Accept Invitation
      </a>
    </div>
    <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">
      Or copy and paste this link into your browser:<br>
      <span style="color: #2563eb; word-break: break-all;">${escapedUrl}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      This invitation link is valid for 7 days. If you did not expect this invitation, you can safely ignore this email.
    </p>
  </div>
 </body>
</html>`;

    const resendEndpoint = "https://api.resend.com/emails";
    const response = await fetch(resendEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [params.recipientEmail.trim()],
        subject,
        text: textContent,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      let providerErrorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody && typeof errBody === "object") {
          if (typeof errBody.message === "string") {
            providerErrorMsg = errBody.message;
          } else if (typeof errBody.error === "string") {
            providerErrorMsg = errBody.error;
          } else if (errBody.error && typeof errBody.error.message === "string") {
            providerErrorMsg = errBody.error.message;
          }
        }
      } catch {
        // Non-JSON response
      }

      const sanitizedError = sanitizeErrorMessage(providerErrorMsg);
      const diagnosticCode = `PROVIDER_HTTP_${response.status}`;
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: Status ${response.status} - ${sanitizedError}`);
      return { success: false, error: sanitizedError, errorCode: diagnosticCode };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!data || typeof data !== "object" || !data.id || typeof data.id !== "string") {
      const diagnosticCode = "PROVIDER_INVALID_RESPONSE_FORMAT";
      const errorMsg = "Invalid provider response format";
      console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${errorMsg}`);
      return { success: false, error: errorMsg, errorCode: diagnosticCode };
    }

    if (process.env.NODE_ENV !== "test") {
      console.log(`[INVITATION EMAIL] Dispatched via Resend (ID: ${data.id})`);
    }

    return { success: true, messageId: data.id };
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Network error during email dispatch";
    const sanitizedError = sanitizeErrorMessage(rawMessage);
    const diagnosticCode = "NETWORK_DISPATCH_ERROR";
    console.error(`[INVITATION EMAIL] Delivery failed [${diagnosticCode}]: ${sanitizedError}`);
    return { success: false, error: sanitizedError, errorCode: diagnosticCode };
  }
}
