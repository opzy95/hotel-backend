const staffService = require("../services/staff-service");
const {
  departmentSchema,
  roomIdSchema,
  staffMemberSchema,
  staffMemberUpdateSchema,
} = require("../schemas");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

function sendServiceError(res, error) {
  const status = error === "department_not_found"
    || error === "staff_member_not_found"
      ? 404
      : 409;
  return res.status(status).json({ error });
}

async function listDepartments(req, res) {
  const departments = await staffService.listDepartments(req.params.hotelId);
  return res.json({ departments });
}

async function createDepartment(req, res) {
  const parsed = departmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await staffService.createDepartment(req.params.hotelId, parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function listStaff(req, res) {
  const staff = await staffService.listStaff(req.params.hotelId);
  return res.json({ staff });
}

async function createStaffMember(req, res) {
  const parsed = staffMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await staffService.createStaffMember(req.params.hotelId, parsed.data);
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.status(201).json(result);
}

async function updateStaffMember(req, res) {
  if (!roomIdSchema.safeParse(req.params.staffId).success) {
    return res.status(404).json({ error: "staff_member_not_found" });
  }
  const parsed = staffMemberUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  const result = await staffService.updateStaffMember(
    req.params.hotelId,
    req.params.staffId,
    parsed.data,
  );
  if (result.error) {
    return sendServiceError(res, result.error);
  }
  return res.json(result);
}

module.exports = {
  createDepartment,
  createStaffMember,
  listDepartments,
  listStaff,
  updateStaffMember,
};
