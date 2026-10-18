import crypto from "crypto";

export const OTP_PURPOSE_SIGNUP = "signup_verify";
export const OTP_PURPOSE_RESET = "password_reset";

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
export const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
export const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
export const OTP_MAX_RESENDS_PER_HOUR = Number(process.env.OTP_MAX_RESENDS_PER_HOUR || 5);
export const RESET_TOKEN_EXPIRY_MINUTES = Number(process.env.RESET_TOKEN_EXPIRY_MINUTES || 15);

/** Cryptographically secure 6-digit OTP (may include leading zeros). */
export function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(OTP_LENGTH, "0");
}

/** SHA-256 hex digest. OTPs are never stored or compared as plain text. */
export function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

/** Timing-safe comparison of a candidate OTP against a stored hash. */
export function verifySecret(candidate, storedHash) {
  const candidateHash = hashSecret(candidate);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(String(storedHash), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Single-use password-reset proof ticket issued after OTP verification. */
export function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function otpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
}

export function resetTokenExpiryDate() {
  return new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
}
