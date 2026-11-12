const mongoose = require("mongoose");

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  emailVerifiedAt: { type: Date, default: null },
  verificationCodeSentAt: { type: Date, default: null },
  authVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

const authActionTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  purpose: {
    type: String,
    enum: ["email_verification", "password_reset"],
    required: true,
  },
  tokenSalt: { type: String },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  attempts: { type: Number, min: 0, max: 3, default: 0 },
  lockedAt: { type: Date, default: null },
}, { timestamps: true });
authActionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authActionTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

const refreshSessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  authVersion: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  replacedByTokenHash: { type: String, default: null },
}, { timestamps: true });
refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshSessionSchema.index({ userId: 1, revokedAt: 1, consumedAt: 1 });

const hotelSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: {
    line1: { type: String, required: true },
    line2: { type: String, default: "" },
    city: { type: String, required: true },
    region: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    country: { type: String, required: true, uppercase: true },
  },
  type: { type: String, required: true },
  roomCount: { type: Number, required: true, min: 0 },
  slug: { type: String, required: true, unique: true },
  status: {
    type: String,
    enum: ["pending_approval", "active", "suspended"],
    default: "pending_approval",
    required: true,
  },
  settings: {
    timezone: { type: String },
    locale: { type: String },
    currency: { type: String },
    checkInTime: { type: String },
    checkOutTime: { type: String },
  },
  setupCompletedSteps: { type: [String], default: [] },
}, { timestamps: true });

const membershipSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  role: { type: String, enum: ["manager", "staff"], required: true },
  status: { type: String, enum: ["active", "revoked"], default: "active" },
}, { timestamps: true });
membershipSchema.index({ hotelId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });

const roomTypeSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  nameKey: { type: String, required: true },
  description: { type: String, default: "", maxlength: 2000 },
  sizeSqm: { type: Number, required: true, min: Number.EPSILON },
  maxGuests: { type: Number, required: true, min: 1 },
  availabilityVersion: { type: Number, default: 0, min: 0, select: false },
  bedSetup: [{
    type: { type: String, required: true, trim: true, maxlength: 40 },
    count: { type: Number, required: true, min: 1 },
  }],
  baseRateMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  amenities: { type: [String], default: [] },
  photos: [{
    publicId: { type: String, required: true },
    secureUrl: { type: String, required: true },
    width: Number,
    height: Number,
    format: String,
    bytes: Number,
  }],
  active: { type: Boolean, default: true },
}, { timestamps: true });
roomTypeSchema.index({ hotelId: 1, nameKey: 1 }, { unique: true });
roomTypeSchema.index({ hotelId: 1, active: 1 });

const roomSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  code: { type: String, required: true, trim: true, maxlength: 40 },
  codeKey: { type: String, required: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true },
  floor: { type: String, trim: true, maxlength: 40, default: "" },
  wing: { type: String, trim: true, maxlength: 80, default: "" },
  notes: { type: String, trim: true, maxlength: 1000, default: "" },
  active: { type: Boolean, default: true },
}, { timestamps: true });
roomSchema.index({ hotelId: 1, codeKey: 1 }, { unique: true });
roomSchema.index({ hotelId: 1, roomTypeId: 1, active: 1 });

const guestSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 40 },
  country: {
    type: String,
    uppercase: true,
    match: /^[A-Z]{2}$/,
    default: null,
  },
  membershipTier: { type: String, trim: true, maxlength: 40, default: null },
}, { timestamps: true });
guestSchema.index({ hotelId: 1, email: 1 }, { unique: true });
guestSchema.index({ hotelId: 1, createdAt: -1 });

const reservationSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  guestId: { type: Schema.Types.ObjectId, ref: "Guest", default: null },
  reference: { type: String, required: true, unique: true },
  guestName: { type: String, required: true, trim: true, maxlength: 120 },
  guestEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  guestPhone: { type: String, required: true, trim: true, maxlength: 40 },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true },
  roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  adults: { type: Number, required: true, min: 1 },
  children: { type: Number, required: true, min: 0 },
  nights: { type: Number, required: true, min: 1 },
  rateMinorPerNight: { type: Number, required: true, min: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  amountPaidMinor: { type: Number, required: true, min: 0, default: 0 },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  paymentStatus: {
    type: String,
    enum: ["unpaid", "partially_paid", "paid", "refunded"],
    default: "unpaid",
    required: true,
  },
  status: {
    type: String,
    enum: ["confirmed", "cancelled", "checked_in", "checked_out", "no_show"],
    default: "confirmed",
    required: true,
  },
  source: { type: String, enum: ["public", "admin"], required: true },
}, { timestamps: true });
reservationSchema.index({ hotelId: 1, createdAt: -1 });
reservationSchema.index({ guestId: 1 });
reservationSchema.index({ hotelId: 1, status: 1, checkIn: 1 });
reservationSchema.index({ hotelId: 1, roomId: 1, status: 1, checkIn: 1, checkOut: 1 });

const reservationPaymentSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
  reservationId: { type: Schema.Types.ObjectId, ref: "Reservation", required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  method: {
    type: String,
    enum: ["cash", "card", "bank_transfer", "mobile_money", "other"],
    required: true,
  },
  reference: { type: String, trim: true, maxlength: 120, default: null },
  note: { type: String, trim: true, maxlength: 500, default: "" },
  idempotencyKey: { type: String, required: true, maxlength: 80 },
  receivedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  receivedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });
reservationPaymentSchema.index(
  { hotelId: 1, reservationId: 1, idempotencyKey: 1 },
  { unique: true },
);
reservationPaymentSchema.index({ hotelId: 1, reservationId: 1, receivedAt: 1 });

const operatorSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  role: { type: String, enum: ["super_admin"], default: "super_admin" },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const planSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  description: { type: String, default: "" },
  planType: { type: String, enum: ["trial", "paid"], default: "paid", required: true },
  trialDays: { type: Number, min: 0, max: 365, default: 0 },
  features: { type: Schema.Types.Mixed, default: {} },
  limits: { type: Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true },
  sortOrder: { type: Number, min: 0, default: 0 },
  amountMinor: { type: Number, min: 0 },
  currency: { type: String, uppercase: true },
  interval: { type: String, enum: ["month", "year", "6_months", "12_months"] },
}, { timestamps: true });

const planPriceSchema = new Schema({
  planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
  billingInterval: { type: String, enum: ["6_months", "12_months"], required: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  active: { type: Boolean, default: true },
}, { timestamps: true });
planPriceSchema.index({ planId: 1, billingInterval: 1 }, { unique: true });

const subscriptionSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true, unique: true },
  planId: { type: Schema.Types.ObjectId, ref: "Plan", default: null },
  planPriceId: { type: Schema.Types.ObjectId, ref: "PlanPrice", default: null },
  planSnapshot: {
    code: String,
    name: String,
    description: String,
    planType: String,
    amountMinor: Number,
    currency: String,
    billingInterval: String,
  },
  status: {
    type: String,
    enum: ["pending_selection", "pending", "trialing", "active", "expired", "past_due", "cancelled"],
    default: "pending_selection",
  },
  billing_interval: { type: String, enum: ["6_months", "12_months"] },
  selected_at: Date,
  trial_start_date: Date,
  trial_end_date: Date,
  trial_used_at: Date,
  activated_at: Date,
  expires_at: Date,
}, { timestamps: true });

const subscriptionPaymentSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
  subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", required: true, index: true },
  planPriceId: { type: Schema.Types.ObjectId, ref: "PlanPrice", required: true },
  provider: { type: String, enum: ["paystack"], default: "paystack", required: true },
  providerReference: { type: String, required: true, unique: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  status: { type: String, enum: ["pending", "successful", "failed", "cancelled"], default: "pending", required: true },
  verifiedAt: Date,
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

const auditLogSchema = new Schema({
  actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", default: null },
  action: { type: String, required: true, maxlength: 120 },
  targetId: { type: Schema.Types.ObjectId, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
auditLogSchema.index({ hotelId: 1, createdAt: -1 });

module.exports = {
  AuditLog: mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema),
  AuthActionToken: mongoose.models.AuthActionToken || mongoose.model("AuthActionToken", authActionTokenSchema),
  Guest: mongoose.models.Guest || mongoose.model("Guest", guestSchema),
  Hotel: mongoose.models.Hotel || mongoose.model("Hotel", hotelSchema),
  HotelMembership: mongoose.models.HotelMembership || mongoose.model("HotelMembership", membershipSchema),
  PlatformOperator: mongoose.models.PlatformOperator || mongoose.model("PlatformOperator", operatorSchema),
  Plan: mongoose.models.Plan || mongoose.model("Plan", planSchema),
  PlanPrice: mongoose.models.PlanPrice || mongoose.model("PlanPrice", planPriceSchema),
  RefreshSession: mongoose.models.RefreshSession || mongoose.model("RefreshSession", refreshSessionSchema),
  Reservation: mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema),
  ReservationPayment: mongoose.models.ReservationPayment
    || mongoose.model("ReservationPayment", reservationPaymentSchema),
  Room: mongoose.models.Room || mongoose.model("Room", roomSchema),
  RoomType: mongoose.models.RoomType || mongoose.model("RoomType", roomTypeSchema),
  Subscription: mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema),
  SubscriptionPayment: mongoose.models.SubscriptionPayment || mongoose.model("SubscriptionPayment", subscriptionPaymentSchema),
  User: mongoose.models.User || mongoose.model("User", userSchema),
};
