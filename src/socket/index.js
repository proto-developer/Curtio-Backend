const { Server } = require("socket.io");
const socketAuth = require("./auth");
const registerEvents = require("./events");

let io = null;

/**
 * Initialize the Socket.IO server and attach it to the existing
 * HTTP server.  Must be called exactly once from server.js.
 *
 * @param {import("http").Server} httpServer
 */
const initSocket = (httpServer) => {
  // Reuse the same CORS origins that the REST API already allows
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

  const isDevLocalhostOrigin = (origin) =>
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/localhost(:\d+)?$/.test(origin);

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || corsOrigins.includes(origin) || isDevLocalhostOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Production tuning
    pingTimeout: 60000,      // how long to wait for a pong before disconnecting
    pingInterval: 25000,     // heartbeat interval
    transports: ["websocket", "polling"],  // prefer WebSocket, fall back to polling
  });

  // ── Auth middleware ──────────────────────────────────────────────
  io.use(socketAuth);

  // ── Event handlers ───────────────────────────────────────────────
  registerEvents(io);

  console.log("✅ Socket.IO initialized");

  return io;
};

/**
 * Returns the initialized Socket.IO server instance.
 * Throws if called before `initSocket()`.
 */
const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized. Call initSocket() first.");
  }
  return io;
};

module.exports = { initSocket, getIO };
