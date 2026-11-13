const { z } = require("zod");

const hotelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(3).max(40),
  address: z.object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).optional().default(""),
    city: z.string().trim().min(1).max(100),
    region: z.string().trim().max(100).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    country: z.string().trim().regex(/^[A-Za-z]{2}$/),
  }),
  type: z.string().trim().min(2).max(60),
  roomCount: z.number().int().min(0).max(100000),
});

const registrationSchema = z.object({
  hotel: hotelSchema,
  manager: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long"),
  }),
});

const emailOnlySchema = z.object({
  email: z.string().trim().email().max(254),
});

const verificationCodeSchema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

const actionTokenSchema = z.object({
  token: z.string().regex(/^[a-f\d]{64}$/i),
});

const resetPasswordSchema = actionTokenSchema.extend({
  password: z.string().min(12).max(128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long"),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password is too long"),
});

const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/),
  description: z.string().trim().max(1000).optional().default(""),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  interval: z.enum(["month", "year", "6_months", "12_months"]).optional(),
  billing_interval: z.enum(["6_months", "12_months"]).optional(),
  plan_type: z.enum(["trial", "paid"]).optional(),
  planType: z.enum(["trial", "paid"]).optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  trial_days: z.number().int().min(0).max(365).optional(),
  is_active: z.boolean().optional(),
  active: z.boolean().optional(),
  is_public: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  features: z.union([
    z.record(z.boolean()),
    z.array(z.string().trim().min(1).max(120)),
  ]).optional().default({}),
  limits: z.record(z.any()).optional().default({}),
  plan_prices: z.array(z.object({
    plan_code: z.string().trim().regex(/^[A-Z0-9_-]+$/).optional(),
    billing_interval: z.enum(["6_months", "12_months"]).optional(),
    amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
    is_active: z.boolean().optional(),
  })).optional(),
}).passthrough();

const settingsSchema = z.object({
  timezone: z.string().trim().min(1).max(80).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, { message: "Invalid timezone" }).optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  checkInTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  checkOutTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const planIdentifierSchema = z.string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^(?:[a-f\d]{24}|[A-Za-z0-9_-]+)$/i);

const planSelectionSchema = z.object({
  planId: planIdentifierSchema.optional(),
  planCode: planIdentifierSchema.optional(),
}).refine(
  (selection) => Boolean(selection.planId) !== Boolean(selection.planCode),
  { message: "Provide exactly one of planId or planCode" },
);

const hotelStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

const bedSetupItemSchema = z.object({
  type: z.string().trim().min(1).max(40),
  count: z.number().int().min(1).max(20),
});

const roomTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().default(""),
  sizeSqm: z.number().positive().max(10000),
  maxGuests: z.number().int().positive().max(100),
  bedSetup: z.array(bedSetupItemSchema).min(1).max(10),
  baseRateMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  amenities: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
});

const roomTypeUpdateSchema = roomTypeSchema.partial().refine(
  (roomType) => Object.keys(roomType).length > 0,
  { message: "At least one field is required" },
);

const roomTypeListSchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional().default("false"),
});

const roomIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

const roomSchema = z.object({
  code: z.string().trim().min(1).max(40),
  roomTypeId: roomIdSchema,
  floor: z.string().trim().max(40).optional().default(""),
  wing: z.string().trim().max(80).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

const roomUpdateSchema = roomSchema.partial().refine(
  (room) => Object.keys(room).length > 0,
  { message: "At least one field is required" },
);

const departmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(40),
  description: z.string().trim().max(1000).optional().default(""),
  lead: z.string().trim().max(120).optional().default(""),
});

const staffMemberFields = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(3).max(40),
  role: z.string().trim().min(1).max(80),
  departmentId: roomIdSchema,
  shift: z.string().trim().min(1).max(80),
  status: z.enum(["on_duty", "off_duty", "on_leave"]),
};

const staffMemberSchema = z.object(staffMemberFields);
const staffMemberUpdateSchema = staffMemberSchema.partial().refine(
  (staffMember) => Object.keys(staffMember).length > 0,
  { message: "At least one field is required" },
);

const reservationFields = {
  guestName: z.string().trim().min(2).max(120),
  guestEmail: z.string().trim().email().max(254),
  guestPhone: z.string().trim().min(3).max(40),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomTypeId: roomIdSchema,
  adults: z.number().int().min(1).max(100),
  children: z.number().int().min(0).max(100).default(0),
};

function validDateOnly(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validStayDates(reservation) {
  return validDateOnly(reservation.checkIn)
    && validDateOnly(reservation.checkOut)
    && reservation.checkOut > reservation.checkIn;
}

const publicReservationSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  ...reservationFields,
}).refine(validStayDates, {
  message: "Check-out must be after check-in",
  path: ["checkOut"],
});

const adminReservationSchema = z.object({
  ...reservationFields,
  assignedRoomId: roomIdSchema.optional(),
  guestCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
}).refine(validStayDates, {
  message: "Check-out must be after check-in",
  path: ["checkOut"],
});

const reservationLookupSchema = z.object({
  reference: z.string().trim().min(8).max(40),
  email: z.string().trim().email().max(254),
});

const reservationListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["confirmed", "cancelled", "checked_in", "checked_out", "no_show"]).optional(),
  checkInFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkInTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (query) => (!query.checkInFrom || validDateOnly(query.checkInFrom))
    && (!query.checkInTo || validDateOnly(query.checkInTo)),
  { message: "Invalid calendar date", path: ["checkInFrom"] },
).refine(
  (query) => !query.checkInFrom || !query.checkInTo || query.checkInFrom <= query.checkInTo,
  { message: "checkInTo must not be before checkInFrom", path: ["checkInTo"] },
);

const reservationAvailabilitySchema = z.object({
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomTypeId: roomIdSchema,
  adults: z.coerce.number().int().min(1).max(100),
  children: z.coerce.number().int().min(0).max(100).default(0),
}).refine(validStayDates, {
  message: "Check-out must be after check-in",
  path: ["checkOut"],
});

const reservationPaymentSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z.enum(["cash", "card", "bank_transfer", "mobile_money", "other"]),
  reference: z.string().trim().max(120).nullable().optional().default(null),
  note: z.string().trim().max(500).optional().default(""),
  idempotencyKey: z.string().uuid(),
});

const guestListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  membershipTier: z.string().trim().min(1).max(40).optional(),
});

const guestProfileUpdateSchema = z.object({
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  membershipTier: z.string().trim().min(1).max(40).nullable().optional(),
}).refine((profile) => Object.keys(profile).length > 0, {
  message: "At least one profile field is required",
});

const reservationIdSchema = roomIdSchema;

const reservationUpdateSchema = z.object({
  guestName: reservationFields.guestName.optional(),
  guestEmail: reservationFields.guestEmail.optional(),
  guestPhone: reservationFields.guestPhone.optional(),
  guestCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  checkIn: reservationFields.checkIn.optional(),
  checkOut: reservationFields.checkOut.optional(),
  roomTypeId: roomIdSchema.optional(),
  assignedRoomId: roomIdSchema.optional(),
  adults: reservationFields.adults.optional(),
  children: reservationFields.children.optional(),
  status: z.enum(["confirmed", "cancelled", "checked_in", "checked_out", "no_show"]).optional(),
}).refine((reservation) => Object.keys(reservation).length > 0, {
  message: "At least one field is required",
}).refine(
  (reservation) => (reservation.checkIn === undefined) === (reservation.checkOut === undefined),
  { message: "checkIn and checkOut must be provided together", path: ["checkOut"] },
).refine(
  (reservation) => reservation.checkIn === undefined || validStayDates(reservation),
  { message: "Check-out must be after check-in", path: ["checkOut"] },
);

module.exports = {
  adminReservationSchema,
  actionTokenSchema,
  bedSetupItemSchema,
  departmentSchema,
  emailOnlySchema,
  guestListSchema,
  guestProfileUpdateSchema,
  hotelSchema,
  hotelStatusSchema,
  loginSchema,
  paginationSchema,
  planSchema,
  planSelectionSchema,
  publicReservationSchema,
  registrationSchema,
  reservationAvailabilitySchema,
  reservationIdSchema,
  reservationListSchema,
  reservationLookupSchema,
  reservationPaymentSchema,
  reservationUpdateSchema,
  resetPasswordSchema,
  roomIdSchema,
  roomSchema,
  roomTypeListSchema,
  roomTypeSchema,
  roomTypeUpdateSchema,
  roomUpdateSchema,
  settingsSchema,
  staffMemberSchema,
  staffMemberUpdateSchema,
  verificationCodeSchema,
};
