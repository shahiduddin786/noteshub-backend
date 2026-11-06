import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { isAuthenticated } from "../middleware/isAuthenticated.js";
import { refreshAccessToken } from "../controllers/sessionController.js";

// Guards the session-renewal contract behind the paid-notes payment flow:
// a 10-day access token that has expired must be reported as
// "Access token expired" (never silently accepted) and must be renewable
// through POST /api/auth/refresh with the 30-day refresh token.

const mockRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.payload = body;
    return this;
  },
});

const callMiddleware = async (headers = {}) => {
  const req = { headers };
  const res = mockRes();
  let nextCalled = false;
  await isAuthenticated(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
};

let fixtureUser = null;

test.before(async () => {
  fixtureUser = await prisma.user.create({
    data: {
      username: "Auth Session Test",
      email: `auth-session-test-${Date.now()}@noteshub-test.local`,
      isVerified: true,
    },
  });
});

test.after(async () => {
  if (fixtureUser) {
    await prisma.user.delete({ where: { id: fixtureUser.id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

test("missing Authorization header is rejected with 401", async () => {
  const { res, nextCalled } = await callMiddleware();
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.success, false);
  assert.equal(nextCalled, false);
});

test("malformed token is rejected as invalid, not expired", async () => {
  const { res, nextCalled } = await callMiddleware({ authorization: "Bearer not.a.token" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, "Invalid access token");
  assert.equal(nextCalled, false);
});

test("expired access token returns 401 'Access token expired'", async () => {
  const expired = jwt.sign({ id: fixtureUser.id }, process.env.SECRET_KEY, { expiresIn: -60 });
  const { res, nextCalled } = await callMiddleware({ authorization: `Bearer ${expired}` });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, "Access token expired");
  assert.equal(nextCalled, false);
});

test("valid token attaches the user and calls next", async () => {
  const token = jwt.sign({ id: fixtureUser.id }, process.env.SECRET_KEY, { expiresIn: "1h" });
  const { req, res, nextCalled } = await callMiddleware({ authorization: `Bearer ${token}` });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.userId, fixtureUser.id);
  assert.equal(req.user.id, fixtureUser.id);
});

test("valid signature for a deleted/unknown user yields 404, not access", async () => {
  const token = jwt.sign({ id: "user-does-not-exist-e2e" }, process.env.SECRET_KEY, { expiresIn: "1h" });
  const { res, nextCalled } = await callMiddleware({ authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 404);
  assert.equal(nextCalled, false);
});

test("refresh mints a new working access token", async () => {
  const refreshToken = jwt.sign({ id: fixtureUser.id }, process.env.SECRET_KEY, { expiresIn: "30d" });
  const res = mockRes();
  await refreshAccessToken({ body: { refreshToken } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.accessToken);
  const decoded = jwt.verify(res.payload.accessToken, process.env.SECRET_KEY);
  assert.equal(decoded.id, fixtureUser.id);
  // New access token is long-lived again (expires in roughly 10 days).
  const lifetimeSeconds = decoded.exp - Math.floor(Date.now() / 1000);
  assert.ok(lifetimeSeconds > 9 * 24 * 60 * 60, `lifetime was ${lifetimeSeconds}s`);
});

test("expired refresh token is rejected with 401 'Refresh token expired'", async () => {
  const refreshToken = jwt.sign({ id: fixtureUser.id }, process.env.SECRET_KEY, { expiresIn: -60 });
  const res = mockRes();
  await refreshAccessToken({ body: { refreshToken } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, "Refresh token expired");
});

test("garbage refresh token is rejected as invalid", async () => {
  const res = mockRes();
  await refreshAccessToken({ body: { refreshToken: "not.a.token" } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.message, "Invalid refresh token");
});

test("missing refresh token yields 400", async () => {
  const res = mockRes();
  await refreshAccessToken({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});
