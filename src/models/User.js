const mongoose = require("mongoose");

const urlSchema = new mongoose.Schema(
  {
    originalUrl: {
      type: String,
      required: true,
      trim: true,
    },
    shortCode: {
      type: String,
      required: true,
      trim: true,
    },
    clicks: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    password: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    labels: {
      type: [String],
      default: [],
    },
    campaigns: [
      {
        name: { type: String, required: true },
        source: { type: String, default: "" },
        medium: { type: String, default: "" },
        _id: false,
      },
    ],
    clickLogs: [
      {
        ip: String,
        userAgent: String,
        referer: String,
        xRequestedWith: String,

        secFetchSite: String,
        secFetchMode: String,
        secFetchDest: String,

        source: {
          type: String,
          default: "unknown",
        },

        isBot: {
          type: Boolean,
          default: false,
        },

        botReason: {
          type: String,
          default: null,
        },

        country: {
          type: String,
          default: "unknown",
        },

        countryCode: {
          type: String,
          default: "unknown",
        },

        clickedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    preClicks: {
      type: Number,
      default: 0,
    },
    preClickLogs: [
      {
        ip: String,
        userAgent: String,
        referer: String,

        source: {
          type: String,
          default: "unknown",
        },

        country: {
          type: String,
          default: "unknown",
        },

        countryCode: {
          type: String,
          default: "unknown",
        },

        clickedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    labels: {
      type: Map,
      of: {
        name: { type: String, required: true },
        color: { type: String, required: true }
      },
      default: {
        "1": { name: "Priority", color: "#ef4444" },
        "2": { name: "Marketing", color: "#3b82f6" },
        "3": { name: "Product", color: "#10b981" }
      }
    },
    urls: [urlSchema],
  },
  { timestamps: true }
);

// Ensure that shortCode is unique across all user records globally
userSchema.index({ "urls.shortCode": 1 }, { unique: true, sparse: true });

// Store in "Testing" database → "User" collection (matches Atlas exactly)
const User = mongoose.model("User", userSchema, "User");

module.exports = User;
