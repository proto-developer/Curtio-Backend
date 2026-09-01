const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { isOwner } = require("../config/owners");

/**
 * Generate a JWT token for a user.
 * Expires in 7 days. A new token is issued on every login / OTP verification.
 */
const generateToken = async (user) => {
  const ownerStatus = await isOwner(user.email);
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      name: user.name,
      isOwner: ownerStatus,
    },
    env.JWT_SECRET,
    { expiresIn: "10d" }
  );
};

/**
 * Verify a JWT token. Returns the decoded payload or throws an error.
 */
const verifyToken = (token) => {
  return jwt.verify(token, env.JWT_SECRET);
};

module.exports = { generateToken, verifyToken };
