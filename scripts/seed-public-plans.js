require("dotenv").config();

const mongoose = require("mongoose");
const { ensurePublicPlans } = require("../src/services/plan-seed");

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be configured");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const seeded = await ensurePublicPlans();
  console.log(`Seeded ${seeded.plans.length} plans and ${seeded.plan_prices.length} price entries.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Failed to seed public plans", error);
  process.exitCode = 1;
});
