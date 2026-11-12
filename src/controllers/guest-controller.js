const guestService = require("../services/guest-service");
const { guestListSchema, guestProfileUpdateSchema, roomIdSchema } = require("../schemas");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

async function listGuests(req, res) {
  const parsed = guestListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_query",
      details: validationDetails(parsed.error.issues),
    });
  }
  return res.json(await guestService.listGuests(req.params.hotelId, parsed.data));
}

async function updateGuestProfile(req, res) {
  if (!roomIdSchema.safeParse(req.params.guestId).success) {
    return res.status(404).json({ error: "guest_not_found" });
  }
  const parsed = guestProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await guestService.updateGuestProfile(
    req.params.hotelId,
    req.params.guestId,
    parsed.data,
  );
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result);
}

module.exports = {
  listGuests,
  updateGuestProfile,
};
