import prisma from "../lib/prisma.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  generateOtpCode,
  generateResetToken,
  hashSecret,
  otpExpiryDate,
  resetTokenExpiryDate,
  verifySecret,
} from "./otp.js";

const HOUR_MS = 60 * 60 * 1000;

function tooManyResends(row, now) {
  if (!row) return false;
  if (now - row.resendWindowStart.getTime() > HOUR_MS) return false;
  return row.resendCount >= OTP_MAX_RESENDS_PER_HOUR;
}

/**
 * Issue (or re-issue) a 6-digit OTP. Previous codes for the same
 * email+purpose are invalidated by the upsert. Enforces resend
 * cooldown and an hourly resend cap. Returns the plain code ONLY so
 * the caller can email it — it is never sent in an API response.
 */
export async function issueOtp(email, purpose) {
  const normalized = String(email).trim().toLowerCase();
  const now = new Date();
  const existing = await prisma.otpCode.findUnique({
    where: { email_purpose: { email: normalized, purpose } },
  });

  if (existing) {
    const elapsedSec = (now - existing.lastSentAt.getTime()) / 1000;
    if (elapsedSec < OTP_RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSec);
      const err = new Error(`Please wait ${wait}s before requesting a new code.`);
      err.code = "OTP_COOLDOWN";
      err.retryAfterSeconds = wait;
      throw err;
    }
    if (tooManyResends(existing, now)) {
      const err = new Error("Too many codes requested. Try again later.");
      err.code = "OTP_RATE_LIMITED";
      throw err;
    }
  }

  const windowExpired = !existing || now - existing.resendWindowStart.getTime() > HOUR_MS;
  const code = generateOtpCode();

  await prisma.otpCode.upsert({
    where: { email_purpose: { email: normalized, purpose } },
    update: {
      codeHash: hashSecret(code),
      expiresAt: otpExpiryDate(),
      attempts: 0,
      consumedAt: null,
      lastSentAt: now,
      resendCount: windowExpired ? 1 : existing.resendCount + 1,
      resendWindowStart: windowExpired ? now : existing.resendWindowStart,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
    },
    create: {
      email: normalized,
      purpose,
      codeHash: hashSecret(code),
      expiresAt: otpExpiryDate(),
      resendCount: 1,
      resendWindowStart: now,
      lastSentAt: now,
    },
  });

  return code;
}

/**
 * Verify a submitted OTP. Enforces expiry, attempt cap and single use.
 * On success the code is consumed. For password-reset codes a one-time
 * reset ticket is also issued and returned (plaintext, for the client to
 * present at change-password).
 */
export async function verifyOtpCode(email, purpose, code) {
  const normalized = String(email).trim().toLowerCase();
  const candidate = String(code ?? "").trim();

  const row = await prisma.otpCode.findUnique({
    where: { email_purpose: { email: normalized, purpose } },
  });

  if (!row || row.consumedAt) {
    return { ok: false, reason: "invalid" };
  }
  if (row.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= row.maxAttempts) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return { ok: false, reason: "locked" };
  }
  if (!verifySecret(candidate, row.codeHash)) {
    const attempts = row.attempts + 1;
    const data = { attempts };
    if (attempts >= row.maxAttempts) data.consumedAt = new Date();
    await prisma.otpCode.update({ where: { id: row.id }, data });
    return { ok: false, reason: "invalid", attemptsLeft: Math.max(0, row.maxAttempts - attempts) };
  }

  let resetToken;
  const data = { consumedAt: new Date(), attempts: row.attempts + 1 };
  if (purpose === "password_reset") {
    resetToken = generateResetToken();
    data.resetTokenHash = hashSecret(resetToken);
    data.resetTokenExpiresAt = resetTokenExpiryDate();
  }
  await prisma.otpCode.update({ where: { id: row.id }, data });
  return { ok: true, resetToken };
}

/** Validate + consume a password-reset ticket. Single use, short expiry. */
export async function consumeResetToken(email, token) {
  const normalized = String(email).trim().toLowerCase();
  if (!token) return false;

  const row = await prisma.otpCode.findUnique({
    where: { email_purpose: { email: normalized, purpose: "password_reset" } },
  });
  if (!row || !row.resetTokenHash || !row.resetTokenExpiresAt) return false;
  if (row.resetTokenExpiresAt < new Date()) return false;
  if (!verifySecret(String(token), row.resetTokenHash)) return false;

  await prisma.otpCode.update({
    where: { id: row.id },
    data: { resetTokenHash: null, resetTokenExpiresAt: null },
  });
  return true;
}

/** Remaining resend cooldown in seconds (0 when a new code may be issued). */
export async function resendCooldownRemaining(email, purpose) {
  const normalized = String(email).trim().toLowerCase();
  const row = await prisma.otpCode.findUnique({
    where: { email_purpose: { email: normalized, purpose } },
  });
  if (!row) return 0;
  const elapsedSec = (Date.now() - row.lastSentAt.getTime()) / 1000;
  return Math.max(0, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSec));
}
