require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const testMongoUri = process.env.TEST_MONGO_URI;

test("hotel managers can manage only their hotel's room inventory", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const app = require("../app");
  const {
    Hotel,
    HotelMembership,
    PlatformOperator,
    Room,
    RoomType,
    User,
  } = require("../src/models");
  const { signAccessToken } = require("../src/utils/jwt");
  const suffix = randomUUID();
  const createdHotelIds = [];
  const createdUserIds = [];
  const originalPhotoStorage = app.locals.roomPhotoStorage;
  const uploadedImages = [];
  const deletedImages = [];
  app.locals.roomPhotoStorage = {
    async uploadImages(files) {
      const photos = files.map((_file, index) => ({
        publicId: `test/${suffix}/${index}`,
        secureUrl: `https://res.cloudinary.com/test/image/upload/${suffix}/${index}.png`,
        width: 10,
        height: 10,
        format: "png",
        bytes: 5,
      }));
      uploadedImages.push(...photos);
      return photos;
    },
    async deleteImages(photos) {
      deletedImages.push(...photos.map((photo) => photo.publicId));
    },
    async deleteImage(publicId) {
      deletedImages.push(publicId);
    },
  };

  await mongoose.connect(testMongoUri);
  await Promise.all([Room.init(), RoomType.init()]);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const [managerA, managerB, platformAdmin] = await User.create([
      { name: "Manager A", email: `room-a-${suffix}@example.test`, passwordHash: "test" },
      { name: "Manager B", email: `room-b-${suffix}@example.test`, passwordHash: "test" },
      { name: "Platform Admin", email: `room-admin-${suffix}@example.test`, passwordHash: "test" },
    ]);
    createdUserIds.push(managerA._id, managerB._id, platformAdmin._id);

    const [hotelA, hotelB] = await Hotel.create([
      {
        name: "Room Test Hotel A",
        email: `room-hotel-a-${suffix}@example.test`,
        phone: "+10000000000",
        address: { line1: "1 Test Street", city: "Test", country: "US" },
        type: "test",
        roomCount: 2,
        slug: `room-test-a-${suffix}`,
        status: "active",
        settings: { currency: "USD", timezone: "America/New_York" },
      },
      {
        name: "Room Test Hotel B",
        email: `room-hotel-b-${suffix}@example.test`,
        phone: "+10000000001",
        address: { line1: "2 Test Street", city: "Test", country: "US" },
        type: "test",
        roomCount: 2,
        slug: `room-test-b-${suffix}`,
        status: "active",
        settings: { currency: "USD", timezone: "America/Los_Angeles" },
      },
    ]);
    createdHotelIds.push(hotelA._id, hotelB._id);
    await HotelMembership.create([
      { hotelId: hotelA._id, userId: managerA._id, role: "manager", status: "active" },
      { hotelId: hotelB._id, userId: managerB._id, role: "manager", status: "active" },
    ]);
    await PlatformOperator.create({ userId: platformAdmin._id, active: true });

    const headers = (user) => ({
      authorization: `Bearer ${signAccessToken(user._id)}`,
    });
    const jsonHeaders = (user) => ({
      ...headers(user),
      "content-type": "application/json",
    });
    const roomTypeBody = {
      name: "Standard",
      description: "Standard room",
      sizeSqm: 22.5,
      maxGuests: 2,
      bedSetup: [{ type: "queen", count: 1 }],
      baseRateMinor: 12500,
      amenities: ["Wi-Fi"],
    };
    const typesUrlA = `${baseUrl}/api/hotels/${hotelA._id}/room-types`;
    const typesUrlB = `${baseUrl}/api/hotels/${hotelB._id}/room-types`;

    const createTypeResponse = await fetch(typesUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify(roomTypeBody),
    });
    assert.equal(createTypeResponse.status, 201);
    const { roomType } = await createTypeResponse.json();
    assert.equal(roomType.currency, "USD");
    assert.equal(roomType.photos.length, 0);
    const ownTypesResponse = await fetch(typesUrlA, { headers: headers(managerA) });
    assert.equal(ownTypesResponse.status, 200);
    assert.equal((await ownTypesResponse.json()).roomTypes.length, 1);

    const duplicateTypeResponse = await fetch(typesUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify({ ...roomTypeBody, name: "  sTaNdArD " }),
    });
    assert.equal(duplicateTypeResponse.status, 409);
    assert.equal((await duplicateTypeResponse.json()).error, "room_type_name_already_exists");

    const secondHotelTypeResponse = await fetch(typesUrlB, {
      method: "POST",
      headers: jsonHeaders(managerB),
      body: JSON.stringify(roomTypeBody),
    });
    assert.equal(secondHotelTypeResponse.status, 201);
    const otherHotelType = (await secondHotelTypeResponse.json()).roomType;

    const crossHotelTypesResponse = await fetch(typesUrlB, { headers: headers(managerA) });
    assert.equal(crossHotelTypesResponse.status, 404);
    const adminTypesResponse = await fetch(typesUrlA, { headers: headers(platformAdmin) });
    assert.equal(adminTypesResponse.status, 404);

    const roomsUrlA = `${baseUrl}/api/hotels/${hotelA._id}/rooms`;
    const missingTypeResponse = await fetch(roomsUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify({ code: "101", roomTypeId: new mongoose.Types.ObjectId().toString() }),
    });
    assert.equal(missingTypeResponse.status, 404);
    const otherHotelTypeResponse = await fetch(roomsUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify({ code: "101", roomTypeId: otherHotelType.id }),
    });
    assert.equal(otherHotelTypeResponse.status, 404);

    const roomBody = { code: "101", roomTypeId: roomType.id, floor: "1", wing: "East" };
    const createRoomResponse = await fetch(roomsUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify(roomBody),
    });
    assert.equal(createRoomResponse.status, 201);
    const { room } = await createRoomResponse.json();
    assert.equal(room.status, "Available");
    assert.equal(room.roomType.name, "Standard");
    const ownRoomsResponse = await fetch(roomsUrlA, { headers: headers(managerA) });
    assert.equal(ownRoomsResponse.status, 200);
    assert.equal((await ownRoomsResponse.json()).rooms.length, 1);

    const duplicateRoomResponse = await fetch(roomsUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify({ ...roomBody, code: " 101 " }),
    });
    assert.equal(duplicateRoomResponse.status, 409);
    assert.equal((await duplicateRoomResponse.json()).error, "room_code_already_exists");

    const sameCodeOtherHotelResponse = await fetch(`${baseUrl}/api/hotels/${hotelB._id}/rooms`, {
      method: "POST",
      headers: jsonHeaders(managerB),
      body: JSON.stringify({ code: "101", roomTypeId: otherHotelType.id }),
    });
    assert.equal(sameCodeOtherHotelResponse.status, 201);

    const uploadBody = new FormData();
    uploadBody.append("photos", new Blob(["image"], { type: "image/png" }), "room.png");
    const uploadResponse = await fetch(`${typesUrlA}/${roomType.id}/photos`, {
      method: "POST",
      headers: headers(managerA),
      body: uploadBody,
    });
    assert.equal(uploadResponse.status, 201);
    const uploadedType = (await uploadResponse.json()).roomType;
    assert.equal(uploadedType.photos.length, 1);
    assert.equal(uploadedType.photos[0].secureUrl.startsWith("https://"), true);
    assert.equal(uploadedImages.length, 1);

    const deletePhotoResponse = await fetch(
      `${typesUrlA}/${roomType.id}/photos/${uploadedType.photos[0].id}`,
      { method: "DELETE", headers: headers(managerA) },
    );
    assert.equal(deletePhotoResponse.status, 200);
    assert.equal((await deletePhotoResponse.json()).roomType.photos.length, 0);
    assert.deepEqual(deletedImages, [uploadedImages[0].publicId]);

    const deactivateTypeResponse = await fetch(`${typesUrlA}/${roomType.id}`, {
      method: "DELETE",
      headers: headers(managerA),
    });
    assert.equal(deactivateTypeResponse.status, 200);
    assert.equal((await deactivateTypeResponse.json()).roomType.active, false);

    const inactiveTypeRoomResponse = await fetch(roomsUrlA, {
      method: "POST",
      headers: jsonHeaders(managerA),
      body: JSON.stringify({ code: "102", roomTypeId: roomType.id }),
    });
    assert.equal(inactiveTypeRoomResponse.status, 409);
    assert.equal((await inactiveTypeRoomResponse.json()).error, "room_type_inactive");

    const inactiveTypesResponse = await fetch(`${typesUrlA}?includeInactive=true`, {
      headers: headers(managerA),
    });
    assert.equal((await inactiveTypesResponse.json()).roomTypes[0].active, false);
    const retainedRoomResponse = await fetch(`${roomsUrlA}?includeInactive=true`, {
      headers: headers(managerA),
    });
    const retainedRooms = (await retainedRoomResponse.json()).rooms;
    assert.equal(retainedRooms[0].roomType.active, false);
    assert.equal(retainedRooms[0].status, "Available");
  } finally {
    await Room.deleteMany({ hotelId: { $in: createdHotelIds } });
    await RoomType.deleteMany({ hotelId: { $in: createdHotelIds } });
    await HotelMembership.deleteMany({ hotelId: { $in: createdHotelIds } });
    await PlatformOperator.deleteMany({ userId: { $in: createdUserIds } });
    await Hotel.deleteMany({ _id: { $in: createdHotelIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    app.locals.roomPhotoStorage = originalPhotoStorage;
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await mongoose.disconnect();
  }
});
