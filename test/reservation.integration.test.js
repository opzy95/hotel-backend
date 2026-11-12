require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;

test("public and admin reservations enforce inventory, price, lookup, and tenant access", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const {
    Hotel,
    Guest,
    HotelMembership,
    Reservation,
    ReservationPayment,
    Room,
    RoomType,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");
  const suffix = randomUUID();
  const createdHotelIds = [];
  const createdUserIds = [];

  await mongoose.connect(testMongoUri);
  await Promise.all([
    Reservation.init(),
    ReservationPayment.init(),
    Guest.init(),
    Room.init(),
    RoomType.init(),
  ]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const manager = await User.create({
      name: "Reservation Manager",
      email: `reservation-manager-${suffix}@example.test`,
      passwordHash: "test",
    });
    createdUserIds.push(manager._id);
    const hotel = await Hotel.create({
      name: "Reservation Test Hotel",
      email: `reservation-hotel-${suffix}@example.test`,
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `reservation-test-${suffix}`,
      status: "active",
      settings: { currency: "USD" },
    });
    createdHotelIds.push(hotel._id);
    await HotelMembership.create({
      hotelId: hotel._id,
      userId: manager._id,
      role: "manager",
      status: "active",
    });
    const roomType = await RoomType.create({
      hotelId: hotel._id,
      name: "Standard",
      nameKey: "standard",
      sizeSqm: 22,
      maxGuests: 2,
      bedSetup: [{ type: "queen", count: 1 }],
      baseRateMinor: 12500,
      currency: "USD",
    });
    await Room.create({
      hotelId: hotel._id,
      code: "101",
      codeKey: "101",
      roomTypeId: roomType._id,
    });

    const day = (offset) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const payload = {
      hotelSlug: hotel.slug,
      guestName: "Guest Example",
      guestEmail: "guest@example.test",
      guestPhone: "+10000000001",
      checkIn: day(0),
      checkOut: day(2),
      roomTypeId: roomType._id.toString(),
      adults: 2,
      children: 0,
      totalMinor: 1,
    };
    const managerToken = signAccessToken(manager._id);
    const managerHeaders = {
      "content-type": "application/json",
      authorization: `Bearer ${managerToken}`,
    };
    const availabilityUrl = new URL(
      `${baseUrl}/api/hotels/${hotel._id}/reservations/availability`,
    );
    availabilityUrl.search = new URLSearchParams({
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      roomTypeId: payload.roomTypeId,
      adults: String(payload.adults),
      children: String(payload.children),
    });
    const availabilityResponse = await fetch(availabilityUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    assert.equal(availabilityResponse.status, 200);
    const availability = await availabilityResponse.json();
    assert.deepEqual(availability.availableRooms.map((room) => room.code), ["101"]);
    assert.equal(availability.pricing.totalMinor, 25000);

    const overCapacityUrl = new URL(availabilityUrl);
    overCapacityUrl.searchParams.set("adults", "3");
    const overCapacityResponse = await fetch(overCapacityUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    assert.equal(overCapacityResponse.status, 409);
    assert.equal((await overCapacityResponse.json()).error, "room_guest_limit_exceeded");

    const jsonHeaders = { "content-type": "application/json" };
    const createResponse = await fetch(`${baseUrl}/api/public/reservations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).reservation;
    assert.match(created.reference, /^HTL-[A-F0-9]{16}$/);
    assert.equal(created.pricing.nights, 2);
    assert.equal(created.pricing.totalMinor, 25000);
    assert.equal(created.paymentStatus, "unpaid");
    assert.equal(created.status, "confirmed");
    assert.equal(created.assignedRoom.code, "101");

    const reservationsUrl = `${baseUrl}/api/hotels/${hotel._id}/reservations`;
    const reservationsResponse = await fetch(reservationsUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    assert.equal(reservationsResponse.status, 200);
    const reservations = await reservationsResponse.json();
    const adminGuest = reservations.reservations[0].guest;
    assert.ok(adminGuest.id);
    assert.equal(adminGuest.country, null);
    assert.equal(adminGuest.membershipTier, null);
    assert.ok(adminGuest.createdAt);

    const guestListUrl = `${baseUrl}/api/hotels/${hotel._id}/guests`;
    const guestListResponse = await fetch(guestListUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    assert.equal(guestListResponse.status, 200);
    assert.equal((await guestListResponse.json()).guests[0].id, adminGuest.id);

    const guestUpdateResponse = await fetch(`${guestListUrl}/${adminGuest.id}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ country: "ng", membershipTier: "Gold" }),
    });
    assert.equal(guestUpdateResponse.status, 200);
    const updatedGuest = (await guestUpdateResponse.json()).guest;
    assert.equal(updatedGuest.country, "NG");
    assert.equal(updatedGuest.membershipTier, "Gold");

    const refreshedReservationsResponse = await fetch(reservationsUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    const refreshedReservation = (await refreshedReservationsResponse.json()).reservations[0];
    assert.equal(refreshedReservation.guest.country, "NG");
    assert.equal(refreshedReservation.guest.membershipTier, "Gold");

    const manualPaymentStatusResponse = await fetch(
      `${baseUrl}/api/hotels/${hotel._id}/reservations/${created.id}`,
      {
        method: "PATCH",
        headers: managerHeaders,
        body: JSON.stringify({ paymentStatus: "paid" }),
      },
    );
    assert.equal(manualPaymentStatusResponse.status, 400);

    const paymentsUrl = `${baseUrl}/api/hotels/${hotel._id}/reservations/${created.id}/payments`;
    const emptyPaymentsResponse = await fetch(paymentsUrl, { headers: managerHeaders });
    assert.equal(emptyPaymentsResponse.status, 200);
    const emptyPayments = await emptyPaymentsResponse.json();
    assert.deepEqual(emptyPayments.payments, []);
    assert.equal(emptyPayments.paymentSummary.balanceDueMinor, 25000);

    const firstPayment = {
      amountMinor: 10000,
      method: "cash",
      reference: null,
      note: "Deposit",
      idempotencyKey: randomUUID(),
    };
    const firstPaymentResponse = await fetch(paymentsUrl, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify(firstPayment),
    });
    assert.equal(firstPaymentResponse.status, 201);
    const firstPaymentResult = await firstPaymentResponse.json();
    assert.equal(firstPaymentResult.payment.amountMinor, 10000);
    assert.equal(firstPaymentResult.paymentSummary.paidMinor, 10000);
    assert.equal(firstPaymentResult.paymentSummary.balanceDueMinor, 15000);
    assert.equal(firstPaymentResult.paymentSummary.paymentStatus, "partially_paid");

    const replayResponse = await fetch(paymentsUrl, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify(firstPayment),
    });
    assert.equal(replayResponse.status, 200);
    assert.equal((await replayResponse.json()).paymentSummary.paidMinor, 10000);

    const overpaymentResponse = await fetch(paymentsUrl, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        ...firstPayment,
        amountMinor: 15001,
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(overpaymentResponse.status, 409);
    assert.equal((await overpaymentResponse.json()).error, "payment_exceeds_balance");

    const secondPaymentResponse = await fetch(paymentsUrl, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        amountMinor: 15000,
        method: "bank_transfer",
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(secondPaymentResponse.status, 201);
    assert.equal(
      (await secondPaymentResponse.json()).paymentSummary.paymentStatus,
      "paid",
    );
    const recordedPaymentsResponse = await fetch(paymentsUrl, { headers: managerHeaders });
    const recordedPayments = await recordedPaymentsResponse.json();
    assert.equal(recordedPayments.payments.length, 2);
    assert.equal(recordedPayments.paymentSummary.balanceDueMinor, 0);

    const afterBookingAvailability = await fetch(availabilityUrl, {
      headers: { authorization: `Bearer ${managerToken}` },
    });
    assert.equal((await afterBookingAvailability.json()).availableRooms.length, 0);

    const roomsResponse = await fetch(`${baseUrl}/api/hotels/${hotel._id}/rooms`, {
      headers: { authorization: `Bearer ${signAccessToken(manager._id)}` },
    });
    assert.equal(roomsResponse.status, 200);
    assert.equal((await roomsResponse.json()).rooms[0].status, "Reserved");

    const conflictResponse = await fetch(`${baseUrl}/api/public/reservations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    assert.equal(conflictResponse.status, 409);
    assert.equal((await conflictResponse.json()).error, "room_unavailable");

    const badLookup = await fetch(`${baseUrl}/api/public/reservations/lookup`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ reference: created.reference, email: "wrong@example.test" }),
    });
    assert.equal(badLookup.status, 404);
    assert.equal((await badLookup.json()).error, "reservation_not_found");

    const lookupResponse = await fetch(`${baseUrl}/api/public/reservations/lookup`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ reference: created.reference, email: payload.guestEmail }),
    });
    assert.equal(lookupResponse.status, 200);
    assert.equal((await lookupResponse.json()).reservation.id, created.id);

    const cancelResponse = await fetch(
      `${baseUrl}/api/hotels/${hotel._id}/reservations/${created.id}`,
      {
        method: "PATCH",
        headers: managerHeaders,
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).reservation.status, "cancelled");

    const availableRoomsResponse = await fetch(`${baseUrl}/api/hotels/${hotel._id}/rooms`, {
      headers: { authorization: `Bearer ${signAccessToken(manager._id)}` },
    });
    assert.equal((await availableRoomsResponse.json()).rooms[0].status, "Available");

    const afterCancellationResponse = await fetch(`${baseUrl}/api/public/reservations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    assert.equal(afterCancellationResponse.status, 201);
  } finally {
    await Guest.deleteMany({ hotelId: { $in: createdHotelIds } });
    await ReservationPayment.deleteMany({ hotelId: { $in: createdHotelIds } });
    await Reservation.deleteMany({ hotelId: { $in: createdHotelIds } });
    await Room.deleteMany({ hotelId: { $in: createdHotelIds } });
    await RoomType.deleteMany({ hotelId: { $in: createdHotelIds } });
    await HotelMembership.deleteMany({ hotelId: { $in: createdHotelIds } });
    await Hotel.deleteMany({ _id: { $in: createdHotelIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await mongoose.disconnect();
  }
});
