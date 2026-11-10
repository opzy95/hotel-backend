require("dotenv").config();

const { randomBytes, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;
process.env.JWT_SECRET ||= randomBytes(32).toString("hex");

test("free trial requires verified email, expires, and cannot be reused", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const {
    Hotel,
    HotelMembership,
    Plan,
    Subscription,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");

  await mongoose.connect(testMongoUri);
  const suffix = randomUUID();
  const user = await User.create({
    name: "Trial Manager",
    email: `trial-manager-${suffix}@example.test`,
    passwordHash: "test-only-hash",
  });
  const hotel = await Hotel.create({
    name: "Trial Hotel",
    email: `trial-hotel-${suffix}@example.test`,
    phone: "+10000000000",
    address: { line1: "1 Trial Street", city: "Test", country: "US" },
    type: "test",
    roomCount: 1,
    slug: `trial-hotel-${suffix}`,
  });
  const plan = await Plan.create({
    name: "Free Trial",
    code: `FREE_TRIAL_${suffix.replace(/-/g, "").slice(0, 8)}`,
    planType: "trial",
    trialDays: 60,
    active: true,
  });
  await HotelMembership.create({
    hotelId: hotel._id,
    userId: user._id,
    role: "manager",
    status: "active",
  });
  await Subscription.create({
    hotelId: hotel._id,
    status: "pending_selection",
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    authorization: `Bearer ${signAccessToken(user._id, user.authVersion)}`,
    "content-type": "application/json",
  };
  const selectTrial = () => fetch(`${baseUrl}/api/hotels/${hotel._id}/subscription`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ planId: plan._id }),
  });

  try {
    const unverifiedResponse = await selectTrial();
    assert.equal(unverifiedResponse.status, 403);
    assert.equal((await unverifiedResponse.json()).error, "email_not_verified");

    await User.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
    const selectionResponse = await selectTrial();
    assert.equal(selectionResponse.status, 200);
    const selection = await selectionResponse.json();
    assert.equal(selection.subscription.status, "trialing");
    const start = new Date(selection.subscription.trial_start_date);
    const end = new Date(selection.subscription.trial_end_date);
    assert.equal(end.getTime() - start.getTime(), 60 * 24 * 60 * 60 * 1000);

    await Subscription.updateOne(
      { hotelId: hotel._id },
      { $set: { trial_end_date: new Date(Date.now() - 1000) } },
    );
    const onboardingResponse = await fetch(
      `${baseUrl}/api/hotels/${hotel._id}/onboarding`,
      { headers },
    );
    assert.equal(onboardingResponse.status, 200);
    assert.equal((await onboardingResponse.json()).subscription.status, "expired");

    const settingsResponse = await fetch(`${baseUrl}/api/hotels/${hotel._id}/settings`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ timezone: "Africa/Lagos" }),
    });
    assert.equal(settingsResponse.status, 403);
    assert.equal((await settingsResponse.json()).error, "subscription_expired");

    const reusedTrialResponse = await selectTrial();
    assert.equal(reusedTrialResponse.status, 409);
    assert.equal((await reusedTrialResponse.json()).error, "trial_already_used");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await Subscription.deleteMany({ hotelId: hotel._id });
    await HotelMembership.deleteMany({ hotelId: hotel._id });
    await Hotel.deleteOne({ _id: hotel._id });
    await Plan.deleteOne({ _id: plan._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
});
