const multer = require("multer");

const acceptedMimeTypes = new Set([
  "application/pdf",
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const parseReceipt = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 32 * 1024,
    parts: 11,
  },
  fileFilter: (_req, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      return callback(new Error("unsupported_receipt_type"));
    }
    return callback(null, true);
  },
}).single("receipt");

function parseReceiptUpload(req, res, next) {
  parseReceipt(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error instanceof multer.MulterError) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "request_too_large"
          : "invalid_receipt_upload",
      });
    }
    if (error.message === "unsupported_receipt_type") {
      return res.status(400).json({ error: "unsupported_receipt_type" });
    }
    return next(error);
  });
}

module.exports = { parseReceiptUpload };
