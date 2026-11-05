/**
 * Decoupled Transactional Invitation Mailer (T025, FR-015)
 *
 * Dispatches invitation emails asynchronously outside database transactions via Resend REST API.
 * Catches delivery errors gracefully so the database transaction is never rolled back,
 * returning a structured result so the caller can return a partial warning to the user.
 */

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
  messageId?: string;
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
 * Sanitizes error messages to prevent leaking API keys, bearer tokens, or sensitive URL params.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/re_[a-zA-Z0-9_]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/[?&]token=[a-f0-9]+/gi, "?token=[REDACTED]");
}

/**
 * Validates that the invitation URL origin strictly matches the configured application origin.
 */
export function validateInvitationUrl(urlStr: string): boolean {
  try {
    const parsedUrl = new URL(urlStr);
    const appUrlStr = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const expectedOrigin = new URL(appUrlStr).origin;

    if (parsedUrl.origin !== expectedOrigin) {
      return false;
    }

    if (parsedUrl.pathname !== "/invitations/accept") {
      return false;
    }

    const token = parsedUrl.searchParams.get("token");
    if (!token || token.trim().length === 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Dispatches an employee invitation email using the Resend REST API.
 */
export async function sendInvitationEmail(
  params: SendInvitationEmailParams
): Promise<SendInvitationEmailResult> {
  try {
    if (!params.recipientEmail || !params.invitationUrl) {
      return { success: false, error: "Recipient email and invitation URL are required" };
    }

    // Practical recipient email format check
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(params.recipientEmail.trim())) {
      return { success: false, error: "Invalid recipient email address" };
    }

    // Origin and format verification for invitation link
    if (!validateInvitationUrl(params.invitationUrl)) {
      return { success: false, error: "Invalid invitation URL or untrusted origin" };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const emailFrom = process.env.EMAIL_FROM?.trim();
    const isProduction = process.env.NODE_ENV === "production";

    if (!apiKey) {
      const errorMsg = isProduction
        ? "Missing RESEND_API_KEY in production"
        : "RESEND_API_KEY is not configured";
      if (isProduction) {
        console.error(`[INVITATION EMAIL] Delivery failed: ${errorMsg}`);
      }
      return { success: false, error: errorMsg };
    }

    if (!emailFrom) {
      const errorMsg = isProduction
        ? "Missing EMAIL_FROM in production"
        : "EMAIL_FROM is not configured";
      if (isProduction) {
        console.error(`[INVITATION EMAIL] Delivery failed: ${errorMsg}`);
      }
      return { success: false, error: errorMsg };
    }

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
      console.warn(`[INVITATION EMAIL] Delivery failed: Provider rejected request (status: ${response.status})`);
      return { success: false, error: sanitizedError };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!data || typeof data !== "object" || !data.id || typeof data.id !== "string") {
      console.warn("[INVITATION EMAIL] Delivery failed: Invalid response format from Resend");
      return { success: false, error: "Invalid provider response format" };
    }

    if (process.env.NODE_ENV !== "test") {
      console.log(`[INVITATION EMAIL] Dispatched to ${params.recipientEmail} via Resend (ID: ${data.id})`);
    }

    return { success: true, messageId: data.id };
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Network error during email dispatch";
    const sanitizedError = sanitizeErrorMessage(rawMessage);
    console.warn(`[INVITATION EMAIL] Delivery failed: ${sanitizedError}`);
    return { success: false, error: sanitizedError };
  }
}
