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
  const originalHotelProfileImageStorage = app.locals.hotelProfileImageStorage;
  const uploadedProfileImages = [];
  const deletedProfileImageIds = [];
  app.locals.hotelProfileImageStorage = {
    async uploadHotelProfileImage(buffer, hotelId) {
      const image = {
        publicId: `profile/${hotelId}/${uploadedProfileImages.length + 1}`,
        secureUrl: `https://images.example.test/${uploadedProfileImages.length + 1}.png`,
        bytes: buffer.length,
      };
      uploadedProfileImages.push(image);
      return image;
    },
    async deleteImage(publicId) {
      deletedProfileImageIds.push(publicId);
    },
    async deleteImages(images) {
      deletedProfileImageIds.push(...images.map(({ publicId }) => publicId));
    },
  };
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
          bankDetails: {
            bankName: "Example Bank",
            bankAccountNumber: "0012345678",
            accountName: "Example Hotel Ltd",
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
    assert.deepEqual(
      (await Hotel.findById(registration.hotel.id).lean()).bankDetails,
      {
        bankName: "Example Bank",
        bankAccountNumber: "0012345678",
        accountName: "Example Hotel Ltd",
      },
    );
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
    const profileImagesUrl = `${baseUrl}/api/hotels/${registration.hotel.id}/profile-images`;
    const profileImageHeaders = { authorization: `Bearer ${login.token}` };
    const coverImageForm = new FormData();
    coverImageForm.append("slot", "cover");
    coverImageForm.append(
      "image",
      new Blob(["cover image"], { type: "image/png" }),
      "cover.png",
    );
    const coverImageResponse = await fetch(profileImagesUrl, {
      method: "POST",
      headers: profileImageHeaders,
      body: coverImageForm,
    });
    assert.equal(coverImageResponse.status, 200);
    const coverImageHotel = (await coverImageResponse.json()).hotel;
    assert.equal(coverImageHotel.coverImageUrl, "https://images.example.test/1.png");
    assert.equal(coverImageHotel.secondaryImageUrl, null);

    const secondaryImageForm = new FormData();
    secondaryImageForm.append("slot", "secondary");
    secondaryImageForm.append(
      "image",
      new Blob(["secondary image"], { type: "image/png" }),
      "secondary.png",
    );
    const secondaryImageResponse = await fetch(profileImagesUrl, {
      method: "POST",
      headers: profileImageHeaders,
      body: secondaryImageForm,
    });
    assert.equal(secondaryImageResponse.status, 200);
    assert.deepEqual(
      {
        coverImageUrl: (await secondaryImageResponse.json()).hotel.coverImageUrl,
        secondaryImageUrl: (await Hotel.findById(registration.hotel.id).lean())
          .secondaryImage.secureUrl,
      },
      {
        coverImageUrl: "https://images.example.test/1.png",
        secondaryImageUrl: "https://images.example.test/2.png",
      },
    );

    const replacementCoverForm = new FormData();
    replacementCoverForm.append("slot", "cover");
    replacementCoverForm.append(
      "image",
      new Blob(["replacement cover"], { type: "image/png" }),
      "cover-replacement.png",
    );
    const replacementCoverResponse = await fetch(profileImagesUrl, {
      method: "POST",
      headers: profileImageHeaders,
      body: replacementCoverForm,
    });
    assert.equal(replacementCoverResponse.status, 200);
    const replacedProfile = (await replacementCoverResponse.json()).hotel;
    assert.equal(replacedProfile.coverImageUrl, "https://images.example.test/3.png");
    assert.equal(replacedProfile.secondaryImageUrl, "https://images.example.test/2.png");
    assert.deepEqual(deletedProfileImageIds, [`profile/${registration.hotel.id}/1`]);

    const updatedBankDetails = {
      bankName: "Updated Example Bank",
      bankAccountNumber: "0009876543",
      accountName: "Updated Example Hotel Ltd",
    };
    const bankDetailsResponse = await fetch(
      `${baseUrl}/api/hotels/${registration.hotel.id}/bank-details`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${login.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(updatedBankDetails),
      },
    );
    assert.equal(bankDetailsResponse.status, 200);
    assert.deepEqual((await bankDetailsResponse.json()).bankDetails, updatedBankDetails);

    const hotelSettingsResponse = await fetch(
      `${baseUrl}/api/hotels/${registration.hotel.id}/settings`,
      { headers: { authorization: `Bearer ${login.token}` } },
    );
    assert.equal(hotelSettingsResponse.status, 200);
    const hotelSettings = (await hotelSettingsResponse.json()).hotel;
    assert.equal(hotelSettings.id, registration.hotel.id);
    assert.equal(hotelSettings.name, "Example Hotel");
    assert.deepEqual(hotelSettings.bankDetails, updatedBankDetails);
    assert.equal(hotelSettings.coverImageUrl, "https://images.example.test/3.png");
    assert.equal(hotelSettings.secondaryImageUrl, "https://images.example.test/2.png");

    const publicHotelResponse = await fetch(
      `${baseUrl}/api/public/hotels/${registration.hotel.slug}`,
    );
    assert.equal(publicHotelResponse.status, 200);
    const publicHotel = (await publicHotelResponse.json()).hotel;
    assert.deepEqual(
      publicHotel.bankDetails,
      updatedBankDetails,
    );
    assert.equal(publicHotel.coverImageUrl, "https://images.example.test/3.png");
    assert.equal(publicHotel.secondaryImageUrl, "https://images.example.test/2.png");

    const deleteCoverResponse = await fetch(`${profileImagesUrl}/cover`, {
      method: "DELETE",
      headers: profileImageHeaders,
    });
    assert.equal(deleteCoverResponse.status, 200);
    const hotelAfterCoverRemoval = (await deleteCoverResponse.json()).hotel;
    assert.equal(hotelAfterCoverRemoval.coverImageUrl, null);
    assert.equal(hotelAfterCoverRemoval.secondaryImageUrl, "https://images.example.test/2.png");
    const deleteSecondaryResponse = await fetch(`${profileImagesUrl}/secondary`, {
      method: "DELETE",
      headers: profileImageHeaders,
    });
    assert.equal(deleteSecondaryResponse.status, 200);
    const hotelAfterImageRemoval = (await deleteSecondaryResponse.json()).hotel;
    assert.equal(hotelAfterImageRemoval.coverImageUrl, null);
    assert.equal(hotelAfterImageRemoval.secondaryImageUrl, null);
    assert.deepEqual(deletedProfileImageIds, [
      `profile/${registration.hotel.id}/1`,
      `profile/${registration.hotel.id}/3`,
      `profile/${registration.hotel.id}/2`,
    ]);

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
    app.locals.hotelProfileImageStorage = originalHotelProfileImageStorage;
  }
});
