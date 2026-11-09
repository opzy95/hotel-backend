require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;

test("hotel registration creates a Manager who can log in", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const {
    AuditLog,
    AuthActionToken,
    Hotel,
    HotelMembership,
    PlatformOperator,
    Subscription,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");

  const suffix = randomUUID();
  const managerEmail = `manager-${suffix}@example.test`;
  const operatorEmail = `operator-${suffix}@example.test`;
  const hotelEmail = `hotel-${suffix}@example.test`;
  const password = "unique-test-password-2026";
  const resetPassword = "another-unique-password-2026";
  const hotelIds = [];
  let userId;
  let operatorUserId;
  const sentEmails = [];
  const originalSendVerificationEmail = app.locals.sendVerificationEmail;
  const originalSendPasswordResetEmail = app.locals.sendPasswordResetEmail;
  app.locals.sendVerificationEmail = async (user, token) => {
    sentEmails.push({ type: "verification", user, token });
  };
  app.locals.sendPasswordResetEmail = async (user, token) => {
    sentEmails.push({ type: "password_reset", user, token });
  };
  await mongoose.connect(testMongoUri);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const registrationResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hotel: {
          name: "Example Hotel",
          email: hotelEmail,
          phone: "+2348012345678",
          address: {
            line1: "1 Example Road",
            city: "Lagos",
            country: "NG",
          },
          type: "boutique",
          roomCount: 40,
        },
        manager: {
          name: "Hotel Manager",
          email: managerEmail,
          password,
        },
      }),
    });
    const registrationMail = sentEmails.find((email) => email.type === "verification");

    assert.equal(registrationResponse.status, 201);
    const registration = await registrationResponse.json();
    assert.equal(registration.token, undefined);
    assert.equal(registration.emailVerificationRequired, true);
    assert.equal(registration.user.email, managerEmail);
    assert.equal(registration.membership.role, "manager");
    assert.equal(registration.membership.status, "active");
    assert.equal(registration.hotel.status, "pending_approval");
    assert.equal(registration.onboarding.currentStep, "choose_plan");

    hotelIds.push(registration.hotel.id);
    const manager = await User.findOne({ email: managerEmail }).select("+passwordHash");
    assert.ok(manager);
    userId = manager._id;
    assert.notEqual(manager.passwordHash, password);
    assert.equal(manager.emailVerifiedAt, null);
    assert.ok(registrationMail?.token);
    const storedVerificationToken = await AuthActionToken.findOne({
      userId: manager._id,
      purpose: "email_verification",
    });
    assert.ok(storedVerificationToken);
    assert.notEqual(storedVerificationToken.tokenHash, registrationMail.token);

    const unverifiedLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, password }),
    });
    assert.equal(unverifiedLoginResponse.status, 403);
    assert.equal((await unverifiedLoginResponse.json()).error, "email_not_verified");

    const verificationResponse = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: registrationMail.token }),
    });
    assert.equal(verificationResponse.status, 200);
    assert.ok((await User.findById(manager._id)).emailVerifiedAt);

    const replayedVerificationResponse = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: registrationMail.token }),
    });
    assert.equal(replayedVerificationResponse.status, 400);

    const membership = await HotelMembership.findOne({
      hotelId: registration.hotel.id,
      userId: manager._id,
    });
    assert.equal(membership?.role, "manager");
    assert.equal(membership?.status, "active");

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, password }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    assert.ok(login.token);

    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${login.token}` },
    });
    assert.equal(meResponse.status, 200);
    const me = await meResponse.json();
    assert.equal(me.user.email, managerEmail);
    assert.equal(me.isPlatformOperator, false);
    assert.equal(
      me.memberships.some((item) => item.hotelId.toString() === registration.hotel.id.toString()),
      true,
    );

    const managerPendingResponse = await fetch(
      `${baseUrl}/api/platform/hotels/pending-approval`,
      { headers: { authorization: `Bearer ${login.token}` } },
    );
    assert.equal(managerPendingResponse.status, 403);
    const managerApprovalResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/approve`,
      { method: "POST", headers: { authorization: `Bearer ${login.token}` } },
    );
    assert.equal(managerApprovalResponse.status, 403);

    const operator = await User.create({
      name: "Test Platform Operator",
      email: operatorEmail,
      passwordHash: "test-only-hash",
    });
    operatorUserId = operator._id;
    await PlatformOperator.create({ userId: operator._id, active: true });
    const operatorToken = signAccessToken(operator._id);
    const operatorHeaders = { authorization: `Bearer ${operatorToken}` };

    const operatorForgotPasswordResponse = await fetch(
      `${baseUrl}/api/auth/forgot-password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: operatorEmail }),
      },
    );
    assert.equal(operatorForgotPasswordResponse.status, 202);
    assert.equal(sentEmails.findLast((email) => email.type === "password_reset")?.user.email, operatorEmail);

    const pendingResponse = await fetch(
      `${baseUrl}/api/platform/hotels/pending-approval`,
      { headers: operatorHeaders },
    );
    assert.equal(pendingResponse.status, 200);
    const pending = await pendingResponse.json();
    const pendingHotel = pending.data.find(
      (hotel) => hotel._id.toString() === registration.hotel.id.toString(),
    );
    assert.equal(pendingHotel?.manager.name, "Hotel Manager");
    assert.equal(pendingHotel?.manager.email, managerEmail);

    const earlyActivationResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/status`,
      {
        method: "PATCH",
        headers: { ...operatorHeaders, "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    assert.equal(earlyActivationResponse.status, 409);
    assert.equal((await earlyActivationResponse.json()).error, "hotel_not_approved");

    const approvalResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/approve`,
      { method: "POST", headers: operatorHeaders },
    );
    assert.equal(approvalResponse.status, 200);
    assert.equal((await approvalResponse.json()).hotel.status, "approved");

    const activationResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/status`,
      {
        method: "PATCH",
        headers: { ...operatorHeaders, "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    assert.equal(activationResponse.status, 409);
    assert.equal((await activationResponse.json()).error, "subscription_not_active");

    const forgotPasswordResponse = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail }),
    });
    assert.equal(forgotPasswordResponse.status, 202);
    const resetEmail = sentEmails.findLast((email) => email.type === "password_reset");
    assert.ok(resetEmail?.token);

    const resetPasswordResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: resetEmail.token, password: resetPassword }),
    });
    assert.equal(resetPasswordResponse.status, 200);

    const oldPasswordLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, password }),
    });
    assert.equal(oldPasswordLoginResponse.status, 401);

    const resetPasswordLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, password: resetPassword }),
    });
    assert.equal(resetPasswordLoginResponse.status, 200);

    const replayedResetResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: resetEmail.token, password }),
    });
    assert.equal(replayedResetResponse.status, 400);
    const oldAccessTokenResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${login.token}` },
    });
    assert.equal(oldAccessTokenResponse.status, 401);

    const unknownForgotResponse = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `unknown-${suffix}@example.test` }),
    });
    assert.equal(unknownForgotResponse.status, 202);
  } finally {
    if (hotelIds.length === 0) {
      const hotel = await Hotel.findOne({ email: hotelEmail }).select("_id");
      if (hotel) {
        hotelIds.push(hotel._id);
      }
    }
    await AuditLog.deleteMany({ targetId: { $in: hotelIds } });
    await AuthActionToken.deleteMany({ userId: { $in: [userId, operatorUserId].filter(Boolean) } });
    await PlatformOperator.deleteMany({ userId: operatorUserId });
    await Subscription.deleteMany({ hotelId: { $in: hotelIds } });
    await HotelMembership.deleteMany({ hotelId: { $in: hotelIds } });
    await Hotel.deleteMany({ _id: { $in: hotelIds } });
    await User.deleteMany({
      $or: [
        { email: managerEmail },
        { email: operatorEmail },
        ...(userId ? [{ _id: userId }] : []),
        ...(operatorUserId ? [{ _id: operatorUserId }] : []),
      ],
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    app.locals.sendVerificationEmail = originalSendVerificationEmail;
    app.locals.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }
});
