const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
  PaystackConfigurationError,
  PaystackRequestError,
  createPaystackClient,
  verifyPaystackWebhookSignature,
} = require("../src/services/paystack-client");
const { addBillingInterval } = require("../src/services/subscription-payment-service");

test("Paystack checkout initialization sends the trusted amount and callback", async () => {
  let requestUrl;
  let requestOptions;
  const client = createPaystackClient({
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.test/authorize",
          access_code: "checkout-access",
          reference: "SUB-test-reference",
        },
      }), { status: 200 });
    },
    readSecretKey: () => "sk_test_placeholder",
  });

  const checkout = await client.initializeTransaction({
    email: "manager@example.test",
    amountMinor: 15000000,
    currency: "NGN",
    reference: "SUB-test-reference",
    callbackUrl: "https://frontend.example.test/subscription/callback",
    metadata: { hotelId: "hotel-id" },
  });

  assert.equal(requestUrl, "https://api.paystack.co/transaction/initialize");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.authorization, "Bearer sk_test_placeholder");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    email: "manager@example.test",
    amount: 15000000,
    currency: "NGN",
    reference: "SUB-test-reference",
    callback_url: "https://frontend.example.test/subscription/callback",
    metadata: { hotelId: "hotel-id" },
  });
  assert.deepEqual(checkout, {
    authorizationUrl: "https://checkout.paystack.test/authorize",
    accessCode: "checkout-access",
    reference: "SUB-test-reference",
  });
});

test("Paystack verification normalizes a provider response", async () => {
  let requestUrl;
  let requestOptions;
  const client = createPaystackClient({
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        status: true,
        data: {
          reference: "SUB-ref/with spaces",
          status: "success",
          amount: 15000000,
          currency: "NGN",
          channel: "card",
          paid_at: "2026-01-02T03:04:05.000Z",
        },
      }), { status: 200 });
    },
    readSecretKey: () => "sk_test_placeholder",
  });

  const result = await client.verifyTransaction("SUB-ref/with spaces");

  assert.equal(
    requestUrl,
    "https://api.paystack.co/transaction/verify/SUB-ref%2Fwith%20spaces",
  );
  assert.equal(requestOptions.method, "GET");
  assert.equal(requestOptions.body, undefined);
  assert.deepEqual(result, {
    reference: "SUB-ref/with spaces",
    status: "success",
    amountMinor: 15000000,
    currency: "NGN",
    channel: "card",
    paidAt: "2026-01-02T03:04:05.000Z",
  });
});

test("Paystack webhook signature requires the exact raw body and secret", () => {
  const rawBody = Buffer.from(JSON.stringify({
    event: "charge.success",
    data: { reference: "SUB-test-reference" },
  }));
  const signature = createHmac("sha512", "webhook-secret")
    .update(rawBody)
    .digest("hex");

  assert.equal(verifyPaystackWebhookSignature({
    rawBody,
    signature,
    readWebhookSecret: () => "webhook-secret",
  }), true);
  assert.equal(verifyPaystackWebhookSignature({
    rawBody: Buffer.from("tampered"),
    signature,
    readWebhookSecret: () => "webhook-secret",
  }), false);
  assert.equal(verifyPaystackWebhookSignature({
    rawBody,
    signature: "invalid",
    readWebhookSecret: () => "webhook-secret",
  }), false);
});

test("Paystack configuration and unsuccessful provider responses fail explicitly", async () => {
  const unconfiguredClient = createPaystackClient({
    fetchImpl: async () => {
      throw new Error("Fetch should not run without a key");
    },
    readSecretKey: () => "",
  });
  await assert.rejects(
    unconfiguredClient.verifyTransaction("SUB-reference"),
    PaystackConfigurationError,
  );

  const rejectedClient = createPaystackClient({
    fetchImpl: async () => new Response(JSON.stringify({
      status: false,
      message: "provider detail",
    }), { status: 400 }),
    readSecretKey: () => "sk_test_placeholder",
  });
  await assert.rejects(
    rejectedClient.verifyTransaction("SUB-reference"),
    (error) => error instanceof PaystackRequestError
      && !error.message.includes("provider detail"),
  );
});

test("subscription expiry adds calendar months without overflowing month ends", () => {
  assert.equal(
    addBillingInterval(new Date("2024-08-31T12:34:56.789Z"), "6_months").toISOString(),
    "2025-02-28T12:34:56.789Z",
  );
  assert.equal(
    addBillingInterval(new Date("2024-02-29T12:34:56.789Z"), "12_months").toISOString(),
    "2025-02-28T12:34:56.789Z",
  );
  assert.equal(addBillingInterval(new Date(), "unsupported"), null);
});
