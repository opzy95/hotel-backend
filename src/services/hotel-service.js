const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { Hotel, HotelMembership, Plan, PlanPrice, Subscription } = require("../models");
const { publicHotel } = require("../utils/public-resources");

async function createHotelWorkspace(hotelDetails, manager, session) {
  const slugBase = hotelDetails.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "hotel";
  const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;

  const [hotel] = await Hotel.create(
    [{
      ...hotelDetails,
      email: hotelDetails.email.toLowerCase(),
      address: {
        ...hotelDetails.address,
        country: hotelDetails.address.country.toUpperCase(),
      },
      slug,
      status: "pending_approval",
      settings: {},
      setupCompletedSteps: ["registration"],
    }],
    { session },
  );
  await HotelMembership.create(
    [{ hotelId: hotel._id, userId: manager._id, role: "manager", status: "active" }],
    { session },
  );
  await Subscription.create(
    [{ hotelId: hotel._id, status: "pending_selection" }],
    { session },
  );
  return hotel;
}

async function createHotel(details, manager) {
  const session = await mongoose.startSession();
  let hotel;
  try {
    await session.withTransaction(async () => {
      hotel = await createHotelWorkspace(details, manager, session);
    });
  } finally {
    await session.endSession();
  }
  return hotel;
}

async function getPublicPlans() {
  const [plans, planPrices] = await Promise.all([
    Plan.find({ active: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean(),
    PlanPrice.find({ active: true })
      .populate("planId", "code")
      .sort({ billingInterval: 1, amountMinor: 1 })
      .lean(),
  ]);

  return {
    plans: plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      description: plan.description || "",
      plan_type: plan.planType || "paid",
      trial_days: Number(plan.trialDays || 0),
      is_active: Boolean(plan.active),
      is_public: Boolean(plan.isPublic),
      sort_order: Number(plan.sortOrder || 0),
      features: plan.features && typeof plan.features === "object" ? plan.features : {},
      limits: plan.limits && typeof plan.limits === "object" ? plan.limits : {},
    })),
    plan_prices: planPrices.map((price) => ({
      plan_code: price.planId?.code || "",
      billing_interval: price.billingInterval,
      amount: Number(price.amountMinor || 0),
      currency: price.currency,
      is_active: Boolean(price.active),
    })),
  };
}

async function getOnboarding(hotelId) {
  const [hotel, subscription] = await Promise.all([
    Hotel.findById(hotelId).select("status setupCompletedSteps"),
    Subscription.findOne({ hotelId }).populate("planId", "name code"),
  ]);
  if (!hotel) {
    return null;
  }

  const completedSteps = hotel.setupCompletedSteps || ["registration"];
  return {
    hotelStatus: hotel.status,
    currentStep: !subscription?.planId
      ? "choose_plan"
      : completedSteps.includes("configure_hotel")
        ? "complete"
        : "configure_hotel",
    completedSteps,
    subscription: subscription ? {
      status: subscription.status,
      plan: subscription.planId,
      trialEndsAt: subscription.trialEndsAt,
    } : null,
  };
}

async function selectSubscriptionPlan(hotelId, planId) {
  const plan = await Plan.findOne({ _id: planId, active: true });
  if (!plan) {
    return { error: "plan_not_found" };
  }

  const trialEndsAt = plan.trialDays
    ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
    : undefined;
  const subscriptionUpdate = {
    $set: {
      planId: plan._id,
      planSnapshot: {
        name: plan.name,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        interval: plan.interval,
      },
      status: trialEndsAt
        ? "trialing"
        : plan.amountMinor === 0
          ? "active"
          : "pending_payment",
      ...(trialEndsAt ? { trialEndsAt } : {}),
    },
  };
  if (!trialEndsAt) {
    subscriptionUpdate.$unset = { trialEndsAt: 1 };
  }

  const subscription = await Subscription.findOneAndUpdate(
    {
      hotelId,
      status: { $in: ["pending_selection", "pending_payment"] },
    },
    subscriptionUpdate,
    { new: true, runValidators: true },
  ).populate("planId", "name code amountMinor currency interval trialDays features");
  if (!subscription) {
    return { error: "subscription_selection_locked" };
  }

  await Hotel.updateOne(
    { _id: hotelId },
    { $addToSet: { setupCompletedSteps: "choose_plan" } },
  );
  return {
    subscription: {
      status: subscription.status,
      plan: subscription.planId,
      planSnapshot: subscription.planSnapshot,
      trialEndsAt: subscription.trialEndsAt,
    },
    paymentRequired: subscription.status === "pending_payment",
  };
}

async function updateSettings(hotelId, settings) {
  const hotel = await Hotel.findById(hotelId);
  if (!hotel) {
    return null;
  }
  hotel.settings = { ...(hotel.toObject().settings || {}), ...settings };
  const requiredSettings = [
    "timezone",
    "locale",
    "currency",
    "checkInTime",
    "checkOutTime",
  ];
  if (
    requiredSettings.every((key) => hotel.settings[key])
    && !hotel.setupCompletedSteps.includes("configure_hotel")
  ) {
    hotel.setupCompletedSteps.push("configure_hotel");
  }
  await hotel.save();
  return publicHotel(hotel);
}

module.exports = {
  createHotel,
  createHotelWorkspace,
  getOnboarding,
  getPublicPlans,
  publicHotel,
  selectSubscriptionPlan,
  updateSettings,
};
