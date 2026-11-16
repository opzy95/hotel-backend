const DEFAULT_RECEPTIONIST_PERMISSIONS = Object.freeze([
  "reservations.view",
  "reservations.create",
  "guests.view",
  "guests.create",
  "reservations.check_in",
  "reservations.check_out",
  "reservations.extend",
  "rooms.availability.view",
  "payments.walk_in.create",
]);

const RECEPTIONIST_PERMISSIONS = Object.freeze([
  ...DEFAULT_RECEPTIONIST_PERMISSIONS,
  "payments.create",
  "reservations.extend",
]);

module.exports = {
  DEFAULT_RECEPTIONIST_PERMISSIONS,
  RECEPTIONIST_PERMISSIONS,
};
