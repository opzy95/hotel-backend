const { v2: cloudinary } = require("cloudinary");

class CloudStorageConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudStorageConfigurationError";
  }
}

class CloudStorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudStorageError";
  }
}

function configuredCloudinary() {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
    throw new CloudStorageConfigurationError("Cloudinary is not configured");
  }
  cloudinary.config({
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    cloud_name: CLOUDINARY_CLOUD_NAME,
    secure: true,
  });
  return cloudinary;
}

function uploadImage(buffer) {
  const client = configuredCloudinary();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream({
      folder: "hotel-backend/room-types",
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp", "avif"],
    }, (error, result) => {
      if (error) {
        return reject(error);
      }
      return resolve({
        publicId: result.public_id,
        secureUrl: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
      });
    });
    stream.end(buffer);
  });
}

function uploadHotelProfileImage(buffer, hotelId) {
  const client = configuredCloudinary();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream({
      folder: `hotel-backend/hotels/${hotelId}/profile-images`,
      resource_type: "image",
      allowed_formats: ["jpg", "jpeg", "png", "webp", "avif"],
    }, (error, result) => {
      if (error) {
        return reject(error);
      }
      if (!result?.public_id || !result.secure_url) {
        return reject(new Error("Hotel profile image upload returned incomplete metadata"));
      }
      return resolve({
        publicId: result.public_id,
        secureUrl: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
      });
    });
    stream.end(buffer);
  }).catch((error) => {
    if (error instanceof CloudStorageConfigurationError) {
      throw error;
    }
    throw new CloudStorageError("Hotel profile image upload failed");
  });
}

function uploadReceipt(file) {
  const client = configuredCloudinary();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream({
      folder: "hotel-backend/payment-receipts",
      resource_type: "auto",
      allowed_formats: ["avif", "jpg", "jpeg", "png", "webp", "pdf"],
    }, (error, result) => {
      if (error) {
        return reject(error);
      }
      if (!result?.public_id || !result.secure_url || !result.resource_type || !result.format) {
        return reject(new Error("Receipt upload returned incomplete metadata"));
      }
      return resolve({
        publicId: result.public_id,
        secureUrl: result.secure_url,
        resourceType: result.resource_type,
        format: result.format,
        bytes: result.bytes,
      });
    });
    stream.end(file.buffer);
  }).catch((error) => {
    if (error instanceof CloudStorageConfigurationError) {
      throw error;
    }
    throw new CloudStorageError("Receipt upload failed");
  });
}

async function uploadImages(files) {
  const uploaded = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadImage(file.buffer));
    }
    return uploaded;
  } catch (error) {
    await deleteImages(uploaded).catch(() => {});
    if (error instanceof CloudStorageConfigurationError) {
      throw error;
    }
    throw new CloudStorageError("Cloudinary upload failed");
  }
}

async function deleteImage(publicId) {
  try {
    return await configuredCloudinary().uploader.destroy(publicId, {
      invalidate: true,
      resource_type: "image",
    });
  } catch (error) {
    if (error instanceof CloudStorageConfigurationError) {
      throw error;
    }
    throw new CloudStorageError("Cloudinary deletion failed");
  }
}

async function deleteReceipt(receipt) {
  try {
    return await configuredCloudinary().uploader.destroy(receipt.publicId, {
      invalidate: true,
      resource_type: receipt.resourceType,
    });
  } catch (error) {
    if (error instanceof CloudStorageConfigurationError) {
      throw error;
    }
    throw new CloudStorageError("Receipt deletion failed");
  }
}

async function deleteImages(images) {
  await Promise.all(images.map((image) => deleteImage(image.publicId)));
}

module.exports = {
  CloudStorageConfigurationError,
  CloudStorageError,
  deleteImage,
  deleteImages,
  deleteReceipt,
  uploadHotelProfileImage,
  uploadReceipt,
  uploadImages,
};