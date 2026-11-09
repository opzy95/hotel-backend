# Hotel backend onboarding foundation

This Express 5 API uses MongoDB through Mongoose. Hotel registration creates a
tenant document, its first user, an active `manager` membership, and a
`pending_selection` subscription in one MongoDB transaction. New hotels start
as `pending_approval`; their manager can complete onboarding, but a platform
operator must approve the hotel before it can be activated.

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
   npm start
   ```
4. Configure Brevo transactional email with `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `FRONTEND_URL`. The sender
   address must be verified in Brevo. Keep the API key only in the backend
   environment.

The seed command creates or activates a separate platform-operator grant. It
does not provide a public super-admin signup route.

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
| `POST` | `/api/auth/login` | Public, rate-limited | Sign in with email/password |
| `POST` | `/api/auth/verify-email` | Public | Verify email with the one-time token from the email link |
| `POST` | `/api/auth/resend-verification` | Public, rate-limited | Send a new verification email |
| `POST` | `/api/auth/forgot-password` | Public, rate-limited | Request a password-reset email |
| `POST` | `/api/auth/reset-password` | Public | Set a new password with the one-time reset token |
| `GET` | `/api/auth/me` | Authenticated | Return user, hotel memberships, and platform-operator status |
| `POST` | `/api/hotels` | Authenticated | Create another hotel with the caller as its first Manager |
| `GET` | `/api/hotels/{hotelId}/onboarding` | Hotel Manager | Read approval, plan, and setup progress |
| `PUT` | `/api/hotels/{hotelId}/subscription` | Hotel Manager | Select an active plan |
| `PATCH` | `/api/hotels/{hotelId}/settings` | Hotel Manager | Update initial hotel settings |
| `GET` | `/api/platform/hotels` | Platform operator | List hotels for platform administration |
| `GET` | `/api/platform/hotels/pending-approval` | Platform operator | List pending hotels with their registering Manager's name and email |
| `POST` | `/api/platform/hotels/{hotelId}/approve` | Platform operator | Approve a pending hotel; does not activate it |
| `PATCH` | `/api/platform/hotels/{hotelId}/status` | Platform operator | Activate or suspend a hotel |
| `POST` | `/api/platform/plans` | Platform operator | Create a plan |

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

Registration sends a verification email and does not issue an access token.
The frontend should take the token from the `/verify-email?token=...` link and
POST `{ "token": "..." }` to `/api/auth/verify-email`. Verification tokens
expire after 24 hours and can be used once. Until verified, login returns
`403 email_not_verified`; use `POST /api/auth/resend-verification` with
`{ "email": "manager@example.com" }` to request another link.
If Brevo delivery fails during registration, the API returns
`503 verification_email_delivery_failed`; the account has already been
created, so the user should request another verification email rather than
registering again.

Password recovery uses the same `POST /api/auth/forgot-password` endpoint for
hotel Managers and platform super admins, with
`{ "email": "admin@example.com" }`; there is no separate admin URL. The generic
`202` response does not reveal whether that email is registered. The email link points to
`/reset-password?token=...`. Submit the token and a new password to
`POST /api/auth/reset-password`. Reset tokens expire after one hour, are
single-use, and resetting the password invalidates existing access tokens.
Configure the frontend routes `/verify-email` and `/reset-password`, and set
`FRONTEND_URL` to the frontend origin.
Valid requests are rate limited. Email action tokens are stored as SHA-256
hashes, are one-time use, and expire automatically in MongoDB after their
validity period. Brevo delivery failures are logged and surfaced as HTTP 503.

Successful registration returns the new hotel with
`status: "pending_approval"`, a `manager` membership, and onboarding step
`choose_plan`. Selecting a plan stores a price snapshot. Paid plans are marked
`pending_payment`; free plans or plans in a trial are marked `active` or
`trialing` respectively. A platform operator reviews pending hotels and the
registering Manager through `GET /api/platform/hotels/pending-approval`, then
approves one with `POST /api/platform/hotels/{hotelId}/approve`. Approval
changes the hotel status to `approved`; activation is a separate action and
requires an active or trialing subscription. Plan selection locks once a free
or trial plan is selected. Trial expiry is not automated in this first slice.

## Not included in this first slice

Payment-provider checkout/webhooks, staff invitations/email delivery, hotel
domains, room inventory, bookings, guest records, and audit-log browsing are
not implemented yet. Do not treat
`pending_payment` as proof that a payment succeeded. Paid plans without a trial
cannot be activated until payment processing is integrated. The hotel
registration address requires a two-letter country code; currency uses a
three-letter ISO code and prices are integer minor units.

Before production signup, configure and test Brevo delivery and abuse
protections. Use HTTPS for the production `FRONTEND_URL`. Plan availability
and pricing should be reviewed before publishing plans.

Run the API tenant-isolation integration test against a dedicated replica-set
test database by setting `TEST_MONGO_URI` to a database whose name ends in
`_test`. The registration/login and tenant-isolation integration tests clean up
only the records they create. Without that setting, the integration tests are
skipped; the remaining HTTP validation/health tests run without MongoDB.
