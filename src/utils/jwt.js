const jwt = require("jsonwebtoken");

const ISSUER = "hotel-backend";
const AUDIENCE = "hotel-frontend";
const ACCESS_TOKEN_TTL = "1h";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return secret;
}

function assertJwtConfig() {
  getSecret();
}

function signAccessToken(userId, tokenVersion = 0) {
  const subject = typeof userId === "string" ? userId : userId?.toString();
  if (!subject || subject === "[object Object]") {
    throw new TypeError("A valid user ID is required to sign an access token");
  }
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new TypeError("Token version must be a non-negative integer");
  }

  return jwt.sign({ ver: tokenVersion }, getSecret(), {
    algorithm: "HS256",
    subject,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

function verifyAccessToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("A non-empty access token is required");
  }

  return jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

function isJwtVerificationError(error) {
  return error instanceof jwt.JsonWebTokenError;
}

module.exports = {
  assertJwtConfig,
  isJwtVerificationError,
  signAccessToken,
  verifyAccessToken,
};
