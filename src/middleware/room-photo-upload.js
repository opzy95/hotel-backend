const multer = require("multer");

const acceptedMimeTypes = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const parseRoomPhotos = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      return callback(new Error("unsupported_image_type"));
    }
    return callback(null, true);
  },
}).array("photos", 10);

module.exports = { parseRoomPhotos };