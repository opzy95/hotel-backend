const authService = require("../services/auth-service");
const {
  emailOnlySchema,
  loginSchema,
  registrationSchema,
  resetPasswordSchema,
  verificationCodeSchema,
} = require("../schemas");
const { publicHotel, publicUser } = require("../utils/public-resources");

function validationDetails(issues) {
  return issues.map(({ path, message }) => ({
    path: path.join("."),
    message,
  }));
}

async function register(req, res) {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  try {
    const result = await authService.register(
      parsed.data,
      req.app.locals.sendVerificationCodeEmail,
    );
    if (result.error === "account_already_exists") {
      return res.status(409).json({ error: result.error });
    }
    return res.status(201).json({
      user: publicUser(result.user),
      hotel: publicHotel(result.hotel),
      membership: { role: "manager", status: "active" },
      onboarding: { currentStep: "choose_plan", completedSteps: ["registration"] },
      emailVerificationRequired: true,
      message: "We sent a code to your email.",
      verificationCodeResendAvailableInSeconds: 60,
    });
  } catch (error) {
    if (error instanceof authService.EmailDeliveryError) {
      return res.status(503).json({
        error: "verification_email_delivery_failed",
        message: "Your account was created, but the verification code could not be sent. Please request a new code in 60 seconds.",
      });
    }
    throw error;
  }
}

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_credentials" });
  }
  const result = await authService.login(parsed.data);
  if (result.error === "invalid_credentials") {
    return res.status(401).json({ error: result.error });
  }
  if (result.error === "email_not_verified") {
    return res.status(403).json({ error: result.error });
  }
  return res.json(result);
}

async function verifyCode(req, res) {
  const parsed = verificationCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_verification_code" });
  }
  const result = await authService.verifyEmailCode(parsed.data.email, parsed.data.code);
  if (result.error === "verification_code_locked") {
    return res.status(429).json({
      error: result.error,
      message: "Too many incorrect attempts. Request a new verification code.",
    });
  }
  if (result.error) {
    return res.status(400).json(result);
  }
  return res.json({ message: "Email address verified. You can now log in." });
}

async function resendVerification(req, res) {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_email" });
  }
  try {
    await authService.resendVerification(
      parsed.data.email,
      req.app.locals.sendVerificationCodeEmail,
    );
  } catch (error) {
    if (error instanceof authService.EmailDeliveryError) {
      return res.status(503).json({ error: "email_delivery_unavailable" });
    }
    throw error;
  }
  return res.status(202).json({
    message: "If the account exists and needs verification, we sent a code to your email.",
    resendAvailableInSeconds: 60,
  });
}

async function forgotPassword(req, res) {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_email" });
  }
  try {
    await authService.sendPasswordReset(
      parsed.data.email,
      req.app.locals.sendPasswordResetEmail,
    );
  } catch (error) {
    if (error instanceof authService.EmailDeliveryError) {
      return res.status(503).json({ error: "email_delivery_unavailable" });
    }
    throw error;
  }
  return res.status(202).json({
    message: "If an account exists for that email, a password reset link has been sent.",
  });
}

async function resetPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "validation_error",
      details: validationDetails(parsed.error.issues),
    });
  }
  if (!await authService.resetPassword(parsed.data.token, parsed.data.password)) {
    return res.status(400).json({ error: "invalid_or_expired_token" });
  }
  return res.json({ message: "Password reset successfully. Please log in again." });
}

async function currentUser(req, res) {
  return res.json(await authService.getCurrentUser(req.user));
}

module.exports = {
  currentUser,
  forgotPassword,
  login,
  register,
  resendVerification,
  resetPassword,
  verifyCode,
};
