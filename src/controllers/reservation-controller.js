const reservationService = require("../services/reservation-service");
const {
  adminReservationSchema,
  publicReservationSchema,
  reservationAvailabilitySchema,
  reservationExtensionSchema,
  reservationIdSchema,
  reservationListSchema,
  reservationLookupSchema,
  reservationPaymentSchema,
  reservationUpdateSchema,
} = require("../schemas");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

function sendServiceError(res, error) {
  const status = error === "hotel_not_found"
    || error === "reservation_not_found"
    || error === "room_type_not_found"
      ? 404
      : error === "invalid_stay_dates"
        ? 400
        : 409;
  return res.status(status).json({ error });
}

async function createPublicReservation(req, res) {
  const parsed = publicReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.createPublicReservation(parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function lookupPublicReservation(req, res) {
  const parsed = reservationLookupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.lookupReservation(
    parsed.data.reference,
    parsed.data.email,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function listReservations(req, res) {
  const parsed = reservationListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_query",
      details: validationDetails(parsed.error.issues),
    });
  }
  return res.json(await reservationService.listReservations(req.params.hotelId, parsed.data));
}

async function getAvailability(req, res) {
  const parsed = reservationAvailabilitySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_query",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.getAvailability(req.params.hotelId, parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function listPayments(req, res) {
  if (!reservationIdSchema.safeParse(req.params.reservationId).success) {
    return res.status(404).json({ error: "reservation_not_found" });
  }
  const result = await reservationService.listPayments(
    req.params.hotelId,
    req.params.reservationId,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function recordPayment(req, res) {
  if (!reservationIdSchema.safeParse(req.params.reservationId).success) {
    return res.status(404).json({ error: "reservation_not_found" });
  }
  const parsed = reservationPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.recordPayment(
    req.params.hotelId,
    req.params.reservationId,
    parsed.data,
    req.user,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  const { replayed, ...response } = result;
  return res.status(replayed ? 200 : 201).json(response);
}

async function createAdminReservation(req, res) {
  const parsed = adminReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.createReservation(
    req.params.hotelId,
    parsed.data,
    "admin",
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function createWalkInReservation(req, res) {
  const parsed = adminReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.createReservation(
    req.params.hotelId,
    parsed.data,
    "walk_in",
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function changeReservationStayStatus(req, res, status) {
  if (!reservationIdSchema.safeParse(req.params.reservationId).success) {
    return res.status(404).json({ error: "reservation_not_found" });
  }
  const result = await reservationService.updateReservation(
    req.params.hotelId,
    req.params.reservationId,
    { status },
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function checkInReservation(req, res) {
  return changeReservationStayStatus(req, res, "checked_in");
}

async function checkOutReservation(req, res) {
  return changeReservationStayStatus(req, res, "checked_out");
}

async function extendReservation(req, res) {
  if (!reservationIdSchema.safeParse(req.params.reservationId).success) {
    return res.status(404).json({ error: "reservation_not_found" });
  }
  const parsed = reservationExtensionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.extendReservation(
    req.params.hotelId,
    req.params.reservationId,
    parsed.data,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

async function updateReservation(req, res) {
  if (!reservationIdSchema.safeParse(req.params.reservationId).success) {
    return res.status(404).json({ error: "reservation_not_found" });
  }
  const parsed = reservationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await reservationService.updateReservation(
    req.params.hotelId,
    req.params.reservationId,
    parsed.data,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

module.exports = {
  checkInReservation,
  checkOutReservation,
  createAdminReservation,
  createPublicReservation,
  createWalkInReservation,
  extendReservation,
  getAvailability,
  listPayments,
  listReservations,
  lookupPublicReservation,
  recordPayment,
  updateReservation,
};
