/**
 * Socket.IO connection event handlers.
 *
 * After authentication (handled by the middleware in auth.js), every
 * connected socket is automatically joined to a private room keyed by
 * the authenticated user's MongoDB _id.  This ensures that emitted
 * events (e.g. `analytics:updated`) are only delivered to the URL owner.
 */
const registerEvents = (io) => {
  io.on("connection", (socket) => {
    const userId = socket.user.id;

    // ── Join private room ──────────────────────────────────────────
    socket.join(userId);
    console.log(
      `🔌 [Socket] User connected — id: ${userId}  socket: ${socket.id}`
    );

    // ── Disconnect logging ─────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      console.log(
        `❌ [Socket] User disconnected — id: ${userId}  socket: ${socket.id}  reason: ${reason}`
      );
    });

    // ── Error handler ──────────────────────────────────────────────
    socket.on("error", (err) => {
      console.error(
        `⚠️ [Socket] Error — id: ${userId}  socket: ${socket.id}`,
        err.message
      );
    });
  });
};

module.exports = registerEvents;
    