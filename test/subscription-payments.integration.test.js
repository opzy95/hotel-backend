require("dotenv").config();

const { randomBytes, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;
process.env.JWT_SECRET ||= randomBytes(32).toString("hex");

test("Paystack verifies and activates only the selected platform subscription", {
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
    PlanPrice,
    Subscription,
    SubscriptionPayment,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");

  await mongoose.connect(testMongoUri);
  await SubscriptionPayment.init();
  const suffix = randomUUID();
  const originalGateway = app.locals.subscriptionPaymentGateway;
  const originalCallbackUrl = process.env.PAYSTACK_CALLBACK_URL;
  const calls = { initialize: [], verify: [] };
  let verificationAmount = 15000000;
  const gateway = {
    async initializeTransaction(transaction) {
      calls.initialize.push(transaction);
      return {
        authorizationUrl: "https://checkout.paystack.test/authorize",
        accessCode: "checkout-access",
        reference: transaction.reference,
      };
    },
    async verifyTransaction(reference) {
      calls.verify.push(reference);
      return {
        reference,
        status: "success",
        amountMinor: verificationAmount,
        currency: "NGN",
        channel: "card",
        paidAt: new Date().toISOString(),
      };
    },
  };
  app.locals.subscriptionPaymentGateway = gateway;
  process.env.PAYSTACK_CALLBACK_URL = "https://frontend.example.test/subscription/callback";

  const user = await User.create({
    name: "Subscription Manager",
    email: `subscription-manager-${suffix}@example.test`,
    passwordHash: "test-only-hash",
  });
  const hotel = await Hotel.create({
    name: "Subscription Hotel",
    email: `subscription-hotel-${suffix}@example.test`,
    phone: "+10000000000",
    address: { line1: "1 Subscription Street", city: "Test", country: "US" },
    type: "test",
    roomCount: 1,
    slug: `subscription-hotel-${suffix}`,
  });
  const plan = await Plan.create({
    name: "Paid Plan",
    code: `PAID_${suffix.replace(/-/g, "").slice(0, 8)}`,
    planType: "paid",
    trialDays: 0,
    active: true,
    isPublic: true,
  });
  const planPrice = await PlanPrice.create({
    planId: plan._id,
    billingInterval: "6_months",
    amountMinor: 15000000,
    currency: "NGN",
    active: true,
  });
  const legacyHotel = await Hotel.create({
    name: "Legacy Subscription Hotel",
    email: `legacy-subscription-hotel-${suffix}@example.test`,
    phone: "+10000000001",
    address: { line1: "2 Subscription Street", city: "Test", country: "US" },
    type: "test",
    roomCount: 1,
    slug: `legacy-subscription-hotel-${suffix}`,
  });
  await HotelMembership.create({
    hotelId: hotel._id,
    userId: user._id,
    role: "manager",
    status: "active",
  });
  await HotelMembership.create({
    hotelId: legacyHotel._id,
    userId: user._id,
    role: "manager",
    status: "active",
  });
  await Subscription.create({
    hotelId: hotel._id,
    status: "pending_selection",
  });
  await Subscription.create({
    hotelId: legacyHotel._id,
    planId: plan._id,
    planSnapshot: { code: plan.code, name: plan.name, planType: "paid" },
    status: "pending",
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    authorization: `Bearer ${signAccessToken(user._id, user.authVersion)}`,
    "content-type": "application/json",
  };

  try {
    const selectionResponse = await fetch(
      `${baseUrl}/api/hotels/${hotel._id}/subscription`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ planId: plan._id }),
      },
    );
    assert.equal(selectionResponse.status, 200);
    const selection = await selectionResponse.json();
    assert.equal(selection.subscription.status, "pending");
    assert.deepEqual(selection.subscription.planPrice, {
      billingInterval: "6_months",
      amountMinor: 15000000,
      currency: "NGN",
    });

    const initializeUrl = `${baseUrl}/api/hotels/${hotel._id}/subscription/payments/initialize`;
    const initializeResponse = await fetch(initializeUrl, { method: "POST", headers });
    assert.equal(initializeResponse.status, 200);
    const checkout = await initializeResponse.json();
    assert.equal(checkout.checkout.authorizationUrl, "https://checkout.paystack.test/authorize");
    assert.equal(checkout.payment.amountMinor, 15000000);
    assert.equal(checkout.payment.currency, "NGN");
    assert.equal(calls.initialize.length, 1);
    assert.equal(calls.initialize[0].email, user.email);
    assert.equal(calls.initialize[0].callbackUrl, process.env.PAYSTACK_CALLBACK_URL);

    const retryResponse = await fetch(initializeUrl, { method: "POST", headers });
    assert.equal(retryResponse.status, 200);
    assert.equal((await retryResponse.json()).payment.reference, checkout.payment.reference);
    assert.equal(calls.initialize.length, 1);

    const verifyUrl = `${baseUrl}/api/hotels/${hotel._id}/subscription/payments/verify`;
    const verifyResponse = await fetch(verifyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ reference: checkout.payment.reference }),
    });
    assert.equal(verifyResponse.status, 200);
    const verified = await verifyResponse.json();
    assert.equal(verified.payment.status, "successful");
    assert.equal(verified.subscription.status, "active");
    assert.ok(new Date(verified.subscription.expiresAt) > new Date(verified.subscription.activatedAt));

    const repeatedVerifyResponse = await fetch(verifyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ reference: checkout.payment.reference }),
    });
    assert.equal(repeatedVerifyResponse.status, 200);
    assert.equal((await repeatedVerifyResponse.json()).payment.status, "successful");
    assert.equal(calls.verify.length, 1);

    const storedPayment = await SubscriptionPayment.findOne({
      providerReference: checkout.payment.reference,
    }).lean();
    assert.equal(storedPayment.status, "successful");
    assert.equal(storedPayment.planPriceId.toString(), planPrice._id.toString());
    assert.equal((await Subscription.findOne({ hotelId: hotel._id })).status, "active");

    const legacyInitializeResponse = await fetch(
      `${baseUrl}/api/hotels/${legacyHotel._id}/subscription/payments/initialize`,
      { method: "POST", headers },
    );
    assert.equal(legacyInitializeResponse.status, 200);
    const legacyCheckout = await legacyInitializeResponse.json();
    const migratedSubscription = await Subscription.findOne({
      hotelId: legacyHotel._id,
    }).lean();
    assert.equal(migratedSubscription.planPriceId.toString(), planPrice._id.toString());
    assert.equal(migratedSubscription.planSnapshot.amountMinor, 15000000);
    assert.equal(calls.initialize.length, 2);

    verificationAmount = 14999999;
    const mismatchResponse = await fetch(
      `${baseUrl}/api/hotels/${legacyHotel._id}/subscription/payments/verify`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reference: legacyCheckout.payment.reference }),
      },
    );
    assert.equal(mismatchResponse.status, 409);
    assert.equal((await mismatchResponse.json()).error, "payment_details_mismatch");
    assert.equal((await Subscription.findOne({ hotelId: legacyHotel._id })).status, "pending");
    assert.equal(calls.verify.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.subscriptionPaymentGateway = originalGateway;
    if (originalCallbackUrl === undefined) {
      delete process.env.PAYSTACK_CALLBACK_URL;
    } else {
      process.env.PAYSTACK_CALLBACK_URL = originalCallbackUrl;
    }
    const hotelIds = [hotel._id, legacyHotel._id];
    await SubscriptionPayment.deleteMany({ hotelId: { $in: hotelIds } });
    await Subscription.deleteMany({ hotelId: { $in: hotelIds } });
    await HotelMembership.deleteMany({ hotelId: { $in: hotelIds } });
    await PlanPrice.deleteOne({ _id: planPrice._id });
    await Hotel.deleteMany({ _id: { $in: hotelIds } });
    await Plan.deleteOne({ _id: plan._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
});
