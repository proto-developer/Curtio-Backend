const { verifyToken } = require("../lib/jwt");

/**
 * Socket.IO authentication middleware.
 *
 * Reads the JWT from `socket.handshake.auth.token`, verifies it using
 * the same secret/logic as the REST API, and attaches the decoded
 * payload to `socket.user`.
 *
 * If the token is missing or invalid the connection is rejected with
 * an `Error` — Socket.IO surfaces this as a `connect_error` on the client.
 */
const socketAuth = (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: No token provided."));
    }

    const decoded = verifyToken(token);   // { id, email, name, isOwner }
    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error("Authentication error: Invalid or expired token."));
  }
};

module.exports = socketAuth;
