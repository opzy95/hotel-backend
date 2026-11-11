require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;
const frontendOrigin = process.env.FRONTEND_URL
  ? new URL(process.env.FRONTEND_URL).origin
  : "http://localhost:5173";
process.env.FRONTEND_URL = frontendOrigin;

function cookiePair(response) {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

test("refresh tokens rotate, reject replay, and logout revokes the session", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const { RefreshSession, User } = require("../src/models");
  const { hashRefreshToken } = require("../src/services/auth-tokens");
  const suffix = randomUUID();
  let user;

  await mongoose.connect(testMongoUri);
  await RefreshSession.init();
  user = await User.create({
    name: "Refresh Test User",
    email: `refresh-${suffix}@example.test`,
    passwordHash: "$2a$10$NW6c7pGjU1E1cdD.d6VRbO7fQYmHq/lw8qWQfplY13XeC4.F7r/Gi",
    emailVerifiedAt: new Date(),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originHeaders = { origin: frontendOrigin };

  async function login() {
    return fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { ...originHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        password: "unused-test-password",
      }),
    });
  }

  try {
    const bcrypt = require("bcryptjs");
    user.passwordHash = await bcrypt.hash("unused-test-password", 4);
    await user.save();
    const loginResponse = await login();
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    assert.ok(loginBody.token);
    assert.equal(loginBody.refreshToken, undefined);
    assert.equal(loginResponse.headers.get("access-control-allow-origin"), frontendOrigin);
    assert.equal(loginResponse.headers.get("access-control-allow-credentials"), "true");
    const firstCookie = cookiePair(loginResponse);
    assert.match(loginResponse.headers.get("set-cookie"), /HttpOnly/i);
    assert.match(loginResponse.headers.get("set-cookie"), /Path=\/api\/auth/i);

    const firstRefreshToken = firstCookie.slice(firstCookie.indexOf("=") + 1);
    const firstRecord = await RefreshSession.findOne({
      tokenHash: hashRefreshToken(firstRefreshToken),
    });
    assert.ok(firstRecord);
    assert.notEqual(firstRecord.tokenHash, firstRefreshToken);
    assert.ok(firstRecord.expiresAt.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000);

    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { ...originHeaders, cookie: firstCookie },
    });
    assert.equal(refreshResponse.status, 200);
    const refreshedBody = await refreshResponse.json();
    assert.ok(refreshedBody.token);
    assert.equal(refreshedBody.refreshToken, undefined);
    const secondCookie = cookiePair(refreshResponse);
    assert.notEqual(secondCookie, firstCookie);

    const replayResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { ...originHeaders, cookie: firstCookie },
    });
    assert.equal(replayResponse.status, 401);
    const revokedFamilyResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { ...originHeaders, cookie: secondCookie },
    });
    assert.equal(revokedFamilyResponse.status, 401);

    const secondLoginResponse = await login();
    assert.equal(secondLoginResponse.status, 200);
    const logoutCookie = cookiePair(secondLoginResponse);
    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { ...originHeaders, cookie: logoutCookie },
    });
    assert.equal(logoutResponse.status, 200);
    const loggedOutRefreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { ...originHeaders, cookie: logoutCookie },
    });
    assert.equal(loggedOutRefreshResponse.status, 401);

    const thirdLoginResponse = await login();
    assert.equal(thirdLoginResponse.status, 200);
    const staleVersionCookie = cookiePair(thirdLoginResponse);
    await User.updateOne({ _id: user._id }, { $inc: { authVersion: 1 } });
    const staleVersionResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { ...originHeaders, cookie: staleVersionCookie },
    });
    assert.equal(staleVersionResponse.status, 401);

    const untrustedOriginResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { origin: "https://attacker.example.test", cookie: staleVersionCookie },
    });
    assert.equal(untrustedOriginResponse.status, 403);
  } finally {
    await RefreshSession.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
});