const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  sendBrevoEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("../src/services/brevo-email");

const envNames = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
  "FRONTEND_URL",
];
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const name of envNames) {
    if (originalEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalEnv[name];
    }
  }
  globalThis.fetch = originalFetch;
});

function configureEmail() {
  process.env.BREVO_API_KEY = "test-api-key";
  process.env.BREVO_SENDER_EMAIL = "no-reply@example.com";
  process.env.BREVO_SENDER_NAME = "Hotel Platform";
  process.env.FRONTEND_URL = "http://localhost:5173";
}

test("verification email sends the six-digit code without requiring a frontend URL", async () => {
  configureEmail();
  delete process.env.FRONTEND_URL;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201 };
  };

  await sendVerificationEmail(
    { email: "manager@example.com", name: "<Manager & Co>" },
    "012345",
  );

  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.options.headers["api-key"], "test-api-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.to[0].email, "manager@example.com");
  assert.match(body.htmlContent, /&lt;Manager &amp; Co&gt;/);
  assert.match(body.textContent, /\b012345\b/);
  assert.match(body.htmlContent, /<strong>012345<\/strong>/);
  assert.doesNotMatch(body.textContent, /https?:\/\//);
});

test("password-reset email points to the frontend reset page", async () => {
  configureEmail();
  let message;
  globalThis.fetch = async (_url, options) => {
    message = JSON.parse(options.body);
    return { ok: true, status: 201 };
  };

  await sendPasswordResetEmail(
    { email: "manager@example.com", name: "Manager" },
    "reset-token",
  );

  const link = new URL(message.textContent.match(/https?:\/\/\S+/)[0]);
  assert.equal(link.pathname, "/reset-password");
  assert.equal(link.searchParams.get("token"), "reset-token");
});

test("Brevo API errors are surfaced to the caller", async () => {
  configureEmail();
  globalThis.fetch = async () => ({ ok: false, status: 401 });

  await assert.rejects(
    () => sendBrevoEmail({
      to: { email: "manager@example.com", name: "Manager" },
      subject: "Test",
      text: "Test",
      html: "<p>Test</p>",
    }),
    /status 401/,
  );
});

test("requires HTTPS for non-local password-reset links", async () => {
  configureEmail();
  process.env.FRONTEND_URL = "http://frontend.example.com";

  await assert.rejects(
    () => sendPasswordResetEmail(
      { email: "manager@example.com", name: "Manager" },
      "reset-token",
    ),
    /HTTPS outside localhost/,
  );
});
