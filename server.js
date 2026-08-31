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
  res.json({ success: true, message: "Bravely is Live!" });
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
