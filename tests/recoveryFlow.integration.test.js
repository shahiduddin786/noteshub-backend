import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

const RUN = process.env.RUN_INTEGRATION === "1";
const maybe = RUN ? test : test.skip;

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:5599";
const ADMIN = {
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD,
};

const NOTE_A = "mu/sem4/integration-recovery-a";
const NOTE_B = "mu/sem4/integration-recovery-b";
const NOTE_C = "mu/sem4/integration-recovery-c";
const NOTE_D = "mu/sem4/integration-recovery-d";

const TOKEN_A = "registered-token-secret-a";
const TOKEN_C = "registered-token-secret-c";
const TOKEN_D = "registered-token-secret-d";

const CURRENT_FP_A = "v2-" + "a".repeat(64);
const CURRENT_FP_C = "v2-" + "c".repeat(64);
const CURRENT_FP_D = "v2-" + "d".repeat(64);

const state = {};

const call = async (path, { method = "GET", token, admin, body, headers = {} } = {}) => {
  const finalHeaders = { "Content-Type": "application/json", ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  if (admin) {
    finalHeaders.username = admin.username;
    finalHeaders.password = admin.password;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  return { status: res.status, json, text };
};

const createSeedUser = async (suffix, noteKey, deviceToken) => {
  const user = await prisma.user.create({
    data: {
      username: `Recovery Tester ${suffix.toUpperCase()}`,
      email: `recovery-${suffix}@test.local`,
      password: null,
      authProvider: "local",
      isVerified: true,
      termsAccepted: true,
    },
  });

  const config = await prisma.paidNoteConfig.upsert({
    where: { noteKey },
    update: { isEnabled: true },
    create: { noteKey, title: `Recovery Integration Notes ${suffix.toUpperCase()}`, price: 49, isEnabled: true },
  });

  const purchase = await prisma.purchaseOrder.create({
    data: {
      userId: user.id,
      noteKey,
      razorpayOrderId: `order_int_${suffix}_${Date.now()}`,
      amount: 4900,
      status: "captured",
    },
  });

  const entitlement = await prisma.noteEntitlement.create({
    data: { userId: user.id, noteKey },
  });

  const registeredDevice = await prisma.registeredDevice.create({
    data: {
      entitlementId: entitlement.id,
      fingerprint: `v2-${suffix}${"f".repeat(60)}`,
      deviceToken,
    },
  });

  return {
    user,
    config,
    purchase,
    entitlement,
    registeredDevice,
    token: jwt.sign({ id: user.id }, process.env.SECRET_KEY),
  };
};

maybe("seed: prepares isolated users, notes and purchases", async () => {
  await prisma.deviceRecoveryRequest.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.deviceAuthEvent.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.registeredDevice.deleteMany({
    where: { entitlement: { user: { email: { endsWith: "@test.local" } } } },
  });
  await prisma.noteEntitlement.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.purchaseOrder.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.local" } } });
  await prisma.paidNoteConfig.deleteMany({ where: { noteKey: { startsWith: "mu/sem4/integration-recovery-" } } });

  state.a = await createSeedUser("a", NOTE_A, TOKEN_A);

  const userB = await prisma.user.create({
    data: {
      username: "Recovery Tester B",
      email: "recovery-b@test.local",
      password: null,
      authProvider: "local",
      isVerified: true,
      termsAccepted: true,
    },
  });
  state.b = { user: userB, token: jwt.sign({ id: userB.id }, process.env.SECRET_KEY) };

  state.c = await createSeedUser("c", NOTE_C, TOKEN_C);
  state.d = await createSeedUser("d", NOTE_D, TOKEN_D);

  assert.ok(state.a.token);
  assert.ok(state.c.token);
});

maybe("device authorization still blocks an unregistered browser", async () => {
  const res = await call(`/api/paid-notes/entitlement/${NOTE_A}`, {
    token: state.a.token,
    headers: { "x-device-fingerprint": "v2-" + "9".repeat(64) },
  });

  assert.equal(res.status, 403);
  assert.equal(res.json.message, "Device not authorized");
});

maybe("eligible purchaser sees recovery option and purchase details", async () => {
  const res = await call(`/api/paid-notes/recovery/eligibility/${NOTE_A}`, { token: state.a.token });

  assert.equal(res.status, 200);
  assert.equal(res.json.eligible, true);
  assert.equal(res.json.purchase.id, state.a.purchase.id);
  assert.equal(res.json.noteTitle, state.a.config.title);
  assert.equal(res.json.device.registered, true);
  assert.equal(res.text.includes(TOKEN_A), false);
  assert.equal(res.json.activeRequest, null);
});

maybe("a user without a purchase cannot view or submit recovery for it", async () => {
  const eligibility = await call(`/api/paid-notes/recovery/eligibility/${NOTE_A}`, { token: state.b.token });
  assert.equal(eligibility.status, 200);
  assert.equal(eligibility.json.eligible, false);
  assert.equal(eligibility.json.reason, "NO_ENTITLEMENT");
  assert.equal(eligibility.json.purchase, null);

  const submit = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.b.token,
    body: { noteKey: NOTE_A, description: "I want access to notes I never bought on this account." },
    headers: { "x-device-fingerprint": "v2-" + "b".repeat(64) },
  });

  assert.equal(submit.status, 403);
});

maybe("an authenticated user cannot submit a request without a description", async () => {
  const res = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.a.token,
    body: { noteKey: NOTE_A, description: "help" },
    headers: { "x-device-fingerprint": CURRENT_FP_A },
  });

  assert.equal(res.status, 400);
});

maybe("purchaser submits a device recovery request", async () => {
  const res = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.a.token,
    body: {
      noteKey: NOTE_A,
      description:
        "I purchased these notes on my OnePlus Nord 5, but after clearing Chrome data, NotesHub says they were purchased on another device.",
    },
    headers: { "x-device-fingerprint": CURRENT_FP_A },
  });

  assert.equal(res.status, 201);
  assert.equal(res.json.request.status, "PENDING");
  assert.equal(res.json.request.deviceFingerprint, CURRENT_FP_A);
  assert.equal(res.json.purchase.id, state.a.purchase.id);
  state.requestA = res.json.request;

  const stored = await prisma.deviceRecoveryRequest.findUnique({ where: { id: res.json.request.id } });
  assert.equal(stored.purchaseOrderId, state.a.purchase.id);
  assert.equal(stored.userId, state.a.user.id);
  assert.equal(stored.activeMarker, "active");
});

maybe("duplicate active requests are rejected", async () => {
  const res = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.a.token,
    body: { noteKey: NOTE_A, description: "Second attempt because my device still shows blocked." },
    headers: { "x-device-fingerprint": CURRENT_FP_A },
  });

  assert.equal(res.status, 409);
  assert.ok(res.json.activeRequest);
  assert.equal(res.json.activeRequest.id, state.requestA.id);
});

maybe("repeated submissions trigger rate limiting", async () => {
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const res = await call("/api/paid-notes/recovery/request", {
      method: "POST",
      token: state.a.token,
      body: { noteKey: NOTE_A, description: "Automated duplicate submission attempt number." },
      headers: { "x-device-fingerprint": CURRENT_FP_A },
    });
    statuses.push(res.status);
  }

  assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(",")}`);
});

maybe("ordinary users cannot reach admin recovery endpoints", async () => {
  const list = await call("/api/paid-notes/admin/recovery", { token: state.a.token });
  assert.equal(list.status, 403);

  const detail = await call(`/api/paid-notes/admin/recovery/${state.requestA.id}`, { token: state.a.token });
  assert.equal(detail.status, 403);

  const noCreds = await call(`/api/paid-notes/admin/recovery/${state.requestA.id}`);
  assert.equal(noCreds.status, 403);
});

maybe("admin can list recovery requests with filtering", async () => {
  const pending = await call("/api/paid-notes/admin/recovery?status=PENDING", { admin: ADMIN });
  assert.equal(pending.status, 200);
  assert.ok(pending.json.requests.some((r) => r.id === state.requestA.id));
  assert.equal(pending.json.requests.every((r) => r.status === "PENDING"), true);

  const search = await call("/api/paid-notes/admin/recovery?q=recovery-a@test.local", { admin: ADMIN });
  assert.equal(search.status, 200);
  assert.ok(search.json.requests.some((r) => r.id === state.requestA.id));

  const noMatch = await call("/api/paid-notes/admin/recovery?q=no-such-request-zzz", { admin: ADMIN });
  assert.equal(noMatch.status, 200);
  assert.equal(noMatch.json.total, 0);

  const sorted = await call("/api/paid-notes/admin/recovery?sort=status&order=asc", { admin: ADMIN });
  assert.equal(sorted.status, 200);

  const rejectedFilter = await call("/api/paid-notes/admin/recovery?status=REJECTED", { admin: ADMIN });
  assert.equal(rejectedFilter.status, 200);
  assert.equal(rejectedFilter.json.requests.every((r) => r.status === "REJECTED"), true);
});

maybe("admin can inspect purchase and device history without secret leakage", async () => {
  const res = await call(`/api/paid-notes/admin/recovery/${state.requestA.id}`, { admin: ADMIN });

  assert.equal(res.status, 200);
  assert.equal(res.json.user.email, state.a.user.email);
  assert.equal(res.json.purchase.id, state.a.purchase.id);
  assert.equal(res.json.purchase.status, "captured");
  assert.equal(res.json.entitlement.exists, true);
  assert.equal(res.json.registeredDevice.registered, true);
  assert.equal(res.json.registeredDevice.fingerprint, state.a.registeredDevice.fingerprint);
  assert.equal(res.json.comparison.fingerprintMatch, false);
  assert.ok(Array.isArray(res.json.events));
  assert.ok(res.json.request.description.includes("OnePlus Nord 5"));

  assert.equal(res.text.includes(TOKEN_A), false);
  assert.equal(res.text.includes('"deviceToken":'), false);
});

maybe("admin approval reauthorizes the current device and restores access", async () => {
  const res = await call(`/api/paid-notes/admin/recovery/${state.requestA.id}/approve`, {
    method: "POST",
    admin: ADMIN,
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.request.status, "APPROVED");
  assert.equal(res.json.request.resolvedBy, ADMIN.username);
  assert.ok(res.json.request.resolvedAt);
  assert.equal(res.text.includes('"deviceToken":'), false);
  assert.equal(res.text.includes(TOKEN_A), false);
  assert.equal(res.json.emailSent, false, "email failure must not fail the approval");

  const device = await prisma.registeredDevice.findUnique({
    where: { entitlementId: state.a.entitlement.id },
  });
  assert.notEqual(device.deviceToken, TOKEN_A);
  assert.equal(device.fingerprint, CURRENT_FP_A);

  const approvalEvent = await prisma.deviceAuthEvent.findFirst({
    where: { userId: state.a.user.id, eventType: "RECOVERY_APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.actor, ADMIN.username);
  assert.equal(approvalEvent.fingerprint, CURRENT_FP_A);

  const rebind = await call(`/api/paid-notes/entitlement/${NOTE_A}`, {
    token: state.a.token,
    headers: { "x-device-fingerprint": CURRENT_FP_A },
  });
  assert.equal(rebind.status, 200);
  assert.equal(rebind.json.hasAccess, true);
  assert.ok(rebind.json.deviceToken);

  const withToken = await call(`/api/paid-notes/entitlement/${NOTE_A}`, {
    token: state.a.token,
    headers: { "x-device-token": rebind.json.deviceToken, "x-device-fingerprint": CURRENT_FP_A },
  });
  assert.equal(withToken.status, 200);
  assert.equal(withToken.json.hasAccess, true);
});

maybe("approval is decided once and cannot be repeated", async () => {
  const res = await call(`/api/paid-notes/admin/recovery/${state.requestA.id}/approve`, {
    method: "POST",
    admin: ADMIN,
  });
  assert.equal(res.status, 409);
});

maybe("rejection requires a reason and survives email failure", async () => {
  const create = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.c.token,
    body: { noteKey: NOTE_C, description: "My laptop browser lost the device token after a reset." },
    headers: { "x-device-fingerprint": CURRENT_FP_C },
  });
  assert.equal(create.status, 201);
  const requestId = create.json.request.id;

  const noReason = await call(`/api/paid-notes/admin/recovery/${requestId}/reject`, {
    method: "POST",
    admin: ADMIN,
    body: {},
  });
  assert.equal(noReason.status, 400);

  const emptyReason = await call(`/api/paid-notes/admin/recovery/${requestId}/reject`, {
    method: "POST",
    admin: ADMIN,
    body: { reason: "   " },
  });
  assert.equal(emptyReason.status, 400);

  const rejected = await call(`/api/paid-notes/admin/recovery/${requestId}/reject`, {
    method: "POST",
    admin: ADMIN,
    body: { reason: "Device fingerprints show a shared device; recovery cannot be granted." },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.request.status, "REJECTED");
  assert.equal(rejected.json.emailSent, false);
  assert.ok(rejected.json.request.rejectionReason.includes("shared device"));

  const stored = await prisma.deviceRecoveryRequest.findUnique({ where: { id: requestId } });
  assert.equal(stored.status, "REJECTED");
  assert.equal(stored.resolvedBy, ADMIN.username);
  assert.ok(stored.resolvedAt);
  assert.ok(stored.emailLastError);
  assert.equal(stored.activeMarker, null);

  const resend = await call(`/api/paid-notes/admin/recovery/${requestId}/resend-notification`, {
    method: "POST",
    admin: ADMIN,
  });
  assert.equal(resend.status, 200);
  assert.equal(resend.json.emailSent, false);

  const stillRejected = await prisma.deviceRecoveryRequest.findUnique({ where: { id: requestId } });
  assert.equal(stillRejected.status, "REJECTED");

  const rejectedList = await call("/api/paid-notes/admin/recovery?status=REJECTED", { admin: ADMIN });
  assert.ok(rejectedList.json.requests.some((r) => r.id === requestId));
});

maybe("a refunded purchase cannot regain access through recovery", async () => {
  const create = await call("/api/paid-notes/recovery/request", {
    method: "POST",
    token: state.d.token,
    body: { noteKey: NOTE_D, description: "Request submitted before the refund was processed." },
    headers: { "x-device-fingerprint": CURRENT_FP_D },
  });
  assert.equal(create.status, 201);
  const requestId = create.json.request.id;

  await prisma.purchaseOrder.update({
    where: { id: state.d.purchase.id },
    data: { status: "refunded" },
  });

  const eligibility = await call(`/api/paid-notes/recovery/eligibility/${NOTE_D}`, { token: state.d.token });
  assert.equal(eligibility.json.eligible, false);
  assert.equal(eligibility.json.reason, "PURCHASE_INELIGIBLE");

  const approve = await call(`/api/paid-notes/admin/recovery/${requestId}/approve`, {
    method: "POST",
    admin: ADMIN,
  });
  assert.equal(approve.status, 409);

  const device = await prisma.registeredDevice.findUnique({
    where: { entitlementId: state.d.entitlement.id },
  });
  assert.equal(device.deviceToken, TOKEN_D);

  const entitlement = await call(`/api/paid-notes/entitlement/${NOTE_D}`, {
    token: state.d.token,
    headers: { "x-device-fingerprint": CURRENT_FP_D },
  });
  assert.equal(entitlement.status, 403);

  await prisma.purchaseOrder.update({
    where: { id: state.d.purchase.id },
    data: { status: "captured" },
  });
});

maybe("cleanup: removes integration fixtures", async () => {
  await prisma.deviceRecoveryRequest.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.deviceAuthEvent.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.registeredDevice.deleteMany({
    where: { entitlement: { user: { email: { endsWith: "@test.local" } } } },
  });
  await prisma.noteEntitlement.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.purchaseOrder.deleteMany({
    where: { user: { email: { endsWith: "@test.local" } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@test.local" } } });
  await prisma.paidNoteConfig.deleteMany({ where: { noteKey: { startsWith: "mu/sem4/integration-recovery-" } } });

  const leftover = await prisma.user.count({ where: { email: { endsWith: "@test.local" } } });
  assert.equal(leftover, 0);
});
