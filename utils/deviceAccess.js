import crypto from "crypto";

/**
 * Device authorization for paid notes.
 *
 * Hierarchy:
 * 1. `deviceToken` — a server-generated 256-bit secret persisted per device
 *    in the browser. A matching token is authoritative: browser layout
 *    switches ("Desktop site" mode), viewport changes and user-agent
 *    updates cannot change it, so the same physical device keeps access.
 * 2. `fingerprint` — the value frozen on RegisteredDevice at purchase time.
 *    Compared against both the current stable (v2) fingerprint and the
 *    legacy pre-v2 fingerprint so purchases made before the v2 rollout keep
 *    working. A matching fingerprint re-issues the registered device token
 *    (see `issueToken`), letting a browser that lost its stored token
 *    re-bind without an admin reset.
 *
 * A presented token or fingerprint that does not match grants nothing:
 * another physical device cannot reproduce the registered token (random,
 * unguessable) and cannot reproduce the registered fingerprint without
 * cloning the purchase-time browser profile exactly.
 *
 * Timing-safe comparisons: these values act as bearer secrets, so they are
 * hashed before comparison to avoid leaking equality information through
 * response timing.
 */

const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
};

/**
 * @param {{ deviceToken: string, fingerprint: string }|null} registeredDevice
 * @param {{ deviceToken?: string, fingerprint?: string, legacyFingerprint?: string }} presented
 * @returns {{ status: "authorized", issueToken?: string } | { status: "denied" }}
 */
export function evaluateDeviceAccess(registeredDevice, presented = {}) {
  if (!registeredDevice || !registeredDevice.deviceToken) {
    return { status: "denied" };
  }

  const { deviceToken, fingerprint, legacyFingerprint } = presented || {};

  if (safeEqual(registeredDevice.deviceToken, deviceToken)) {
    return { status: "authorized" };
  }

  const storedFingerprint = registeredDevice.fingerprint;
  const fingerprintMatches =
    safeEqual(storedFingerprint, fingerprint) ||
    safeEqual(storedFingerprint, legacyFingerprint);

  if (fingerprintMatches) {
    return { status: "authorized", issueToken: registeredDevice.deviceToken };
  }

  return { status: "denied" };
}
