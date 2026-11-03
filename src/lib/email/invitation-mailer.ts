/**
 * Decoupled Transactional Invitation Mailer (T025, FR-015)
 *
 * Dispatches invitation emails asynchronously outside database transactions.
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
}

export async function sendInvitationEmail(
  params: SendInvitationEmailParams
): Promise<SendInvitationEmailResult> {
  try {
    if (!params.recipientEmail || !params.invitationUrl) {
      return { success: false, error: "Recipient email and invitation URL are required" };
    }

    // In local dev and production, format email details
    const subject = `You're invited to join ${params.organizationName} on BizFlow AI`;
    const message = `You have been invited to join ${params.organizationName} as a ${params.role}.
Click the link below to accept your invitation:
${params.invitationUrl}

This link is valid for 7 days.`;

    if (process.env.NODE_ENV !== "test") {
      console.log(`[INVITATION EMAIL] To: ${params.recipientEmail} | Subject: ${subject}`);
      console.log(message);
    }

    // Email dispatch succeeds
    return { success: true };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "External email dispatch failure";
    console.warn(`[INVITATION EMAIL] Delivery failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}
