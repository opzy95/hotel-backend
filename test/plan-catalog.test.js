const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PLAN_PRICES, DEFAULT_PLANS } = require("../src/services/plan-seed");
const { planSelectionSchema } = require("../src/schemas");

test("default catalog separates Standard six-month and Professional yearly plans", () => {
  assert.deepEqual(
    DEFAULT_PLANS.map(({ code, name, planType, trialDays }) => ({
      code,
      name,
      planType,
      trialDays,
    })),
    [
      { code: "FREE_TRIAL", name: "Free Trial", planType: "trial", trialDays: 60 },
      { code: "STANDARD", name: "Standard", planType: "paid", trialDays: 0 },
      { code: "PROFESSIONAL", name: "Professional", planType: "paid", trialDays: 0 },
    ],
  );
  assert.deepEqual(
    DEFAULT_PLAN_PRICES.map(({ planCode, billingInterval, amountMinor, currency }) => ({
      planCode,
      billingInterval,
      amountMinor,
      currency,
    })),
    [
      {
        planCode: "STANDARD",
        billingInterval: "6_months",
        amountMinor: 150000,
        currency: "NGN",
      },
      {
        planCode: "PROFESSIONAL",
        billingInterval: "12_months",
        amountMinor: 270000,
        currency: "NGN",
      },
    ],
  );
});

test("plan selection accepts either a Mongo ID or a plan code", () => {
  assert.equal(
    planSelectionSchema.safeParse({ planId: "507f1f77bcf86cd799439011" }).success,
    true,
  );
  assert.equal(
    planSelectionSchema.safeParse({ planId: "PROFESSIONAL" }).success,
    true,
  );
  assert.equal(
    planSelectionSchema.safeParse({ planCode: "STANDARD" }).success,
    true,
  );
  assert.equal(planSelectionSchema.safeParse({}).success, false);
  assert.equal(
    planSelectionSchema.safeParse({
      planId: "PROFESSIONAL",
      planCode: "STANDARD",
    }).success,
    false,
  );
});
