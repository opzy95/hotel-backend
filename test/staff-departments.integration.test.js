const { randomBytes, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  departmentSchema,
  staffMemberSchema,
  staffMemberUpdateSchema,
} = require("../src/schemas");

require("dotenv").config();
const testMongoUri = process.env.TEST_MONGO_URI;
process.env.JWT_SECRET ||= randomBytes(32).toString("hex");

test("staff and department schemas enforce the API contract", () => {
  const department = departmentSchema.parse({ name: "Front Office", shortName: "FO" });
  assert.equal(department.description, "");
  assert.equal(department.lead, "");

  const staffMember = {
    name: "Taylor Staff",
    email: "taylor@example.test",
    phone: "+10000000000",
    role: "Receptionist",
    departmentId: "0123456789abcdef01234567",
    shift: "Morning",
    status: "on_duty",
  };
  for (const status of ["on_duty", "off_duty", "on_leave"]) {
    assert.equal(staffMemberSchema.safeParse({ ...staffMember, status }).success, true);
  }
  assert.equal(staffMemberSchema.safeParse({ ...staffMember, status: "away" }).success, false);
  assert.equal(staffMemberUpdateSchema.safeParse({ status: "on_leave" }).success, true);
  assert.equal(staffMemberUpdateSchema.safeParse({}).success, false);
});

test("hotel managers can manage staff and departments only within their hotel", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const jwt = require("jsonwebtoken");
  const app = require("../app");
  const {
    Department,
    Hotel,
    HotelMembership,
    StaffMember,
    User,
  } = require("../src/models");
  const suffix = randomUUID();
  const createdUserIds = [];
  const createdHotelIds = [];
  const createdDepartmentIds = [];
  const createdStaffIds = [];

  await mongoose.connect(testMongoUri);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const user = await User.create({
      name: "Staff Manager",
      email: `staff-manager-${suffix}@example.test`,
      passwordHash: "test-only-hash",
    });
    const hotel = await Hotel.create({
      name: "Staff Hotel",
      email: `staff-hotel-${suffix}@example.test`,
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `staff-hotel-${suffix}`,
    });
    const otherHotel = await Hotel.create({
      name: "Other Staff Hotel",
      email: `other-staff-hotel-${suffix}@example.test`,
      phone: "+10000000001",
      address: { line1: "2 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `other-staff-hotel-${suffix}`,
    });
    createdUserIds.push(user._id);
    createdHotelIds.push(hotel._id, otherHotel._id);
    await HotelMembership.create({
      hotelId: hotel._id,
      userId: user._id,
      role: "manager",
      status: "active",
    });
    const foreignDepartment = await Department.create({
      hotelId: otherHotel._id,
      name: "Foreign Department",
      shortName: `foreign-${suffix}`,
      shortNameKey: `foreign-${suffix}`.toLowerCase(),
    });
    createdDepartmentIds.push(foreignDepartment._id);

    const token = jwt.sign({}, process.env.JWT_SECRET, {
      subject: user._id.toString(),
      issuer: "hotel-backend",
      audience: "hotel-frontend",
      expiresIn: "5m",
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = (path, method = "GET", body) => fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const hotelPath = `/api/hotels/${hotel._id}`;

    const createDepartmentResponse = await request(
      `${hotelPath}/departments`,
      "POST",
      {
        name: "Front Office",
        shortName: `FO-${suffix}`,
        description: "Guest services",
        lead: "Jordan Lee",
      },
    );
    assert.equal(createDepartmentResponse.status, 201);
    const { department } = await createDepartmentResponse.json();
    assert.equal(department.name, "Front Office");
    assert.ok(department.id);
    createdDepartmentIds.push(department.id);

    const departmentsResponse = await request(`${hotelPath}/departments`);
    assert.equal(departmentsResponse.status, 200);
    assert.deepEqual(
      (await departmentsResponse.json()).departments.map((item) => item.id),
      [department.id],
    );

    const createStaffResponse = await request(`${hotelPath}/staff`, "POST", {
      name: "Taylor Staff",
      email: `taylor-${suffix}@example.test`,
      phone: "+10000000002",
      role: "Receptionist",
      departmentId: department.id,
      shift: "Morning",
      status: "on_duty",
    });
    assert.equal(createStaffResponse.status, 201);
    const { staffMember } = await createStaffResponse.json();
    assert.ok(staffMember.id);
    assert.equal(staffMember.departmentId, department.id);
    assert.ok(staffMember.joinedAt);
    createdStaffIds.push(staffMember.id);

    const updateResponse = await request(
      `${hotelPath}/staff/${staffMember.id}`,
      "PATCH",
      { status: "on_leave" },
    );
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).staffMember.status, "on_leave");

    const foreignDepartmentUpdateResponse = await request(
      `${hotelPath}/staff/${staffMember.id}`,
      "PATCH",
      { departmentId: foreignDepartment._id.toString() },
    );
    assert.equal(foreignDepartmentUpdateResponse.status, 404);
    assert.equal(
      (await foreignDepartmentUpdateResponse.json()).error,
      "department_not_found",
    );

    const staffListResponse = await request(`${hotelPath}/staff`);
    assert.equal(staffListResponse.status, 200);
    const { staff } = await staffListResponse.json();
    assert.equal(staff.length, 1);
    assert.equal(staff[0].status, "on_leave");

    const invalidStatusResponse = await request(`${hotelPath}/staff`, "POST", {
      name: "Invalid Status",
      email: `invalid-${suffix}@example.test`,
      phone: "+10000000003",
      role: "Receptionist",
      departmentId: department.id,
      shift: "Morning",
      status: "away",
    });
    assert.equal(invalidStatusResponse.status, 400);
    assert.equal((await invalidStatusResponse.json()).error, "validation_error");

    const foreignDepartmentResponse = await request(`${hotelPath}/staff`, "POST", {
      name: "Foreign Department Staff",
      email: `foreign-${suffix}@example.test`,
      phone: "+10000000004",
      role: "Receptionist",
      departmentId: foreignDepartment._id.toString(),
      shift: "Morning",
      status: "off_duty",
    });
    assert.equal(foreignDepartmentResponse.status, 404);
    assert.equal((await foreignDepartmentResponse.json()).error, "department_not_found");

    const otherHotelResponse = await request(`/api/hotels/${otherHotel._id}/departments`);
    assert.equal(otherHotelResponse.status, 404);
  } finally {
    await StaffMember.deleteMany({ _id: { $in: createdStaffIds } });
    await Department.deleteMany({ _id: { $in: createdDepartmentIds } });
    await HotelMembership.deleteMany({ hotelId: { $in: createdHotelIds } });
    await Hotel.deleteMany({ _id: { $in: createdHotelIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await mongoose.disconnect();
  }
});
