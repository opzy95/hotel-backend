const { createHash, randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
const {
  HotelInvitation,
  HotelMembership,
  StaffMember,
  User,
} = require("../models");

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

class InvitationEmailDeliveryError extends Error {}

function hashInvitationToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createInvitationToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInvitationToken(token) };
}

function invitationResource(invitation) {
  const status = invitation.consumedAt
    ? "accepted"
    : invitation.revokedAt
      ? "revoked"
      : invitation.expiresAt <= new Date()
        ? "expired"
        : "pending";
  return {
    id: invitation._id,
    hotelId: invitation.hotelId,
    staffMemberId: invitation.staffMemberId || null,
    email: invitation.email,
    role: invitation.role,
    permissions: invitation.permissions,
    status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

async function deliverInvitation(invitation, token, sendEmail) {
  try {
    await sendEmail(invitation, token);
  } catch (error) {
    console.error("Staff invitation email delivery failed", error);
    await HotelInvitation.updateOne(
      { _id: invitation._id, tokenHash: hashInvitationToken(token), consumedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw new InvitationEmailDeliveryError("invitation_email_delivery_failed");
  }
}

async function createInvitation(hotelId, data, invitedByUserId, sendEmail) {
  let staffMember = null;
  if (data.staffMemberId) {
    staffMember = await StaffMember.findOne({
      _id: data.staffMemberId,
      hotelId,
    }).select("_id email role");
    if (!staffMember) {
      return { error: "staff_member_not_found" };
    }
    if (staffMember.role.trim().toLowerCase() !== "receptionist") {
      return { error: "staff_member_not_receptionist" };
    }
  }
  const email = (staffMember?.email || data.email).toLowerCase();
  if (!staffMember) {
    staffMember = await StaffMember.findOne({
      hotelId,
      email,
      role: { $regex: /^receptionist$/i },
    }).select("_id");
  }
  if (await User.exists({ email })) {
    return { error: "account_already_exists" };
  }

  const existing = await HotelInvitation.findOne({
    hotelId,
    email,
    revokedAt: null,
    consumedAt: null,
  });
  if (existing && existing.expiresAt > new Date()) {
    return { error: "staff_invitation_already_exists" };
  }

  const token = createInvitationToken();
  const now = new Date();
  let invitation;
  if (existing) {
    invitation = await HotelInvitation.findOneAndUpdate(
      { _id: existing._id, revokedAt: null, consumedAt: null },
      {
        $set: {
          tokenHash: token.tokenHash,
          permissions: data.permissions,
          invitedByUserId,
          staffMemberId: staffMember?._id || null,
          expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
        },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!invitation) {
      return { error: "staff_invitation_already_exists" };
    }
  } else {
    try {
      [invitation] = await HotelInvitation.create([{
        hotelId,
        staffMemberId: staffMember?._id || null,
        email,
        role: "receptionist",
        permissions: data.permissions,
        tokenHash: token.tokenHash,
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
        invitedByUserId,
      }]);
    } catch (error) {
      if (error.code === 11000) {
        return { error: "staff_invitation_already_exists" };
      }
      throw error;
    }
  }

  await deliverInvitation(invitation, token.token, sendEmail);
  return { invitation: invitationResource(invitation) };
}

async function listInvitations(hotelId) {
  const invitations = await HotelInvitation.find({ hotelId })
    .sort({ createdAt: -1 })
    .lean();
  return { invitations: invitations.map(invitationResource) };
}

async function revokeInvitation(hotelId, invitationId) {
  const invitation = await HotelInvitation.findOneAndUpdate(
    { _id: invitationId, hotelId, revokedAt: null, consumedAt: null },
    { $set: { revokedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  return invitation
    ? { invitation: invitationResource(invitation) }
    : { error: "staff_invitation_not_found" };
}

async function resendInvitation(hotelId, invitationId, invitedByUserId, sendEmail) {
  const token = createInvitationToken();
  const now = new Date();
  const invitation = await HotelInvitation.findOneAndUpdate(
    { _id: invitationId, hotelId, revokedAt: null, consumedAt: null },
    {
      $set: {
        tokenHash: token.tokenHash,
        invitedByUserId,
        expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!invitation) {
    return { error: "staff_invitation_not_found" };
  }

  await deliverInvitation(invitation, token.token, sendEmail);
  return { invitation: invitationResource(invitation) };
}

async function acceptInvitation(data) {
  const email = data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(data.password, 12);
  const now = new Date();
  const session = await HotelInvitation.startSession();
  let accepted = false;
  try {
    await session.withTransaction(async () => {
      const invitation = await HotelInvitation.findOneAndUpdate(
        {
          tokenHash: hashInvitationToken(data.token),
          hotelId: data.hotelId,
          email,
          role: "receptionist",
          revokedAt: null,
          consumedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { consumedAt: now } },
        { returnDocument: "after", session },
      );
      if (!invitation) {
        return;
      }
      if (await User.exists({ email }).session(session)) {
        return;
      }
      const [user] = await User.create([{
        name: data.name,
        email,
        passwordHash,
        emailVerifiedAt: now,
      }], { session });
      await HotelMembership.create([{
        hotelId: invitation.hotelId,
        userId: user._id,
        staffMemberId: invitation.staffMemberId || null,
        role: "receptionist",
        permissions: invitation.permissions,
        status: "active",
      }], { session });
      accepted = true;
    });
  } finally {
    await session.endSession();
  }
  return accepted ? { accepted: true } : { error: "invalid_or_expired_invitation" };
}

module.exports = {
  InvitationEmailDeliveryError,
  acceptInvitation,
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
};
