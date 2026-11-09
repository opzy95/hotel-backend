const mongoose = require("mongoose");

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  emailVerifiedAt: { type: Date, default: null },
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
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: true });
authActionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authActionTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

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
    enum: ["pending_approval", "approved", "active", "suspended"],
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

const operatorSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  role: { type: String, enum: ["super_admin"], default: "super_admin" },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const planSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, lowercase: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  interval: { type: String, enum: ["month", "year"], required: true },
  trialDays: { type: Number, min: 0, max: 365, default: 0 },
  features: { type: [String], default: [] },
  active: { type: Boolean, default: true },
}, { timestamps: true });

const subscriptionSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: "Hotel", required: true, unique: true },
  planId: { type: Schema.Types.ObjectId, ref: "Plan", default: null },
  planSnapshot: {
    name: String,
    amountMinor: Number,
    currency: String,
    interval: String,
  },
  status: {
    type: String,
    enum: ["pending_selection", "pending_payment", "trialing", "active", "cancelled"],
    default: "pending_selection",
  },
  trialEndsAt: Date,
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
  Hotel: mongoose.models.Hotel || mongoose.model("Hotel", hotelSchema),
  HotelMembership: mongoose.models.HotelMembership || mongoose.model("HotelMembership", membershipSchema),
  PlatformOperator: mongoose.models.PlatformOperator || mongoose.model("PlatformOperator", operatorSchema),
  Plan: mongoose.models.Plan || mongoose.model("Plan", planSchema),
  Subscription: mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema),
  User: mongoose.models.User || mongoose.model("User", userSchema),
};
