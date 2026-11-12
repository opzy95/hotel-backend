# Hotel backend onboarding foundation

This Express 5 API uses MongoDB through Mongoose. Hotel registration creates a
tenant document, its first user, an active `manager` membership, and a
`pending_selection` subscription in one MongoDB transaction. New hotels start
as `pending_approval`; verifying the registering Manager's email activates the
hotel. Platform operators can suspend and reactivate verified hotels.

All hotel-scoped API routes resolve access from the authenticated user's
membership for the `hotelId` in the route. A hotel ID supplied by a caller does
not grant access. Platform operators are provisioned separately and do not
receive their privileges from hotel membership.

## Local setup

1. Copy `.env.example` to `.env`, set `MONGO_URI`, and replace `JWT_SECRET` with
   a random value of at least 32 characters. Do not commit `.env`.
2. MongoDB must run as a replica set (or a sharded cluster) because signup
   creates multiple related documents transactionally.
3. Configure `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`, then run:

   ```sh
   npm run seed:platform-admin
   npm run seed:plans
   npm start
   ```
4. Configure Brevo transactional email with `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `FRONTEND_URL`. The sender
   address must be verified in Brevo. Keep the API key only in the backend
   environment.
5. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
  `CLOUDINARY_API_SECRET` for room-type photos. Keep these values only in the
  backend environment.

## Code structure

Routes are declared in `src/routes.js`. Controllers in `src/controllers/`
validate HTTP input, call the corresponding service, and format HTTP responses.
Services in `src/services/` contain business logic and database operations.
Authentication and access checks are in `src/middleware/auth.js`.

The seed command creates or activates a separate platform-operator grant.
The provisioned platform administrator is marked as verified, and active
`super_admin` accounts can log in without email verification. Hotel accounts
still need to verify their email. The seed command does not provide a public
super-admin signup route.

## Current API

All authenticated endpoints use `Authorization: Bearer <token>`.
Access tokens are issued and validated by `src/utils/jwt.js`; the utility
requires a `JWT_SECRET` of at least 32 bytes and uses HS256 with a one-hour
expiry, issuer, and audience checks.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Health check |
| `GET` | `/api/public/plans` | Public | List active plans |
| `POST` | `/api/auth/register` | Public, rate-limited | Create account, hotel tenant, Manager membership, and pending subscription |
| `POST` | `/api/auth/login` | Public, rate-limited | Sign in; configured frontend origin also receives an HttpOnly refresh cookie |
| `POST` | `/api/auth/refresh` | Configured frontend origin | Rotate refresh cookie and issue a new access token |
| `POST` | `/api/auth/logout` | Configured frontend origin | Revoke refresh session and clear its cookie |
| `POST` | `/api/auth/send-verification-code` | Public, rate-limited | Send a six-digit verification code |
| `POST` | `/api/auth/verify-code` | Public | Verify an email with its six-digit code |
| `POST` | `/api/auth/resend-verification` | Public, rate-limited | Resend a verification code after the cooldown |
| `POST` | `/api/auth/forgot-password` | Public, rate-limited | Request a password-reset email |
| `POST` | `/api/auth/reset-password` | Public | Set a new password with the one-time reset token |
| `GET` | `/api/auth/me` | Authenticated | Return user, hotel memberships, and platform-operator status |
| `POST` | `/api/hotels` | Authenticated | Create another hotel with the caller as its first Manager |
| `GET` | `/api/hotels/{hotelId}/onboarding` | Hotel Manager | Read hotel status, plan, and setup progress |
| `PUT` | `/api/hotels/{hotelId}/subscription` | Hotel Manager | Select an active plan |
| `PATCH` | `/api/hotels/{hotelId}/settings` | Hotel Manager | Update initial hotel settings |
| `GET` | `/api/hotels/{hotelId}/room-types` | Hotel Manager | List active room types; `includeInactive=true` includes inactive types |
| `POST` | `/api/hotels/{hotelId}/room-types` | Hotel Manager | Create a room type |
| `PATCH` | `/api/hotels/{hotelId}/room-types/{roomTypeId}` | Hotel Manager | Update room type details |
| `DELETE` | `/api/hotels/{hotelId}/room-types/{roomTypeId}` | Hotel Manager | Deactivate a room type |
| `POST` | `/api/hotels/{hotelId}/room-types/{roomTypeId}/photos` | Hotel Manager | Upload up to 10 photos as multipart `photos` fields |
| `DELETE` | `/api/hotels/{hotelId}/room-types/{roomTypeId}/photos/{photoId}` | Hotel Manager | Delete a room-type photo from Cloudinary |
| `GET` | `/api/hotels/{hotelId}/rooms` | Hotel Manager | List active rooms and their room types; `includeInactive=true` includes inactive rooms |
| `POST` | `/api/hotels/{hotelId}/rooms` | Hotel Manager | Create a room using an active room type in the same hotel |
| `PATCH` | `/api/hotels/{hotelId}/rooms/{roomId}` | Hotel Manager | Update room code, type, floor, wing, or notes |
| `DELETE` | `/api/hotels/{hotelId}/rooms/{roomId}` | Hotel Manager | Deactivate a room |
| `GET` | `/api/hotels/{hotelId}/guests` | Hotel Manager | List hotel-scoped guest profiles with pagination and optional search/tier filters |
| `PATCH` | `/api/hotels/{hotelId}/guests/{guestId}` | Hotel Manager | Update a guest's country or membership tier |
| `POST` | `/api/public/reservations` | Public, rate-limited | Create a guest reservation using the hotel's slug |
| `POST` | `/api/public/reservations/lookup` | Public, rate-limited | Retrieve a reservation with its reference and guest email |
| `GET` | `/api/hotels/{hotelId}/reservations` | Hotel Manager | List reservations with pagination and optional search/status/check-in-date filters |
| `POST` | `/api/hotels/{hotelId}/reservations` | Hotel Manager | Create an admin reservation and assign a physical room |
| `GET` | `/api/hotels/{hotelId}/reservations/availability` | Hotel Manager | Check available rooms and server-calculated pricing for a stay and room type |
| `GET` | `/api/hotels/{hotelId}/reservations/{reservationId}/payments` | Hotel Manager | List recorded payments and current payment summary |
| `POST` | `/api/hotels/{hotelId}/reservations/{reservationId}/payments` | Hotel Manager | Record a full or partial admin-collected payment |
| `PATCH` | `/api/hotels/{hotelId}/reservations/{reservationId}` | Hotel Manager | Update guest, stay, room assignment, or reservation status |
| `GET` | `/api/platform/hotels` | Platform operator | List hotels with manager, subscription, plan, and subscription payment details |
| `GET` | `/api/platform/hotels/pending-approval` | Platform operator | List hotels whose registering Manager has not verified email |
| `PATCH` | `/api/platform/hotels/{hotelId}/status` | Platform operator | Activate or suspend a hotel |
| `POST` | `/api/platform/plans` | Platform operator | Create a plan |

### Session renewal

Access tokens expire after 15 minutes. A successful browser login from the exact
`FRONTEND_URL` origin keeps the existing `{ "token": "...", "user": { ... } }`
JSON response and sets the `hotel_refresh` HttpOnly cookie. The refresh token is
never returned in JSON or available to frontend JavaScript. Login requests
without an `Origin` retain the access-token response for non-browser clients,
but do not create a refresh session.

The frontend should send browser credentials on login, refresh, and logout. On
an API `401`, it should make one `POST /api/auth/refresh` request with browser
credentials, use the returned `{ "token": "..." }` to retry the original
request once, and return to sign-in if refresh returns `401`. Logout is
`POST /api/auth/logout`; it returns `{ "message": "logged_out" }`. Refresh and
logout require the request `Origin` to match `FRONTEND_URL` exactly. CORS is
restricted to that origin and allows credentials.

Refresh sessions have a 30-day absolute expiry that is not extended by token
rotation. Each refresh token is single-use; replaying an already rotated token
revokes that browser session family. Logout revokes the family, and password
reset revokes all refresh sessions for the user. Refresh cookies are scoped to
`/api/auth`, `HttpOnly`, and `SameSite=Lax` by default. For a cross-site frontend
and API, configure `COOKIE_SAME_SITE=none` and serve over HTTPS; `Secure` is
enabled automatically in production or can be set with `COOKIE_SECURE=true`.

### Room inventory

Room-type create/update bodies use `name`, optional `description`, `sizeSqm`,
`maxGuests`, `bedSetup` (for example `[{ "type": "queen", "count": 1 }]`),
`baseRateMinor`, and optional `amenities`. The hotel must already have a
configured currency; the API takes it from hotel settings and does not accept a
client-supplied currency. Names are unique per hotel after trimming and
case-normalization. `baseRateMinor` is a non-negative integer in that currency's
minor units.

Room create/update bodies use `code`, `roomTypeId`, and optional `floor`,
`wing`, and `notes`. Codes are unique per hotel, ignoring case. Create and type
change operations require an active room type belonging to the same hotel.
Room types and rooms are deactivated rather than hard-deleted. All of these
routes require an active manager membership; platform-operator status alone is
not sufficient.

Example room-type request:

```json
{
  "name": "Standard",
  "description": "One queen bed",
  "sizeSqm": 22.5,
  "maxGuests": 2,
  "bedSetup": [{ "type": "queen", "count": 1 }],
  "baseRateMinor": 12500,
  "amenities": ["Wi-Fi", "Desk"]
}
```

`POST /api/hotels/{hotelId}/rooms` accepts:

```json
{
  "code": "101",
  "roomTypeId": "<room-type-id>",
  "floor": "1",
  "wing": "East",
  "notes": "Near the elevator"
}
```

The room create response is `{ "room": { "id": "...", "hotelId": "...",
"code": "101", "roomType": { ... }, "floor": "1", "wing": "East",
"notes": "Near the elevator", "active": true, "status": "Available" } }`.
Room-type create returns `{ "roomType": { ... } }`; the list endpoints return
`{ "rooms": [...] }` and `{ "roomTypes": [...] }`.

Photo upload uses `multipart/form-data` with one or more `photos` image fields
(JPEG, PNG, WebP, or AVIF; maximum 5 MiB each and 10 photos per room type).
Images are stored in Cloudinary; MongoDB stores their Cloudinary public ID and
secure URL. Responses contain `roomTypes`, `roomType`, `rooms`, or `room` as
appropriate. Each room includes its related `roomType` and `status`. A room is
`Occupied` when its active reservation is checked in, `Reserved` during a
confirmed stay, and otherwise `Available`.

### Reservations

Stay dates use `YYYY-MM-DD` hotel calendar dates, with check-out exclusive.
Each reservation covers one physical room. Public creation identifies an active
hotel by its `hotelSlug`; the server validates guest capacity and assigns an
available room of the requested type. Admin creation uses the same fields with
`POST /api/hotels/{hotelId}/reservations` and may include `assignedRoomId` to
request a specific room. A room cannot have overlapping confirmed or checked-in
reservations. Reservation writes serialize by room type in a MongoDB
transaction, so the deployment must use a replica set (as required for signup).

The server ignores client-supplied prices and calculates
`roomType.baseRateMinor * nights`, storing the rate, currency, and total as a
snapshot in integer minor units. No taxes, discounts, or payment-provider
processing is applied. New reservations are `confirmed`; a nonzero total starts
as `unpaid`, while a zero total is immediately settled.
Reservation payment status is derived from recorded amounts: `unpaid`,
`partially_paid`, or `paid`. Reservation statuses are `confirmed`, `cancelled`,
`checked_in`, `checked_out`, and `no_show`. A cancelled or no-show reservation
can be confirmed again only if the room remains available; checked-in
reservations can only be checked out.

Public booking request:

```json
{
  "hotelSlug": "grand-harbor",
  "guestName": "Alex Example",
  "guestEmail": "alex@example.com",
  "guestPhone": "+33123456789",
  "checkIn": "2027-06-10",
  "checkOut": "2027-06-12",
  "roomTypeId": "<room-type-id>",
  "adults": 2,
  "children": 0
}
```

`POST /api/public/reservations` returns `201` with
`{ "reservation": { "id", "reference", "guest", "checkIn", "checkOut",
"roomType", "assignedRoom", "guests", "pricing", "paymentStatus", "status" } }`.
The generated reference has the form `HTL-` followed by 16 hexadecimal
characters. The server returns `400 validation_error` for invalid input,
`404 hotel_not_found` or `404 room_type_not_found` for unknown resources, and
`409 room_unavailable` or `409 room_guest_limit_exceeded` when inventory or
capacity constraints fail.

Example response:

```json
{
  "reservation": {
    "id": "<reservation-id>",
    "hotelId": "<hotel-id>",
    "reference": "HTL-1A2B3C4D5E6F7890",
    "guest": {
      "name": "Alex Example",
      "email": "alex@example.com",
      "phone": "+33123456789"
    },
    "checkIn": "2027-06-10",
    "checkOut": "2027-06-12",
    "roomType": { "id": "<room-type-id>", "name": "Standard" },
    "assignedRoom": { "id": "<room-id>", "code": "101" },
    "guests": { "adults": 2, "children": 0 },
    "pricing": {
      "nights": 2,
      "rateMinorPerNight": 12500,
      "totalMinor": 25000,
      "currency": "USD"
    },
    "paymentStatus": "unpaid",
    "status": "confirmed",
    "source": "public"
  }
}
```

`POST /api/public/reservations/lookup` accepts
`{ "reference": "HTL-...", "email": "alex@example.com" }`. Both values must
match; an unknown reference or mismatched email returns
`404 reservation_not_found`. Both public endpoints are rate-limited.

Managers can use `GET /api/hotels/{hotelId}/reservations?page=1&limit=25` with
optional `search`, `status`, `checkInFrom`, and `checkInTo` filters. Responses
contain `reservations` and `{ "page", "limit", "total", "pages" }` pagination.
Admin reservation objects include `guest.id`, `guest.country`,
`guest.membershipTier`, and `guest.createdAt` alongside guest name, email, and
phone. Guest profiles are hotel-scoped and matched by normalized email.
Country and membership tier are `null` until provided; the backend does not
infer them. Existing reservations are linked to profiles during startup
backfill; those profile creation timestamps indicate when the profile was
backfilled, not the original reservation date.

The admin reservation `guest` object is:

```json
{
  "id": "<guest-id>",
  "name": "Alex Example",
  "email": "alex@example.com",
  "phone": "+33123456789",
  "country": null,
  "membershipTier": null,
  "createdAt": "2026-11-12T10:30:00.000Z"
}
```

`GET /api/hotels/{hotelId}/guests?page=1&limit=25` lists profiles and accepts
optional `search` and `membershipTier` filters. `PATCH /api/hotels/{hotelId}/guests/{guestId}`
accepts `country` as a two-letter ISO
country code and/or `membershipTier` as a hotel-defined string; either can be
set to `null` to clear it. Admin reservation creation and updates may also
provide `guestCountry`.

Load categories from `GET /api/hotels/{hotelId}/room-types`, then check
availability before selecting an assigned room:

```http
GET /api/hotels/{hotelId}/reservations/availability?checkIn=2027-06-10&checkOut=2027-06-12&roomTypeId=<room-type-id>&adults=2&children=0
```

The availability response contains the requested `stay`, `roomType`, and
`guests`, an `availableRooms` array with `{ "id", "code" }` entries, and
`pricing` with `{ "nights", "rateMinorPerNight", "totalMinor", "currency" }`.
The array is empty when there is no available room. Requests exceeding the
category's guest limit return `409 room_guest_limit_exceeded`. This is a
point-in-time check: reservation creation checks inventory again, so the UI must
handle `409 room_unavailable` if another booking wins the room before save.
Availability, creation, and listing routes all require an active manager
membership for the hotel.

`PATCH /api/hotels/{hotelId}/reservations/{reservationId}` accepts partial guest
details, both `checkIn` and `checkOut` together, `roomTypeId` with an optional
`assignedRoomId`, guest counts, or `status`. Payment status cannot be set
directly.

Record a full or partial admin-collected payment with
`POST /api/hotels/{hotelId}/reservations/{reservationId}/payments`:

```json
{
  "amountMinor": 10000,
  "method": "cash",
  "reference": null,
  "note": "Deposit collected at front desk",
  "idempotencyKey": "b9e87092-9b25-4e8d-a330-0fa5c96615db"
}
```

`amountMinor` is a positive integer in the reservation currency's minor units.
Supported methods are `cash`, `card`, `bank_transfer`, `mobile_money`, and
`other`. The server rejects overpayments and derives the remaining balance.
The idempotency key must be a UUID; retrying the same request returns the
existing payment without adding it twice. A new payment returns `201`; an
identical retry returns `200`.

The payment response contains `payment` with `id`, `amountMinor`, `currency`,
`method`, `reference`, `note`, `idempotencyKey`, `receivedAt`, and `receivedBy`
(`id` and `name`), plus `paymentSummary` with `totalMinor`, `paidMinor`,
`balanceDueMinor`, and `paymentStatus`. For example:

```json
{
  "payment": {
    "id": "<payment-id>",
    "amountMinor": 10000,
    "currency": "USD",
    "method": "cash",
    "reference": null,
    "note": "Deposit collected at front desk",
    "idempotencyKey": "b9e87092-9b25-4e8d-a330-0fa5c96615db",
    "receivedAt": "2026-11-12T11:30:00.000Z",
    "receivedBy": {
      "id": "<user-id>",
      "name": "Hotel Manager"
    }
  },
  "paymentSummary": {
    "totalMinor": 25000,
    "paidMinor": 10000,
    "balanceDueMinor": 15000,
    "paymentStatus": "partially_paid"
  }
}
```

`GET /api/hotels/{hotelId}/reservations/{reservationId}/payments` returns
`{ "payments": [...], "paymentSummary": { ... } }`. Admin reservation objects
also include `paymentSummary`. Payment records are append-only; payment
reversals/refunds and gateway processing are not implemented. Manager
reservation and payment operations require an active manager membership for
that hotel; an arbitrary `hotelId` does not grant access.

The local API base URL is `http://localhost:3000/api` unless `PORT` is
configured. In deployment, use the backend origin with the `/api` prefix. For
browser clients, configure `FRONTEND_URL` to the exact frontend origin so CORS
allows it; additional public-booking frontend origins require an explicit CORS
configuration change.

Hotel registration body:

```json
{
  "hotel": {
    "name": "Grand Harbor Hotel",
    "email": "stay@example.com",
    "phone": "+33123456789",
    "address": {
      "line1": "1 Harbor Street",
      "city": "Paris",
      "country": "FR"
    },
    "type": "boutique",
    "roomCount": 40
  },
  "manager": {
    "name": "Alex Example",
    "email": "alex@example.com",
    "password": "use-a-unique-password"
  }
}
```

The first user is the hotel `manager`; this public endpoint does not register
platform super admins. After registration, the manager can sign in with:

```json
{
  "email": "manager@example.com",
  "password": "the-same-registration-password"
}
```

Registration sends a six-digit code and does not issue an access token. The
response includes `message: "We sent a code to your email."`. Submit
`{ "email": "manager@example.com", "code": "123456" }` to
`POST /api/auth/verify-code`. Codes expire after 10 minutes and allow at most
three incorrect attempts; after lockout, request a new code. Use
`POST /api/auth/send-verification-code` or
`POST /api/auth/resend-verification` with
`{ "email": "manager@example.com" }` to request one. Resending is available
once per 60 seconds. Until verified, hotel-account login returns
`403 email_not_verified`.
If Brevo delivery fails during registration, the API returns
`503 verification_email_delivery_failed`; the account has already been
created, so the user should request another verification code rather than
registering again.

Password recovery uses the same `POST /api/auth/forgot-password` endpoint for
hotel Managers and platform super admins, with
`{ "email": "admin@example.com" }`; there is no separate admin URL. The generic
`202` response does not reveal whether that email is registered. The email link points to
`/reset-password?token=...`. Submit the token and a new password to
`POST /api/auth/reset-password`. Reset tokens expire after one hour, are
single-use, and resetting the password invalidates existing access tokens.
Configure the frontend route `/reset-password`, and set `FRONTEND_URL` to the
frontend origin. Valid requests are rate limited. Verification codes are stored
as keyed hashes, are single-use, and expire automatically in MongoDB. Password
reset tokens are stored as SHA-256 hashes, are single-use, and also expire
automatically. Brevo delivery failures are logged and surfaced as HTTP 503.

Successful registration returns the new hotel with
`status: "pending_approval"`, a `manager` membership, and onboarding step
`choose_plan`. A verified manager can select the 60-day `FREE_TRIAL` once per
hotel. Its start and end are stored in `trial_start_date` and `trial_end_date`;
the end date is 60 days after selection. When a manager accesses the hotel
after the end date, the subscription is marked `expired`. Expired hotels can
still access onboarding and subscription selection, but settings changes are
blocked as read-only. Expiry is applied when a hotel-scoped request is made,
not by a background scheduler. Paid plan selection remains `pending` until
payment verification is implemented. The public catalog contains `STANDARD`
(six months, NGN 150,000) and `PROFESSIONAL` (twelve months, NGN 270,000) as
separate paid plans. Plan entries include their database `id`, which is used
when selecting a plan. `PUT /api/hotels/{hotelId}/subscription` accepts either
`{ "planId": "<plan id>" }` or `{ "planCode": "STANDARD" }`; for compatibility,
the plan code may also be sent as `planId`. The seed deactivates the previous
six-month `PROFESSIONAL` price rather than deleting its record. Hotels remain
`pending_approval` until the manager verifies their email, at which point they
become `active`. Platform operators can then switch hotels between `active`
and `suspended` through `PATCH /api/platform/hotels/{hotelId}/status`.
Suspended hotels are blocked from tenant-scoped operations until an operator
reactivates them. Existing `approved` hotel statuses are migrated to `active`
when the backend starts.

## Not included in this first slice

Payment-provider checkout/webhooks, dynamic or seasonal room pricing, booking
confirmation emails, staff invitations/email delivery, custom hotel domains,
and audit-log browsing are not implemented yet. Do not treat
`pending` as proof that a subscription payment succeeded. Paid plans without a
trial cannot be activated until payment processing is integrated. The hotel
registration address requires a two-letter country code; currency uses a
three-letter ISO code and prices are integer minor units.

Before production signup, configure and test Brevo delivery and abuse
protections. Use HTTPS for the production `FRONTEND_URL`. Plan availability
and pricing should be reviewed before publishing plans.

Run the API integration tests against a dedicated replica-set test database by
setting `TEST_MONGO_URI` to a database whose name ends in `_test`. Integration
tests clean up only the records they create. Without that setting, the
integration tests are skipped; the remaining HTTP validation/health tests run
without MongoDB.
