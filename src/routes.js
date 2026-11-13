const express = require("express");
const { rateLimit } = require("express-rate-limit");
const authController = require("./controllers/auth-controller");
const guestController = require("./controllers/guest-controller");
const hotelController = require("./controllers/hotel-controller");
const platformController = require("./controllers/platform-controller");
const reservationController = require("./controllers/reservation-controller");
const roomController = require("./controllers/room-controller");
const staffController = require("./controllers/staff-controller");
const { parseRoomPhotos } = require("./middleware/room-photo-upload");
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
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const publicReservationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const reservationLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
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
router.post(
  "/api/public/reservations",
  publicReservationLimiter,
  reservationController.createPublicReservation,
);
router.post(
  "/api/public/reservations/lookup",
  reservationLookupLimiter,
  reservationController.lookupPublicReservation,
);

router.post("/api/auth/register", registrationLimiter, authController.register);
router.post("/api/auth/login", loginLimiter, authController.login);
router.post("/api/auth/refresh", refreshLimiter, authController.refresh);
router.post("/api/auth/logout", authController.logout);
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
  "/api/hotels/:hotelId/room-types",
  authenticate,
  requireManager,
  roomController.listRoomTypes,
);
router.post(
  "/api/hotels/:hotelId/room-types",
  authenticate,
  requireManager,
  roomController.createRoomType,
);
router.patch(
  "/api/hotels/:hotelId/room-types/:roomTypeId",
  authenticate,
  requireManager,
  roomController.updateRoomType,
);
router.delete(
  "/api/hotels/:hotelId/room-types/:roomTypeId",
  authenticate,
  requireManager,
  roomController.deactivateRoomType,
);
router.post(
  "/api/hotels/:hotelId/room-types/:roomTypeId/photos",
  authenticate,
  requireManager,
  parseRoomPhotos,
  roomController.uploadRoomTypePhotos,
);
router.delete(
  "/api/hotels/:hotelId/room-types/:roomTypeId/photos/:photoId",
  authenticate,
  requireManager,
  roomController.removeRoomTypePhoto,
);
router.get(
  "/api/hotels/:hotelId/rooms",
  authenticate,
  requireManager,
  roomController.listRooms,
);
router.post(
  "/api/hotels/:hotelId/rooms",
  authenticate,
  requireManager,
  roomController.createRoom,
);
router.patch(
  "/api/hotels/:hotelId/rooms/:roomId",
  authenticate,
  requireManager,
  roomController.updateRoom,
);
router.delete(
  "/api/hotels/:hotelId/rooms/:roomId",
  authenticate,
  requireManager,
  roomController.deactivateRoom,
);
router.get(
  "/api/hotels/:hotelId/guests",
  authenticate,
  requireManager,
  guestController.listGuests,
);
router.patch(
  "/api/hotels/:hotelId/guests/:guestId",
  authenticate,
  requireManager,
  guestController.updateGuestProfile,
);
router.get(
  "/api/hotels/:hotelId/departments",
  authenticate,
  requireManager,
  staffController.listDepartments,
);
router.post(
  "/api/hotels/:hotelId/departments",
  authenticate,
  requireManager,
  staffController.createDepartment,
);
router.get(
  "/api/hotels/:hotelId/staff",
  authenticate,
  requireManager,
  staffController.listStaff,
);
router.post(
  "/api/hotels/:hotelId/staff",
  authenticate,
  requireManager,
  staffController.createStaffMember,
);
router.patch(
  "/api/hotels/:hotelId/staff/:staffId",
  authenticate,
  requireManager,
  staffController.updateStaffMember,
);
router.get(
  "/api/hotels/:hotelId/reservations/availability",
  authenticate,
  requireManager,
  reservationController.getAvailability,
);
router.get(
  "/api/hotels/:hotelId/reservations/:reservationId/payments",
  authenticate,
  requireManager,
  reservationController.listPayments,
);
router.post(
  "/api/hotels/:hotelId/reservations/:reservationId/payments",
  authenticate,
  requireManager,
  reservationController.recordPayment,
);
router.get(
  "/api/hotels/:hotelId/reservations",
  authenticate,
  requireManager,
  reservationController.listReservations,
);
router.post(
  "/api/hotels/:hotelId/reservations",
  authenticate,
  requireManager,
  reservationController.createAdminReservation,
);
router.patch(
  "/api/hotels/:hotelId/reservations/:reservationId",
  authenticate,
  requireManager,
  reservationController.updateReservation,
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
