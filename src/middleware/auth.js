const mongoose = require("mongoose");
const {
  Hotel,
  HotelMembership,
  PlatformOperator,
  Subscription,
  User,
} = require("../models");
const { expireSubscriptions } = require("../services/subscription-lifecycle");
const { isJwtVerificationError, verifyAccessToken } = require("../utils/jwt");

async function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token, extra] = authorization.split(" ");
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({ error: "authentication_required" });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || (payload.ver ?? 0) !== user.authVersion) {
      return res.status(401).json({ error: "authentication_required" });
    }
    req.user = user;
    return next();
  } catch (error) {
    if (isJwtVerificationError(error)) {
      return res.status(401).json({ error: "authentication_required" });
    }
    return next(error);
  }
}

async function requireManager(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.hotelId)) {
    return res.status(404).json({ error: "hotel_not_found" });
  }

  const membership = await HotelMembership.findOne({
    hotelId: req.params.hotelId,
    userId: req.user._id,
    role: "manager",
    status: "active",
  });
  if (!membership) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  const hotel = await Hotel.findById(req.params.hotelId).select("status");
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  if (hotel.status === "suspended") {
    return res.status(403).json({ error: "hotel_suspended" });
  }
  await expireSubscriptions(hotel._id);
  return next();
}

async function requireSubscriptionWriteAccess(req, res, next) {
  const subscription = await Subscription.findOne({
    hotelId: req.params.hotelId,
  }).select("status");
  if (subscription?.status === "expired") {
    return res.status(403).json({
      error: "subscription_expired",
      message: "This hotel is read-only until its subscription is renewed.",
    });
  }
  return next();
}

async function requirePlatformOperator(req, res, next) {
  const operator = await PlatformOperator.exists({
    userId: req.user._id,
    active: true,
  });
  if (!operator) {
    return res.status(403).json({ error: "platform_operator_required" });
  }
  return next();
}

module.exports = {
  authenticate,
  requireManager,
  requirePlatformOperator,
  requireSubscriptionWriteAccess,
};
