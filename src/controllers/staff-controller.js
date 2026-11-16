const staffService = require("../services/staff-service");
const hotelInvitationService = require("../services/hotel-invitation-service");
const {
  departmentSchema,
  hotelInvitationSchema,
  roomIdSchema,
  staffMemberInvitationSchema,
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
    || error === "receptionist_membership_not_found"
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

async function deleteStaffMember(req, res) {
  if (!roomIdSchema.safeParse(req.params.staffId).success) {
    return res.status(404).json({ error: "staff_member_not_found" });
  }
  const result = await staffService.deleteStaffMember(
    req.params.hotelId,
    req.params.staffId,
  );
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json({ message: "staff_member_deleted", ...result });
}

function sendInvitationError(res, error) {
  const status = error === "staff_invitation_not_found"
    || error === "staff_member_not_found"
    ? 404
    : error === "account_already_exists" || error === "staff_invitation_already_exists"
      ? 409
      : 400;
  return res.status(status).json({ error });
}

async function listInvitations(req, res) {
  return res.json(await hotelInvitationService.listInvitations(req.params.hotelId));
}

async function createInvitation(req, res) {
  const parsed = hotelInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  try {
    const result = await hotelInvitationService.createInvitation(
      req.params.hotelId,
      parsed.data,
      req.user._id,
      req.app.locals.sendStaffInvitationEmail,
    );
    if (result.error) {
      return sendInvitationError(res, result.error);
    }
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof hotelInvitationService.InvitationEmailDeliveryError) {
      return res.status(503).json({ error: error.message });
    }
    throw error;
  }
}

async function createStaffMemberInvitation(req, res) {
  if (!roomIdSchema.safeParse(req.params.staffId).success) {
    return sendInvitationError(res, "staff_member_not_found");
  }
  const parsed = staffMemberInvitationSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  try {
    const result = await hotelInvitationService.createInvitation(
      req.params.hotelId,
      { ...parsed.data, staffMemberId: req.params.staffId },
      req.user._id,
      req.app.locals.sendStaffInvitationEmail,
    );
    if (result.error) {
      return sendInvitationError(res, result.error);
    }
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof hotelInvitationService.InvitationEmailDeliveryError) {
      return res.status(503).json({ error: error.message });
    }
    throw error;
  }
}

async function revokeInvitation(req, res) {
  if (!roomIdSchema.safeParse(req.params.invitationId).success) {
    return sendInvitationError(res, "staff_invitation_not_found");
  }
  const result = await hotelInvitationService.revokeInvitation(
    req.params.hotelId,
    req.params.invitationId,
  );
  if (result.error) {
    return sendInvitationError(res, result.error);
  }
  return res.json(result);
}

async function resendInvitation(req, res) {
  if (!roomIdSchema.safeParse(req.params.invitationId).success) {
    return sendInvitationError(res, "staff_invitation_not_found");
  }
  try {
    const result = await hotelInvitationService.resendInvitation(
      req.params.hotelId,
      req.params.invitationId,
      req.user._id,
      req.app.locals.sendStaffInvitationEmail,
    );
    if (result.error) {
      return sendInvitationError(res, result.error);
    }
    return res.json(result);
  } catch (error) {
    if (error instanceof hotelInvitationService.InvitationEmailDeliveryError) {
      return res.status(503).json({ error: error.message });
    }
    throw error;
  }
}

module.exports = {
  createDepartment,
  createInvitation,
  createStaffMemberInvitation,
  createStaffMember,
  deleteStaffMember,
  listDepartments,
  listInvitations,
  listStaff,
  resendInvitation,
  revokeInvitation,
  updateStaffMember,
};
