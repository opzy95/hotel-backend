const { Guest, Reservation } = require("../models");

function guestResource(guest) {
  return {
    id: guest._id,
    hotelId: guest.hotelId,
    name: guest.name,
    email: guest.email,
    phone: guest.phone,
    country: guest.country || null,
    membershipTier: guest.membershipTier || null,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
  };
}

async function upsertGuestProfile(hotelId, data, session) {
  const updates = {
    name: data.guestName,
    phone: data.guestPhone,
  };
  if (data.guestCountry !== undefined) {
    updates.country = data.guestCountry.toUpperCase();
  }
  const options = {
    upsert: true,
    returnDocument: "after",
    runValidators: true,
    setDefaultsOnInsert: true,
  };
  if (session) {
    options.session = session;
  }
  return Guest.findOneAndUpdate(
    { hotelId, email: data.guestEmail.toLowerCase() },
    {
      $set: updates,
      $setOnInsert: { hotelId, email: data.guestEmail.toLowerCase() },
    },
    options,
  );
}

async function backfillLegacyReservationGuests() {
  await Guest.init();
  const cursor = Reservation.find({ guestId: null })
    .select("hotelId guestName guestEmail guestPhone")
    .lean()
    .cursor();

  for await (const reservation of cursor) {
    const email = reservation.guestEmail.toLowerCase();
    let guest;
    try {
      guest = await Guest.findOneAndUpdate(
        { hotelId: reservation.hotelId, email },
        {
          $setOnInsert: {
            hotelId: reservation.hotelId,
            name: reservation.guestName,
            email,
            phone: reservation.guestPhone,
            country: null,
            membershipTier: null,
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
      guest = await Guest.findOne({ hotelId: reservation.hotelId, email });
    }
    if (!guest) {
      throw new Error(`Guest profile backfill failed for reservation ${reservation._id}`);
    }
    await Reservation.updateOne(
      { _id: reservation._id, guestId: null },
      { $set: { guestId: guest._id } },
    );
  }
}

async function listGuests(hotelId, query) {
  const filter = { hotelId };
  if (query.membershipTier) {
    filter.membershipTier = query.membershipTier;
  }
  if (query.search) {
    const escapedSearch = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const search = new RegExp(escapedSearch, "i");
    filter.$or = [
      { name: search },
      { email: search },
      { phone: search },
    ];
  }
  const [guests, total] = await Promise.all([
    Guest.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Guest.countDocuments(filter),
  ]);
  return {
    guests: guests.map(guestResource),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
}

async function updateGuestProfile(hotelId, guestId, data) {
  const updates = {};
  if (data.country !== undefined) {
    updates.country = data.country?.toUpperCase() || null;
  }
  if (data.membershipTier !== undefined) {
    updates.membershipTier = data.membershipTier || null;
  }
  const guest = await Guest.findOneAndUpdate(
    { _id: guestId, hotelId },
    { $set: updates },
    { returnDocument: "after", runValidators: true },
  ).lean();
  return guest
    ? { guest: guestResource(guest) }
    : { error: "guest_not_found" };
}

module.exports = {
  backfillLegacyReservationGuests,
  guestResource,
  listGuests,
  updateGuestProfile,
  upsertGuestProfile,
};
