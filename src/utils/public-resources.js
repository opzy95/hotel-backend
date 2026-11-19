function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email };
}

function hotelBankDetails(bankDetails) {
  if (!bankDetails) {
    return null;
  }
  return {
    bankName: bankDetails.bankName,
    bankAccountNumber: bankDetails.bankAccountNumber,
    accountName: bankDetails.accountName,
  };
}

function publicHotel(hotel) {
  return {
    id: hotel._id,
    name: hotel.name,
    email: hotel.email,
    phone: hotel.phone,
    address: hotel.address,
    type: hotel.type,
    roomCount: hotel.roomCount,
    slug: hotel.slug,
    status: hotel.status,
    settings: hotel.settings || {},
    bankDetails: hotelBankDetails(hotel.bankDetails),
  };
}

function publicHotelDetails(hotel) {
  const settings = hotel.settings || {};
  const address = hotel.address || {};
  return {
    name: hotel.name,
    slug: hotel.slug,
    phone: hotel.phone,
    address: {
      line1: address.line1,
      line2: address.line2 || "",
      city: address.city,
      region: address.region || "",
      postalCode: address.postalCode || "",
      country: address.country,
    },
    type: hotel.type,
    bankDetails: hotelBankDetails(hotel.bankDetails),
    settings: {
      timezone: settings.timezone || "UTC",
      locale: settings.locale || null,
      currency: settings.currency || null,
      checkInTime: settings.checkInTime || null,
      checkOutTime: settings.checkOutTime || null,
    },
  };
}

module.exports = { publicHotel, publicHotelDetails, publicUser };
