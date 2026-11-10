const { Plan, PlanPrice } = require("../models");

const DEFAULT_PLANS = [
  {
    code: "FREE_TRIAL",
    name: "Free Trial",
    description: "Explore all Professional hotel management features free for 60 days.",
    planType: "trial",
    trialDays: 60,
    active: true,
    isPublic: true,
    sortOrder: 1,
    features: {
      dashboard: true,
      reservations: true,
      room_management: true,
      room_categories: true,
      guest_management: true,
      check_in_check_out: true,
      staff_management: true,
      role_permissions: true,
      housekeeping: true,
      reports: true,
      public_booking_website: true,
      online_payments: true,
      notifications: true,
    },
    limits: {
      rooms: null,
      staff_accounts: null,
      reservations: null,
    },
  },
  {
    code: "PROFESSIONAL",
    name: "Professional",
    description: "Complete hotel management solution for growing hotels.",
    planType: "paid",
    trialDays: 0,
    active: true,
    isPublic: true,
    sortOrder: 2,
    features: {
      dashboard: true,
      reservations: true,
      room_management: true,
      room_categories: true,
      guest_management: true,
      check_in_check_out: true,
      staff_management: true,
      role_permissions: true,
      housekeeping: true,
      reports: true,
      public_booking_website: true,
      online_payments: true,
      notifications: true,
    },
    limits: {
      rooms: null,
      staff_accounts: null,
      reservations: null,
    },
  },
];

const DEFAULT_PLAN_PRICES = [
  {
    planCode: "PROFESSIONAL",
    billingInterval: "6_months",
    amountMinor: 150000,
    currency: "NGN",
    active: true,
  },
  {
    planCode: "PROFESSIONAL",
    billingInterval: "12_months",
    amountMinor: 270000,
    currency: "NGN",
    active: true,
  },
];

function normalizePlanPayload(payload = {}) {
  const planType = payload.plan_type ?? payload.planType ?? "paid";
  const active = payload.is_active ?? payload.active ?? true;
  const isPublic = payload.is_public ?? payload.isPublic ?? true;

  return {
    name: payload.name,
    code: String(payload.code || payload.plan_code || "").trim().toUpperCase(),
    description: payload.description || "",
    planType: planType === "trial" ? "trial" : "paid",
    trialDays: Number(payload.trial_days ?? payload.trialDays ?? 0) || 0,
    active: Boolean(active),
    isPublic: Boolean(isPublic),
    sortOrder: Number(payload.sort_order ?? payload.sortOrder ?? 0) || 0,
    features: payload.features && typeof payload.features === "object" ? payload.features : {},
    limits: payload.limits && typeof payload.limits === "object" ? payload.limits : {},
  };
}

async function ensurePublicPlans() {
  const plans = [];
  for (const planSpec of DEFAULT_PLANS) {
    const normalized = normalizePlanPayload(planSpec);
    const plan = await Plan.findOneAndUpdate(
      { code: normalized.code },
      {
        $set: { ...normalized },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
    plans.push(plan);
  }

  const planByCode = new Map(plans.map((plan) => [plan.code, plan]));
  const planPrices = [];
  for (const priceSpec of DEFAULT_PLAN_PRICES) {
    const plan = planByCode.get(priceSpec.planCode);
    if (!plan) {
      continue;
    }
    const price = await PlanPrice.findOneAndUpdate(
      {
        planId: plan._id,
        billingInterval: priceSpec.billingInterval,
      },
      {
        $set: {
          amountMinor: Number(priceSpec.amountMinor) || 0,
          currency: String(priceSpec.currency || "NGN").toUpperCase(),
          active: Boolean(priceSpec.active),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );
    planPrices.push({
      plan_code: priceSpec.planCode,
      amount: Number(price.amountMinor || 0),
      currency: price.currency,
      billing_interval: price.billingInterval,
      is_active: Boolean(price.active),
    });
  }

  return {
    plans: plans
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description || "",
        plan_type: plan.planType,
        trial_days: Number(plan.trialDays || 0),
        is_active: Boolean(plan.active),
        is_public: Boolean(plan.isPublic),
        sort_order: Number(plan.sortOrder || 0),
        features: plan.features && typeof plan.features === "object" ? plan.features : {},
        limits: plan.limits && typeof plan.limits === "object" ? plan.limits : {},
      })),
    plan_prices: planPrices,
  };
}

module.exports = {
  DEFAULT_PLAN_PRICES,
  DEFAULT_PLANS,
  ensurePublicPlans,
  normalizePlanPayload,
};
