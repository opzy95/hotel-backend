require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  checkoutDueReservations,
  getLocalDateTime,
} = require("../src/services/reservation-checkout");

const testMongoUri = process.env.TEST_MONGO_URI;

test("checkout scheduler uses each hotel's local timezone and checkout time", () => {
  const beforeCheckout = getLocalDateTime(
    new Date("2026-11-16T09:59:00.000Z"),
    "Africa/Lagos",
  );
  const atCheckout = getLocalDateTime(
    new Date("2026-11-16T10:00:00.000Z"),
    "Africa/Lagos",
  );

  assert.deepEqual(beforeCheckout, { date: "2026-11-16", time: "10:59" });
  assert.deepEqual(atCheckout, { date: "2026-11-16", time: "11:00" });
});

test("scheduled checkout persists status only for checked-in stays whose local checkout time passed", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const { Hotel, Reservation } = require("../src/models");
  const suffix = randomUUID();
  await mongoose.connect(testMongoUri);

  let hotel;
  const reservations = [];
  try {
    hotel = await Hotel.create({
      name: "Checkout Test Hotel",
      email: `checkout-hotel-${suffix}@example.test`,
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `checkout-hotel-${suffix}`,
      status: "active",
      settings: { timezone: "Africa/Lagos", checkOutTime: "11:00" },
    });

    const makeReservation = (checkOut, status = "checked_in") => ({
      hotelId: hotel._id,
      reference: `HTL-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
      guestName: "Checkout Guest",
      guestEmail: `${randomUUID()}@example.test`,
      guestPhone: "+10000000001",
      checkIn: new Date("2026-11-15T00:00:00.000Z"),
      checkOut: new Date(`${checkOut}T00:00:00.000Z`),
      roomTypeId: new mongoose.Types.ObjectId(),
      roomId: new mongoose.Types.ObjectId(),
      adults: 1,
      children: 0,
      nights: 1,
      rateMinorPerNight: 10000,
      totalMinor: 10000,
      currency: "USD",
      paymentStatus: "unpaid",
      status,
      source: "admin",
    });
    const created = await Reservation.create([
      makeReservation("2026-11-15"),
      makeReservation("2026-11-16"),
      makeReservation("2026-11-17"),
      makeReservation("2026-11-15", "confirmed"),
    ]);
    reservations.push(...created.map((reservation) => reservation._id));

    const beforeCheckout = await checkoutDueReservations(
      new Date("2026-11-16T09:59:00.000Z"),
    );
    assert.equal(beforeCheckout.checkedOutCount, 1);
    assert.equal(await Reservation.countDocuments({
      _id: { $in: [created[0]._id, created[1]._id] },
      status: "checked_out",
    }), 1);

    const atCheckout = await checkoutDueReservations(
      new Date("2026-11-16T10:00:00.000Z"),
    );
    assert.equal(atCheckout.checkedOutCount, 1);
    const statuses = await Reservation.find({ _id: { $in: reservations } })
      .sort({ _id: 1 })
      .select("checkOut status")
      .lean();
    assert.equal(statuses.filter((reservation) => reservation.status === "checked_out").length, 2);
    assert.equal(statuses.filter((reservation) => reservation.status === "confirmed").length, 1);
    assert.equal(statuses.filter((reservation) => reservation.status === "checked_in").length, 1);
  } finally {
    if (hotel) {
      await Reservation.deleteMany({ _id: { $in: reservations } });
      await Hotel.deleteOne({ _id: hotel._id });
    }
    await mongoose.disconnect();
  }
});
