const mongoose = require("mongoose");
const {
  AuditLog,
  Hotel,
  HotelMembership,
  Plan,
  PlanPrice,
  Subscription,
  SubscriptionPayment,
  User,
} = require("../models");
const { normalizePlanPayload } = require("./plan-seed");
const { expireSubscriptions } = require("./subscription-lifecycle");
const { publicHotel } = require("../utils/public-resources");

async function listHotels(page, limit, userId) {
  await AuditLog.create({
    actorUserId: userId,
    action: "platform.hotels.list",
    metadata: { page, limit },
  });
  await expireSubscriptions();
  const [hotels, total] = await Promise.all([
    Hotel.find()
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Hotel.countDocuments(),
  ]);
  const hotelIds = hotels.map((hotel) => hotel._id);
  const [memberships, subscriptions, payments] = await Promise.all([
    HotelMembership.find({
      hotelId: { $in: hotelIds },
      role: "manager",
      status: "active",
    }).select("hotelId userId").lean(),
    Subscription.find({ hotelId: { $in: hotelIds } })
      .populate("planId", "code name description planType trialDays features limits")
      .populate("planPriceId", "billingInterval amountMinor currency")
      .lean(),
    SubscriptionPayment.find({ hotelId: { $in: hotelIds } })
      .select("hotelId subscriptionId provider providerReference amountMinor currency status verifiedAt createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const managers = await User.find({
    _id: { $in: memberships.map((membership) => membership.userId) },
  }).select("name email emailVerifiedAt createdAt").lean();

  const managerById = new Map(
    managers.map((manager) => [manager._id.toString(), manager]),
  );
  const managerByHotelId = new Map(
    memberships.map((membership) => [
      membership.hotelId.toString(),
      managerById.get(membership.userId.toString()) || null,
    ]),
  );
  const subscriptionByHotelId = new Map(
    subscriptions.map((subscription) => [subscription.hotelId.toString(), subscription]),
  );
  const paymentsByHotelId = new Map();
  for (const payment of payments) {
    const key = payment.hotelId.toString();
    const hotelPayments = paymentsByHotelId.get(key) || [];
    hotelPayments.push(payment);
    paymentsByHotelId.set(key, hotelPayments);
  }

  return {
    data: hotels.map((hotel) => {
      const subscription = subscriptionByHotelId.get(hotel._id.toString());
      const plan = subscription?.planId;
      const planPrice = subscription?.planPriceId;
      return {
        ...hotel,
        manager: managerByHotelId.get(hotel._id.toString()) || null,
        subscription: subscription ? {
          id: subscription._id,
          status: subscription.status,
          plan: plan ? {
            id: plan._id,
            code: plan.code,
            name: plan.name,
            description: plan.description,
            plan_type: plan.planType,
            trial_days: plan.trialDays,
            features: plan.features,
            limits: plan.limits,
          } : null,
          plan_snapshot: subscription.planSnapshot || null,
          plan_price: planPrice ? {
            id: planPrice._id,
            billing_interval: planPrice.billingInterval,
            amount: planPrice.amountMinor,
            currency: planPrice.currency,
          } : null,
          billing_interval: subscription.billing_interval,
          selected_at: subscription.selected_at,
          trial_start_date: subscription.trial_start_date,
          trial_end_date: subscription.trial_end_date,
          trial_used_at: subscription.trial_used_at,
          activated_at: subscription.activated_at,
          expires_at: subscription.expires_at,
          payments: (paymentsByHotelId.get(hotel._id.toString()) || []).map((payment) => ({
            id: payment._id,
            subscription_id: payment.subscriptionId,
            provider: payment.provider,
            provider_reference: payment.providerReference,
            amount: payment.amountMinor,
            currency: payment.currency,
            status: payment.status,
            verified_at: payment.verifiedAt,
            created_at: payment.createdAt,
            updated_at: payment.updatedAt,
          })),
        } : null,
      };
    }),
    pagination: { page, limit, total },
  };
}

async function listPendingApprovalHotels(page, limit, userId) {
  await AuditLog.create({
    actorUserId: userId,
    action: "platform.hotels.pending_approval.list",
    metadata: { page, limit },
  });
  const [hotels, total] = await Promise.all([
    Hotel.find({ status: "pending_approval" })
      .select("name email phone address type roomCount slug status createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Hotel.countDocuments({ status: "pending_approval" }),
  ]);
  const memberships = await HotelMembership.find({
    hotelId: { $in: hotels.map((hotel) => hotel._id) },
    role: "manager",
    status: "active",
  }).select("hotelId userId").lean();
  const managers = await User.find({
    _id: { $in: memberships.map((membership) => membership.userId) },
  }).select("name email").lean();
  const managersById = new Map(
    managers.map((manager) => [manager._id.toString(), manager]),
  );
  const managerByHotelId = new Map(
    memberships.map((membership) => [
      membership.hotelId.toString(),
      managersById.get(membership.userId.toString()),
    ]),
  );
  return {
    data: hotels.map((hotel) => ({
      ...hotel,
      manager: managerByHotelId.get(hotel._id.toString()) || null,
    })),
    pagination: { page, limit, total },
  };
}

async function updateHotelStatus(hotelId, status, userId) {
  await expireSubscriptions(hotelId);
  const session = await mongoose.startSession();
  let hotel;
  let activationError;
  try {
    await session.withTransaction(async () => {
      const currentHotel = await Hotel.findById(hotelId).select("status").session(session);
      if (!currentHotel) {
        return;
      }
      if (currentHotel.status === "pending_approval") {
        activationError = "hotel_email_not_verified";
        return;
      }
      if (!["active", "suspended"].includes(currentHotel.status)) {
        activationError = "invalid_hotel_status";
        return;
      }
      if (status === "active" && currentHotel.status === "suspended") {
        const managerMembership = await HotelMembership.findOne({
          hotelId,
          role: "manager",
          status: "active",
        }).select("userId").session(session);
        const verifiedManager = managerMembership
          ? await User.exists({
            _id: managerMembership.userId,
            emailVerifiedAt: { $ne: null },
          }).session(session)
          : false;
        if (!verifiedManager) {
          activationError = "hotel_email_not_verified";
          return;
        }
      }
      hotel = await Hotel.findByIdAndUpdate(
        hotelId,
        { $set: { status } },
        { returnDocument: "after", runValidators: true, session },
      );
      if (hotel) {
        await AuditLog.create(
          [{
            actorUserId: userId,
            hotelId: hotel._id,
            action: `hotel.${status}`,
            targetId: hotel._id,
          }],
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  if (!hotel) {
    if (activationError) {
      return { error: activationError, status: 409 };
    }
    return { error: "hotel_not_found", status: 404 };
  }
  return publicHotel(hotel);
}

async function createPlan(data, userId) {
  const session = await mongoose.startSession();
  let plan;
  try {
    await session.withTransaction(async () => {
      const normalized = normalizePlanPayload(data);
      const createdPlan = await Plan.create([{
        name: normalized.name,
        code: normalized.code,
        description: normalized.description,
        planType: normalized.planType,
        trialDays: normalized.trialDays,
        features: normalized.features,
        limits: normalized.limits,
        active: normalized.active,
        isPublic: normalized.isPublic,
        sortOrder: normalized.sortOrder,
      }], { session });
      [plan] = createdPlan;

      const planPrices = Array.isArray(data.plan_prices) ? data.plan_prices : [];
      if (planPrices.length > 0) {
        const priceDocs = planPrices.map((price) => ({
          planId: plan._id,
          billingInterval: price.billing_interval || price.billingInterval || "6_months",
          amountMinor: Number(price.amount ?? price.amount_minor ?? 0),
          currency: String(price.currency || "NGN").toUpperCase(),
          active: price.is_active ?? price.active ?? true,
        }));
        await PlanPrice.create(priceDocs.map((price) => ({ ...price })), { session });
      }
      await AuditLog.create(
        [{
          actorUserId: userId,
          action: "platform.plan.created",
          targetId: plan._id,
          metadata: { code: plan.code },
        }],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  return plan;
}

module.exports = {
  createPlan,
  listHotels,
  listPendingApprovalHotels,
  updateHotelStatus,
};
