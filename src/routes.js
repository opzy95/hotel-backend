const express = require("express");
const { ipKeyGenerator, rateLimit } = require("express-rate-limit");
const authController = require("./controllers/auth-controller");
const guestController = require("./controllers/guest-controller");
const hotelController = require("./controllers/hotel-controller");
const platformController = require("./controllers/platform-controller");
const reservationController = require("./controllers/reservation-controller");
const roomController = require("./controllers/room-controller");
const staffController = require("./controllers/staff-controller");
const { parseReceiptUpload } = require("./middleware/receipt-upload");
const { parseRoomPhotos } = require("./middleware/room-photo-upload");
const {
  authenticate,
  requireManager,
  requireHotelPermission,
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
const invitationAcceptanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const staffInvitationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
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
const publicHotelLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const reservationLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const reservationReferenceIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const reservationReferenceEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return typeof email === "string" && email.trim()
      ? `email:${email.trim().toLowerCase()}`
      : ipKeyGenerator(req.ip);
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
router.get("/", (_req, res) => {
  res.json({ message: "Hotel backend is running" });
});
router.post(
  "/api/payments/paystack/webhook",
  hotelController.paystackWebhook,
);
router.get("/api/public/plans", hotelController.publicPlans);
router.get(
  "/api/public/hotels",
  publicHotelLimiter,
  hotelController.publicHotels,
);
router.get(
  "/api/public/hotels/:hotelSlug",
  publicHotelLimiter,
  hotelController.publicHotelBySlug,
);
router.get(
  "/api/public/hotels/:hotelSlug/availability",
  publicHotelLimiter,
  reservationController.getPublicAvailability,
);
router.post(
  "/api/public/reservations",
  publicReservationLimiter,
  parseReceiptUpload,
  reservationController.createPublicReservation,
);
router.post(
  "/api/public/reservations/lookup",
  reservationLookupLimiter,
  reservationController.lookupPublicReservation,
);
router.post(
  "/api/public/reservations/reference-email",
  reservationReferenceIpLimiter,
  reservationReferenceEmailLimiter,
  reservationController.requestUpcomingReservationReferences,
);

router.post("/api/auth/register", registrationLimiter, authController.register);
router.post(
  "/api/auth/accept-invitation",
  invitationAcceptanceLimiter,
  authController.acceptInvitation,
);
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
router.post(
  "/api/hotels/:hotelId/subscription/payments/initialize",
  authenticate,
  requireManager,
  hotelController.initializeSubscriptionPayment,
);
router.post(
  "/api/hotels/:hotelId/subscription/payments/verify",
  authenticate,
  requireManager,
  hotelController.verifySubscriptionPayment,
);
router.get(
  "/api/hotels/:hotelId/settings",
  authenticate,
  requireManager,
  hotelController.getSettings,
);
router.patch(
  "/api/hotels/:hotelId/settings",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  hotelController.updateSettings,
);
router.put(
  "/api/hotels/:hotelId/bank-details",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  hotelController.updateBankDetails,
);

router.get(
  "/api/hotels/:hotelId/room-types",
  authenticate,
  requireHotelPermission("rooms.availability.view"),
  roomController.listRoomTypes,
);
router.post(
  "/api/hotels/:hotelId/room-types",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.createRoomType,
);
router.patch(
  "/api/hotels/:hotelId/room-types/:roomTypeId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.updateRoomType,
);
router.delete(
  "/api/hotels/:hotelId/room-types/:roomTypeId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.deactivateRoomType,
);
router.post(
  "/api/hotels/:hotelId/room-types/:roomTypeId/photos",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  parseRoomPhotos,
  roomController.uploadRoomTypePhotos,
);
router.delete(
  "/api/hotels/:hotelId/room-types/:roomTypeId/photos/:photoId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.removeRoomTypePhoto,
);
router.get(
  "/api/hotels/:hotelId/rooms",
  authenticate,
  requireHotelPermission("rooms.availability.view"),
  roomController.listRooms,
);
router.post(
  "/api/hotels/:hotelId/rooms",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.createRoom,
);
router.patch(
  "/api/hotels/:hotelId/rooms/:roomId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.updateRoom,
);
router.delete(
  "/api/hotels/:hotelId/rooms/:roomId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  roomController.deactivateRoom,
);
router.get(
  "/api/hotels/:hotelId/guests",
  authenticate,
  requireHotelPermission("guests.view"),
  guestController.listGuests,
);
router.post(
  "/api/hotels/:hotelId/guests",
  authenticate,
  requireHotelPermission("guests.create"),
  requireSubscriptionWriteAccess,
  guestController.createGuest,
);
router.patch(
  "/api/hotels/:hotelId/guests/:guestId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
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
  requireSubscriptionWriteAccess,
  staffController.createDepartment,
);
router.get(
  "/api/hotels/:hotelId/staff",
  authenticate,
  requireManager,
  staffController.listStaff,
);
router.get(
  "/api/hotels/:hotelId/staff/invitations",
  authenticate,
  requireManager,
  staffController.listInvitations,
);
router.post(
  "/api/hotels/:hotelId/staff/invitations",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffInvitationLimiter,
  staffController.createInvitation,
);
router.post(
  "/api/hotels/:hotelId/staff/:staffId/invitation",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffInvitationLimiter,
  staffController.createStaffMemberInvitation,
);
router.post(
  "/api/hotels/:hotelId/staff/invitations/:invitationId/resend",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffInvitationLimiter,
  staffController.resendInvitation,
);
router.delete(
  "/api/hotels/:hotelId/staff/invitations/:invitationId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffController.revokeInvitation,
);
router.post(
  "/api/hotels/:hotelId/staff",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffController.createStaffMember,
);
router.patch(
  "/api/hotels/:hotelId/staff/:staffId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffController.updateStaffMember,
);
router.delete(
  "/api/hotels/:hotelId/staff/:staffId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  staffController.deleteStaffMember,
);
router.get(
  "/api/hotels/:hotelId/reservations/availability",
  authenticate,
  requireHotelPermission("rooms.availability.view"),
  reservationController.getAvailability,
);
router.get(
  "/api/hotels/:hotelId/reservations/:reservationId/payments",
  authenticate,
  requireHotelPermission("payments.walk_in.create"),
  reservationController.listPayments,
);
router.post(
  "/api/hotels/:hotelId/reservations/:reservationId/payments",
  authenticate,
  requireHotelPermission("payments.walk_in.create"),
  requireSubscriptionWriteAccess,
  reservationController.recordPayment,
);
router.get(
  "/api/hotels/:hotelId/reservations",
  authenticate,
  requireHotelPermission("reservations.view"),
  reservationController.listReservations,
);
router.post(
  "/api/hotels/:hotelId/reservations",
  authenticate,
  requireHotelPermission("reservations.create"),
  requireSubscriptionWriteAccess,
  reservationController.createAdminReservation,
);
router.post(
  "/api/hotels/:hotelId/reservations/walk-ins",
  authenticate,
  requireHotelPermission("reservations.create"),
  requireSubscriptionWriteAccess,
  reservationController.createWalkInReservation,
);
router.post(
  "/api/hotels/:hotelId/reservations/:reservationId/check-in",
  authenticate,
  requireHotelPermission("reservations.check_in"),
  requireSubscriptionWriteAccess,
  reservationController.checkInReservation,
);
router.post(
  "/api/hotels/:hotelId/reservations/:reservationId/check-out",
  authenticate,
  requireHotelPermission("reservations.check_out"),
  requireSubscriptionWriteAccess,
  reservationController.checkOutReservation,
);
router.post(
  "/api/hotels/:hotelId/reservations/:reservationId/extend",
  authenticate,
  requireHotelPermission("reservations.extend"),
  requireSubscriptionWriteAccess,
  reservationController.extendReservation,
);
router.patch(
  "/api/hotels/:hotelId/reservations/:reservationId",
  authenticate,
  requireManager,
  requireSubscriptionWriteAccess,
  reservationController.updateReservation,
);

router.get(
  "/api/platform/hotels",
  authenticate,
  requirePlatformOperator,
  platformController.listHotels,
);
router.get(
  "/api/platform/payments",
  authenticate,
  requirePlatformOperator,
  platformController.listPayments,
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
