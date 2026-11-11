const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const authService = require("../src/services/auth-service");
const authController = require("../src/controllers/auth-controller");
const {
  REFRESH_COOKIE_NAME,
  cookieOptions,
  isTrustedFrontendOrigin,
} = require("../src/utils/refresh-cookie");

const originalEnv = {
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  FRONTEND_URL: process.env.FRONTEND_URL,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("refresh cookie is HttpOnly and scoped to auth endpoints", () => {
  process.env.COOKIE_SAME_SITE = "lax";
  process.env.COOKIE_SECURE = "false";
  delete process.env.NODE_ENV;

  assert.equal(REFRESH_COOKIE_NAME, "hotel_refresh");
  assert.deepEqual(cookieOptions(1000), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 1000,
  });
});

test("cross-site refresh cookies require Secure", () => {
  process.env.COOKIE_SAME_SITE = "none";
  process.env.COOKIE_SECURE = "false";
  delete process.env.NODE_ENV;

  assert.equal(cookieOptions().secure, true);
});

test("refresh and logout accept only the configured frontend origin", () => {
  process.env.FRONTEND_URL = "https://frontend.example.test/app";

  assert.equal(isTrustedFrontendOrigin({ get: () => "https://frontend.example.test" }), true);
  assert.equal(isTrustedFrontendOrigin({ get: () => "https://attacker.example.test" }), false);
  assert.equal(isTrustedFrontendOrigin({ get: () => undefined }), false);
});

test("non-browser login keeps the access-token response without setting a refresh cookie", async () => {
  const originalLogin = authService.login;
  authService.login = async (_data, options) => {
    assert.deepEqual(options, { issueRefreshSession: false });
    return { token: "access-token", user: { id: "user-id" } };
  };
  const response = {
    json(body) {
      this.body = body;
      return this;
    },
    cookie() {
      assert.fail("non-browser login must not set a refresh cookie");
    },
  };

  try {
    await authController.login({
      body: { email: "user@example.test", password: "password" },
      get: () => undefined,
    }, response);
    assert.deepEqual(response.body, {
      token: "access-token",
      user: { id: "user-id" },
    });
  } finally {
    authService.login = originalLogin;
  }
});