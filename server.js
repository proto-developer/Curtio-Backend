const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const env = require("./config/env");
const connectDB = require("./config/db");
const authMiddleware = require("./middleware/auth.middleware");
const authRoutes = require("./modules/auth.routes");
const urlRoutes = require("./routes/url.routes");
const urlController = require("./controllers/url.controller");
const {
  getPremiumStatus,
  hasUnlimitedLinks,
  FREE_LINK_LIMIT,
  FREE_CAMPAIGN_LIMIT,
} = require("./config/premium");
const User = require("./models/User");

const app = express();

/* ── CORS ── */
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : "*",
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
app.get("/api/dashboard", authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: "Welcome to Dashboard!",
    user: req.user,
  });
});

/* ── Plan Status (Protected) ── */
// Small, cheap endpoint for the sidebar: the plan flags on their own, without
// the whole links payload. Lets the sidebar resolve its own plan card instead
// of waiting on a page to hand the data down.
app.get("/api/plan", authMiddleware, async (req, res) => {
  try {
    const [status, unlimitedLinks, user] = await Promise.all([
      getPremiumStatus(req.user.email),
      hasUnlimitedLinks(req.user.email),
      User.findById(req.user.id).select("urls.originalUrl urls.campaigns").lean(),
    ]);

    // A campaign is a name from utm_campaign in the destination URL OR from the
    // link's campaigns array — the same rule the Campaigns page groups by.
    const campaignNames = new Set();
    for (const url of user?.urls || []) {
      try {
        const tag = new URL(url.originalUrl).searchParams.get("utm_campaign");
        if (tag && tag.trim()) campaignNames.add(tag.trim());
      } catch (e) {
        /* not a parseable URL — no utm_campaign to read */
      }
      for (const c of url.campaigns || []) {
        const name = typeof c === "string" ? c : c?.name;
        if (name && name.trim()) campaignNames.add(name.trim());
      }
    }

    return res.status(200).json({
      success: true,
      isPremium: status.isPremium,
      unlimitedLinks,
      subscriptionStatus: status.status,
      subscriptionExpiresAt: status.expiresAt,
      linksCount: user?.urls?.length || 0,
      campaignsCount: campaignNames.size,
      freeLinkLimit: FREE_LINK_LIMIT,
      freeCampaignLimit: FREE_CAMPAIGN_LIMIT,
    });
  } catch (error) {
    console.error("Plan status error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

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

/* ── Start Server AFTER DB CONNECT ── */
const { initSocket } = require("./socket");

const startServer = async () => {
  try {
    await connectDB();

    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(env.PORT, () => {
      console.log(`✅ Server Started: http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error("❌ DB Connection Failed:", error);
    process.exit(1);
  }
};

// startServer();

// module.exports = app;


if (process.env.NODE_ENV !== "test") {
  startServer();
}

module.exports = app;
