const { createHash, randomBytes } = require("node:crypto");
const { AuthActionToken } = require("../models");

const TOKEN_LIFETIMES = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

function hashActionToken(token) {
  return createHash("sha256").update(token).digest("hex");
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

module.exports = { hashActionToken, issueAuthActionToken };
