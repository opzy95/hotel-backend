require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { PlatformOperator, User } = require("../src/models");

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (
    !process.env.MONGO_URI
    || !email
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !password
    || password.length < 12
    || Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new Error(
      "Set MONGO_URI, a valid SUPER_ADMIN_EMAIL, and a 12-72 byte SUPER_ADMIN_PASSWORD",
    );
  }

  await mongoose.connect(process.env.MONGO_URI);
  let user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    user = await User.create({
      email,
      name: "Platform Administrator",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerifiedAt: new Date(),
    });
  } else if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
  }
  await PlatformOperator.updateOne(
    { userId: user._id },
    { $set: { role: "super_admin", active: true } },
    { upsert: true },
  );
  console.log(`Platform operator provisioned for ${email}`);
}

main()
  .catch((error) => {
    console.error("Failed to provision platform operator", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
