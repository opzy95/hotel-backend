const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const {
  Hotel,
  HotelMembership,
  Plan,
  PlanPrice,
  Subscription,
  User,
} = require("../models");
const { expireSubscriptions } = require("./subscription-lifecycle");
const { publicHotel, publicHotelDetails } = require("../utils/public-resources");

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

async function findActiveHotelBySlug(slug) {
  return Hotel.findOne({ slug, status: "active" })
    .select("name slug phone address type settings bankDetails coverImage secondaryImage")
    .lean();
}

async function getPublicHotelBySlug(slug) {
  const hotel = await findActiveHotelBySlug(slug);
  return hotel ? publicHotelDetails(hotel) : null;
}

async function listPublicHotels() {
  const hotels = await Hotel.find({ status: "active" })
    .select("name slug address")
    .sort({ name: 1 })
    .lean();
  return hotels.map(({ name, slug, address }) => ({ name, slug, address }));
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
      id: plan._id,
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
  await expireSubscriptions(hotelId);
  const [hotel, subscription] = await Promise.all([
    Hotel.findById(hotelId).select("status setupCompletedSteps"),
    Subscription.findOne({ hotelId })
      .populate("planId", "name code")
      .populate("planPriceId", "billingInterval amountMinor currency"),
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
      planPrice: subscription.planPriceId,
      trial_start_date: subscription.trial_start_date,
      trial_end_date: subscription.trial_end_date,
      expires_at: subscription.expires_at,
    } : null,
  };
}

async function getSettings(hotelId) {
  return Hotel.findById(hotelId)
    .select("name email phone address type roomCount slug status settings bankDetails coverImage secondaryImage")
    .lean();
}

async function selectSubscriptionPlan(hotelId, planId, userId, billingInterval) {
  await expireSubscriptions(hotelId);
  const planFilter = mongoose.isValidObjectId(planId)
    ? { _id: planId, active: true }
    : { code: planId.toUpperCase(), active: true };
  const [plan, user] = await Promise.all([
    Plan.findOne(planFilter),
    User.findById(userId).select("emailVerifiedAt"),
  ]);
  if (!plan) {
    return { error: "plan_not_found" };
  }

  const isTrial = plan.planType === "trial" && plan.trialDays > 0;
  if (isTrial && !user?.emailVerifiedAt) {
    return { error: "email_not_verified" };
  }

  let planPrice = null;
  if (!isTrial) {
    const activePrices = await PlanPrice.find({ planId: plan._id, active: true })
      .sort({ billingInterval: 1 })
      .lean();
    if (billingInterval) {
      planPrice = activePrices.find((price) => price.billingInterval === billingInterval);
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
  }

  const selectedAt = new Date();
  const trialEndDate = isTrial
    ? new Date(selectedAt.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
    : undefined;
  const setFields = {
    planId: plan._id,
    planSnapshot: {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      planType: plan.planType,
      ...(planPrice ? {
        amountMinor: planPrice.amountMinor,
        currency: planPrice.currency,
        billingInterval: planPrice.billingInterval,
      } : {
        amountMinor: plan.amountMinor,
        currency: plan.currency,
      }),
    },
    selected_at: selectedAt,
    status: isTrial ? "trialing" : "pending",
  };
  if (!isTrial) {
    setFields.planPriceId = planPrice._id;
    setFields.billing_interval = planPrice.billingInterval;
  }
  if (isTrial) {
    setFields.trial_start_date = selectedAt;
    setFields.trial_end_date = trialEndDate;
    setFields.trial_used_at = selectedAt;
  }

  const subscriptionFilter = { hotelId };
  if (isTrial) {
    subscriptionFilter.status = "pending_selection";
  } else {
    subscriptionFilter.$or = [
      { status: { $in: ["pending_selection", "expired"] } },
      {
        status: "pending",
        $or: [
          { planPriceId: null },
          { planPriceId: { $exists: false } },
        ],
      },
    ];
  }
  if (isTrial) {
    subscriptionFilter.$or = [
      { trial_used_at: { $exists: false } },
      { trial_used_at: null },
    ];
  }
  const subscription = await Subscription.findOneAndUpdate(
    subscriptionFilter,
    { $set: setFields },
    { returnDocument: "after", runValidators: true },
  ).populate("planId", "name code amountMinor currency interval trialDays features");
  if (!subscription) {
    if (isTrial && await Subscription.exists({ hotelId, trial_used_at: { $ne: null } })) {
      return { error: "trial_already_used" };
    }
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
      planPrice: planPrice ? {
        billingInterval: planPrice.billingInterval,
        amountMinor: planPrice.amountMinor,
        currency: planPrice.currency,
      } : null,
      planSnapshot: subscription.planSnapshot,
      trial_start_date: subscription.trial_start_date,
      trial_end_date: subscription.trial_end_date,
    },
    paymentRequired: subscription.status === "pending",
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

async function updateBankDetails(hotelId, bankDetails) {
  return Hotel.findByIdAndUpdate(
    hotelId,
    { $set: { bankDetails } },
    { returnDocument: "after", runValidators: true },
  );
}

async function updateProfileImages(hotelId, images, storage) {
  const hotel = await Hotel.findById(hotelId);
  if (!hotel) {
    return null;
  }

  const imageSlots = ["coverImage", "secondaryImage"];
  const uploaded = [];
  try {
    for (const slot of imageSlots) {
      const file = images[slot];
      if (file) {
        uploaded.push({
          slot,
          image: await storage.uploadHotelProfileImage(file.buffer, hotelId.toString()),
        });
      }
    }
  } catch (error) {
    const uploadedImages = uploaded.map(({ image }) => image);
    if (uploadedImages.length) {
      try {
        await storage.deleteImages(uploadedImages);
      } catch (cleanupError) {
        console.error("Failed to clean up hotel profile image upload", cleanupError);
      }
    }
    throw error;
  }

  const replaced = uploaded.map(({ slot, image }) => ({
    slot,
    previousImage: hotel[slot],
    image,
  }));
  for (const { slot, image } of replaced) {
    hotel[slot] = image;
  }
  try {
    await hotel.save();
  } catch (error) {
    const uploadedImages = uploaded.map(({ image }) => image);
    try {
      await storage.deleteImages(uploadedImages);
    } catch (cleanupError) {
      console.error("Failed to clean up hotel profile image upload", cleanupError);
    }
    throw error;
  }

  for (const { previousImage } of replaced) {
    if (previousImage?.publicId) {
      await storage.deleteImage(previousImage.publicId);
    }
  }

  return publicHotel(hotel);
}

async function removeProfileImage(hotelId, slot, storage) {
  const hotel = await Hotel.findById(hotelId);
  if (!hotel) {
    return null;
  }
  const imageField = slot === "cover" ? "coverImage" : "secondaryImage";
  const previousImage = hotel[imageField];
  if (!previousImage?.publicId) {
    return { error: "profile_image_not_found" };
  }

  hotel[imageField] = null;
  await hotel.save();
  await storage.deleteImage(previousImage.publicId);
  return { hotel: publicHotel(hotel) };
}

module.exports = {
  createHotel,
  createHotelWorkspace,
  findActiveHotelBySlug,
  getPublicHotelBySlug,
  getOnboarding,
  getSettings,
  listPublicHotels,
  getPublicPlans,
  publicHotel,
  removeProfileImage,
  selectSubscriptionPlan,
  updateBankDetails,
  updateProfileImages,
  updateSettings,
};
