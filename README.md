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
| `GET` | `/api/public/hotels` | Public, rate-limited | List active hotels by name and slug |
| `GET` | `/api/public/hotels/{hotelSlug}` | Public, rate-limited | Look up an active hotel and its guest-facing details, including bank details and profile image URLs |
| `GET` | `/api/public/hotels/{hotelSlug}/availability` | Public, rate-limited | Search available room types and server-calculated pricing for dates and guest counts |
| `POST` | `/api/auth/register` | Public, rate-limited | Create account, hotel tenant (optional `bankDetails`), Manager membership, and pending subscription |
| `POST` | `/api/auth/accept-invitation` | Public, rate-limited | Accept a single-use hotel staff invitation and set a password |
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
| `GET` | `/api/hotels/{hotelId}/settings` | Hotel Manager | Read hotel details, operational settings, and bank details |
| `PATCH` | `/api/hotels/{hotelId}/settings` | Hotel Manager | Update timezone, locale, currency, and check-in/out times |
| `PUT` | `/api/hotels/{hotelId}/bank-details` | Hotel Manager | Set or replace bank details for public booking |
| `POST` | `/api/hotels/{hotelId}/profile-images` | Hotel Manager | Upload or replace one profile image using multipart `slot` and `image` fields |
| `DELETE` | `/api/hotels/{hotelId}/profile-images/{slot}` | Hotel Manager | Remove a profile image (`cover` or `secondary`) |
| `PUT` | `/api/hotels/{hotelId}/profile-images` | Hotel Manager | Upload/replace either or both images using multipart `coverImage` and `secondaryImage` fields |
| `GET` | `/api/hotels/{hotelId}/room-types` | Manager, or receptionist with `rooms.availability.view` | List active room types; only managers can include inactive types |
| `POST` | `/api/hotels/{hotelId}/room-types` | Hotel Manager | Create a room type |
| `PATCH` | `/api/hotels/{hotelId}/room-types/{roomTypeId}` | Hotel Manager | Update room type details |
| `DELETE` | `/api/hotels/{hotelId}/room-types/{roomTypeId}` | Hotel Manager | Deactivate a room type |
| `POST` | `/api/hotels/{hotelId}/room-types/{roomTypeId}/photos` | Hotel Manager | Upload up to 10 photos as multipart `photos` fields |
| `DELETE` | `/api/hotels/{hotelId}/room-types/{roomTypeId}/photos/{photoId}` | Hotel Manager | Delete a room-type photo from Cloudinary |
| `GET` | `/api/hotels/{hotelId}/rooms` | Manager, or receptionist with `rooms.availability.view` | List room status; receptionists see active rooms only and receive availability fields only |
| `POST` | `/api/hotels/{hotelId}/rooms` | Hotel Manager | Create a room using an active room type in the same hotel |
| `PATCH` | `/api/hotels/{hotelId}/rooms/{roomId}` | Hotel Manager | Update room code, type, floor, wing, or notes |
| `DELETE` | `/api/hotels/{hotelId}/rooms/{roomId}` | Hotel Manager | Deactivate a room |
| `GET` | `/api/hotels/{hotelId}/guests` | Manager or receptionist with `guests.view` | List hotel-scoped guest profiles with pagination and optional search/tier filters |
| `POST` | `/api/hotels/{hotelId}/guests` | Manager or receptionist with `guests.create` | Add a hotel-scoped guest profile |
| `PATCH` | `/api/hotels/{hotelId}/guests/{guestId}` | Hotel Manager | Update a guest's country or membership tier |
| `GET` | `/api/hotels/{hotelId}/departments` | Hotel Manager | List the hotel's departments |
| `POST` | `/api/hotels/{hotelId}/departments` | Hotel Manager | Create a department |
| `GET` | `/api/hotels/{hotelId}/staff` | Hotel Manager | List the hotel's staff |
| `GET` | `/api/hotels/{hotelId}/staff/invitations` | Hotel Manager | List staff invitations and their pending, accepted, expired, or revoked status |
| `POST` | `/api/hotels/{hotelId}/staff/invitations` | Hotel Manager | Invite an email as a receptionist with selected operational permissions |
| `POST` | `/api/hotels/{hotelId}/staff/{staffId}/invitation` | Hotel Manager | Send a receptionist invitation to an existing receptionist staff record |
| `POST` | `/api/hotels/{hotelId}/staff/invitations/{invitationId}/resend` | Hotel Manager | Invalidate and resend a receptionist invitation |
| `DELETE` | `/api/hotels/{hotelId}/staff/invitations/{invitationId}` | Hotel Manager | Revoke a pending receptionist invitation |
| `POST` | `/api/hotels/{hotelId}/staff` | Hotel Manager | Add staff to a department belonging to the hotel |
| `PATCH` | `/api/hotels/{hotelId}/staff/{staffId}` | Hotel Manager | Update staff details; updates may be partial |
| `DELETE` | `/api/hotels/{hotelId}/staff/{staffId}` | Hotel Manager | Delete a staff record; also revoke associated receptionist access and pending invitations |
| `POST` | `/api/public/reservations` | Public, rate-limited | Create a guest reservation using the hotel's slug; optional receipt upload |
| `POST` | `/api/public/reservations/lookup` | Public, rate-limited | Retrieve a reservation with its reference and guest email |
| `POST` | `/api/public/reservations/reference-email` | Public, rate-limited | Email references for upcoming reservations matching a guest email |
| `GET` | `/api/hotels/{hotelId}/reservations` | Manager or receptionist with `reservations.view` | List reservations with pagination and optional search/status/check-in-date filters |
| `POST` | `/api/hotels/{hotelId}/reservations` | Manager or receptionist with `reservations.create` | Create an admin reservation and assign a physical room |
| `POST` | `/api/hotels/{hotelId}/reservations/walk-ins` | Manager or receptionist with `reservations.create` | Create a walk-in reservation eligible for receptionist payment recording |
| `GET` | `/api/hotels/{hotelId}/reservations/availability` | Manager or receptionist with `rooms.availability.view` | Check available rooms and server-calculated pricing for a stay and room type |
| `POST` | `/api/hotels/{hotelId}/reservations/{reservationId}/check-in` | Manager or receptionist with `reservations.check_in` | Check in a reservation |
| `POST` | `/api/hotels/{hotelId}/reservations/{reservationId}/check-out` | Manager or receptionist with `reservations.check_out` | Check out a reservation |
| `GET` | `/api/hotels/{hotelId}/reservations/{reservationId}/payments` | Manager, or receptionist with `payments.walk_in.create` | List payments, current summary, and any public-booking receipt |
| `POST` | `/api/hotels/{hotelId}/reservations/{reservationId}/payments` | Manager, or receptionist with `payments.walk_in.create` | Record a full or partial payment for any reservation, including walk-ins |
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

### Staff and departments

Create departments with `name`, `shortName`, and optional `description` and
`lead`. Department short names are unique within each hotel, ignoring case.
Department create returns `{ "department": { "id", "name", "shortName",
"description", "lead" } }`; the list endpoint returns a `departments` array
with the same fields.

Staff create requires `name`, `email`, `phone`, `role`, `departmentId`, `shift`,
and `status`. The status must be `on_duty`, `off_duty`, or `on_leave`. A staff
member's email is unique within their hotel. The department must already exist
in that same hotel; this is also checked when changing a staff member's
department. Staff create returns `{ "staffMember": { "id", "name", "email",
"phone", "role", "departmentId", "shift", "status", "joinedAt" } }`; the list
endpoint returns a `staff` array with the same fields. `joinedAt` is set by the
API. Invalid request fields return `400` with `validation_error` and field
details; duplicate department short names or staff emails return `409`, while
department ownership and missing-resource errors return `404`.

To invite a person already listed as a receptionist, the frontend can select
their staff record and call
`POST /api/hotels/{hotelId}/staff/{staffId}/invitation` with an optional
`{ "permissions": [...] }` body. The backend verifies that the record belongs
to that hotel and its role is `Receptionist`, then emails the invitation to the
record's address. The record remains visible in the staff list after the
receptionist accepts; the invitation response includes its `staffMemberId`.
The email-based invitation endpoint also links a matching receptionist staff
record when one exists. Fresh email invitations remain available for people
who are not yet in the staff directory.

Managers can remove any staff directory entry with
`DELETE /api/hotels/{hotelId}/staff/{staffId}`. Deleting a receptionist also
revokes their active receptionist membership for this hotel and any pending
invitation tied to the staff entry or email. The person's global user account
is retained, but it no longer has access to this hotel. Other staff deletion
only removes the hotel directory entry.

### Receptionist invitations and access

Managers invite a receptionist with `POST /api/hotels/{hotelId}/staff/invitations`
and `{ "email": "...", "permissions": ["reservations.view", ...] }`. If
`permissions` is omitted, the invitation grants the supported receptionist
actions: `reservations.view`, `reservations.create`, `guests.view`,
`guests.create`, `reservations.check_in`, `reservations.check_out`,
`reservations.extend`, `rooms.availability.view`, and
`payments.walk_in.create`. Managers can select a subset; manager-only
permissions are not accepted. Regardless of the selected subset, active
receptionist memberships are allowed to extend stays. The email contains a
single-use link that expires after seven days. Resending replaces the token;
revoking invalidates it. The API stores only a token hash and never creates a
password before acceptance.

The recipient accepts the link with `POST /api/auth/accept-invitation`,
providing the link's `token` and `hotelId` query values, the invited `email`,
their `name`, and a new `password`. Successful acceptance verifies the email,
activates the hotel membership, consumes the invitation, and enables normal
`/api/auth/login`.
`/api/auth/me` returns each active membership's `hotelId`, `role`, and
`permissions`. Receptionist API access is checked against that active,
hotel-scoped membership on every request. Staff management, hotel settings,
reports, room configuration, reservation editing, and payment editing,
deletion, refunds, and general administration remain manager-only.
Receptionists with `payments.walk_in.create` may view the payment history and
record append-only payments for reservations created through any source,
including walk-ins. They
cannot edit, delete, or refund payments. Memberships using the `payments.create`
alias are also recognized for compatibility.

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
Room types and rooms are deactivated rather than hard-deleted. Inventory
changes require an active manager membership; platform-operator status alone
is not sufficient. Receptionists with `rooms.availability.view` can read active
room types and a limited room-status response, but cannot include inactive
items or access room configuration fields.

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
snapshot in integer minor units. Public availability quotes currently report
zero additional fees (`feesMinor: 0`, `fees: []`); no taxes, discounts, or
payment-provider processing is applied. New reservations are `confirmed`; a
nonzero total starts as `unpaid`, while a zero total is immediately settled.
Reservation payment status is derived from recorded amounts: `unpaid`,
`pending_verification` (a public receipt was uploaded but payment is not
recorded), `partially_paid`, or `paid`. Reservation statuses are `confirmed`, `cancelled`,
`checked_in`, `checked_out`, and `no_show`. A cancelled or no-show reservation
can be confirmed again only if the room remains available; checked-in
reservations can only be checked out.
The backend runs a checkout scheduler every minute. For hotels with a configured
timezone and `checkOutTime`, checked-in reservations are persisted as
`checked_out` once that local checkout time has passed on or after their
checkout date. Hotels without valid checkout settings are skipped until
configured; the scheduler reports them in the backend logs.

The homepage can list active properties with:

```http
GET /api/public/hotels
```

The response is `{ "hotels": [{ "name": "...", "slug": "..." }] }`; inactive
hotels are omitted. Use a returned slug for the public hotel lookup and booking
URLs.

Public hotel lookup:

```http
GET /api/public/hotels/grand-harbor
```

Returns `{ "hotel": { "name", "slug", "phone", "address", "type", "settings", "bankDetails", "coverImageUrl", "secondaryImageUrl" } }`
for active hotels only. The public response omits internal hotel identifiers,
account email, and hotel status. The two profile image URL fields are `null`
until an image is uploaded.

Registration may include a `bankDetails` object under `hotel` with
`bankName`, `bankAccountNumber`, and `accountName`. Managers can later set or
replace the complete object with `PUT /api/hotels/{hotelId}/bank-details` and
the same three fields. The public hotel lookup returns `bankDetails` as `null`
until configured; when present, guests can use it for bank-transfer payments.

The manager-only `GET /api/hotels/{hotelId}/settings` returns the hotel profile
(`id`, `name`, `email`, `phone`, `address`, `type`, `roomCount`, `slug`, and
`status`) together with `settings`, `bankDetails`, `coverImageUrl`, and
`secondaryImageUrl`. Update operational settings with
`PATCH /api/hotels/{hotelId}/settings`; update the bank account with
`PUT /api/hotels/{hotelId}/bank-details`. Upload or replace profile images with
`POST /api/hotels/{hotelId}/profile-images` using multipart form fields `slot`
(`cover` or `secondary`) and `image` (one image, maximum 5 MiB). The `PUT`
variant remains available for clients that send `coverImage` and/or
`secondaryImage` fields; only supplied image fields are replaced. Remove an
image with `DELETE /api/hotels/{hotelId}/profile-images/{slot}`. Successful
uploads are stored in Cloudinary and their secure URLs appear in the settings
and public hotel detail responses. Hotel identity and profile fields are
read-only through the JSON settings route.

Public availability search:

```http
GET /api/public/hotels/grand-harbor/availability?checkIn=2027-06-10&checkOut=2027-06-12&adults=2&children=0
```

The server resolves the active hotel from the slug and scopes its room-type,
room, and reservation queries to that hotel. The response includes the hotel,
requested stay and guest counts, plus `roomTypes` with capacity, guest-facing
details, `availableRoomCount`, and pricing (`rateMinorPerNight`,
`subtotalMinor`, `feesMinor`, `fees`, `totalMinor`, and `currency`). Room types
without availability or capacity for the requested party are omitted. This is
a point-in-time check; reservation creation rechecks inventory and calculates
the price again.

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

The request rejects extra fields, including `hotelId`, physical room IDs, and
client-supplied prices. The hotel is resolved from `hotelSlug`; the server
assigns an available room and calculates the final price.

`POST /api/public/reservations` returns `201` with
`{ "reservation": { "id", "reference", "guest", "checkIn", "checkOut",
"roomType", "assignedRoom", "guests", "pricing", "paymentStatus", "status" } }`.
The generated reference has the form `HTL-` followed by 16 hexadecimal
characters. The server returns `400 validation_error` for invalid input,
`404 hotel_not_found` or `404 room_type_not_found` for unknown resources, and
`409 room_unavailable` or `409 room_guest_limit_exceeded` when inventory or
capacity constraints fail.

The public booking endpoint also accepts `multipart/form-data` with the same
fields (numeric `adults` and `children` are sent as strings) and an optional
`receipt` file. Receipts may be PDF, AVIF, JPEG, PNG, or WebP up to 5 MB.
Receipt upload is available only through this public booking route; admin and
walk-in reservation routes do not accept receipts. Uploading a receipt sets
`paymentStatus` to `pending_verification`, not `paid`; payment remains pending
until a manager or authorized receptionist records the received transfer.
Bookings without a receipt retain the normal `unpaid`/`paid` behavior.

For browser clients, append the normal booking fields and the optional file to
`FormData`; do not set the multipart `Content-Type` header manually:

```js
const form = new FormData();
form.append("hotelSlug", hotelSlug);
form.append("guestName", guestName);
form.append("guestEmail", guestEmail);
form.append("guestPhone", guestPhone);
form.append("checkIn", checkIn);
form.append("checkOut", checkOut);
form.append("roomTypeId", roomTypeId);
form.append("adults", String(adults));
form.append("children", String(children));
form.append("receipt", receiptFile);
```

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
`404 reservation_not_found`.

To recover reference numbers, `POST /api/public/reservations/reference-email`
accepts `{ "email": "alex@example.com" }`. The API emails references for
upcoming confirmed reservations associated with that address. It always
returns the same `202` response whether or not a match exists, and is
rate-limited by both IP address and email. If email delivery fails, the API
returns `503 email_delivery_unavailable`.

Managers can use `GET /api/hotels/{hotelId}/reservations?page=1&limit=25` with
optional `search`, `status`, `checkInFrom`, and `checkInTo` filters. Responses
contain `reservations` and `{ "page", "limit", "total", "pages" }` pagination.
Admin reservation objects include `guest.id`, `guest.country`,
`guest.membershipTier`, and `guest.createdAt` alongside guest name, email, and
phone. Guest profiles are hotel-scoped and matched by normalized email.
Managers can view a public-booking `paymentReceipt` in reservation details.
Receptionists see the receipt only if they have `payments.walk_in.create` or
`payments.create`; the payment-details endpoint also includes it for authorized
staff. Receipt metadata includes a view URL, format, size, and upload time.
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
Availability is available to managers and receptionists with
`rooms.availability.view`; reservation creation and listing use their
respective hotel-scoped permissions.

`PATCH /api/hotels/{hotelId}/reservations/{reservationId}` accepts partial guest
details, both `checkIn` and `checkOut` together, `roomTypeId` with an optional
`assignedRoomId`, guest counts, or `status`. Payment status cannot be set
directly. This general update route is manager-only.

Receptionists can extend a confirmed or checked-in stay with:

```http
POST /api/hotels/{hotelId}/reservations/{reservationId}/extend
Content-Type: application/json

{ "checkOut": "2027-06-13" }
```

The new date must be after the existing checkout date. The backend checks that
the assigned room remains available, preserves the reservation's nightly rate,
and recalculates nights, total, and payment balance. Success returns
`{ "reservation": ... }` with updated `checkOut`, `pricing`, and
`paymentSummary`. Every active receptionist membership is authorized for this
action; `/api/auth/me` includes `reservations.extend` even for existing
memberships. A room conflict returns `409 assigned_room_unavailable`;
non-extendable reservation statuses return
`409 reservation_stay_extension_not_allowed`.

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
`{ "payments": [...], "paymentSummary": { ... }, "paymentReceipt": { ... } }`
when the reservation is a public booking with an uploaded receipt. Authorized
managers and receptionists with `payments.walk_in.create` or `payments.create`
can view its URL, file format, size, and upload time. Admin reservation objects
also include `paymentSummary`. Payment records are append-only; payment
reversals/refunds and gateway processing are not implemented. Manager
reservation and payment administration requires an active manager membership;
receptionist access is limited to explicit permissions, and an arbitrary
`hotelId` does not grant access.

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
not by a background scheduler. The public catalog contains `STANDARD`
(six months, NGN 150,000) and `PROFESSIONAL` (twelve months, NGN 270,000) as
separate paid plans. These prices are stored in minor units (kobo) as
15,000,000 and 27,000,000. Plan entries include their database `id`, which is
used when selecting a plan. `PUT /api/hotels/{hotelId}/subscription` accepts
either `{ "planId": "<plan id>" }` or `{ "planCode": "STANDARD" }`; include
`billingInterval` (`6_months` or `12_months`) when a plan has multiple active
prices. For compatibility, the plan code may also be sent as `planId`. Run
`npm run seed:plans` after deployment to synchronize the default catalog
prices. The seed deactivates the previous six-month `PROFESSIONAL` price rather
than deleting its record. Hotels remain
`pending_approval` until the manager verifies their email, at which point they
become `active`. Platform operators can then switch hotels between `active`
and `suspended` through `PATCH /api/platform/hotels/{hotelId}/status`.
Suspended hotels are blocked from tenant-scoped operations until an operator
reactivates them. Existing `approved` hotel statuses are migrated to `active`
when the backend starts.

For paid plans, select the plan first, then initialize hosted checkout with
`POST /api/hotels/{hotelId}/subscription/payments/initialize`. It returns a
Paystack authorization URL and reference. After Paystack redirects the browser
to `PAYSTACK_CALLBACK_URL` (or `FRONTEND_URL` when unset), the frontend must
send `{ "reference": "<reference>" }` to
`POST /api/hotels/{hotelId}/subscription/payments/verify`. The backend verifies
the transaction directly with Paystack and checks its reference, amount, and
currency before activating the subscription. A browser redirect or uploaded
receipt alone never marks a platform subscription as paid. Keep
`PAYSTACK_SECRET_KEY` server-side; the hosted checkout flow does not require
the public key. Configure `PAYSTACK_CALLBACK_URL` to a frontend route that
reads the `reference` query parameter and calls the verification endpoint.
This flow is only for platform subscriptions; reservation payments are
unchanged. Paystack webhooks are not configured in this integration.

Dynamic or seasonal room pricing, booking confirmation emails, staff
invitations/email delivery, custom hotel domains, and audit-log browsing are
not implemented yet. The hotel registration address requires a two-letter
country code; currency uses a three-letter ISO code and prices are integer
minor units.

Before production signup, configure and test Brevo delivery and abuse
protections. Use HTTPS for the production `FRONTEND_URL`. Plan availability
and pricing should be reviewed before publishing plans.

Run the API integration tests against a dedicated replica-set test database by
setting `TEST_MONGO_URI` to a database whose name ends in `_test`. Integration
tests clean up only the records they create. Without that setting, the
integration tests are skipped; the remaining HTTP validation/health tests run
without MongoDB.
