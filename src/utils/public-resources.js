function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email };
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
    settings: hotel.settings,
  };
}

module.exports = { publicHotel, publicUser };
