const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const {
  assertJwtConfig,
  isJwtVerificationError,
  signAccessToken,
  verifyAccessToken,
} = require("../src/utils/jwt");

const originalSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalSecret;
  }
});

test("signs and verifies an HS256 access token with the expected claims", () => {
  process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";

  const token = signAccessToken("user-123");
  const payload = verifyAccessToken(token);

  assert.equal(payload.sub, "user-123");
  assert.equal(payload.iss, "hotel-backend");
  assert.equal(payload.aud, "hotel-frontend");
  assert.equal(payload.ver, 0);
  assert.equal(payload.exp - payload.iat, 15 * 60);
  assert.equal(jwt.decode(token, { complete: true }).header.alg, "HS256");
});

test("includes the user's token version for invalidating tokens after password reset", () => {
  process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";

  const payload = verifyAccessToken(signAccessToken("user-123", 4));
  assert.equal(payload.ver, 4);
  assert.throws(() => signAccessToken("user-123", -1), /Token version/);
});

test("rejects invalid tokens as JWT verification errors", () => {
  process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";

  assert.throws(
    () => verifyAccessToken("not-a-jwt"),
    (error) => isJwtVerificationError(error),
  );
});

test("requires a sufficiently long secret before signing or verifying", () => {
  process.env.JWT_SECRET = "too-short";

  assert.throws(() => assertJwtConfig(), /JWT_SECRET/);
  assert.throws(() => signAccessToken("user-123"), /JWT_SECRET/);
  assert.throws(() => verifyAccessToken("token"), /JWT_SECRET/);
});

test("rejects a missing user ID when signing", () => {
  process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";

  assert.throws(() => signAccessToken(undefined), /user ID/);
});
