const mongoose = require("mongoose");
const { Hotel, Reservation, Room, RoomType } = require("../models");

const MAX_ROOM_TYPE_PHOTOS = 10;

function roomTypeResource(roomType) {
  return {
    id: roomType._id,
    hotelId: roomType.hotelId,
    name: roomType.name,
    description: roomType.description,
    sizeSqm: roomType.sizeSqm,
    maxGuests: roomType.maxGuests,
    bedSetup: roomType.bedSetup,
    baseRateMinor: roomType.baseRateMinor,
    currency: roomType.currency,
    amenities: roomType.amenities,
    photos: roomType.photos.map((photo) => ({
      id: photo._id,
      secureUrl: photo.secureUrl,
      width: photo.width,
      height: photo.height,
      format: photo.format,
    })),
    active: roomType.active,
    createdAt: roomType.createdAt,
    updatedAt: roomType.updatedAt,
  };
}

function roomResource(room, status = "Available") {
  return {
    id: room._id,
    hotelId: room.hotelId,
    code: room.code,
    roomType: room.roomTypeId ? roomTypeResource(room.roomTypeId) : null,
    floor: room.floor,
    wing: room.wing,
    notes: room.notes,
    active: room.active,
    status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

async function listRoomTypes(hotelId, includeInactive) {
  const filter = { hotelId };
  if (!includeInactive) {
    filter.active = true;
  }
  const roomTypes = await RoomType.find(filter).sort({ name: 1 }).lean();
  return roomTypes.map(roomTypeResource);
}

async function createRoomType(hotelId, data) {
  const hotel = await Hotel.findById(hotelId).select("settings.currency").lean();
  if (!hotel) {
    return { error: "hotel_not_found" };
  }
  const currency = hotel.settings?.currency;
  if (!currency) {
    return { error: "hotel_currency_not_configured" };
  }

  try {
    const roomType = await RoomType.create({
      ...data,
      hotelId,
      nameKey: data.name.trim().toLocaleLowerCase("en-US"),
      currency,
    });
    return { roomType: roomTypeResource(roomType) };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "room_type_name_already_exists" };
    }
    throw error;
  }
}

async function updateRoomType(hotelId, roomTypeId, data) {
  const updates = { ...data };
  if (updates.name !== undefined) {
    updates.nameKey = updates.name.trim().toLocaleLowerCase("en-US");
  }
  try {
    const roomType = await RoomType.findOneAndUpdate(
      { _id: roomTypeId, hotelId },
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    );
    return roomType ? { roomType: roomTypeResource(roomType) } : { error: "room_type_not_found" };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "room_type_name_already_exists" };
    }
    throw error;
  }
}

async function deactivateRoomType(hotelId, roomTypeId) {
  const roomType = await RoomType.findOneAndUpdate(
    { _id: roomTypeId, hotelId, active: true },
    { $set: { active: false } },
    { returnDocument: "after" },
  );
  if (roomType) {
    return { roomType: roomTypeResource(roomType) };
  }
  return await RoomType.exists({ _id: roomTypeId, hotelId })
    ? { error: "room_type_already_inactive" }
    : { error: "room_type_not_found" };
}

async function listRooms(hotelId, includeInactive = false) {
  const filter = { hotelId };
  if (!includeInactive) {
    filter.active = true;
  }
  const [rooms, hotel] = await Promise.all([
    Room.find(filter)
      .populate("roomTypeId")
      .sort({ codeKey: 1 })
      .lean(),
    Hotel.findById(hotelId).select("settings.timezone").lean(),
  ]);
  if (!hotel) {
    return [];
  }
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: hotel.settings?.timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const today = `${dateParts.find((part) => part.type === "year").value}-${dateParts.find((part) => part.type === "month").value}-${dateParts.find((part) => part.type === "day").value}`;
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const roomIds = rooms.map((room) => room._id);
  const reservations = roomIds.length
    ? await Reservation.find({
      hotelId,
      roomId: { $in: roomIds },
      status: { $in: ["confirmed", "checked_in"] },
      checkIn: { $lte: todayDate },
      checkOut: { $gt: todayDate },
    }).select("roomId status").lean()
    : [];
  const statusByRoomId = new Map();
  for (const reservation of reservations) {
    const status = reservation.status === "checked_in" ? "Occupied" : "Reserved";
    if (status === "Occupied" || !statusByRoomId.has(reservation.roomId.toString())) {
      statusByRoomId.set(reservation.roomId.toString(), status);
    }
  }
  return rooms.map((room) => roomResource(
    room,
    statusByRoomId.get(room._id.toString()) || "Available",
  ));
}

async function findActiveRoomType(hotelId, roomTypeId) {
  const roomType = await RoomType.findOne({ _id: roomTypeId, hotelId }).select("active");
  if (!roomType) {
    return { error: "room_type_not_found" };
  }
  if (!roomType.active) {
    return { error: "room_type_inactive" };
  }
  return { roomType };
}

async function createRoom(hotelId, data) {
  const typeResult = await findActiveRoomType(hotelId, data.roomTypeId);
  if (typeResult.error) {
    return typeResult;
  }
  try {
    const room = await Room.create({
      ...data,
      hotelId,
      codeKey: data.code.trim().toLocaleUpperCase("en-US"),
    });
    await room.populate("roomTypeId");
    return { room: roomResource(room) };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "room_code_already_exists" };
    }
    throw error;
  }
}

async function updateRoom(hotelId, roomId, data) {
  if (data.roomTypeId) {
    const typeResult = await findActiveRoomType(hotelId, data.roomTypeId);
    if (typeResult.error) {
      return typeResult;
    }
  }
  const updates = { ...data };
  if (updates.code !== undefined) {
    updates.codeKey = updates.code.trim().toLocaleUpperCase("en-US");
  }
  try {
    const room = await Room.findOneAndUpdate(
      { _id: roomId, hotelId },
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    ).populate("roomTypeId");
    return room ? { room: roomResource(room) } : { error: "room_not_found" };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "room_code_already_exists" };
    }
    throw error;
  }
}

async function deactivateRoom(hotelId, roomId) {
  const room = await Room.findOneAndUpdate(
    { _id: roomId, hotelId, active: true },
    { $set: { active: false } },
    { returnDocument: "after" },
  ).populate("roomTypeId");
  if (room) {
    return { room: roomResource(room) };
  }
  return await Room.exists({ _id: roomId, hotelId })
    ? { error: "room_already_inactive" }
    : { error: "room_not_found" };
}

async function uploadRoomTypePhotos(hotelId, roomTypeId, files, storage) {
  const roomType = await RoomType.findOne({ _id: roomTypeId, hotelId, active: true })
    .select("photos");
  if (!roomType) {
    return { error: "room_type_not_found" };
  }
  if (roomType.photos.length + files.length > MAX_ROOM_TYPE_PHOTOS) {
    return { error: "room_type_photo_limit_exceeded" };
  }

  const uploaded = await storage.uploadImages(files);
  const updated = await RoomType.findOneAndUpdate(
    {
      _id: roomTypeId,
      hotelId,
      active: true,
      photos: { $size: roomType.photos.length },
    },
    { $push: { photos: { $each: uploaded } } },
    { returnDocument: "after" },
  );
  if (!updated) {
    await storage.deleteImages(uploaded).catch(() => {});
    return await RoomType.exists({ _id: roomTypeId, hotelId, active: true })
      ? { error: "room_type_photo_update_conflict" }
      : { error: "room_type_not_found" };
  }
  return { roomType: roomTypeResource(updated) };
}

async function removeRoomTypePhoto(hotelId, roomTypeId, photoId, storage) {
  if (!mongoose.isValidObjectId(photoId)) {
    return { error: "photo_not_found" };
  }
  const roomType = await RoomType.findOne({ _id: roomTypeId, hotelId, active: true });
  if (!roomType) {
    return { error: "room_type_not_found" };
  }
  const photo = roomType.photos.id(photoId);
  if (!photo) {
    return { error: "photo_not_found" };
  }
  await storage.deleteImage(photo.publicId);
  roomType.photos.pull(photoId);
  await roomType.save();
  return { roomType: roomTypeResource(roomType) };
}

module.exports = {
  createRoom,
  createRoomType,
  deactivateRoom,
  deactivateRoomType,
  listRoomTypes,
  listRooms,
  removeRoomTypePhoto,
  roomResource,
  roomTypeResource,
  updateRoom,
  updateRoomType,
  uploadRoomTypePhotos,
};