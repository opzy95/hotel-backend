const { Subscription } = require("../models");

async function expireSubscriptions(hotelId, now = new Date()) {
  const filter = {
    status: { $in: ["trialing", "active"] },
    $or: [
      { status: "trialing", trial_end_date: { $lte: now } },
      { status: "trialing", trial_end_date: { $exists: false } },
      { status: "active", expires_at: { $lte: now } },
    ],
  };
  if (hotelId) {
    filter.hotelId = hotelId;
  }

  await Subscription.updateMany(filter, { $set: { status: "expired" } });
}

module.exports = { expireSubscriptions };
