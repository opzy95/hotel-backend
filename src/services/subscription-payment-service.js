const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const {
  PlanPrice,
  Subscription,
  SubscriptionPayment,
} = require("../models");
const {
  PaystackConfigurationError,
  paystackClient,
} = require("./paystack-client");

function subscriptionPaymentResource(payment) {
  return {
    reference: payment.providerReference,
    provider: payment.provider,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    verifiedAt: payment.verifiedAt || null,
  };
}

function checkoutResource(payment) {
  return {
    payment: subscriptionPaymentResource(payment),
    checkout: {
      authorizationUrl: payment.metadata.authorizationUrl,
      accessCode: payment.metadata.accessCode,
    },
  };
}

function getCallbackUrl() {
  const callbackUrl = process.env.PAYSTACK_CALLBACK_URL?.trim()
    || process.env.FRONTEND_URL?.trim();
  if (!callbackUrl) {
    throw new PaystackConfigurationError(
      "PAYSTACK_CALLBACK_URL or FRONTEND_URL must be configured",
    );
  }
  let parsed;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new PaystackConfigurationError(
      "Paystack callback URL must be a valid absolute URL",
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
  ) {
    throw new PaystackConfigurationError(
      "Paystack callback URL must use HTTP or HTTPS",
    );
  }
  return parsed.toString();
}

function addBillingInterval(startDate, billingInterval) {
  const months = billingInterval === "6_months"
    ? 6
    : billingInterval === "12_months"
      ? 12
      : null;
  if (months === null) {
    return null;
  }

  const start = new Date(startDate);
  const day = start.getUTCDate();
  const targetMonth = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth() + months,
    1,
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonth.setUTCDate(Math.min(day, lastDay));
  return targetMonth;
}

async function findActivePendingPayment(subscriptionId) {
  return SubscriptionPayment.findOne({
    subscriptionId,
    status: "pending",
  }).sort({ createdAt: -1 }).lean();
}

async function bindLegacyPendingPlanPrice(subscription) {
  const activePrices = await PlanPrice.find({
    planId: subscription.planId,
    active: true,
  }).sort({ billingInterval: 1 }).lean();
  let planPrice;
  if (subscription.billing_interval) {
    planPrice = activePrices.find(
      (price) => price.billingInterval === subscription.billing_interval,
    );
  } else if (activePrices.length === 1) {
    [planPrice] = activePrices;
  } else if (activePrices.length > 1) {
    return { error: "billing_interval_required" };
  }
  if (
    !planPrice
    || !Number.isSafeInteger(planPrice.amountMinor)
    || planPrice.amountMinor <= 0
    || !/^[A-Z]{3}$/.test(planPrice.currency)
  ) {
    return { error: "plan_price_unavailable" };
  }

  const updatedSubscription = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      status: "pending",
      $or: [
        { planPriceId: null },
        { planPriceId: { $exists: false } },
      ],
    },
    {
      $set: {
        planPriceId: planPrice._id,
        billing_interval: planPrice.billingInterval,
        planSnapshot: {
          ...subscription.planSnapshot,
          amountMinor: planPrice.amountMinor,
          currency: planPrice.currency,
          billingInterval: planPrice.billingInterval,
        },
      },
    },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (updatedSubscription) {
    return { subscription: updatedSubscription };
  }

  const currentSubscription = await Subscription.findById(subscription._id).lean();
  return currentSubscription?.planPriceId
    ? { subscription: currentSubscription }
    : { error: "subscription_not_payable" };
}

async function initializeSubscriptionPayment(hotelId, manager, gateway = paystackClient) {
  let subscription = await Subscription.findOne({ hotelId }).lean();
  if (!subscription) {
    return { error: "subscription_not_found" };
  }
  if (subscription.status === "pending" && !subscription.planPriceId) {
    const binding = await bindLegacyPendingPlanPrice(subscription);
    if (binding.error) {
      return binding;
    }
    subscription = binding.subscription;
  }
  if (subscription.status !== "pending" || !subscription.planPriceId) {
    return { error: "subscription_not_payable" };
  }

  const planPrice = await PlanPrice.findOne({
    _id: subscription.planPriceId,
    planId: subscription.planId,
  }).lean();
  const amountMinor = subscription.planSnapshot?.amountMinor;
  const currency = subscription.planSnapshot?.currency;
  if (
    !planPrice
    || !Number.isSafeInteger(amountMinor)
    || amountMinor <= 0
    || typeof currency !== "string"
    || !/^[A-Z]{3}$/.test(currency)
    || planPrice.billingInterval !== subscription.billing_interval
  ) {
    return { error: "plan_price_unavailable" };
  }

  const pendingPayment = await findActivePendingPayment(subscription._id);
  if (pendingPayment) {
    return pendingPayment.metadata?.authorizationUrl && pendingPayment.metadata?.accessCode
      ? checkoutResource(pendingPayment)
      : { error: "payment_initialization_in_progress" };
  }

  const providerReference = `SUB-${randomUUID()}`;
  const checkout = await gateway.initializeTransaction({
    email: manager.email,
    amountMinor,
    currency,
    reference: providerReference,
    callbackUrl: getCallbackUrl(),
    metadata: {
      hotelId: hotelId.toString(),
      subscriptionId: subscription._id.toString(),
      planCode: subscription.planSnapshot?.code || "",
      billingInterval: planPrice.billingInterval,
    },
  });

  const paymentData = {
    hotelId,
    subscriptionId: subscription._id,
    planPriceId: planPrice._id,
    provider: "paystack",
    providerReference,
    amountMinor,
    currency,
    status: "pending",
    metadata: {
      authorizationUrl: checkout.authorizationUrl,
      accessCode: checkout.accessCode,
    },
  };

  try {
    const [payment] = await SubscriptionPayment.create([paymentData]);
    return checkoutResource(payment);
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
    const existing = await findActivePendingPayment(subscription._id);
    return existing?.metadata?.authorizationUrl && existing?.metadata?.accessCode
      ? checkoutResource(existing)
      : { error: "payment_initialization_in_progress" };
  }
}

async function markPaymentUnsuccessful(payment, gatewayStatus) {
  const status = gatewayStatus === "abandoned"
    ? "cancelled"
    : gatewayStatus === "failed"
      ? "failed"
      : "pending";
  if (status !== "pending") {
    await SubscriptionPayment.updateOne(
      { _id: payment._id, status: "pending" },
      {
        $set: {
          status,
          "metadata.gatewayStatus": gatewayStatus,
        },
      },
    );
  }
  return { error: "payment_not_successful", paymentStatus: status };
}

async function markPaymentMismatched(payment, reason) {
  await SubscriptionPayment.updateOne(
    { _id: payment._id, status: "pending" },
    {
      $set: {
        status: "failed",
        "metadata.failureReason": reason,
      },
    },
  );
  return { error: "payment_details_mismatch" };
}

async function verifiedPaymentResult(payment) {
  const subscription = await Subscription.findOne({
    _id: payment.subscriptionId,
    hotelId: payment.hotelId,
  }).lean();
  return {
    payment: subscriptionPaymentResource(payment),
    subscription: subscription ? {
      status: subscription.status,
      billingInterval: subscription.billing_interval || null,
      activatedAt: subscription.activated_at || null,
      expiresAt: subscription.expires_at || null,
    } : null,
  };
}

async function verifySubscriptionPayment(hotelId, reference, gateway = paystackClient) {
  const payment = await SubscriptionPayment.findOne({
    hotelId,
    provider: "paystack",
    providerReference: reference,
  }).lean();
  if (!payment) {
    return { error: "payment_not_found" };
  }
  if (payment.status === "successful") {
    return verifiedPaymentResult(payment);
  }
  if (payment.status !== "pending") {
    return { error: "payment_not_pending", paymentStatus: payment.status };
  }

  const subscription = await Subscription.findOne({
    _id: payment.subscriptionId,
    hotelId,
    status: "pending",
    planPriceId: payment.planPriceId,
  }).lean();
  if (!subscription) {
    return { error: "subscription_not_payable" };
  }

  const verified = await gateway.verifyTransaction(reference);
  if (verified.reference !== payment.providerReference) {
    return markPaymentMismatched(payment, "reference_mismatch");
  }
  if (verified.amountMinor !== payment.amountMinor) {
    return markPaymentMismatched(payment, "amount_mismatch");
  }
  if (verified.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    return markPaymentMismatched(payment, "currency_mismatch");
  }
  if (verified.status !== "success") {
    return markPaymentUnsuccessful(payment, verified.status);
  }

  const activatedAt = new Date();
  const expiresAt = addBillingInterval(activatedAt, subscription.billing_interval);
  if (!expiresAt) {
    return { error: "subscription_interval_invalid" };
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const updatedSubscription = await Subscription.findOneAndUpdate(
        {
          _id: subscription._id,
          hotelId,
          status: "pending",
          planPriceId: payment.planPriceId,
        },
        {
          $set: {
            status: "active",
            activated_at: activatedAt,
            expires_at: expiresAt,
          },
        },
        { returnDocument: "after", session },
      );
      if (!updatedSubscription) {
        result = { error: "subscription_not_payable" };
        return;
      }

      const updatedPayment = await SubscriptionPayment.findOneAndUpdate(
        { _id: payment._id, status: "pending" },
        {
          $set: {
            status: "successful",
            verifiedAt: activatedAt,
            "metadata.gatewayStatus": verified.status,
            "metadata.channel": verified.channel,
            "metadata.paidAt": verified.paidAt,
          },
        },
        { returnDocument: "after", session },
      );
      if (!updatedPayment) {
        throw new Error("Subscription payment changed while being verified");
      }
      result = {
        payment: subscriptionPaymentResource(updatedPayment),
        subscription: {
          status: updatedSubscription.status,
          billingInterval: updatedSubscription.billing_interval,
          activatedAt: updatedSubscription.activated_at,
          expiresAt: updatedSubscription.expires_at,
        },
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

module.exports = {
  addBillingInterval,
  initializeSubscriptionPayment,
  verifySubscriptionPayment,
};
