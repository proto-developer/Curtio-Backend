const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const connectDB = require("./config/db");
const authMiddleware = require("./middleware/auth.middleware");
const authRoutes = require("./modules/auth/auth.routes");
const accountRoutes = require("./modules/account/account.routes");
const billingRoutes = require("./modules/billing/billing.routes");
const urlRoutes = require("./modules/urls/url.routes");
const urlController = require("./modules/urls/url.controller");

const app = express();

/* ── CORS ── */
const configuredOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

const isDevLocalhostOrigin = (origin) =>
  process.env.NODE_ENV !== "production" &&
  /^https?:\/\/localhost(:\d+)?$/.test(origin);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || configuredOrigins.includes(origin) || isDevLocalhostOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

/* ── Middlewares ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ── DB Connection Middleware (For Serverless) ── */
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("DB Connection Error in Middleware:", error);
    res.status(500).json({ success: false, message: "Database connection failed." });
  }
});

/* ── Health Check ── */
app.get("/", (req, res) => {
  res.json({ success: true, message: "Curtio Staging is Live!" });
});

/* ── Auth Routes ── */
app.use("/api/auth", authRoutes);

/* ── Dashboard (Protected) ── */
app.use("/api", accountRoutes);

/* ── Plan Status (Protected) ── */
app.use("/api", billingRoutes);

/* ── URL Routes (Protected) ── */
app.use("/api/urls", authMiddleware, urlRoutes);

/* ── Public Password Verify Route ── */
// Called by the /password/:shortCode page in the SPA when a visitor submits the
// password for a protected link. Must stay public — the visitor has no account.
app.post("/api/public/verify/:shortCode", urlController.verifyLinkPassword);

/* ── Public Click-Track Route ── */
// Called by the loader page JS once its redirect countdown fires.
// No auth required — the short code is the only identifier needed.
app.post("/api/track/:shortCode", urlController.trackClick);

/* ── Public Pre-Click Track Route ── */
// Called immediately when the loader page opens, before the countdown starts.
app.post("/api/preclick/:shortCode", urlController.trackPreClick);

/* ── Public Redirect Route ── */
app.get("/:shortCode", urlController.handleRedirect);

module.exports = app;
