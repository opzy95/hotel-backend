const hotelService = require("../services/hotel-service");
const subscriptionPaymentService = require("../services/subscription-payment-service");
const {
  hotelSchema,
  bankDetailsSchema,
  planSelectionSchema,
  publicHotelSlugSchema,
  settingsSchema,
  subscriptionPaymentVerificationSchema,
} = require("../schemas");
const { verifyPaystackWebhookSignature } = require("../services/paystack-client");
const { publicHotel } = require("../utils/public-resources");

function profileImageField(slot) {
  if (slot === "cover") {
    return "coverImage";
  }
  if (slot === "secondary") {
    return "secondaryImage";
  }
  return null;
}

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

async function publicPlans(_req, res) {
  return res.json(await hotelService.getPublicPlans());
}

async function publicHotels(_req, res) {
  return res.json({ hotels: await hotelService.listPublicHotels() });
}

async function publicHotelBySlug(req, res) {
  const parsed = publicHotelSlugSchema.safeParse(req.params.hotelSlug);
  if (!parsed.success) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  const hotel = await hotelService.getPublicHotelBySlug(parsed.data);
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ hotel });
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

async function getSettings(req, res) {
  const hotel = await hotelService.getSettings(req.params.hotelId);
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ hotel: publicHotel(hotel) });
}

async function selectSubscriptionPlan(req, res) {
  const parsed = planSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_plan" });
  }
  const result = await hotelService.selectSubscriptionPlan(
    req.params.hotelId,
    parsed.data.planId || parsed.data.planCode,
    req.user._id,
    parsed.data.billingInterval,
  );
  if (result.error === "plan_not_found") {
    return res.status(404).json({ error: result.error });
  }
  if (result.error === "email_not_verified") {
    return res.status(403).json({ error: result.error });
  }
  if (result.error === "trial_already_used") {
    return res.status(409).json({ error: result.error });
  }
  if (result.error === "subscription_selection_locked") {
    return res.status(409).json({ error: result.error });
  }
  if (result.error === "billing_interval_required") {
    return res.status(400).json({ error: result.error });
  }
  if (result.error === "plan_price_unavailable") {
    return res.status(409).json({ error: result.error });
  }
  return res.json(result);
}

function subscriptionPaymentError(res, result) {
  const status = {
    billing_interval_required: 409,
    payment_details_mismatch: 409,
    payment_initialization_in_progress: 409,
    payment_not_found: 404,
    payment_not_pending: 409,
    payment_not_successful: 409,
    plan_price_unavailable: 409,
    subscription_interval_invalid: 409,
    subscription_not_found: 404,
    subscription_not_payable: 409,
  }[result.error] || 400;
  return res.status(status).json({
    error: result.error,
    ...(result.paymentStatus ? { paymentStatus: result.paymentStatus } : {}),
  });
}

async function initializeSubscriptionPayment(req, res) {
  const result = await subscriptionPaymentService.initializeSubscriptionPayment(
    req.params.hotelId,
    req.user,
    req.app.locals.subscriptionPaymentGateway,
  );
  if (result.error) {
    return subscriptionPaymentError(res, result);
  }
  return res.json(result);
}

async function verifySubscriptionPayment(req, res) {
  const parsed = subscriptionPaymentVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payment_reference" });
  }
  const result = await subscriptionPaymentService.verifySubscriptionPayment(
    req.params.hotelId,
    parsed.data.reference,
    req.app.locals.subscriptionPaymentGateway,
  );
  if (result.error) {
    return subscriptionPaymentError(res, result);
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

async function updateBankDetails(req, res) {
  const parsed = bankDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_bank_details" });
  }
  const hotel = await hotelService.updateBankDetails(req.params.hotelId, parsed.data);
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ bankDetails: hotel.bankDetails });
}

async function updateProfileImages(req, res) {
  const images = {
    coverImage: req.files?.coverImage?.[0],
    secondaryImage: req.files?.secondaryImage?.[0],
  };
  if (!images.coverImage && !images.secondaryImage) {
    return res.status(400).json({ error: "profile_images_required" });
  }

  const hotel = await hotelService.updateProfileImages(
    req.params.hotelId,
    images,
    req.app.locals.hotelProfileImageStorage,
  );
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ hotel });
}

async function uploadProfileImage(req, res) {
  const imageField = profileImageField(req.body?.slot);
  if (!imageField) {
    return res.status(400).json({ error: "invalid_profile_image_slot" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "profile_image_required" });
  }

  const hotel = await hotelService.updateProfileImages(
    req.params.hotelId,
    { [imageField]: req.file },
    req.app.locals.hotelProfileImageStorage,
  );
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  return res.json({ hotel });
}

async function removeProfileImage(req, res) {
  const slot = req.params.slot;
  if (!profileImageField(slot)) {
    return res.status(400).json({ error: "invalid_profile_image_slot" });
  }

  const result = await hotelService.removeProfileImage(
    req.params.hotelId,
    slot,
    req.app.locals.hotelProfileImageStorage,
  );
  if (!result) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  if (result.error === "profile_image_not_found") {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result);
}

async function paystackWebhook(req, res) {
  const rawBody = req.body;
  const signature = req.get("x-paystack-signature");
  if (!verifyPaystackWebhookSignature({ rawBody, signature })) {
    return res.status(401).json({ error: "invalid_webhook_signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid_webhook_payload" });
  }
  if (event?.event !== "charge.success") {
    return res.status(200).json({ received: true });
  }
  const reference = event?.data?.reference;
  if (typeof reference !== "string" || !reference.trim()) {
    return res.status(400).json({ error: "invalid_webhook_payload" });
  }
  await subscriptionPaymentService.processPaystackWebhook(
    reference,
    req.app.locals.subscriptionPaymentGateway,
  );
  return res.status(200).json({ received: true });
}

module.exports = {
  createHotel,
  getSettings,
  initializeSubscriptionPayment,
  onboarding,
  publicHotelBySlug,
  publicHotels,
  publicPlans,
  removeProfileImage,
  updateProfileImages,
  uploadProfileImage,
  paystackWebhook,
  selectSubscriptionPlan,
  verifySubscriptionPayment,
  updateBankDetails,
  updateSettings,
};
