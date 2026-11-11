require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

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
    Plan,
    PlanPrice,
    PlatformOperator,
    RefreshSession,
    Subscription,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");

  const suffix = randomUUID();
  const managerEmail = `manager-${suffix}@example.test`;
  const operatorEmail = `operator-${suffix}@example.test`;
  const hotelEmail = `hotel-${suffix}@example.test`;
  const password = "unique-test-password-2026";
  const operatorPassword = "unique-operator-password-2026";
  const resetPassword = "another-unique-password-2026";
  const hotelIds = [];
  let userId;
  let operatorUserId;
  let planId;
  const sentEmails = [];
  const originalSendVerificationCodeEmail = app.locals.sendVerificationCodeEmail;
  const originalSendPasswordResetEmail = app.locals.sendPasswordResetEmail;
  app.locals.sendVerificationCodeEmail = async (user, code) => {
    sentEmails.push({ type: "verification", user, code });
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
    assert.equal(registration.message, "We sent a code to your email.");
    assert.equal(registration.verificationCodeResendAvailableInSeconds, 60);
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
    assert.match(registrationMail?.code, /^\d{6}$/);
    const storedVerificationToken = await AuthActionToken.findOne({
      userId: manager._id,
      purpose: "email_verification",
    });
    assert.ok(storedVerificationToken);
    assert.notEqual(storedVerificationToken.tokenHash, registrationMail.code);
    assert.equal(storedVerificationToken.attempts, 0);

    const unverifiedLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, password }),
    });
    assert.equal(unverifiedLoginResponse.status, 403);
    assert.equal((await unverifiedLoginResponse.json()).error, "email_not_verified");

    const incorrectCode = registrationMail.code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const incorrectResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: managerEmail, code: incorrectCode }),
      });
      assert.equal(incorrectResponse.status, 400);
      assert.equal((await incorrectResponse.json()).attemptsRemaining, 2 - attempt);
    }
    const lockedCodeResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, code: incorrectCode }),
    });
    assert.equal(lockedCodeResponse.status, 429);
    assert.equal((await lockedCodeResponse.json()).error, "verification_code_locked");

    const verificationEmailCount = sentEmails.filter((email) => email.type === "verification").length;
    const cooldownResponse = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail }),
    });
    assert.equal(cooldownResponse.status, 202);
    assert.equal(sentEmails.filter((email) => email.type === "verification").length, verificationEmailCount);

    await User.updateOne(
      { _id: manager._id },
      { $set: { verificationCodeSentAt: new Date(Date.now() - 61_000) } },
    );
    const resendResponse = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail }),
    });
    assert.equal(resendResponse.status, 202);
    const latestVerificationMail = sentEmails.findLast((email) => email.type === "verification");
    assert.match(latestVerificationMail.code, /^\d{6}$/);

    const verificationResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, code: latestVerificationMail.code }),
    });
    assert.equal(verificationResponse.status, 200);
    assert.ok((await User.findById(manager._id)).emailVerifiedAt);
    assert.equal((await Hotel.findById(registration.hotel.id)).status, "active");

    const replayedVerificationResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: managerEmail, code: latestVerificationMail.code }),
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
      headers: {
        "content-type": "application/json",
        origin: new URL(process.env.FRONTEND_URL).origin,
      },
      body: JSON.stringify({ email: managerEmail, password }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    assert.ok(login.token);
    const managerRefreshCookie = loginResponse.headers.get("set-cookie").split(";", 1)[0];

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
    const managerStatusResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/status`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${login.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "suspended" }),
      },
    );
    assert.equal(managerStatusResponse.status, 403);

    const operator = await User.create({
      name: "Test Platform Operator",
      email: operatorEmail,
      passwordHash: await bcrypt.hash(operatorPassword, 12),
    });
    operatorUserId = operator._id;
    await PlatformOperator.create({
      userId: operator._id,
      role: "super_admin",
      active: true,
    });
    assert.equal(operator.emailVerifiedAt, null);
    const operatorLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operatorEmail, password: operatorPassword }),
    });
    assert.equal(operatorLoginResponse.status, 200);
    assert.ok((await operatorLoginResponse.json()).token);
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
    assert.equal(pendingHotel, undefined);

    const plan = await Plan.create({
      name: "Test Trial Plan",
      code: `TEST_${suffix.replace(/-/g, "").slice(0, 8)}`,
      description: "Integration-test plan",
      planType: "trial",
      trialDays: 60,
      features: { reservations: true },
      limits: { rooms: null },
    });
    planId = plan._id;
    const planPrice = await PlanPrice.create({
      planId: plan._id,
      billingInterval: "6_months",
      amountMinor: 123456,
      currency: "NGN",
    });
    await Subscription.updateOne(
      { hotelId: registration.hotel.id },
      {
        $set: {
          planId: plan._id,
          planPriceId: planPrice._id,
          planSnapshot: { code: plan.code, name: plan.name, planType: "trial" },
          status: "trialing",
          billing_interval: "6_months",
          selected_at: new Date(),
          trial_start_date: new Date(),
          trial_end_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        },
      },
    );
    const allHotelsResponse = await fetch(
      `${baseUrl}/api/platform/hotels?page=1&limit=100`,
      { headers: operatorHeaders },
    );
    assert.equal(allHotelsResponse.status, 200);
    const allHotels = await allHotelsResponse.json();
    const listedHotel = allHotels.data.find(
      (hotel) => hotel._id.toString() === registration.hotel.id.toString(),
    );
    assert.equal(listedHotel.address.line1, "1 Example Road");
    assert.equal(listedHotel.manager.email, managerEmail);
    assert.ok(listedHotel.manager.emailVerifiedAt);
    assert.equal(listedHotel.subscription.status, "trialing");
    assert.equal(listedHotel.subscription.plan.code, plan.code);
    assert.equal(listedHotel.subscription.plan_price.amount, 123456);
    assert.equal(listedHotel.subscription.trial_end_date != null, true);

    const suspendResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/status`,
      {
        method: "PATCH",
        headers: { ...operatorHeaders, "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      },
    );
    assert.equal(suspendResponse.status, 200);
    assert.equal((await suspendResponse.json()).hotel.status, "suspended");

    const suspendedOperationResponse = await fetch(
      `${baseUrl}/api/hotels/${registration.hotel.id}/onboarding`,
      { headers: { authorization: `Bearer ${login.token}` } },
    );
    assert.equal(suspendedOperationResponse.status, 403);
    assert.equal((await suspendedOperationResponse.json()).error, "hotel_suspended");

    const activationResponse = await fetch(
      `${baseUrl}/api/platform/hotels/${registration.hotel.id}/status`,
      {
        method: "PATCH",
        headers: { ...operatorHeaders, "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      },
    );
    assert.equal(activationResponse.status, 200);
    assert.equal((await activationResponse.json()).hotel.status, "active");

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
    const refreshAfterPasswordReset = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        origin: new URL(process.env.FRONTEND_URL).origin,
        cookie: managerRefreshCookie,
      },
    });
    assert.equal(refreshAfterPasswordReset.status, 401);

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
    await RefreshSession.deleteMany({ userId: { $in: [userId, operatorUserId].filter(Boolean) } });
    await PlatformOperator.deleteMany({ userId: operatorUserId });
    await Subscription.deleteMany({ hotelId: { $in: hotelIds } });
    if (planId) {
      await PlanPrice.deleteMany({ planId });
      await Plan.deleteOne({ _id: planId });
    }
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
    app.locals.sendVerificationCodeEmail = originalSendVerificationCodeEmail;
    app.locals.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }
});
