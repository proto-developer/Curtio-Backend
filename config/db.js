const mongoose = require("mongoose");
const env = require("./env");

// Track connection state
let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log("Using existing MongoDB connection");
    return;
  }

  // Check if mongoose already has an active connection (e.g. from a previous hot reload)
  if (mongoose.connections.length > 0 && mongoose.connections[0].readyState === 1) {
    isConnected = true;
    console.log("Using existing MongoDB connection from Mongoose");
    return;
  }

  try {
    const db = await mongoose.connect(env.DB_URL, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });

    isConnected = db.connections[0].readyState === 1;
    console.log("MongoDB Connected Successfully");

    // One-off cleanup: remove the legacy TTL index that deleted lapsed
    // subscriptions. No-op once it is gone. Never blocks startup.
    try {
      const { dropExpiryTtlIndex } = require("../models/Subscription");
      await dropExpiryTtlIndex();
    } catch (err) {
      console.error("Subscription index cleanup skipped:", err.message);
    }
  } catch (error) {
    console.error("Error while connecting to MongoDB", error);
    throw error;
  }
};

module.exports = connectDB;