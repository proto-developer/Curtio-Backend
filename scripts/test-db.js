const connectDB = require("../src/config/db");

(async () => {
  try {
    await connectDB();
    console.log("✅ Database connected successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err);
    process.exit(1);
  }
})();
