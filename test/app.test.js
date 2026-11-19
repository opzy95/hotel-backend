const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");
const { bankDetailsSchema, registrationSchema } = require("../src/schemas");
const { publicHotel, publicHotelDetails } = require("../src/utils/public-resources");
const { reservationResource } = require("../src/services/reservation-service");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test("legacy root health response remains available", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Hotel backend is running" });
});

test("health endpoint responds without a database connection", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("registration validates input before touching the database", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("bank details require a complete, valid account record", () => {
  const bankDetails = {
    bankName: "Example Bank",
    bankAccountNumber: "0012345678",
    accountName: "Example Hotel Ltd",
  };
  assert.deepEqual(bankDetailsSchema.parse(bankDetails), bankDetails);
  assert.equal(bankDetailsSchema.safeParse({
    ...bankDetails,
    bankAccountNumber: " ",
  }).success, false);
  assert.equal(bankDetailsSchema.safeParse({
    ...bankDetails,
    accountName: undefined,
  }).success, false);

  const registration = registrationSchema.safeParse({
    hotel: {
      name: "Example Hotel",
      email: "hotel@example.test",
      phone: "+10000000000",
      address: { line1: "1 Test Street", city: "Test", country: "US" },
      bankDetails,
      type: "boutique",
      roomCount: 10,
    },
    manager: {
      name: "Hotel Manager",
      email: "manager@example.test",
      password: "unique-test-password-2026",
    },
  });
  assert.equal(registration.success, true);
});

test("public hotel details expose configured bank information", () => {
  const bankDetails = {
    bankName: "Example Bank",
    bankAccountNumber: "0012345678",
    accountName: "Example Hotel Ltd",
  };
  const hotel = {
    name: "Example Hotel",
    slug: "example-hotel",
    phone: "+10000000000",
    address: { line1: "1 Test Street", city: "Test", country: "US" },
    type: "boutique",
    bankDetails,
  };
  assert.deepEqual(publicHotel({ ...hotel, _id: "hotel-id" }).bankDetails, bankDetails);
  assert.deepEqual(publicHotelDetails(hotel).bankDetails, bankDetails);
  assert.equal(publicHotelDetails({ ...hotel, bankDetails: undefined }).bankDetails, null);
});

test("public receipt uploads remain pending until payment is recorded", () => {
  const reservation = {
    _id: "reservation-id",
    hotelId: "hotel-id",
    reference: "HTL-0123456789ABCDEF",
    guestName: "Guest Example",
    guestEmail: "guest@example.test",
    guestPhone: "+10000000000",
    checkIn: new Date("2027-06-10T00:00:00.000Z"),
    checkOut: new Date("2027-06-11T00:00:00.000Z"),
    roomTypeId: { _id: "room-type-id", name: "Standard" },
    roomId: { _id: "room-id", code: "101" },
    adults: 1,
    children: 0,
    nights: 1,
    rateMinorPerNight: 12000,
    totalMinor: 12000,
    amountPaidMinor: 0,
    currency: "USD",
    paymentStatus: "pending_verification",
    status: "confirmed",
    source: "public",
    paymentReceipt: {
      secureUrl: "https://example.test/receipt.pdf",
      format: "pdf",
      bytes: 42,
      uploadedAt: new Date("2027-06-01T00:00:00.000Z"),
    },
    createdAt: new Date("2027-06-01T00:00:00.000Z"),
    updatedAt: new Date("2027-06-01T00:00:00.000Z"),
  };
  const pending = reservationResource(reservation, { includePaymentSummary: true });
  assert.equal(pending.paymentStatus, "pending_verification");
  assert.equal(pending.paymentSummary.balanceDueMinor, 12000);
  assert.equal(
    reservationResource(
      { ...reservation, amountPaidMinor: 3000 },
      { includePaymentSummary: true },
    ).paymentStatus,
    "partially_paid",
  );
  assert.equal(reservationResource(reservation).paymentReceipt, undefined);
  assert.equal(
    reservationResource(reservation, { includePaymentReceipt: true }).paymentReceipt.url,
    reservation.paymentReceipt.secureUrl,
  );
  assert.equal(
    reservationResource(
      { ...reservation, source: "admin" },
      { includePaymentReceipt: true },
    ).paymentReceipt,
    undefined,
  );
});

test("malformed JSON receives a client error", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});

test("login rejects malformed credentials without querying the database", async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_credentials");
});

test("email verification rejects codes that are not six digits", async () => {
  const response = await fetch(`${baseUrl}/api/auth/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "manager@example.com", code: "123" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_verification_code");
});

test("send-verification-code endpoint is registered and validates the email", async () => {
  const response = await fetch(`${baseUrl}/api/auth/send-verification-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_email");
});

test("password reset validates tokens and password policy before database access", async () => {
  const response = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "bad", password: "short" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("forgot password validates email shape before database access", async () => {
  const response = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_email");
});

test("protected endpoints reject requests without a bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("hotel settings endpoint requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/hotels/not-an-id/settings`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("platform subscription payment endpoints require authentication", async () => {
  const initializeResponse = await fetch(
    `${baseUrl}/api/hotels/not-an-id/subscription/payments/initialize`,
    { method: "POST" },
  );
  assert.equal(initializeResponse.status, 401);
  assert.equal((await initializeResponse.json()).error, "authentication_required");

  const verifyResponse = await fetch(
    `${baseUrl}/api/hotels/not-an-id/subscription/payments/verify`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: "SUB-test-reference" }),
    },
  );
  assert.equal(verifyResponse.status, 401);
  assert.equal((await verifyResponse.json()).error, "authentication_required");
});

test("public reservation rejects impossible stay dates before database access", async () => {
  const response = await fetch(`${baseUrl}/api/public/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hotelSlug: "sample-hotel",
      guestName: "Guest Example",
      guestEmail: "guest@example.com",
      guestPhone: "+10000000000",
      checkIn: "2026-02-31",
      checkOut: "2026-03-02",
      roomTypeId: "0123456789abcdef01234567",
      adults: 1,
      children: 0,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("public reservation rejects client-supplied hotel, room, and price fields", async () => {
  const response = await fetch(`${baseUrl}/api/public/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hotelSlug: "sample-hotel",
      guestName: "Guest Example",
      guestEmail: "guest@example.com",
      guestPhone: "+10000000000",
      checkIn: "2027-06-10",
      checkOut: "2027-06-12",
      roomTypeId: "0123456789abcdef01234567",
      adults: 1,
      hotelId: "0123456789abcdef01234567",
      roomId: "0123456789abcdef01234568",
      totalMinor: 1,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("public reservation rejects unsupported receipt file types", async () => {
  const form = new FormData();
  form.append("receipt", new Blob(["not a receipt image"], { type: "text/plain" }), "receipt.txt");
  const response = await fetch(`${baseUrl}/api/public/reservations`, {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "unsupported_receipt_type");
});

test("public multipart booking parses numeric fields before validating", async () => {
  const form = new FormData();
  form.append("hotelSlug", "x");
  form.append("guestName", "Guest Example");
  form.append("guestEmail", "guest@example.test");
  form.append("guestPhone", "+10000000000");
  form.append("checkIn", "2027-06-10");
  form.append("checkOut", "2027-06-12");
  form.append("roomTypeId", "0123456789abcdef01234567");
  form.append("adults", "2");
  form.append("children", "0");

  const response = await fetch(`${baseUrl}/api/public/reservations`, {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "validation_error");
  assert.deepEqual(body.details.map(({ path }) => path), ["hotelSlug"]);
});

test("public hotel lookup rejects malformed slugs without database access", async () => {
  const response = await fetch(`${baseUrl}/api/public/hotels/x`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "hotel_not_found");
});

test("public availability validates stay dates before database access", async () => {
  const response = await fetch(
    `${baseUrl}/api/public/hotels/sample-hotel/availability?checkIn=2026-03-02&checkOut=2026-03-02&adults=1`,
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_query");
});

test("public reservation lookup requires a valid reference and email", async () => {
  const response = await fetch(`${baseUrl}/api/public/reservations/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reference: "short", email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("public reference recovery validates email before querying reservations", async () => {
  const response = await fetch(`${baseUrl}/api/public/reservations/reference-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "validation_error");
});

test("admin reservation routes require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/hotels/not-an-id/reservations`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("admin reservation availability requires authentication", async () => {
  const response = await fetch(
    `${baseUrl}/api/hotels/not-an-id/reservations/availability`,
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("admin reservation payment routes require authentication", async () => {
  const response = await fetch(
    `${baseUrl}/api/hotels/not-an-id/reservations/not-an-id/payments`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("admin guest profile routes require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/hotels/not-an-id/guests`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("inviting an existing staff member requires authentication", async () => {
  const response = await fetch(
    `${baseUrl}/api/hotels/not-an-id/staff/not-an-id/invitation`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("deleting a staff member requires authentication", async () => {
  const response = await fetch(
    `${baseUrl}/api/hotels/not-an-id/staff/not-an-id`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});
