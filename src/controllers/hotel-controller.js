const hotelService = require("../services/hotel-service");
const {
  hotelSchema,
  planSelectionSchema,
  settingsSchema,
} = require("../schemas");
const { publicHotel } = require("../utils/public-resources");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

async function publicPlans(_req, res) {
  return res.json(await hotelService.getPublicPlans());
}

async function createHotel(req, res) {
  const parsed = hotelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const hotel = await hotelService.createHotel(parsed.data, req.user);
  return res.status(201).json({
    hotel: publicHotel(hotel),
    membership: { role: "manager", status: "active" },
    onboarding: { currentStep: "choose_plan", completedSteps: ["registration"] },
  });
}

async function onboarding(req, res) {
  const result = await hotelService.getOnboarding(req.params.hotelId);
  if (!result) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json(result);
}

async function selectSubscriptionPlan(req, res) {
  const parsed = planSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_plan" });
  }
  const result = await hotelService.selectSubscriptionPlan(
    req.params.hotelId,
    parsed.data.planId,
  );
  if (result.error === "plan_not_found") {
    return res.status(404).json({ error: result.error });
  }
  if (result.error === "subscription_selection_locked") {
    return res.status(409).json({ error: result.error });
  }
  return res.json(result);
}

async function updateSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
    return res.status(400).json({ error: "invalid_settings" });
  }
  const hotel = await hotelService.updateSettings(req.params.hotelId, parsed.data);
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ hotel });
}

module.exports = {
  createHotel,
  onboarding,
  publicPlans,
  selectSubscriptionPlan,
  updateSettings,
};
