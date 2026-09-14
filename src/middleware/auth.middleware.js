const { verifyToken } = require("../lib/jwt");

/**
 * JWT Auth Middleware
 * Reads the Bearer token from Authorization header,
 * verifies it, and attaches the decoded user to req.user.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, email, name }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};


module.exports = authMiddleware;
