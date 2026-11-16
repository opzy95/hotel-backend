require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;

test("hotel managers invite receptionists with scoped permissions and walk-in payments", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const {
    Guest,
    Hotel,
    HotelInvitation,
    HotelMembership,
    Reservation,
    ReservationPayment,
    Room,
    RoomType,
    StaffMember,
    User,
  } = require("../src/models");
  const {
    DEFAULT_RECEPTIONIST_PERMISSIONS,
  } = require("../src/utils/hotel-permissions");
  const suffix = randomUUID();
  const password = "receptionist-test-password-2026";
  const users = [];
  const hotels = [];
  const staffIds = [];
  const originalSendInvitationEmail = app.locals.sendStaffInvitationEmail;
  const sentInvitations = [];

  await mongoose.connect(testMongoUri);
  await Promise.all([
    HotelInvitation.init(),
    Reservation.init(),
    ReservationPayment.init(),
    Guest.init(),
    Room.init(),
    RoomType.init(),
  ]);
  app.locals.sendStaffInvitationEmail = async (invitation, token) => {
    sentInvitations.push({ invitation, token });
  };
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const manager = await User.create({
      name: "Invitation Manager",
      email: `invite-manager-${suffix}@example.test`,
      passwordHash: "test",
      emailVerifiedAt: new Date(),
    });
    users.push(manager._id);
    const hotel = await Hotel.create({
      name: "Receptionist Hotel",
      email: `invite-hotel-${suffix}@example.test`,
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 2,
      slug: `invite-hotel-${suffix}`,
      status: "active",
      settings: { currency: "USD" },
    });
    const otherHotel = await Hotel.create({
      name: "Other Receptionist Hotel",
      email: `other-invite-hotel-${suffix}@example.test`,
      phone: "+10000000001",
      address: { line1: "2 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `other-invite-hotel-${suffix}`,
      status: "active",
    });
    hotels.push(hotel._id, otherHotel._id);
    await HotelMembership.create({
      hotelId: hotel._id,
      userId: manager._id,
      role: "manager",
      status: "active",
    });
    const receptionistEmail = `receptionist-${suffix}@example.test`;
    const receptionistStaff = await StaffMember.create({
      hotelId: hotel._id,
      name: "Taylor Receptionist",
      email: receptionistEmail,
      phone: "+10000000002",
      role: "Receptionist",
      departmentId: new mongoose.Types.ObjectId(),
      shift: "Morning",
      status: "on_duty",
    });
    const otherHotelReceptionist = await StaffMember.create({
      hotelId: otherHotel._id,
      name: "Other Receptionist",
      email: `other-receptionist-${suffix}@example.test`,
      phone: "+10000000003",
      role: "Receptionist",
      departmentId: new mongoose.Types.ObjectId(),
      shift: "Morning",
      status: "on_duty",
    });
    const nonReceptionistStaff = await StaffMember.create({
      hotelId: hotel._id,
      name: "Housekeeper",
      email: `housekeeper-${suffix}@example.test`,
      phone: "+10000000004",
      role: "Housekeeper",
      departmentId: new mongoose.Types.ObjectId(),
      shift: "Morning",
      status: "on_duty",
    });
    staffIds.push(receptionistStaff._id, otherHotelReceptionist._id, nonReceptionistStaff._id);

    const managerToken = require("../src/utils/jwt").signAccessToken(manager._id);
    const request = (path, method = "GET", body, token = managerToken) => fetch(
      `${baseUrl}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const hotelPath = `/api/hotels/${hotel._id}`;
    const staffInvitationPath = `${hotelPath}/staff/invitations`;
    const selectedInvitationResponse = await request(
      `${hotelPath}/staff/${receptionistStaff._id}/invitation`,
      "POST",
      { permissions: ["reservations.view"] },
    );
    assert.equal(selectedInvitationResponse.status, 201);
    const selectedInvitation = (await selectedInvitationResponse.json()).invitation;
    assert.equal(selectedInvitation.staffMemberId.toString(), receptionistStaff._id.toString());
    assert.equal(selectedInvitation.email, receptionistEmail);
    assert.deepEqual(selectedInvitation.permissions, ["reservations.view"]);

    const foreignStaffInvitationResponse = await request(
      `${hotelPath}/staff/${otherHotelReceptionist._id}/invitation`,
      "POST",
      {},
    );
    assert.equal(foreignStaffInvitationResponse.status, 404);
    assert.equal((await foreignStaffInvitationResponse.json()).error, "staff_member_not_found");

    const nonReceptionistInvitationResponse = await request(
      `${hotelPath}/staff/${nonReceptionistStaff._id}/invitation`,
      "POST",
      {},
    );
    assert.equal(nonReceptionistInvitationResponse.status, 400);
    assert.equal(
      (await nonReceptionistInvitationResponse.json()).error,
      "staff_member_not_receptionist",
    );

    const acceptancePath = "/api/auth/accept-invitation";
    const selectedToken = sentInvitations.at(-1).token;
    const selectedAcceptanceResponse = await request(acceptancePath, "POST", {
      token: selectedToken,
      hotelId: hotel._id.toString(),
      email: receptionistEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(selectedAcceptanceResponse.status, 200);
    const selectedMembership = await HotelMembership.findOne({
      hotelId: hotel._id,
      userId: (await User.findOne({ email: receptionistEmail }))._id,
    });
    assert.equal(selectedMembership.role, "receptionist");
    const listedStaffResponse = await request(`${hotelPath}/staff`);
    assert.equal(listedStaffResponse.status, 200);
    const listedReceptionists = (await listedStaffResponse.json()).staff.filter(
      (member) => member.email === receptionistEmail,
    );
    assert.equal(listedReceptionists.length, 1);
    assert.equal(listedReceptionists[0].id.toString(), receptionistStaff._id.toString());

    const pendingStaffEmail = `pending-staff-${suffix}@example.test`;
    const pendingStaff = await StaffMember.create({
      hotelId: hotel._id,
      name: "Pending Receptionist",
      email: pendingStaffEmail,
      phone: "+10000000005",
      role: "Receptionist",
      departmentId: new mongoose.Types.ObjectId(),
      shift: "Evening",
      status: "off_duty",
    });
    staffIds.push(pendingStaff._id);
    const pendingInvitationResponse = await request(
      `${hotelPath}/staff/${pendingStaff._id}/invitation`,
      "POST",
      {},
    );
    assert.equal(pendingInvitationResponse.status, 201);
    const pendingInvitation = (await pendingInvitationResponse.json()).invitation;
    const pendingToken = sentInvitations.at(-1).token;

    const deletePendingStaffResponse = await request(
      `${hotelPath}/staff/${pendingStaff._id}`,
      "DELETE",
    );
    assert.equal(deletePendingStaffResponse.status, 200);
    const pendingDeletion = await deletePendingStaffResponse.json();
    assert.equal(pendingDeletion.invitationsRevoked, 1);
    assert.equal(pendingDeletion.accessRevoked, false);
    const pendingAcceptanceResponse = await request(acceptancePath, "POST", {
      token: pendingToken,
      hotelId: hotel._id.toString(),
      email: pendingStaffEmail,
      name: "Pending Receptionist",
      password,
    }, "");
    assert.equal(pendingAcceptanceResponse.status, 400);
    assert.ok((await HotelInvitation.findById(pendingInvitation.id)).revokedAt);

    const deleteReceptionistResponse = await request(
      `${hotelPath}/staff/${receptionistStaff._id}`,
      "DELETE",
    );
    assert.equal(deleteReceptionistResponse.status, 200);
    const receptionistDeletion = await deleteReceptionistResponse.json();
    assert.equal(receptionistDeletion.accessRevoked, true);
    assert.ok(await User.exists({ email: receptionistEmail }));
    const revokedStaffMembership = await HotelMembership.findOne({
      hotelId: hotel._id,
      userId: selectedMembership.userId,
    });
    assert.equal(revokedStaffMembership.status, "revoked");
    const selectedAccessResponse = await request(
      `${hotelPath}/reservations`,
      "GET",
      undefined,
      require("../src/utils/jwt").signAccessToken(selectedMembership.userId),
    );
    assert.equal(selectedAccessResponse.status, 404);

    const newInviteEmail = `new-${suffix}@example.test`;
    const createInvitationResponse = await request(staffInvitationPath, "POST", {
      email: newInviteEmail,
    });
    assert.equal(createInvitationResponse.status, 201);
    const invitation = (await createInvitationResponse.json()).invitation;
    assert.equal(invitation.role, "receptionist");
    assert.deepEqual(invitation.permissions, DEFAULT_RECEPTIONIST_PERMISSIONS);
    assert.equal(invitation.status, "pending");
    assert.equal(invitation.password, undefined);
    assert.equal(await User.exists({ email: newInviteEmail }), null);
    assert.equal(sentInvitations.length, 3);
    const newInviteToken = sentInvitations.at(-1).token;
    const storedInvitation = await HotelInvitation.findById(invitation.id).select("+tokenHash");
    assert.notEqual(newInviteToken, storedInvitation.tokenHash);

    const crossHotelInvitationResponse = await request(
      `/api/hotels/${otherHotel._id}/staff/invitations`,
      "POST",
      { email: `foreign-${suffix}@example.test` },
    );
    assert.equal(crossHotelInvitationResponse.status, 404);

    const invalidPermissionResponse = await request(staffInvitationPath, "POST", {
      email: `invalid-permission-${suffix}@example.test`,
      permissions: ["settings.update"],
    });
    assert.equal(invalidPermissionResponse.status, 400);

    const revokeInvitationResponse = await request(
      `${staffInvitationPath}/${invitation.id}`,
      "DELETE",
    );
    assert.equal(revokeInvitationResponse.status, 200);
    const revokedAcceptanceResponse = await request(acceptancePath, "POST", {
      token: newInviteToken,
      hotelId: hotel._id.toString(),
      email: newInviteEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(revokedAcceptanceResponse.status, 400);

    const expiringEmail = `expiring-${suffix}@example.test`;
    const expiringResponse = await request(staffInvitationPath, "POST", {
      email: expiringEmail,
    });
    const expiringInvitation = (await expiringResponse.json()).invitation;
    const expiringToken = sentInvitations.at(-1).token;
    await HotelInvitation.updateOne(
      { _id: expiringInvitation.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const expiredAcceptanceResponse = await request(acceptancePath, "POST", {
      token: expiringToken,
      hotelId: hotel._id.toString(),
      email: expiringEmail,
      name: "Expired Receptionist",
      password,
    }, "");
    assert.equal(expiredAcceptanceResponse.status, 400);

    const resentEmail = `resend-${suffix}@example.test`;
    const resendCreateResponse = await request(staffInvitationPath, "POST", {
      email: resentEmail,
    });
    const resendInvitation = (await resendCreateResponse.json()).invitation;
    const originalToken = sentInvitations.at(-1).token;
    const resendResponse = await request(
      `${staffInvitationPath}/${resendInvitation.id}/resend`,
      "POST",
    );
    assert.equal(resendResponse.status, 200);
    const resentToken = sentInvitations.at(-1).token;
    assert.notEqual(resentToken, originalToken);

    const wrongEmailResponse = await request(acceptancePath, "POST", {
      token: resentToken,
      hotelId: hotel._id.toString(),
      email: `wrong-${suffix}@example.test`,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(wrongEmailResponse.status, 400);
    const wrongHotelResponse = await request(acceptancePath, "POST", {
      token: resentToken,
      hotelId: otherHotel._id.toString(),
      email: resentEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(wrongHotelResponse.status, 400);
    const oldTokenResponse = await request(acceptancePath, "POST", {
      token: originalToken,
      hotelId: hotel._id.toString(),
      email: resentEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(oldTokenResponse.status, 400);

    const acceptResponse = await request(acceptancePath, "POST", {
      token: resentToken,
      hotelId: hotel._id.toString(),
      email: resentEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(acceptResponse.status, 200);
    const acceptedUser = await User.findOne({ email: resentEmail });
    assert.ok(acceptedUser.emailVerifiedAt);
    const acceptedMembership = await HotelMembership.findOne({
      hotelId: hotel._id,
      userId: acceptedUser._id,
    });
    assert.equal(acceptedMembership.role, "receptionist");
    assert.deepEqual(acceptedMembership.permissions, DEFAULT_RECEPTIONIST_PERMISSIONS);
    const replayAcceptanceResponse = await request(acceptancePath, "POST", {
      token: resentToken,
      hotelId: hotel._id.toString(),
      email: resentEmail,
      name: "Taylor Receptionist",
      password,
    }, "");
    assert.equal(replayAcceptanceResponse.status, 400);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: resentEmail, password }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    const receptionistHeadersToken = login.token;
    const meResponse = await request("/api/auth/me", "GET", undefined, receptionistHeadersToken);
    assert.equal(meResponse.status, 200);
    const profile = await meResponse.json();
    const profileMembership = profile.memberships.find(
      (item) => item.hotelId.toString() === hotel._id.toString(),
    );
    assert.equal(profileMembership.role, "receptionist");
    assert.deepEqual(profileMembership.permissions, DEFAULT_RECEPTIONIST_PERMISSIONS);
    assert.equal(profile.memberships.some((item) => item.hotelId.toString() === otherHotel._id.toString()), false);

    const receptionistRequest = (path, method = "GET", body) => request(
      path,
      method,
      body,
      receptionistHeadersToken,
    );
    assert.ok(profileMembership.permissions.includes("payments.walk_in.create"));

    const staffListResponse = await receptionistRequest(`${hotelPath}/staff`);
    assert.equal(staffListResponse.status, 404);
    const settingsResponse = await receptionistRequest(`${hotelPath}/settings`, "PATCH", {
      timezone: "UTC",
    });
    assert.equal(settingsResponse.status, 404);
    const crossTenantResponse = await receptionistRequest(
      `/api/hotels/${otherHotel._id}/reservations`,
    );
    assert.equal(crossTenantResponse.status, 404);

    const guestResponse = await receptionistRequest(`${hotelPath}/guests`, "POST", {
      name: "Guest Lookup",
      email: `guest-${suffix}@example.test`,
      phone: "+10000000002",
    });
    assert.equal(guestResponse.status, 201);
    assert.equal((await receptionistRequest(`${hotelPath}/guests`)).status, 200);

    const roomType = await RoomType.create({
      hotelId: hotel._id,
      name: "Standard",
      nameKey: "standard",
      sizeSqm: 22,
      maxGuests: 2,
      bedSetup: [{ type: "queen", count: 1 }],
      baseRateMinor: 12500,
      currency: "USD",
    });
    const inactiveRoomType = await RoomType.create({
      hotelId: hotel._id,
      name: "Inactive Room Type",
      nameKey: "inactive-room-type",
      sizeSqm: 20,
      maxGuests: 2,
      bedSetup: [{ type: "queen", count: 1 }],
      baseRateMinor: 10000,
      currency: "USD",
      active: false,
    });
    const receptionistRoomTypesResponse = await receptionistRequest(`${hotelPath}/room-types`);
    assert.equal(receptionistRoomTypesResponse.status, 200);
    assert.deepEqual(
      (await receptionistRoomTypesResponse.json()).roomTypes.map((type) => type.name),
      ["Standard"],
    );
    const includeInactiveRoomTypesResponse = await receptionistRequest(
      `${hotelPath}/room-types?includeInactive=true`,
    );
    assert.deepEqual(
      (await includeInactiveRoomTypesResponse.json()).roomTypes.map((type) => type.name),
      ["Standard"],
    );
    const rooms = await Room.create([
      { hotelId: hotel._id, code: "101", codeKey: "101", roomTypeId: roomType._id },
      { hotelId: hotel._id, code: "102", codeKey: "102", roomTypeId: roomType._id },
      {
        hotelId: hotel._id,
        code: "103",
        codeKey: "103",
        roomTypeId: inactiveRoomType._id,
        active: false,
        notes: "Manager-only configuration",
      },
    ]);
    const receptionistRoomsResponse = await receptionistRequest(
      `${hotelPath}/rooms?includeInactive=true`,
    );
    assert.equal(receptionistRoomsResponse.status, 200);
    const receptionistRooms = (await receptionistRoomsResponse.json()).rooms;
    assert.deepEqual(receptionistRooms.map((room) => room.code), ["101", "102"]);
    assert.equal(receptionistRooms[0].notes, undefined);
    assert.deepEqual(
      Object.keys(receptionistRooms[0]).sort(),
      ["code", "hotelId", "id", "roomType", "status"],
    );
    const date = (offset) => {
      const value = new Date();
      value.setUTCDate(value.getUTCDate() + offset);
      return value.toISOString().slice(0, 10);
    };
    const reservationData = {
      guestName: "Walk-in Guest",
      guestEmail: `walkin-${suffix}@example.test`,
      guestPhone: "+10000000003",
      checkIn: date(0),
      checkOut: date(2),
      roomTypeId: roomType._id.toString(),
      adults: 1,
      children: 0,
    };
    const availabilityUrl = new URL(`${baseUrl}${hotelPath}/reservations/availability`);
    availabilityUrl.search = new URLSearchParams({
      checkIn: reservationData.checkIn,
      checkOut: reservationData.checkOut,
      roomTypeId: reservationData.roomTypeId,
      adults: "1",
      children: "0",
    });
    assert.equal((await fetch(availabilityUrl, {
      headers: { authorization: `Bearer ${receptionistHeadersToken}` },
    })).status, 200);
    const walkInResponse = await receptionistRequest(
      `${hotelPath}/reservations/walk-ins`,
      "POST",
      { ...reservationData, assignedRoomId: rooms[0]._id.toString() },
    );
    assert.equal(walkInResponse.status, 201);
    const walkInReservation = (await walkInResponse.json()).reservation;
    assert.equal(walkInReservation.source, "walk_in");

    const paymentPath = `${hotelPath}/reservations/${walkInReservation.id}/payments`;
    const paymentPayload = {
      amountMinor: 5000,
      method: "cash",
      idempotencyKey: randomUUID(),
    };
    const paymentResponse = await receptionistRequest(paymentPath, "POST", paymentPayload);
    assert.equal(paymentResponse.status, 201);
    const paymentResult = await paymentResponse.json();
    assert.equal(paymentResult.payment.amountMinor, 5000);
    assert.equal(paymentResult.payment.reservationId.toString(), walkInReservation.id.toString());
    assert.equal(paymentResult.payment.method, "cash");
    const paymentHistoryResponse = await receptionistRequest(paymentPath);
    assert.equal(paymentHistoryResponse.status, 200);
    const paymentHistory = await paymentHistoryResponse.json();
    assert.equal(paymentHistory.payments.length, 1);
    assert.equal(paymentHistory.payments[0].amountMinor, 5000);

    const checkInResponse = await receptionistRequest(
      `${hotelPath}/reservations/${walkInReservation.id}/check-in`,
      "POST",
    );
    assert.equal(checkInResponse.status, 200);
    assert.equal((await checkInResponse.json()).reservation.status, "checked_in");
    const checkOutResponse = await receptionistRequest(
      `${hotelPath}/reservations/${walkInReservation.id}/check-out`,
      "POST",
    );
    assert.equal(checkOutResponse.status, 200);
    assert.equal((await checkOutResponse.json()).reservation.status, "checked_out");

    const adminReservationResponse = await request(`${hotelPath}/reservations`, "POST", {
      ...reservationData,
      guestName: "Regular Reservation",
      guestEmail: `regular-${suffix}@example.test`,
      assignedRoomId: rooms[1]._id.toString(),
    });
    assert.equal(adminReservationResponse.status, 201);
    const adminReservation = (await adminReservationResponse.json()).reservation;
    const aliasPaymentPermissions = [
      ...DEFAULT_RECEPTIONIST_PERMISSIONS.filter(
        (permission) => permission !== "payments.walk_in.create",
      ),
      "payments.create",
    ];
    await HotelMembership.updateOne(
      { _id: acceptedMembership._id },
      { $set: { permissions: aliasPaymentPermissions } },
    );
    const aliasProfileResponse = await receptionistRequest("/api/auth/me");
    const aliasProfile = await aliasProfileResponse.json();
    const aliasMembership = aliasProfile.memberships.find(
      (item) => item.hotelId.toString() === hotel._id.toString(),
    );
    assert.ok(aliasMembership.permissions.includes("payments.walk_in.create"));
    const nonWalkInPaymentResponse = await receptionistRequest(
      `${hotelPath}/reservations/${adminReservation.id}/payments`,
      "POST",
      { ...paymentPayload, idempotencyKey: randomUUID() },
    );
    assert.equal(nonWalkInPaymentResponse.status, 201);
    const nonWalkInPayment = (await nonWalkInPaymentResponse.json()).payment;
    assert.equal(nonWalkInPayment.amountMinor, 5000);
    assert.equal(nonWalkInPayment.method, "cash");
    assert.equal(
      nonWalkInPayment.reservationId.toString(),
      adminReservation.id.toString(),
    );
    const adminPaymentHistoryResponse = await receptionistRequest(
      `${hotelPath}/reservations/${adminReservation.id}/payments`,
    );
    assert.equal(adminPaymentHistoryResponse.status, 200);
    assert.equal((await adminPaymentHistoryResponse.json()).payments.length, 1);

    const managerOnlyPatchResponse = await receptionistRequest(
      `${hotelPath}/reservations/${adminReservation.id}`,
      "PATCH",
      { status: "cancelled" },
    );
    assert.equal(managerOnlyPatchResponse.status, 404);

    await HotelMembership.updateOne(
      { _id: acceptedMembership._id },
      { $set: { status: "revoked" } },
    );
    const revokedMembershipResponse = await receptionistRequest(`${hotelPath}/reservations`);
    assert.equal(revokedMembershipResponse.status, 404);
  } finally {
    await HotelInvitation.deleteMany({ hotelId: { $in: hotels } });
    await ReservationPayment.deleteMany({ hotelId: { $in: hotels } });
    await Reservation.deleteMany({ hotelId: { $in: hotels } });
    await Guest.deleteMany({ hotelId: { $in: hotels } });
    await Room.deleteMany({ hotelId: { $in: hotels } });
    await RoomType.deleteMany({ hotelId: { $in: hotels } });
    await HotelMembership.deleteMany({ hotelId: { $in: hotels } });
    await StaffMember.deleteMany({ _id: { $in: staffIds } });
    await Hotel.deleteMany({ _id: { $in: hotels } });
    await User.deleteMany({ _id: { $in: users } });
    await User.deleteMany({
      email: {
        $in: [
          `receptionist-${suffix}@example.test`,
          `new-${suffix}@example.test`,
          `pending-staff-${suffix}@example.test`,
          `resend-${suffix}@example.test`,
          `expiring-${suffix}@example.test`,
        ],
      },
    });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    app.locals.sendStaffInvitationEmail = originalSendInvitationEmail;
  }
});
