const { randomBytes, randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");

require("dotenv").config();
const testMongoUri = process.env.TEST_MONGO_URI;
process.env.JWT_SECRET ||= randomBytes(32).toString("hex");

test("a manager cannot access another hotel's onboarding endpoint", {
  skip: !testMongoUri,
}, async () => {
  const databaseName = decodeURIComponent(new URL(testMongoUri).pathname.slice(1));
  if (!/_test$/i.test(databaseName)) {
    throw new Error("TEST_MONGO_URI must target a database whose name ends in _test");
  }

  const mongoose = require("mongoose");
  const jwt = require("jsonwebtoken");
  const app = require("../app");
  const { Hotel, HotelMembership, User } = require("../src/models");
  const suffix = randomUUID();
  const createdUserIds = [];
  const createdHotelIds = [];

  await mongoose.connect(testMongoUri);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const userA = await User.create({
      name: "Manager A",
      email: `manager-a-${suffix}@example.test`,
      passwordHash: "test-only-hash",
    });
    const hotelA = await Hotel.create({
      name: "Hotel A",
      email: `hotel-a-${suffix}@example.test`,
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `hotel-a-${suffix}`,
    });
    const hotelB = await Hotel.create({
      name: "Hotel B",
      email: `hotel-b-${suffix}@example.test`,
      phone: "+10000000001",
      address: { line1: "2 Test Street", city: "Test", country: "US" },
      type: "test",
      roomCount: 1,
      slug: `hotel-b-${suffix}`,
    });
    createdUserIds.push(userA._id);
    createdHotelIds.push(hotelA._id, hotelB._id);
    await HotelMembership.create({
      hotelId: hotelA._id,
      userId: userA._id,
      role: "manager",
      status: "active",
    });

    const token = jwt.sign({}, process.env.JWT_SECRET, {
      subject: userA._id.toString(),
      issuer: "hotel-backend",
      audience: "hotel-frontend",
      expiresIn: "5m",
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const ownHotelResponse = await fetch(
      `${baseUrl}/api/hotels/${hotelA._id}/onboarding`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const otherHotelResponse = await fetch(
      `${baseUrl}/api/hotels/${hotelB._id}/onboarding`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    assert.equal(ownHotelResponse.status, 200);
    assert.equal(otherHotelResponse.status, 404);
  } finally {
    await HotelMembership.deleteMany({ hotelId: { $in: createdHotelIds } });
    await Hotel.deleteMany({ _id: { $in: createdHotelIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await mongoose.disconnect();
  }
});
