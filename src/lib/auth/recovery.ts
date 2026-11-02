import { createHmac, createHash, timingSafeEqual, randomBytes } from "crypto";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { getSafeCookieStore } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const RECOVERY_COOKIE_NAME = "bizflow_recovery_grant";
export const RECOVERY_GRANT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface RecoveryGrantPayload {
  userId: string;
  sessionId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type RecoveryVerificationResult =
  | { success: true; payload: RecoveryGrantPayload }
  | { success: false; reason: "missing" | "invalid" | "expired" | "unauthorized" };

function getSigningSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error("Server secret for recovery grant signing is not configured.");
  }
  return secret;
}

/**
 * Generates SHA-256 hash of recovery nonce for storage and atomic consumption.
 */
export function hashRecoveryNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/**
 * Creates an HMAC-SHA256 signed recovery grant token.
 */
export function createRecoveryGrant(
  userId: string,
  sessionId: string,
  customTtlMs?: number
): string {
  const issuedAt = Date.now();
  const ttl = customTtlMs ?? RECOVERY_GRANT_TTL_MS;
  const expiresAt = issuedAt + ttl;
  const nonce = randomBytes(16).toString("hex");

  const payload: RecoveryGrantPayload = {
    userId,
    sessionId,
    nonce,
    issuedAt,
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSigningSecret())
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Records a recovery grant in PostgreSQL to track server-side nonce validity.
 */
export async function recordRecoveryGrant(
  supabase: SupabaseClient<Database>,
  params: {
    sessionId: string;
    nonce: string;
    expiresAt: number;
    userId?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const nonceHash = hashRecoveryNonce(params.nonce);
  const expiresAtIso = new Date(params.expiresAt).toISOString();

  const { error } = await supabase.rpc("create_recovery_grant", {
    p_session_id: params.sessionId,
    p_nonce_hash: nonceHash,
    p_expires_at: expiresAtIso,
    p_user_id: params.userId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Issues a recovery grant: creates HMAC token and records nonce in PostgreSQL.
 */
export async function issueRecoveryGrant(
  supabase: SupabaseClient<Database>,
  userId: string,
  sessionId: string,
  customTtlMs?: number
): Promise<{ grantToken: string; payload: RecoveryGrantPayload; error?: string }> {
  const grantToken = createRecoveryGrant(userId, sessionId, customTtlMs);
  const verification = verifyRecoveryGrant(grantToken);
  if (!verification.success) {
    throw new Error("Failed to verify freshly created recovery grant");
  }

  const recordResult = await recordRecoveryGrant(supabase, {
    sessionId,
    nonce: verification.payload.nonce,
    expiresAt: verification.payload.expiresAt,
    userId,
  });

  if (!recordResult.success) {
    return {
      grantToken,
      payload: verification.payload,
      error: recordResult.error,
    };
  }

  return { grantToken, payload: verification.payload };
}

/**
 * Verifies an HMAC-SHA256 signed recovery grant token locally.
 */
export function verifyRecoveryGrant(
  token: string | undefined | null
): RecoveryVerificationResult {
  if (!token) {
    return { success: false, reason: "missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { success: false, reason: "invalid" };
  }

  const payloadB64 = parts[0];
  const signature = parts[1];
  if (!payloadB64 || !signature) {
    return { success: false, reason: "invalid" };
  }

  try {
    const expectedSig = createHmac("sha256", getSigningSecret())
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { success: false, reason: "invalid" };
    }

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as RecoveryGrantPayload;

    if (!payload.userId || !payload.sessionId || !payload.nonce || !payload.expiresAt) {
      return { success: false, reason: "invalid" };
    }

    if (Date.now() > payload.expiresAt) {
      return { success: false, reason: "expired" };
    }

    return { success: true, payload };
  } catch {
    return { success: false, reason: "invalid" };
  }
}

/**
 * Checks whether a Supabase session was established via a recovery flow.
 * Inspects the AMR (Authentication Method Reference) claim inside the session access token.
 */
export function isRecoverySession(session: Session | null | undefined): boolean {
  if (!session?.access_token) {
    return false;
  }

  try {
    const parts = session.access_token.split(".");
    const tokenPart = parts[1];
    if (!tokenPart) return false;
    const payload = JSON.parse(Buffer.from(tokenPart, "base64").toString("utf8"));
    const amr = payload.amr;
    if (Array.isArray(amr)) {
      return amr.some((entry: { method?: string }) => entry.method === "recovery");
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts session_id claim from the JWT access token.
 */
export function getSessionIdFromToken(session: Session | null | undefined): string | null {
  if (!session?.access_token) return null;
  try {
    const parts = session.access_token.split(".");
    const tokenPart = parts[1];
    if (!tokenPart) return null;
    const payload = JSON.parse(Buffer.from(tokenPart, "base64").toString("utf8"));
    return payload.session_id || null;
  } catch {
    return null;
  }
}

/**
 * Validates recovery-specific authorization for a given authenticated user and session.
 * 1. Verifies HMAC recovery grant cookie signature and expiry.
 * 2. Cryptographically verifies JWT access token via Supabase Auth server (getUser).
 * 3. Verifies recovery AMR and matching session ID.
 * 4. Checks PostgreSQL recovery_grants table to ensure the nonce is active and unconsumed.
 */
export async function validateRecoveryAuthorization(
  supabase: SupabaseClient<Database>,
  userId: string,
  session: Session | null | undefined
): Promise<RecoveryVerificationResult> {
  const cookieStore = await getSafeCookieStore();
  const grantToken = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;

  const verification = verifyRecoveryGrant(grantToken);
  if (!verification.success) {
    return verification;
  }

  // Ensure the grant belongs to the authenticated user
  if (verification.payload.userId !== userId) {
    return { success: false, reason: "unauthorized" };
  }

  // 2. Cryptographically verify the JWT session via Supabase Auth server
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user || userData.user.id !== userId) {
    return { success: false, reason: "unauthorized" };
  }

  // 3. Ensure the session was established via recovery
  if (!isRecoverySession(session)) {
    return { success: false, reason: "unauthorized" };
  }

  // Ensure session_id matches if present
  const currentSessionId = getSessionIdFromToken(session);
  if (currentSessionId && verification.payload.sessionId !== currentSessionId) {
    return { success: false, reason: "unauthorized" };
  }

  // 4. Server-side single-use verification via database RPC
  const nonceHash = hashRecoveryNonce(verification.payload.nonce);
  const { data: isValidGrant, error: verifyError } = await supabase.rpc(
    "verify_recovery_grant",
    {
      p_nonce_hash: nonceHash,
      p_user_id: userId,
    }
  );

  if (verifyError || !isValidGrant) {
    return { success: false, reason: "invalid" };
  }

  return verification;
}

/**
 * Atomically consumes a recovery grant in PostgreSQL.
 * Returns true if successfully consumed, false if already consumed or expired.
 */
export async function consumeRecoveryGrant(
  supabase: SupabaseClient<Database>,
  nonce: string,
  userId?: string
): Promise<boolean> {
  const nonceHash = hashRecoveryNonce(nonce);
  const { data, error } = await supabase.rpc("consume_recovery_grant", {
    p_nonce_hash: nonceHash,
    p_user_id: userId,
  });

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Sets the recovery grant cookie on a NextResponse object.
 */
export function setRecoveryGrantCookie(response: NextResponse, grantToken: string): void {
  response.cookies.set(RECOVERY_COOKIE_NAME, grantToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60, // 15 minutes
  });
}

/**
 * Invalidates and removes the recovery grant cookie.
 */
export async function clearRecoveryGrant(): Promise<void> {
  const cookieStore = await getSafeCookieStore();
  cookieStore.delete(RECOVERY_COOKIE_NAME);
}
