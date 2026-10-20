import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDeviceAccess } from "../utils/deviceAccess.js";

const REGISTERED = {
  deviceToken: "a".repeat(64),
  fingerprint: "v2-" + "b".repeat(64),
};

const LEGACY_REGISTERED = {
  deviceToken: "c".repeat(64),
  fingerprint: "d".repeat(64), // pre-v2 pure-hash fingerprint
};

test("matching deviceToken authorizes even when the fingerprint changed (desktop-site layout switch)", () => {
  const result = evaluateDeviceAccess(REGISTERED, {
    deviceToken: REGISTERED.deviceToken,
    fingerprint: "v2-" + "z".repeat(64), // new layout -> different everything else
    legacyFingerprint: "e".repeat(64),
  });
  assert.equal(result.status, "authorized");
  assert.equal(result.issueToken, undefined);
});

test("matching v2 fingerprint without a token re-issues the registered token", () => {
  const result = evaluateDeviceAccess(REGISTERED, {
    fingerprint: REGISTERED.fingerprint,
  });
  assert.equal(result.status, "authorized");
  assert.equal(result.issueToken, REGISTERED.deviceToken);
});

test("matching legacy fingerprint without a token re-issues the token (pre-v2 purchases keep working)", () => {
  const result = evaluateDeviceAccess(LEGACY_REGISTERED, {
    legacyFingerprint: LEGACY_REGISTERED.fingerprint,
  });
  assert.equal(result.status, "authorized");
  assert.equal(result.issueToken, LEGACY_REGISTERED.deviceToken);
});

test("stale/wrong token with a matching fingerprint still re-binds the device", () => {
  const result = evaluateDeviceAccess(REGISTERED, {
    deviceToken: "0".repeat(64),
    fingerprint: REGISTERED.fingerprint,
  });
  assert.equal(result.status, "authorized");
  assert.equal(result.issueToken, REGISTERED.deviceToken);
});

test("another device with no token and a fabricated fingerprint is denied", () => {
  const result = evaluateDeviceAccess(REGISTERED, {
    fingerprint: "v2-" + "f".repeat(64),
    legacyFingerprint: "1".repeat(64),
  });
  assert.equal(result.status, "denied");
});

test("wrong token combined with mismatched fingerprints is denied", () => {
  // Token mismatch + fingerprint mismatch -> denied.
  const result = evaluateDeviceAccess(REGISTERED, {
    deviceToken: "9".repeat(64),
    fingerprint: "v2-" + "9".repeat(64),
    legacyFingerprint: "8".repeat(64),
  });
  assert.equal(result.status, "denied");
});

test("presenting nothing at all is denied", () => {
  assert.equal(evaluateDeviceAccess(REGISTERED, {}).status, "denied");
  assert.equal(evaluateDeviceAccess(REGISTERED, undefined).status, "denied");
});

test("missing registered device is denied", () => {
  assert.equal(evaluateDeviceAccess(null, { deviceToken: REGISTERED.deviceToken }).status, "denied");
  assert.equal(
    evaluateDeviceAccess({ fingerprint: REGISTERED.fingerprint }, { deviceToken: "x" }).status,
    "denied"
  );
});

test("empty-string or non-string presented values never match", () => {
  assert.equal(evaluateDeviceAccess(REGISTERED, { deviceToken: "" }).status, "denied");
  assert.equal(evaluateDeviceAccess(REGISTERED, { fingerprint: "" }).status, "denied");
  assert.equal(evaluateDeviceAccess(REGISTERED, { deviceToken: null, fingerprint: undefined }).status, "denied");
  assert.equal(evaluateDeviceAccess(REGISTERED, { deviceToken: 12345 }).status, "denied");
});

test("a device registered with the old algorithm is not matched by the new v2 fingerprint", () => {
  // Guards against accidental cross-version collisions.
  const result = evaluateDeviceAccess(LEGACY_REGISTERED, {
    fingerprint: "v2-" + "d".repeat(64),
  });
  assert.equal(result.status, "denied");
});
