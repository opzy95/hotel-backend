const { Department, StaffMember } = require("../models");

function departmentResource(department) {
  return {
    id: department._id,
    name: department.name,
    shortName: department.shortName,
    description: department.description,
    lead: department.lead,
  };
}

function staffMemberResource(staffMember) {
  return {
    id: staffMember._id,
    name: staffMember.name,
    email: staffMember.email,
    phone: staffMember.phone,
    role: staffMember.role,
    departmentId: staffMember.departmentId,
    shift: staffMember.shift,
    status: staffMember.status,
    joinedAt: staffMember.joinedAt,
  };
}

async function listDepartments(hotelId) {
  const departments = await Department.find({ hotelId }).sort({ name: 1 }).lean();
  return departments.map(departmentResource);
}

async function createDepartment(hotelId, data) {
  try {
    const department = await Department.create({
      ...data,
      hotelId,
      shortNameKey: data.shortName.toLocaleLowerCase("en-US"),
    });
    return { department: departmentResource(department) };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "department_short_name_already_exists" };
    }
    throw error;
  }
}

async function listStaff(hotelId) {
  const staff = await StaffMember.find({ hotelId }).sort({ name: 1 }).lean();
  return staff.map(staffMemberResource);
}

async function hasHotelDepartment(hotelId, departmentId) {
  return Department.exists({ _id: departmentId, hotelId });
}

async function createStaffMember(hotelId, data) {
  if (!await hasHotelDepartment(hotelId, data.departmentId)) {
    return { error: "department_not_found" };
  }
  try {
    const staffMember = await StaffMember.create({
      ...data,
      hotelId,
      email: data.email.toLowerCase(),
    });
    return { staffMember: staffMemberResource(staffMember) };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "staff_email_already_exists" };
    }
    throw error;
  }
}

async function updateStaffMember(hotelId, staffId, data) {
  if (data.departmentId && !await hasHotelDepartment(hotelId, data.departmentId)) {
    return { error: "department_not_found" };
  }
  const updates = { ...data };
  if (updates.email !== undefined) {
    updates.email = updates.email.toLowerCase();
  }
  try {
    const staffMember = await StaffMember.findOneAndUpdate(
      { _id: staffId, hotelId },
      { $set: updates },
      { returnDocument: "after", runValidators: true },
    ).lean();
    return staffMember
      ? { staffMember: staffMemberResource(staffMember) }
      : { error: "staff_member_not_found" };
  } catch (error) {
    if (error.code === 11000) {
      return { error: "staff_email_already_exists" };
    }
    throw error;
  }
}

module.exports = {
  createDepartment,
  createStaffMember,
  departmentResource,
  listDepartments,
  listStaff,
  staffMemberResource,
  updateStaffMember,
};
