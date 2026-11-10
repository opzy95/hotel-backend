const platformService = require("../services/platform-service");
const { paginationSchema, planSchema, hotelStatusSchema } = require("../schemas");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

async function listHotels(req, res) {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_pagination" });
  }
  return res.json(await platformService.listHotels(
    parsed.data.page,
    parsed.data.limit,
    req.user._id,
  ));
}

async function listPendingApprovalHotels(req, res) {
  const parsed = paginationSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_pagination" });
  }
  return res.json(await platformService.listPendingApprovalHotels(
    parsed.data.page,
    parsed.data.limit,
    req.user._id,
  ));
}

async function updateHotelStatus(req, res) {
  const parsed = hotelStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_hotel_status" });
  }
  const result = await platformService.updateHotelStatus(
    req.params.hotelId,
    parsed.data.status,
    req.user._id,
  );
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  return res.json({ hotel: result });
}

async function createPlan(req, res) {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const plan = await platformService.createPlan(parsed.data, req.user._id);
  return res.status(201).json({ plan });
}

module.exports = {
  createPlan,
  listHotels,
  listPendingApprovalHotels,
  updateHotelStatus,
};
