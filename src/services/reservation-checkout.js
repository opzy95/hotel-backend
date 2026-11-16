const { Hotel, Reservation } = require("../models");

const CHECKOUT_INTERVAL_MS = 60 * 1000;
const CHECKOUT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function getLocalDateTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

async function checkoutDueReservations(now = new Date()) {
  const hotelIds = await Reservation.distinct("hotelId", { status: "checked_in" });
  if (!hotelIds.length) {
    return { checkedOutCount: 0, skippedHotelCount: 0 };
  }

  const hotels = await Hotel.find({ _id: { $in: hotelIds } })
    .select("settings.timezone settings.checkOutTime")
    .lean();
  let checkedOutCount = 0;
  let skippedHotelCount = 0;

  for (const hotel of hotels) {
    const timeZone = hotel.settings?.timezone;
    const checkOutTime = hotel.settings?.checkOutTime;
    if (!timeZone || !CHECKOUT_TIME_PATTERN.test(checkOutTime || "")) {
      skippedHotelCount += 1;
      continue;
    }

    let local;
    try {
      local = getLocalDateTime(now, timeZone);
    } catch (error) {
      if (error instanceof RangeError) {
        skippedHotelCount += 1;
        continue;
      }
      throw error;
    }

    const checkoutDate = new Date(`${local.date}T00:00:00.000Z`);
    const checkoutReached = local.time >= checkOutTime;
    const result = await Reservation.updateMany(
      {
        hotelId: hotel._id,
        status: "checked_in",
        checkOut: { [checkoutReached ? "$lte" : "$lt"]: checkoutDate },
      },
      { $set: { status: "checked_out" } },
    );
    checkedOutCount += result.modifiedCount;
  }

  return { checkedOutCount, skippedHotelCount };
}

function startScheduledCheckout() {
  let running = false;
  const run = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await checkoutDueReservations();
      if (result.skippedHotelCount > 0) {
        console.warn(
          `Scheduled checkout skipped ${result.skippedHotelCount} hotel(s) with invalid or missing checkout settings`,
        );
      }
    } catch (error) {
      console.error("Scheduled reservation checkout failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, CHECKOUT_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = {
  CHECKOUT_INTERVAL_MS,
  checkoutDueReservations,
  getLocalDateTime,
  startScheduledCheckout,
};
