const PAYSTACK_API_URL = "https://api.paystack.co";

class PaystackConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaystackConfigurationError";
  }
}

class PaystackRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaystackRequestError";
  }
}

function createPaystackClient({
  fetchImpl = globalThis.fetch,
  readSecretKey = () => process.env.PAYSTACK_SECRET_KEY,
} = {}) {
  async function request(path, method, data) {
    const secretKey = readSecretKey()?.trim();
    if (!secretKey) {
      throw new PaystackConfigurationError("PAYSTACK_SECRET_KEY must be configured");
    }

    let response;
    try {
      response = await fetchImpl(`${PAYSTACK_API_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PaystackRequestError("Unable to reach Paystack");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new PaystackRequestError("Paystack returned an invalid response");
    }
    if (
      !response.ok
      || !payload
      || typeof payload !== "object"
      || payload.status !== true
      || !payload.data
      || typeof payload.data !== "object"
    ) {
      throw new PaystackRequestError("Paystack request failed");
    }
    return payload.data;
  }

  return {
    async initializeTransaction(transaction) {
      const data = await request("/transaction/initialize", "POST", {
        email: transaction.email,
        amount: transaction.amountMinor,
        currency: transaction.currency,
        reference: transaction.reference,
        callback_url: transaction.callbackUrl,
        metadata: transaction.metadata,
      });
      if (
        typeof data.authorization_url !== "string"
        || !data.authorization_url
        || typeof data.access_code !== "string"
        || !data.access_code
        || data.reference !== transaction.reference
      ) {
        throw new PaystackRequestError("Paystack returned incomplete checkout details");
      }
      let authorizationUrl;
      try {
        authorizationUrl = new URL(data.authorization_url);
      } catch {
        throw new PaystackRequestError("Paystack returned an invalid checkout URL");
      }
      if (authorizationUrl.protocol !== "https:") {
        throw new PaystackRequestError("Paystack returned an invalid checkout URL");
      }
      return {
        authorizationUrl: authorizationUrl.toString(),
        accessCode: data.access_code,
        reference: data.reference,
      };
    },

    async verifyTransaction(reference) {
      const data = await request(
        `/transaction/verify/${encodeURIComponent(reference)}`,
        "GET",
      );
      if (
        typeof data.reference !== "string"
        || typeof data.status !== "string"
        || !Number.isSafeInteger(data.amount)
        || typeof data.currency !== "string"
      ) {
        throw new PaystackRequestError("Paystack returned incomplete verification details");
      }
      return {
        reference: data.reference,
        status: data.status,
        amountMinor: data.amount,
        currency: data.currency,
        channel: data.channel || null,
        paidAt: data.paid_at || null,
      };
    },
  };
}

const paystackClient = createPaystackClient();

module.exports = {
  PaystackConfigurationError,
  PaystackRequestError,
  createPaystackClient,
  paystackClient,
};
