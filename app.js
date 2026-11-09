require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { z } = require("zod");
const {
  assertJwtConfig,
  isJwtVerificationError,
  signAccessToken,
  verifyAccessToken,
} = require("./src/utils/jwt");

const {
  AuditLog,
  AuthActionToken,
  Hotel,
  HotelMembership,
  PlatformOperator,
  Plan,
  Subscription,
  User,
} = require("./src/models");
const { hashActionToken, issueAuthActionToken } = require("./src/services/auth-tokens");
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("./src/services/brevo-email");

const registrationSchema = z.object({
  hotel: z.object({
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
  }),
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
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  interval: z.enum(["month", "year"]),
  trialDays: z.number().int().min(0).max(365).default(0),
  features: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
});

const settingsSchema = z.object({
  timezone: z.string().trim().min(1).max(80).optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  checkInTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  checkOutTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  const loginLimiter = require("express-rate-limit").rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const recoveryLimiter = require("express-rate-limit").rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.locals.sendVerificationEmail = sendVerificationEmail;
  app.locals.sendPasswordResetEmail = sendPasswordResetEmail;
  const registrationLimiter = require("express-rate-limit").rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/", (_req, res) => {
    res.json({ message: "Hotel backend is running" });
  });

  app.get("/api/public/plans", async (_req, res) => {
    const plans = await Plan.find({ active: true })
      .select("name code amountMinor currency interval trialDays features")
      .sort({ amountMinor: 1 })
      .lean();
    res.json({ data: plans });
  });

  app.post("/api/auth/register", registrationLimiter, async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      });
    }

    const email = parsed.data.manager.email.toLowerCase();
    const existing = await User.exists({ email });
    if (existing) {
      return res.status(409).json({ error: "account_already_exists" });
    }

    const session = await mongoose.startSession();
    let result;
    const passwordHash = await bcrypt.hash(parsed.data.manager.password, 12);
    try {
      await session.withTransaction(async () => {
        const [user] = await User.create(
          [{
            name: parsed.data.manager.name,
            email,
            passwordHash,
            emailVerifiedAt: null,
          }],
          { session },
        );
        const hotel = await createHotelWorkspace(
          parsed.data.hotel,
          user,
          session,
        );
        result = { user, hotel };
      });
    } finally {
      await session.endSession();
    }

    const actionToken = await issueAuthActionToken(
      result.user._id,
      "email_verification",
    );
    try {
      await req.app.locals.sendVerificationEmail(result.user, actionToken.token);
    } catch (error) {
      console.error("Verification email delivery failed", error);
      return res.status(503).json({
        error: "verification_email_delivery_failed",
        message: "Your account was created, but the verification email could not be sent. Request a new email to continue.",
      });
    }

    res.status(201).json({
      user: publicUser(result.user),
      hotel: publicHotel(result.hotel),
      membership: { role: "manager", status: "active" },
      onboarding: { currentStep: "choose_plan", completedSteps: ["registration"] },
      emailVerificationRequired: true,
    });
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_credentials" });
    }

    const user = await User.findOne({
      email: parsed.data.email.toLowerCase(),
    }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (!user.emailVerifiedAt) {
      return res.status(403).json({ error: "email_not_verified" });
    }

    res.json({
      token: signAccessToken(user._id, user.authVersion),
      user: publicUser(user),
    });
  });

  app.post("/api/auth/verify-email", async (req, res) => {
    const parsed = actionTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    const session = await mongoose.startSession();
    let verified = false;
    try {
      await session.withTransaction(async () => {
        const actionToken = await AuthActionToken.findOneAndUpdate(
          {
            tokenHash: hashActionToken(parsed.data.token),
            purpose: "email_verification",
            consumedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { consumedAt: new Date() } },
          { new: true, session },
        );
        if (!actionToken) {
          return;
        }
        const update = await User.updateOne(
          { _id: actionToken.userId, emailVerifiedAt: null },
          { $set: { emailVerifiedAt: new Date() } },
          { session },
        );
        verified = update.matchedCount === 1;
      });
    } finally {
      await session.endSession();
    }

    if (!verified) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }
    res.json({ message: "Email address verified. You can now log in." });
  });

  app.post("/api/auth/resend-verification", recoveryLimiter, async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_email" });
    }
    const user = await User.findOne({
      email: parsed.data.email.toLowerCase(),
      emailVerifiedAt: null,
    });
    if (user) {
      const actionToken = await issueAuthActionToken(user._id, "email_verification");
      try {
        await req.app.locals.sendVerificationEmail(user, actionToken.token);
      } catch (error) {
        console.error("Verification email delivery failed", error);
        return res.status(503).json({ error: "email_delivery_unavailable" });
      }
    }
    res.status(202).json({
      message: "If the account exists and needs verification, a verification email has been sent.",
    });
  });

  app.post("/api/auth/forgot-password", recoveryLimiter, async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_email" });
    }
    const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
    if (user) {
      const actionToken = await issueAuthActionToken(user._id, "password_reset");
      try {
        await req.app.locals.sendPasswordResetEmail(user, actionToken.token);
      } catch (error) {
        console.error("Password reset email delivery failed", error);
        return res.status(503).json({ error: "email_delivery_unavailable" });
      }
    }
    res.status(202).json({
      message: "If an account exists for that email, a password reset link has been sent.",
    });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const session = await mongoose.startSession();
    let reset = false;
    try {
      await session.withTransaction(async () => {
        const actionToken = await AuthActionToken.findOneAndUpdate(
          {
            tokenHash: hashActionToken(parsed.data.token),
            purpose: "password_reset",
            consumedAt: null,
            expiresAt: { $gt: new Date() },
          },
          { $set: { consumedAt: new Date() } },
          { new: true, session },
        );
        if (!actionToken) {
          return;
        }
        const update = await User.updateOne(
          { _id: actionToken.userId },
          { $set: { passwordHash }, $inc: { authVersion: 1 } },
          { session },
        );
        reset = update.matchedCount === 1;
      });
    } finally {
      await session.endSession();
    }

    if (!reset) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }
    res.json({ message: "Password reset successfully. Please log in again." });
  });

  app.get("/api/auth/me", authenticate, async (req, res) => {
    const [memberships, operator] = await Promise.all([
      HotelMembership.find({ userId: req.user._id, status: "active" })
        .populate("hotelId", "name status slug")
        .lean(),
      PlatformOperator.exists({ userId: req.user._id, active: true }),
    ]);

    res.json({
      user: publicUser(req.user),
      isPlatformOperator: Boolean(operator),
      memberships: memberships.map((membership) => ({
        hotelId: membership.hotelId._id,
        hotelName: membership.hotelId.name,
        hotelStatus: membership.hotelId.status,
        hotelSlug: membership.hotelId.slug,
        role: membership.role,
      })),
    });
  });

  app.post("/api/hotels", authenticate, async (req, res) => {
    const parsed = registrationSchema.shape.hotel.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      });
    }

    const session = await mongoose.startSession();
    let hotel;
    try {
      await session.withTransaction(async () => {
        hotel = await createHotelWorkspace(parsed.data, req.user, session);
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      hotel: publicHotel(hotel),
      membership: { role: "manager", status: "active" },
      onboarding: { currentStep: "choose_plan", completedSteps: ["registration"] },
    });
  });

  app.get("/api/hotels/:hotelId/onboarding", authenticate, requireManager, async (req, res) => {
    const [hotel, subscription] = await Promise.all([
      Hotel.findById(req.params.hotelId).select("status setupCompletedSteps"),
      Subscription.findOne({ hotelId: req.params.hotelId }).populate("planId", "name code"),
    ]);
    if (!hotel) {
      return res.status(404).json({ error: "hotel_not_found" });
    }

    const completedSteps = hotel.setupCompletedSteps || ["registration"];
    res.json({
      hotelStatus: hotel.status,
      currentStep: !subscription?.planId
        ? "choose_plan"
        : completedSteps.includes("configure_hotel")
          ? "complete"
          : "configure_hotel",
      completedSteps,
      subscription: subscription ? {
        status: subscription.status,
        plan: subscription.planId,
        trialEndsAt: subscription.trialEndsAt,
      } : null,
    });
  });

  app.put("/api/hotels/:hotelId/subscription", authenticate, requireManager, async (req, res) => {
    const parsed = z.object({ planId: z.string().regex(/^[a-f\d]{24}$/i) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_plan" });
    }

    const plan = await Plan.findOne({ _id: parsed.data.planId, active: true });
    if (!plan) {
      return res.status(404).json({ error: "plan_not_found" });
    }

    const trialEndsAt = plan.trialDays
      ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000)
      : undefined;
    const subscriptionUpdate = {
      $set: {
        planId: plan._id,
        planSnapshot: {
          name: plan.name,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          interval: plan.interval,
        },
        status: trialEndsAt
          ? "trialing"
          : plan.amountMinor === 0
            ? "active"
            : "pending_payment",
        ...(trialEndsAt ? { trialEndsAt } : {}),
      },
    };
    if (!trialEndsAt) {
      subscriptionUpdate.$unset = { trialEndsAt: 1 };
    }

    const subscription = await Subscription.findOneAndUpdate(
      {
        hotelId: req.params.hotelId,
        status: { $in: ["pending_selection", "pending_payment"] },
      },
      subscriptionUpdate,
      { new: true, runValidators: true },
    ).populate("planId", "name code amountMinor currency interval trialDays features");
    if (!subscription) {
      return res.status(409).json({ error: "subscription_selection_locked" });
    }

    await Hotel.updateOne(
      { _id: req.params.hotelId },
      { $addToSet: { setupCompletedSteps: "choose_plan" } },
    );

    res.json({
      subscription: {
        status: subscription.status,
        plan: subscription.planId,
        planSnapshot: subscription.planSnapshot,
        trialEndsAt: subscription.trialEndsAt,
      },
      paymentRequired: subscription.status === "pending_payment",
    });
  });

  app.patch("/api/hotels/:hotelId/settings", authenticate, requireManager, async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data || {}).length === 0) {
      return res.status(400).json({ error: "invalid_settings" });
    }

    const hotel = await Hotel.findById(req.params.hotelId);
    if (!hotel) {
      return res.status(404).json({ error: "hotel_not_found" });
    }
    hotel.settings = { ...(hotel.toObject().settings || {}), ...parsed.data };
    const requiredSettings = [
      "timezone",
      "locale",
      "currency",
      "checkInTime",
      "checkOutTime",
    ];
    if (requiredSettings.every((key) => hotel.settings[key])) {
      if (!hotel.setupCompletedSteps.includes("configure_hotel")) {
        hotel.setupCompletedSteps.push("configure_hotel");
      }
    }
    await hotel.save();
    res.json({ hotel: publicHotel(hotel) });
  });

  app.get("/api/platform/hotels", authenticate, requirePlatformOperator, async (req, res) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_pagination" });
    }
    const { page, limit } = parsed.data;
    await AuditLog.create({
      actorUserId: req.user._id,
      action: "platform.hotels.list",
      metadata: { page, limit },
    });
    const [hotels, total] = await Promise.all([
      Hotel.find()
      .select("name email phone address.country status slug createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
      Hotel.countDocuments(),
    ]);
    res.json({ data: hotels, pagination: { page, limit, total } });
  });

  app.get("/api/platform/hotels/pending-approval", authenticate, requirePlatformOperator, async (req, res) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_pagination" });
    }

    const { page, limit } = parsed.data;
    await AuditLog.create({
      actorUserId: req.user._id,
      action: "platform.hotels.pending_approval.list",
      metadata: { page, limit },
    });

    const [hotels, total] = await Promise.all([
      Hotel.find({ status: "pending_approval" })
        .select("name email phone address type roomCount slug status createdAt")
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Hotel.countDocuments({ status: "pending_approval" }),
    ]);

    const memberships = await HotelMembership.find({
      hotelId: { $in: hotels.map((hotel) => hotel._id) },
      role: "manager",
      status: "active",
    }).select("hotelId userId").lean();
    const managers = await User.find({
      _id: { $in: memberships.map((membership) => membership.userId) },
    }).select("name email").lean();
    const managersById = new Map(
      managers.map((manager) => [manager._id.toString(), manager]),
    );
    const managerByHotelId = new Map(
      memberships.map((membership) => [
        membership.hotelId.toString(),
        managersById.get(membership.userId.toString()),
      ]),
    );

    res.json({
      data: hotels.map((hotel) => ({
        ...hotel,
        manager: managerByHotelId.get(hotel._id.toString()) || null,
      })),
      pagination: { page, limit, total },
    });
  });

  app.post("/api/platform/hotels/:hotelId/approve", authenticate, requirePlatformOperator, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.hotelId)) {
      return res.status(404).json({ error: "hotel_not_found" });
    }

    const session = await mongoose.startSession();
    let hotel;
    try {
      await session.withTransaction(async () => {
        hotel = await Hotel.findOneAndUpdate(
          { _id: req.params.hotelId, status: "pending_approval" },
          { $set: { status: "approved" } },
          { new: true, runValidators: true, session },
        );
        if (hotel) {
          await AuditLog.create(
            [{
              actorUserId: req.user._id,
              hotelId: hotel._id,
              action: "hotel.approved",
              targetId: hotel._id,
            }],
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }

    if (!hotel) {
      const exists = await Hotel.exists({ _id: req.params.hotelId });
      return res.status(exists ? 409 : 404).json({
        error: exists ? "hotel_not_pending_approval" : "hotel_not_found",
      });
    }
    res.json({ hotel: publicHotel(hotel) });
  });

  app.patch("/api/platform/hotels/:hotelId/status", authenticate, requirePlatformOperator, async (req, res) => {
    const parsed = z.object({ status: z.enum(["active", "suspended"]) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_hotel_status" });
    }

    const session = await mongoose.startSession();
    let hotel;
    let activationError;
    try {
      await session.withTransaction(async () => {
        if (parsed.data.status === "active") {
          const currentHotel = await Hotel.findById(req.params.hotelId)
            .select("status")
            .session(session);
          if (!currentHotel) {
            return;
          }
          if (!["approved", "active"].includes(currentHotel.status)) {
            activationError = "hotel_not_approved";
            return;
          }
          const subscription = await Subscription.findOne({
            hotelId: req.params.hotelId,
          }).session(session);
          if (!subscription || !["active", "trialing"].includes(subscription.status)) {
            activationError = "subscription_not_active";
            return;
          }
        }
        hotel = await Hotel.findByIdAndUpdate(
          req.params.hotelId,
          { $set: { status: parsed.data.status } },
          { new: true, runValidators: true, session },
        );
        if (hotel) {
          await AuditLog.create(
            [{
              actorUserId: req.user._id,
              hotelId: hotel._id,
              action: `hotel.${parsed.data.status}`,
              targetId: hotel._id,
            }],
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    if (!hotel) {
      if (activationError) {
        return res.status(409).json({ error: activationError });
      }
      return res.status(404).json({ error: "hotel_not_found" });
    }
    res.json({ hotel: publicHotel(hotel) });
  });

  app.post("/api/platform/plans", authenticate, requirePlatformOperator, async (req, res) => {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      });
    }
    const session = await mongoose.startSession();
    let plan;
    try {
      await session.withTransaction(async () => {
        [plan] = await Plan.create([parsed.data], { session });
        await AuditLog.create(
          [{
            actorUserId: req.user._id,
            action: "platform.plan.created",
            targetId: plan._id,
            metadata: { code: plan.code },
          }],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    res.status(201).json({ plan });
  });

  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid_json" });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "request_too_large" });
    }
    if (err?.code === 11000) {
      return res.status(409).json({ error: "resource_already_exists" });
    }
    if (err?.name === "CastError") {
      return res.status(404).json({ error: "resource_not_found" });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ error: "validation_error" });
    }
    console.error("Request failed", err);
    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}

async function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const [scheme, token, extra] = authorization.split(" ");
  if (scheme !== "Bearer" || !token || extra) {
    return res.status(401).json({ error: "authentication_required" });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || (payload.ver ?? 0) !== user.authVersion) {
      return res.status(401).json({ error: "authentication_required" });
    }
    req.user = user;
    next();
  } catch (error) {
    if (isJwtVerificationError(error)) {
      return res.status(401).json({ error: "authentication_required" });
    }
    next(error);
  }
}

async function requireManager(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.hotelId)) {
    return res.status(404).json({ error: "hotel_not_found" });
  }

  const membership = await HotelMembership.findOne({
    hotelId: req.params.hotelId,
    userId: req.user._id,
    role: "manager",
    status: "active",
  });
  if (!membership) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  const hotel = await Hotel.findById(req.params.hotelId).select("status");
  if (!hotel) {
    return res.status(404).json({ error: "hotel_not_found" });
  }
  if (hotel.status === "suspended") {
    return res.status(403).json({ error: "hotel_suspended" });
  }
  next();
}

async function requirePlatformOperator(req, res, next) {
  const operator = await PlatformOperator.exists({
    userId: req.user._id,
    active: true,
  });
  if (!operator) {
    return res.status(403).json({ error: "platform_operator_required" });
  }
  next();
}

async function createHotelWorkspace(hotelDetails, manager, session) {
  const slugBase = hotelDetails.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "hotel";
  const slug = `${slugBase}-${randomBytes(3).toString("hex")}`;

  const [hotel] = await Hotel.create(
    [{
      ...hotelDetails,
      email: hotelDetails.email.toLowerCase(),
      address: {
        ...hotelDetails.address,
        country: hotelDetails.address.country.toUpperCase(),
      },
      slug,
      status: "pending_approval",
      settings: {},
      setupCompletedSteps: ["registration"],
    }],
    { session },
  );
  await HotelMembership.create(
    [{ hotelId: hotel._id, userId: manager._id, role: "manager", status: "active" }],
    { session },
  );
  await Subscription.create(
    [{ hotelId: hotel._id, status: "pending_selection" }],
    { session },
  );
  return hotel;
}

function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email };
}

function publicHotel(hotel) {
  return {
    id: hotel._id,
    name: hotel.name,
    email: hotel.email,
    phone: hotel.phone,
    address: hotel.address,
    type: hotel.type,
    roomCount: hotel.roomCount,
    slug: hotel.slug,
    status: hotel.status,
    settings: hotel.settings,
  };
}

const app = createApp();

if (require.main === module) {
  const port = parsePort(process.env.PORT);
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be configured");
  }
  assertJwtConfig();

  mongoose.connect(process.env.MONGO_URI)
    .then(() => {
      app.listen(port, () => {
        console.log(`Hotel backend listening on port ${port}`);
      });
    })
    .catch((error) => {
      console.error("Failed to connect to MongoDB", error);
      process.exitCode = 1;
    });
}

module.exports = app;

function parsePort(value) {
  const portValue = value?.trim() || "3000";
  if (!/^\d+$/.test(portValue)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}
