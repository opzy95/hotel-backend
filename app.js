require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const { Hotel } = require("./src/models");
const { assertJwtConfig } = require("./src/utils/jwt");
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("./src/services/brevo-email");
const routes = require("./src/routes");
const { ensurePublicPlans } = require("./src/services/plan-seed");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.locals.sendVerificationCodeEmail = sendVerificationEmail;
  app.locals.sendPasswordResetEmail = sendPasswordResetEmail;
  app.use(routes);

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
    return res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const port = parsePort(process.env.PORT);
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be configured");
  }
  assertJwtConfig();

  mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
      await Hotel.updateMany(
        { status: "approved" },
        { $set: { status: "active" } },
      );
      await ensurePublicPlans();
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
