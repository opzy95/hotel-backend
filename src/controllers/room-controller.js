const roomService = require("../services/room-service");
const {
  roomIdSchema,
  roomSchema,
  roomTypeListSchema,
  roomTypeSchema,
  roomTypeUpdateSchema,
  roomUpdateSchema,
} = require("../schemas");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

function sendServiceError(res, error) {
  const status = error === "hotel_currency_not_configured"
    || error.endsWith("_inactive")
    || error.endsWith("_conflict")
    || error.endsWith("_exceeded")
    ? 409
    : error.endsWith("_already_exists")
      ? 409
      : 404;
  return res.status(status).json({ error });
}

function validateId(value) {
  return roomIdSchema.safeParse(value).success;
}

async function listRoomTypes(req, res) {
  const parsed = roomTypeListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const roomTypes = await roomService.listRoomTypes(
    req.params.hotelId,
    parsed.data.includeInactive === "true",
  );
  return res.json({ roomTypes });
}

async function createRoomType(req, res) {
  const parsed = roomTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await roomService.createRoomType(req.params.hotelId, parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function updateRoomType(req, res) {
  if (!validateId(req.params.roomTypeId)) {
    return res.status(404).json({ error: "room_type_not_found" });
  }
  const parsed = roomTypeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await roomService.updateRoomType(
    req.params.hotelId,
    req.params.roomTypeId,
    parsed.data,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function deactivateRoomType(req, res) {
  if (!validateId(req.params.roomTypeId)) {
    return res.status(404).json({ error: "room_type_not_found" });
  }
  const result = await roomService.deactivateRoomType(
    req.params.hotelId,
    req.params.roomTypeId,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function uploadRoomTypePhotos(req, res) {
  if (!validateId(req.params.roomTypeId)) {
    return res.status(404).json({ error: "room_type_not_found" });
  }
  if (!req.files?.length) {
    return res.status(400).json({ error: "photos_required" });
  }
  const result = await roomService.uploadRoomTypePhotos(
    req.params.hotelId,
    req.params.roomTypeId,
    req.files,
    req.app.locals.roomPhotoStorage,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function removeRoomTypePhoto(req, res) {
  if (!validateId(req.params.roomTypeId)) {
    return res.status(404).json({ error: "room_type_not_found" });
  }
  const result = await roomService.removeRoomTypePhoto(
    req.params.hotelId,
    req.params.roomTypeId,
    req.params.photoId,
    req.app.locals.roomPhotoStorage,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function listRooms(req, res) {
  const parsed = roomTypeListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const rooms = await roomService.listRooms(
    req.params.hotelId,
    parsed.data.includeInactive === "true",
  );
  return res.json({ rooms });
}

async function createRoom(req, res) {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await roomService.createRoom(req.params.hotelId, parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function updateRoom(req, res) {
  if (!validateId(req.params.roomId)) {
    return res.status(404).json({ error: "room_not_found" });
  }
  const parsed = roomUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await roomService.updateRoom(
    req.params.hotelId,
    req.params.roomId,
    parsed.data,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function deactivateRoom(req, res) {
  if (!validateId(req.params.roomId)) {
    return res.status(404).json({ error: "room_not_found" });
  }
  const result = await roomService.deactivateRoom(req.params.hotelId, req.params.roomId);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

module.exports = {
  createRoom,
  createRoomType,
  deactivateRoom,
  deactivateRoomType,
  listRoomTypes,
  listRooms,
  removeRoomTypePhoto,
  updateRoom,
  updateRoomType,
  uploadRoomTypePhotos,
};