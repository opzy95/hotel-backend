const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const {
  Hotel,
  Guest,
  Reservation,
  ReservationPayment,
  Room,
  RoomType,
} = require("../models");
const { upsertGuestProfile } = require("./guest-service");

const INVENTORY_STATUSES = ["confirmed", "checked_in"];

function toDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function nightsBetween(checkIn, checkOut) {
  return (toDate(checkOut).getTime() - toDate(checkIn).getTime()) / 86400000;
}

function reservationPaymentSummary(reservation) {
  const totalMinor = reservation.totalMinor;
  const paidMinor = reservation.amountPaidMinor || 0;
  const paymentStatus = totalMinor === 0 || paidMinor >= totalMinor
    ? "paid"
    : paidMinor > 0
      ? "partially_paid"
      : "unpaid";
  return {
    totalMinor,
    paidMinor,
    balanceDueMinor: Math.max(totalMinor - paidMinor, 0),
    paymentStatus,
  };
}

function paymentResource(payment, receivedBy) {
  const user = receivedBy || payment.receivedByUserId;
  return {
    id: payment._id,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    note: payment.note,
    idempotencyKey: payment.idempotencyKey,
    receivedAt: payment.receivedAt,
    receivedBy: {
      id: user?._id || user,
      name: user?.name,
    },
  };
}

function makeReference() {
  return `HTL-${randomBytes(8).toString("hex").toUpperCase()}`;
}

function reservationResource(reservation, options = {}) {
  const roomType = reservation.roomTypeId;
  const room = reservation.roomId;
  const guestProfile = reservation.guestId
    && typeof reservation.guestId === "object"
    && reservation.guestId.country !== undefined
    ? reservation.guestId
    : null;
  const paymentSummary = reservationPaymentSummary(reservation);
  const guest = {
    name: reservation.guestName,
    email: reservation.guestEmail,
    phone: reservation.guestPhone,
  };
  if (options.includeGuestProfile) {
    guest.id = guestProfile?._id || reservation.guestId || null;
    guest.country = guestProfile?.country || null;
    guest.membershipTier = guestProfile?.membershipTier || null;
    guest.createdAt = guestProfile?.createdAt || null;
  }
  return {
    id: reservation._id,
    hotelId: reservation.hotelId,
    reference: reservation.reference,
    guest,
    checkIn: reservation.checkIn.toISOString().slice(0, 10),
    checkOut: reservation.checkOut.toISOString().slice(0, 10),
    roomType: {
      id: roomType?._id || reservation.roomTypeId,
      name: roomType?.name,
    },
    assignedRoom: {
      id: room?._id || reservation.roomId,
      code: room?.code,
    },
    guests: { adults: reservation.adults, children: reservation.children },
    pricing: {
      nights: reservation.nights,
      rateMinorPerNight: reservation.rateMinorPerNight,
      totalMinor: reservation.totalMinor,
      currency: reservation.currency,
    },
    paymentStatus: paymentSummary.paymentStatus,
    ...(options.includePaymentSummary ? { paymentSummary } : {}),
    status: reservation.status,
    source: reservation.source,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

async function lockRoomTypes(hotelId, roomTypeIds, session) {
  const ids = [...new Set(roomTypeIds.map((id) => id.toString()))].sort();
  for (const id of ids) {
    await RoomType.updateOne(
      { _id: id, hotelId, active: true },
      { $inc: { availabilityVersion: 1 } },
      { session },
    );
  }
}

async function findAvailableRooms(hotelId, roomTypeId, checkIn, checkOut, session, options = {}) {
  let roomQuery = Room.find({
    hotelId,
    roomTypeId,
    active: true,
  }).select("_id code").sort({ codeKey: 1 });
  if (session) {
    roomQuery = roomQuery.session(session);
  }
  const rooms = await roomQuery.lean();
  if (!rooms.length) {
    return [];
  }

  let reservationQuery = Reservation.find({
    hotelId,
    roomId: { $in: rooms.map((room) => room._id) },
    status: { $in: INVENTORY_STATUSES },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
    ...(options.excludeReservationId ? { _id: { $ne: options.excludeReservationId } } : {}),
  }).select("roomId");
  if (session) {
    reservationQuery = reservationQuery.session(session);
  }
  const reservations = await reservationQuery.lean();
  const occupiedRoomIds = new Set(reservations.map((reservation) => reservation.roomId.toString()));
  return rooms.filter((room) => !occupiedRoomIds.has(room._id.toString()));
}

async function findAvailableRoom(hotelId, roomTypeId, checkIn, checkOut, session, options = {}) {
  const availableRooms = await findAvailableRooms(
    hotelId,
    roomTypeId,
    checkIn,
    checkOut,
    session,
    options,
  );
  if (!availableRooms.length) {
    return { error: options.assignedRoomId ? "assigned_room_unavailable" : "room_unavailable" };
  }
  if (options.assignedRoomId) {
    const assignedRoom = availableRooms.find(
      (room) => room._id.toString() === options.assignedRoomId.toString(),
    );
    return assignedRoom ? { room: assignedRoom } : { error: "assigned_room_unavailable" };
  }
  return availableRooms.length
    ? { room: availableRooms[0] }
    : { error: "room_unavailable" };
}

function totalMinor(rate, nights) {
  const total = rate * nights;
  return Number.isSafeInteger(total) ? total : null;
}

function paymentRequestMatches(payment, data) {
  return payment.amountMinor === data.amountMinor
    && payment.method === data.method
    && payment.reference === data.reference
    && payment.note === data.note;
}

async function findIdempotentPaymentResult(hotelId, reservationId, data) {
  const payment = await ReservationPayment.findOne({
    hotelId,
    reservationId,
    idempotencyKey: data.idempotencyKey,
  }).populate("receivedByUserId", "name").lean();
  if (!payment) {
    return null;
  }
  if (!paymentRequestMatches(payment, data)) {
    return { error: "payment_idempotency_key_conflict" };
  }
  const reservation = await Reservation.findOne({ _id: reservationId, hotelId }).lean();
  return reservation
    ? {
      payment: paymentResource(payment),
      paymentSummary: reservationPaymentSummary(reservation),
      replayed: true,
    }
    : { error: "reservation_not_found" };
}

async function recordPayment(hotelId, reservationId, data, user) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const current = await Reservation.findOne({ _id: reservationId, hotelId }).session(session);
      if (!current) {
        result = { error: "reservation_not_found" };
        return;
      }

      const priorPayment = await ReservationPayment.findOne({
        hotelId,
        reservationId,
        idempotencyKey: data.idempotencyKey,
      }).populate("receivedByUserId", "name").session(session).lean();
      if (priorPayment) {
        result = paymentRequestMatches(priorPayment, data)
          ? {
            payment: paymentResource(priorPayment),
            paymentSummary: reservationPaymentSummary(current),
            replayed: true,
          }
          : { error: "payment_idempotency_key_conflict" };
        return;
      }
      if (["cancelled", "no_show"].includes(current.status)) {
        result = { error: "payment_not_allowed_for_reservation_status" };
        return;
      }

      const paidMinor = current.amountPaidMinor || 0;
      const balanceDueMinor = current.totalMinor - paidMinor;
      if (data.amountMinor > balanceDueMinor) {
        result = { error: "payment_exceeds_balance" };
        return;
      }

      current.amountPaidMinor = paidMinor + data.amountMinor;
      current.paymentStatus = reservationPaymentSummary(current).paymentStatus;
      await current.save({ session });

      const payment = new ReservationPayment({
        hotelId,
        reservationId,
        amountMinor: data.amountMinor,
        currency: current.currency,
        method: data.method,
        reference: data.reference,
        note: data.note,
        idempotencyKey: data.idempotencyKey,
        receivedByUserId: user._id,
      });
      await payment.save({ session });
      result = {
        payment: paymentResource(payment, user),
        paymentSummary: reservationPaymentSummary(current),
      };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) {
      const idempotentResult = await findIdempotentPaymentResult(
        hotelId,
        reservationId,
        data,
      );
      if (idempotentResult) {
        return idempotentResult;
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function listPayments(hotelId, reservationId) {
  const reservation = await Reservation.findOne({ _id: reservationId, hotelId }).lean();
  if (!reservation) {
    return { error: "reservation_not_found" };
  }
  const payments = await ReservationPayment.find({ hotelId, reservationId })
    .populate("receivedByUserId", "name")
    .sort({ receivedAt: 1, _id: 1 })
    .lean();
  return {
    payments: payments.map((payment) => paymentResource(payment)),
    paymentSummary: reservationPaymentSummary(reservation),
  };
}

async function getAvailability(hotelId, data) {
  const checkIn = toDate(data.checkIn);
  const checkOut = toDate(data.checkOut);
  const nights = nightsBetween(data.checkIn, data.checkOut);
  const roomType = await RoomType.findOne({
    _id: data.roomTypeId,
    hotelId,
    active: true,
  }).select("name maxGuests baseRateMinor currency").lean();
  if (!roomType) {
    return { error: "room_type_not_found" };
  }
  if (data.adults + data.children > roomType.maxGuests) {
    return { error: "room_guest_limit_exceeded" };
  }
  const amount = totalMinor(roomType.baseRateMinor, nights);
  if (amount === null) {
    return { error: "reservation_total_exceeded" };
  }
  const availableRooms = await findAvailableRooms(
    hotelId,
    roomType._id,
    checkIn,
    checkOut,
  );
  return {
    hotelId,
    stay: { checkIn: data.checkIn, checkOut: data.checkOut, nights },
    roomType: {
      id: roomType._id,
      name: roomType.name,
      maxGuests: roomType.maxGuests,
    },
    guests: { adults: data.adults, children: data.children },
    availableRooms: availableRooms.map((room) => ({ id: room._id, code: room.code })),
    pricing: {
      nights,
      rateMinorPerNight: roomType.baseRateMinor,
      totalMinor: amount,
      currency: roomType.currency,
    },
  };
}

async function createReservation(hotelId, data, source) {
  const checkIn = toDate(data.checkIn);
  const checkOut = toDate(data.checkOut);
  const nights = nightsBetween(data.checkIn, data.checkOut);
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      await lockRoomTypes(hotelId, [data.roomTypeId], session);
      const hotel = await Hotel.findById(hotelId).session(session).lean();
      const roomType = await RoomType.findOne({
        _id: data.roomTypeId,
        hotelId,
        active: true,
      }).session(session).lean();
      if (!hotel || (source === "public" && hotel.status !== "active")) {
        result = { error: "hotel_not_found" };
        return;
      }
      if (!roomType) {
        result = { error: "room_type_not_found" };
        return;
      }
      if (data.adults + data.children > roomType.maxGuests) {
        result = { error: "room_guest_limit_exceeded" };
        return;
      }
      const amount = totalMinor(roomType.baseRateMinor, nights);
      if (amount === null) {
        result = { error: "reservation_total_exceeded" };
        return;
      }
      const available = await findAvailableRoom(
        hotelId,
        roomType._id,
        checkIn,
        checkOut,
        session,
        { assignedRoomId: data.assignedRoomId },
      );
      if (available.error) {
        result = available;
        return;
      }

      const guest = await upsertGuestProfile(hotelId, data, session);
      const [reservation] = await Reservation.create([{
        hotelId,
        guestId: guest._id,
        reference: makeReference(),
        guestName: data.guestName,
        guestEmail: data.guestEmail,
        guestPhone: data.guestPhone,
        checkIn,
        checkOut,
        roomTypeId: roomType._id,
        roomId: available.room._id,
        adults: data.adults,
        children: data.children,
        nights,
        rateMinorPerNight: roomType.baseRateMinor,
        totalMinor: amount,
        currency: roomType.currency,
        amountPaidMinor: 0,
        paymentStatus: amount === 0 ? "paid" : "unpaid",
        status: "confirmed",
        source,
      }], { session });
      result = {
        reservation: reservationResource({
          ...reservation.toObject(),
          guestId: guest,
          roomTypeId: roomType,
          roomId: available.room,
        }, source === "admin"
          ? { includePaymentSummary: true, includeGuestProfile: true }
          : {}),
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function createPublicReservation(data) {
  const hotel = await Hotel.findOne({ slug: data.hotelSlug, status: "active" })
    .select("_id")
    .lean();
  if (!hotel) {
    return { error: "hotel_not_found" };
  }
  return createReservation(hotel._id, data, "public");
}

async function lookupReservation(reference, email) {
  const reservation = await Reservation.findOne({
    reference: reference.toUpperCase(),
    guestEmail: email.toLowerCase(),
  }).populate("roomTypeId", "name").populate("roomId", "code").lean();
  return reservation
    ? { reservation: reservationResource(reservation) }
    : { error: "reservation_not_found" };
}

async function listReservations(hotelId, query) {
  const filter = { hotelId };
  if (query.status) {
    filter.status = query.status;
  }
  if (query.checkInFrom || query.checkInTo) {
    filter.checkIn = {};
    if (query.checkInFrom) {
      filter.checkIn.$gte = toDate(query.checkInFrom);
    }
    if (query.checkInTo) {
      filter.checkIn.$lte = toDate(query.checkInTo);
    }
  }
  if (query.search) {
    const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const search = new RegExp(escapedSearch, "i");
    filter.$or = [
      { reference: search },
      { guestName: search },
      { guestEmail: search },
      { guestPhone: search },
    ];
  }

  const [reservations, total] = await Promise.all([
    Reservation.find(filter)
      .populate("roomTypeId", "name")
      .populate("roomId", "code")
      .populate("guestId", "country membershipTier createdAt")
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Reservation.countDocuments(filter),
  ]);
  return {
    reservations: reservations.map((reservation) => reservationResource(reservation, {
      includePaymentSummary: true,
      includeGuestProfile: true,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
}

const transitions = {
  confirmed: new Set(["confirmed", "cancelled", "checked_in", "no_show"]),
  cancelled: new Set(["cancelled", "confirmed"]),
  checked_in: new Set(["checked_in", "checked_out"]),
  checked_out: new Set(["checked_out"]),
  no_show: new Set(["no_show", "confirmed"]),
};

async function updateReservation(hotelId, reservationId, data) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const current = await Reservation.findOne({ _id: reservationId, hotelId }).session(session);
      if (!current) {
        result = { error: "reservation_not_found" };
        return;
      }
      const nextStatus = data.status || current.status;
      if (!transitions[current.status]?.has(nextStatus)) {
        result = { error: "invalid_reservation_status_transition" };
        return;
      }

      const nextRoomTypeId = data.roomTypeId || current.roomTypeId;
      const nextCheckIn = data.checkIn ? toDate(data.checkIn) : current.checkIn;
      const nextCheckOut = data.checkOut ? toDate(data.checkOut) : current.checkOut;
      const nextAdults = data.adults === undefined ? current.adults : data.adults;
      const nextChildren = data.children === undefined ? current.children : data.children;
      const allocationChanged = data.checkIn !== undefined
        || roomTypeChanged(current.roomTypeId, nextRoomTypeId)
        || data.assignedRoomId !== undefined;
      const needsAvailability = INVENTORY_STATUSES.includes(nextStatus)
        && (allocationChanged || !INVENTORY_STATUSES.includes(current.status));
      if (needsAvailability) {
        await lockRoomTypes(
          hotelId,
          [current.roomTypeId, nextRoomTypeId],
          session,
        );
      }

      const roomType = await RoomType.findOne({
        _id: nextRoomTypeId,
        hotelId,
        ...(needsAvailability ? { active: true } : {}),
      }).session(session).lean();
      const currentRoomType = await RoomType.findOne({
        _id: current.roomTypeId,
        hotelId,
      }).session(session).lean();
      if (!roomType || !currentRoomType) {
        result = { error: "room_type_not_found" };
        return;
      }
      if (nextAdults + nextChildren > roomType.maxGuests) {
        result = { error: "room_guest_limit_exceeded" };
        return;
      }

      let nextRoomId = data.assignedRoomId || current.roomId;
      let room;
      if (needsAvailability) {
        const roomTypeChanged = nextRoomTypeId.toString() !== current.roomTypeId.toString();
        const available = await findAvailableRoom(
          hotelId,
          nextRoomTypeId,
          nextCheckIn,
          nextCheckOut,
          session,
          {
            excludeReservationId: current._id,
            assignedRoomId: data.assignedRoomId || (roomTypeChanged ? undefined : current.roomId),
          },
        );
        if (available.error) {
          result = available;
          return;
        }
        room = available.room;
        nextRoomId = room._id;
      } else if (data.assignedRoomId || roomTypeChanged(current.roomTypeId, nextRoomTypeId)) {
        room = await Room.findOne({
          _id: data.assignedRoomId || current.roomId,
          hotelId,
          roomTypeId: nextRoomTypeId,
        }).select("_id code").session(session).lean();
        if (!room) {
          result = { error: "assigned_room_not_found" };
          return;
        }
        nextRoomId = room._id;
      }

      const shouldReprice = data.checkIn !== undefined
        || roomTypeChanged(current.roomTypeId, nextRoomTypeId);
      const nextRate = shouldReprice ? roomType.baseRateMinor : current.rateMinorPerNight;
      const nextNights = shouldReprice
        ? (nextCheckOut.getTime() - nextCheckIn.getTime()) / 86400000
        : current.nights;
      if (nextNights < 1 || !Number.isInteger(nextNights)) {
        result = { error: "invalid_stay_dates" };
        return;
      }
      const amount = totalMinor(nextRate, nextNights);
      if (amount === null) {
        result = { error: "reservation_total_exceeded" };
        return;
      }
      const amountPaidMinor = current.amountPaidMinor || 0;
      if (amountPaidMinor > amount) {
        result = { error: "reservation_total_below_paid_amount" };
        return;
      }

      const reservationUpdates = { ...data };
      delete reservationUpdates.assignedRoomId;
      delete reservationUpdates.guestCountry;
      const guest = await upsertGuestProfile(hotelId, {
        guestName: data.guestName || current.guestName,
        guestEmail: data.guestEmail || current.guestEmail,
        guestPhone: data.guestPhone || current.guestPhone,
        guestCountry: data.guestCountry,
      }, session);
      current.set({
        ...reservationUpdates,
        guestId: guest._id,
        roomTypeId: nextRoomTypeId,
        roomId: nextRoomId,
        checkIn: nextCheckIn,
        checkOut: nextCheckOut,
        adults: nextAdults,
        children: nextChildren,
        nights: nextNights,
        rateMinorPerNight: nextRate,
        totalMinor: amount,
        amountPaidMinor,
        currency: roomType.currency,
        paymentStatus: amount === 0 || amountPaidMinor >= amount
          ? "paid"
          : amountPaidMinor > 0
            ? "partially_paid"
            : "unpaid",
        status: nextStatus,
      });
      await current.save({ session });
      if (!room) {
        room = await Room.findById(nextRoomId).select("_id code").session(session).lean();
      }
      result = {
        reservation: reservationResource({
          ...current.toObject(),
          guestId: guest,
          roomTypeId: roomType,
          roomId: room,
        }, { includePaymentSummary: true, includeGuestProfile: true }),
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function roomTypeChanged(previousId, nextId) {
  return previousId.toString() !== nextId.toString();
}

module.exports = {
  createPublicReservation,
  createReservation,
  getAvailability,
  listPayments,
  listReservations,
  lookupReservation,
  recordPayment,
  reservationResource,
  updateReservation,
};
