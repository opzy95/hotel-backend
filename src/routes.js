const express = require("express");
const { rateLimit } = require("express-rate-limit");
const authController = require("./controllers/auth-controller");
const hotelController = require("./controllers/hotel-controller");
const platformController = require("./controllers/platform-controller");
const {
  authenticate,
  requireManager,
  requirePlatformOperator,
  requireSubscriptionWriteAccess,
} = require("./middleware/auth");

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
router.get("/", (_req, res) => {
  res.json({ message: "Hotel backend is running" });
});
router.get("/api/public/plans", hotelController.publicPlans);

router.post("/api/auth/register", registrationLimiter, authController.register);
router.post("/api/auth/login", loginLimiter, authController.login);
router.post("/api/auth/send-verification-code", recoveryLimiter, authController.resendVerification);
router.post("/api/auth/verify-code", authController.verifyCode);
router.post("/api/auth/resend-verification", recoveryLimiter, authController.resendVerification);
router.post("/api/auth/forgot-password", recoveryLimiter, authController.forgotPassword);
router.post("/api/auth/reset-password", authController.resetPassword);
router.get("/api/auth/me", authenticate, authController.currentUser);

router.post("/api/hotels", authenticate, hotelController.createHotel);
router.get(
  "/api/hotels/:hotelId/onboarding",
  authenticate,
  requireManager,
  hotelController.onboarding,
);
router.put(
  "/api/hotels/:hotelId/subscription",
  authenticate,
  requireManager,
  hotelController.selectSubscriptionPlan,
);
router.patch(
  "/api/hotels/:hotelId/settings",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  hotelController.updateSettings,
);

router.get(
  "/api/platform/hotels",
  authenticate,
  requirePlatformOperator,
  platformController.listHotels,
);
router.get(
  "/api/platform/hotels/pending-approval",
  authenticate,
  requirePlatformOperator,
  platformController.listPendingApprovalHotels,
);
router.post(
  "/api/platform/hotels/:hotelId/approve",
  authenticate,
  requirePlatformOperator,
  platformController.approveHotel,
);
router.patch(
  "/api/platform/hotels/:hotelId/status",
  authenticate,
  requirePlatformOperator,
  platformController.updateHotelStatus,
);
router.post(
  "/api/platform/plans",
  authenticate,
  requirePlatformOperator,
  platformController.createPlan,
);

module.exports = router;
