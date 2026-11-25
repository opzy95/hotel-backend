const multer = require("multer");

const acceptedMimeTypes = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const uploadHotelProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
  },
  fileFilter: (_req, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      return callback(new Error("unsupported_image_type"));
    }
    return callback(null, true);
  },
});

const parseHotelProfileImage = uploadHotelProfileImage.single("image");
const parseHotelProfileImages = uploadHotelProfileImage.fields([
  { name: "coverImage", maxCount: 1 },
  { name: "secondaryImage", maxCount: 1 },
]);

module.exports = { parseHotelProfileImage, parseHotelProfileImages };
