const { createHash, createHmac, randomBytes, randomInt } = require("node:crypto");
const { AuthActionToken } = require("../models");

const TOKEN_LIFETIMES = {
  password_reset: 60 * 60 * 1000,
};
const VERIFICATION_CODE_LIFETIME = 10 * 60 * 1000;
const REFRESH_SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;

function hashActionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createRefreshToken(expiresAt = new Date(Date.now() + REFRESH_SESSION_LIFETIME)) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt,
  };
}

async function issueAuthActionToken(userId, purpose) {
  const lifetime = TOKEN_LIFETIMES[purpose];
  if (!lifetime) {
    throw new TypeError("Unsupported authentication token purpose");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + lifetime);
  const session = await AuthActionToken.startSession();
  try {
    await session.withTransaction(async () => {
      await AuthActionToken.deleteMany(
        { userId, purpose, consumedAt: null },
        { session },
      );
      await AuthActionToken.create(
        [{ userId, purpose, tokenHash: hashActionToken(token), expiresAt }],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return { token, expiresAt };
}

function hashVerificationCode(userId, code, salt) {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return createHmac("sha256", secret)
    .update(`${userId}:${salt}:${code}`)
    .digest("hex");
}

async function issueEmailVerificationCode(userId) {
  const code = randomInt(0, 1000000).toString().padStart(6, "0");
  const tokenSalt = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_LIFETIME);
  const session = await AuthActionToken.startSession();
  try {
    await session.withTransaction(async () => {
      await AuthActionToken.deleteMany(
        { userId, purpose: "email_verification", consumedAt: null },
        { session },
      );
      await AuthActionToken.create(
        [{
          userId,
          purpose: "email_verification",
          tokenSalt,
          tokenHash: hashVerificationCode(userId, code, tokenSalt),
          expiresAt,
          attempts: 0,
          lockedAt: null,
        }],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  return { code, expiresAt };
}

module.exports = {
  createRefreshToken,
  hashActionToken,
  hashRefreshToken,
  hashVerificationCode,
  issueAuthActionToken,
  issueEmailVerificationCode,
};
