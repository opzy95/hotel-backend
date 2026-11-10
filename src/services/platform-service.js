const mongoose = require("mongoose");
const { AuditLog, Hotel, HotelMembership, Plan, PlanPrice, Subscription, User } = require("../models");
const { normalizePlanPayload } = require("./plan-seed");
const { publicHotel } = require("../utils/public-resources");

async function listHotels(page, limit, userId) {
  await AuditLog.create({
    actorUserId: userId,
    action: "platform.hotels.list",
    metadata: { page, limit },
  });
  const [hotels, total] = await Promise.all([
    Hotel.find()
      .select("name email phone address.country status slug createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Hotel.countDocuments(),
  ]);
  return { data: hotels, pagination: { page, limit, total } };
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

async function approveHotel(hotelId, userId) {
  const session = await mongoose.startSession();
  let hotel;
  try {
    await session.withTransaction(async () => {
      hotel = await Hotel.findOneAndUpdate(
        { _id: hotelId, status: "pending_approval" },
        { $set: { status: "approved" } },
        { new: true, runValidators: true, session },
      );
      if (hotel) {
        await AuditLog.create(
          [{
            actorUserId: userId,
            hotelId: hotel._id,
            action: "hotel.approved",
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
    const exists = await Hotel.exists({ _id: hotelId });
    return { error: exists ? "hotel_not_pending_approval" : "hotel_not_found", status: exists ? 409 : 404 };
  }
  return publicHotel(hotel);
}

async function updateHotelStatus(hotelId, status, userId) {
  const session = await mongoose.startSession();
  let hotel;
  let activationError;
  try {
    await session.withTransaction(async () => {
      if (status === "active") {
        const currentHotel = await Hotel.findById(hotelId)
          .select("status")
          .session(session);
        if (!currentHotel) {
          return;
        }
        if (!["approved", "active"].includes(currentHotel.status)) {
          activationError = "hotel_not_approved";
          return;
        }
        const subscription = await Subscription.findOne({ hotelId }).session(session);
        if (!subscription || !["active", "trialing"].includes(subscription.status)) {
          activationError = "subscription_not_active";
          return;
        }
      }
      hotel = await Hotel.findByIdAndUpdate(
        hotelId,
        { $set: { status } },
        { new: true, runValidators: true, session },
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
  approveHotel,
  createPlan,
  listHotels,
  listPendingApprovalHotels,
  updateHotelStatus,
};
