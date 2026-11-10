const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { timingSafeEqual } = require("node:crypto");
const {
  AuthActionToken,
  Hotel,
  HotelMembership,
  PlatformOperator,
  User,
} = require("../models");
const {
  hashActionToken,
  hashVerificationCode,
  issueAuthActionToken,
  issueEmailVerificationCode,
} = require("./auth-tokens");
const { createHotelWorkspace } = require("./hotel-service");
const { publicUser } = require("../utils/public-resources");
const { signAccessToken } = require("../utils/jwt");

class EmailDeliveryError extends Error {}
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 3;

async function sendVerificationCode(user, sendEmail) {
  const { code } = await issueEmailVerificationCode(user._id);
  try {
    await sendEmail(user, code);
  } catch (error) {
    console.error("Verification email delivery failed", error);
    throw new EmailDeliveryError("verification_email_delivery_failed");
  }
}

async function register(data, sendVerificationEmail) {
  const email = data.manager.email.toLowerCase();
  if (await User.exists({ email })) {
    return { error: "account_already_exists" };
  }

  const session = await mongoose.startSession();
  let result;
  const passwordHash = await bcrypt.hash(data.manager.password, 12);
  try {
    await session.withTransaction(async () => {
      const [user] = await User.create(
        [{
          name: data.manager.name,
          email,
          passwordHash,
          emailVerifiedAt: null,
          verificationCodeSentAt: new Date(),
        }],
        { session },
      );
      const hotel = await createHotelWorkspace(data.hotel, user, session);
      result = { user, hotel };
    });
  } finally {
    await session.endSession();
  }

  await sendVerificationCode(result.user, sendVerificationEmail);

  return result;
}

async function login(data) {
  const user = await User.findOne({
    email: data.email.toLowerCase(),
  }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    return { error: "invalid_credentials" };
  }
  if (
    !user.emailVerifiedAt
    && !await PlatformOperator.exists({
      userId: user._id,
      role: "super_admin",
      active: true,
    })
  ) {
    return { error: "email_not_verified" };
  }
  return {
    token: signAccessToken(user._id, user.authVersion),
    user: publicUser(user),
  };
}

async function verifyEmailCode(email, code) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || user.emailVerifiedAt) {
    return { error: "invalid_or_expired_verification_code" };
  }

  for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
    const now = new Date();
    const actionToken = await AuthActionToken.findOne({
      userId: user._id,
      purpose: "email_verification",
      consumedAt: null,
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });
    if (!actionToken) {
      return { error: "invalid_or_expired_verification_code" };
    }
    if (actionToken.lockedAt || actionToken.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      return { error: "verification_code_locked" };
    }

    const suppliedHash = Buffer.from(
      hashVerificationCode(user._id, code, actionToken.tokenSalt),
      "hex",
    );
    const expectedHash = Buffer.from(actionToken.tokenHash, "hex");
    if (timingSafeEqual(suppliedHash, expectedHash)) {
      const session = await mongoose.startSession();
      let verified = false;
      try {
        await session.withTransaction(async () => {
          const consumed = await AuthActionToken.findOneAndUpdate(
            {
              _id: actionToken._id,
              consumedAt: null,
              lockedAt: null,
              attempts: actionToken.attempts,
              expiresAt: { $gt: new Date() },
            },
            { $set: { consumedAt: new Date() } },
            { returnDocument: "after", session },
          );
          if (!consumed) {
            return;
          }
          const update = await User.updateOne(
            { _id: user._id, emailVerifiedAt: null },
            {
              $set: { emailVerifiedAt: new Date() },
              $unset: { verificationCodeSentAt: 1 },
            },
            { session },
          );
          if (update.matchedCount === 1) {
            const managedHotels = await HotelMembership.find({
              userId: user._id,
              role: "manager",
              status: "active",
            }).distinct("hotelId").session(session);
            await Hotel.updateMany(
              { _id: { $in: managedHotels }, status: "pending_approval" },
              { $set: { status: "active" } },
              { session },
            );
            verified = true;
          }
        });
      } finally {
        await session.endSession();
      }
      if (verified) {
        return { verified: true };
      }
      continue;
    }

    const nextAttemptCount = actionToken.attempts + 1;
    const update = await AuthActionToken.updateOne(
      {
        _id: actionToken._id,
        consumedAt: null,
        lockedAt: null,
        attempts: actionToken.attempts,
        expiresAt: { $gt: now },
      },
      {
        $inc: { attempts: 1 },
        ...(nextAttemptCount >= MAX_VERIFICATION_ATTEMPTS
          ? { $set: { lockedAt: now } }
          : {}),
      },
    );
    if (update.matchedCount === 1) {
      return nextAttemptCount >= MAX_VERIFICATION_ATTEMPTS
        ? { error: "verification_code_locked" }
        : {
          error: "invalid_verification_code",
          attemptsRemaining: MAX_VERIFICATION_ATTEMPTS - nextAttemptCount,
        };
    }
  }

  return { error: "verification_code_locked" };
}

async function resendVerification(email, sendEmail) {
  const now = new Date();
  const cooldownExpiredAt = new Date(now.getTime() - VERIFICATION_RESEND_COOLDOWN_MS);
  const user = await User.findOneAndUpdate({
    email: email.toLowerCase(),
    emailVerifiedAt: null,
    $or: [
      { verificationCodeSentAt: null },
      { verificationCodeSentAt: { $lte: cooldownExpiredAt } },
    ],
  }, {
    $set: { verificationCodeSentAt: now },
  }, { returnDocument: "after" });
  if (user) {
    try {
      await sendVerificationCode(user, sendEmail);
    } catch (error) {
      await User.updateOne(
        { _id: user._id, verificationCodeSentAt: now },
        { $unset: { verificationCodeSentAt: 1 } },
      );
      throw new EmailDeliveryError("email_delivery_unavailable");
    }
  }
}

async function sendPasswordReset(email, sendPasswordResetEmail) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    const actionToken = await issueAuthActionToken(user._id, "password_reset");
    try {
      await sendPasswordResetEmail(user, actionToken.token);
    } catch (error) {
      console.error("Password reset email delivery failed", error);
      throw new EmailDeliveryError("email_delivery_unavailable");
    }
  }
}

async function resetPassword(token, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  const session = await mongoose.startSession();
  let reset = false;
  try {
    await session.withTransaction(async () => {
      const actionToken = await AuthActionToken.findOneAndUpdate(
        {
          tokenHash: hashActionToken(token),
          purpose: "password_reset",
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { returnDocument: "after", session },
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
  return reset;
}

async function getCurrentUser(user) {
  const [memberships, operator] = await Promise.all([
    HotelMembership.find({ userId: user._id, status: "active" })
      .populate("hotelId", "name status slug")
      .lean(),
    PlatformOperator.exists({ userId: user._id, active: true }),
  ]);
  return {
    user: publicUser(user),
    isPlatformOperator: Boolean(operator),
    memberships: memberships.map((membership) => ({
      hotelId: membership.hotelId._id,
      hotelName: membership.hotelId.name,
      hotelStatus: membership.hotelId.status,
      hotelSlug: membership.hotelId.slug,
      role: membership.role,
    })),
  };
}

module.exports = {
  EmailDeliveryError,
  getCurrentUser,
  login,
  register,
  resendVerification,
  resetPassword,
  sendPasswordReset,
  verifyEmailCode,
};
