import test from "node:test";
import assert from "node:assert/strict";
import {
  parseUserAgent,
  evaluateRecoveryEligibility,
  validateDescription,
  sanitizeRegisteredDevice,
  escapeHtml,
} from "../utils/recovery.js";
import { rateLimit, resetRateLimits } from "../utils/rateLimit.js";

const buildContext = (overrides = {}) => ({
  config: { noteKey: "mu/sem4/dbms", title: "DBMS Notes", price: 49, isEnabled: true },
  entitlement: { id: "ent1", userId: "u1", noteKey: "mu/sem4/dbms" },
  purchaseOrders: [
    { id: "po1", userId: "u1", noteKey: "mu/sem4/dbms", status: "captured", createdAt: new Date("2026-01-05") },
  ],
  ...overrides,
});

test("a verified purchaser with an active entitlement is eligible for recovery", () => {
  const result = evaluateRecoveryEligibility(buildContext());
  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
  assert.equal(result.purchase.id, "po1");
});

test("a user without an entitlement cannot submit a recovery request", () => {
  const result = evaluateRecoveryEligibility(buildContext({ entitlement: null }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "NO_ENTITLEMENT");
  assert.equal(result.purchase, null);
});

test("a user with no purchase records at all is not eligible", () => {
  const result = evaluateRecoveryEligibility(buildContext({ purchaseOrders: [] }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "NO_VERIFIED_PURCHASE");
});

test("refunded, revoked, failed or created purchases are not eligible", () => {
  for (const status of ["refunded", "revoked", "failed", "created"]) {
    const result = evaluateRecoveryEligibility(
      buildContext({
        purchaseOrders: [{ id: "po1", status, createdAt: new Date("2026-01-05") }],
      })
    );
    assert.equal(result.eligible, false, `status ${status} must be ineligible`);
    assert.equal(result.reason, "PURCHASE_INELIGIBLE");
  }
});

test("a disabled or missing paid note is not eligible", () => {
  const disabled = evaluateRecoveryEligibility(
    buildContext({ config: { noteKey: "mu/sem4/dbms", title: "DBMS", price: 49, isEnabled: false } })
  );
  assert.equal(disabled.eligible, false);
  assert.equal(disabled.reason, "NOTE_UNAVAILABLE");

  const missing = evaluateRecoveryEligibility(buildContext({ config: null }));
  assert.equal(missing.eligible, false);
  assert.equal(missing.reason, "NOTE_UNAVAILABLE");
});

test("the most recent captured purchase is bound to the request", () => {
  const result = evaluateRecoveryEligibility(
    buildContext({
      purchaseOrders: [
        { id: "old", status: "captured", createdAt: new Date("2025-01-01") },
        { id: "new", status: "captured", createdAt: new Date("2026-02-02") },
        { id: "failed", status: "failed", createdAt: new Date("2026-03-03") },
      ],
    })
  );
  assert.equal(result.eligible, true);
  assert.equal(result.purchase.id, "new");
});

test("parseUserAgent extracts Chrome on Windows", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  assert.equal(result.browserName, "Chrome");
  assert.equal(result.browserVersion, "131.0.0.0");
  assert.equal(result.osName, "Windows");
});

test("parseUserAgent extracts Safari on iOS", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
  );
  assert.equal(result.browserName, "Safari");
  assert.equal(result.osName, "iOS");
  assert.equal(result.osVersion, "17.5");
});

test("parseUserAgent extracts Firefox on Android", () => {
  const result = parseUserAgent("Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0");
  assert.equal(result.browserName, "Firefox");
  assert.equal(result.osName, "Android");
  assert.equal(result.osVersion, "14");
});

test("parseUserAgent extracts Edge and reports unknown values as null", () => {
  const edge = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
  );
  assert.equal(edge.browserName, "Microsoft Edge");

  const unknown = parseUserAgent("SomeCustomAgent/1.0");
  assert.equal(unknown.browserName, null);
  assert.equal(unknown.osName, null);

  const empty = parseUserAgent(undefined);
  assert.equal(empty.browserName, null);
  assert.equal(empty.osVersion, null);
});

test("recovery description validation rejects short, long and non-string input", () => {
  assert.equal(validateDescription("short").ok, false);
  assert.equal(validateDescription(12345).ok, false);
  assert.equal(validateDescription("x".repeat(2001)).ok, false);

  const ok = validateDescription("  I cleared Chrome data and the notes say another device.  ");
  assert.equal(ok.ok, true);
  assert.equal(ok.value, "I cleared Chrome data and the notes say another device.");
});

test("sanitizeRegisteredDevice never exposes the raw device token", () => {
  const device = {
    id: "dev1",
    entitlementId: "ent1",
    fingerprint: "v2-abc",
    deviceToken: "super-secret-token-value",
    registeredAt: new Date("2026-01-05"),
    lastSeenAt: new Date("2026-02-01"),
    resetAt: null,
  };

  const sanitized = sanitizeRegisteredDevice(device);
  const serialized = JSON.stringify(sanitized);

  assert.equal(serialized.includes("super-secret-token-value"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "deviceToken"), false);
  assert.equal(sanitized.registered, true);
  assert.equal(sanitized.deviceTokenStatus, "Issued");
  assert.equal(sanitized.fingerprint, "v2-abc");

  const missing = sanitizeRegisteredDevice(null);
  assert.equal(missing.registered, false);
  assert.equal(missing.deviceTokenStatus, "Not registered");
});

test("escapeHtml neutralises markup in admin supplied reasons", () => {
  const escaped = escapeHtml('<script>alert("x")</script>&\'');
  assert.equal(escaped.includes("<"), false);
  assert.equal(escaped.includes(">"), false);
  assert.equal(escaped.includes('"'), false);
});

test("rate limit allows up to the limit and then blocks inside the window", () => {
  resetRateLimits();
  const options = { key: "test-user", limit: 3, windowMs: 1000 };

  assert.equal(rateLimit(options).allowed, true);
  assert.equal(rateLimit(options).allowed, true);
  const third = rateLimit(options);
  assert.equal(third.allowed, true);
  const fourth = rateLimit(options);
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterSeconds >= 1);
});

test("rate limit keys are isolated from each other", () => {
  resetRateLimits();
  assert.equal(rateLimit({ key: "a", limit: 1, windowMs: 1000 }).allowed, true);
  assert.equal(rateLimit({ key: "a", limit: 1, windowMs: 1000 }).allowed, false);
  assert.equal(rateLimit({ key: "b", limit: 1, windowMs: 1000 }).allowed, true);
});
